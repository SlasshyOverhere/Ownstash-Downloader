import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Lock,
    Unlock,
    Shield,
    ShieldCheck,
    Eye,
    EyeOff,
    Video,
    Trash2,
    Download,
    Play,
    FolderOpen,
    Folder,
    AlertTriangle,
    Loader2,
    Plus,
    Settings,
    Key,
    RefreshCw,
    X,
    Monitor,
    ExternalLink,
    HelpCircle,
    Cloud,
    CloudOff,
    CheckCircle2,
    Clock,
    AlertCircle,
    Upload,
    PackageOpen,
    FileArchive,
    Music,
    Image,
    FileText
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { staggerContainer, fadeInUp } from '@/lib/animations';
import { toast } from 'sonner';
import api, { VaultStatus, VaultFile, formatBytes } from '@/services/api';
import { MediaPlayer } from '@/components/MediaPlayer';
import { open } from '@tauri-apps/plugin-dialog';
import {
    loadVaultIndexFromGDrive,
    isGDriveAvailable,
    VaultFileEntry,
    gdriveService
} from '@/services/gdriveService';
import {
    isVaultSetup,
    setupVaultCloud,
    unlockVaultCloud,
    lockVaultCloud,
    changeVaultPin,
    resetVaultCloud,
    addToVaultIndex,
    removeFromVaultIndex,
    isVaultCloudInitialized
} from '@/services/vaultCloudService';
import {
    initVaultFileSync,
    cleanupVaultFileSync,
    enqueueUpload,
    downloadFileFromCloud,
    cancelDownload,
    shouldAutoDownload,
    getPendingFiles,
    uploadSelectedFiles,
    VaultFileWithSync,
    DownloadProgress,
    CloudSyncStatus
} from '@/services/vaultFileSyncService';
import { CloudDownloadPopup } from '@/components/vault/CloudDownloadPopup';
import { CloudSyncModal, PendingFile } from '@/components/vault/CloudSyncModal';
import { FolderBrowserModal } from '@/components/vault/FolderBrowserModal';
import { VaultDownloadModal } from '@/components/vault/VaultDownloadModal';
import { useAuth } from '@/contexts/AuthContext';
import { signInWithGoogleBrowser } from '@/services/googleAuth';


// Player preference types
type PlayerPreference = 'internal' | 'external' | 'ask';

// Sync status icon component
function SyncStatusIcon({ status }: { status?: CloudSyncStatus }) {
    switch (status) {
        case 'synced':
            return <span title="Synced to cloud"><CheckCircle2 className="w-3.5 h-3.5 text-green-400" /></span>;
        case 'cloud_only':
            return <span title="Cloud only"><Cloud className="w-3.5 h-3.5 text-blue-400" /></span>;
        case 'pending':
            return <span title="Pending upload"><Clock className="w-3.5 h-3.5 text-yellow-400" /></span>;
        case 'syncing':
            return <span title="Syncing..."><Loader2 className="w-3.5 h-3.5 text-primary animate-spin" /></span>;
        case 'sync_failed':
            return <span title="Sync failed"><AlertCircle className="w-3.5 h-3.5 text-red-400" /></span>;
        default:
            return <span title="Not synced"><CloudOff className="w-3.5 h-3.5 text-muted-foreground" /></span>;
    }
}




// PIN Input Component
function PinInput({
    value,
    onChange,
    length = 8,
    error,
    disabled,
    onEnterPress
}: {
    value: string;
    onChange: (value: string) => void;
    length?: number;
    error?: string;
    disabled?: boolean;
    onEnterPress?: () => void;
}) {
    const [showPin, setShowPin] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value.replace(/\D/g, '').slice(0, length);
        onChange(newValue);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && onEnterPress) {
            e.preventDefault();
            onEnterPress();
        }
    };

    return (
        <div className="space-y-3">
            <div className="relative">
                <input
                    type={showPin ? 'text' : 'password'}
                    value={value}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    placeholder="Enter PIN"
                    className={cn(
                        'w-full px-4 py-3 text-center text-2xl tracking-[0.5em] rounded-xl',
                        'bg-muted/50 border-2 transition-all',
                        error ? 'border-red-500' : 'border-white/10 focus:border-primary',
                        'outline-none font-mono',
                        disabled && 'opacity-50 cursor-not-allowed'
                    )}
                    maxLength={length}
                    autoComplete="off"
                />
                <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                    {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
            </div>
            <div className="flex justify-center gap-2">
                {Array.from({ length }).map((_, i) => (
                    <div
                        key={i}
                        className={cn(
                            'w-3 h-3 rounded-full transition-all',
                            i < value.length
                                ? 'bg-primary scale-110'
                                : 'bg-muted/50'
                        )}
                    />
                ))}
            </div>
            {error && (
                <p className="text-center text-sm text-red-400">{error}</p>
            )}
        </div>
    );
}


export function VaultPage() {
    const { isOfflineMode, setOfflineMode, recheckGDriveToken } = useAuth();
    const [status, setStatus] = useState<VaultStatus | null>(null);
    const [files, setFiles] = useState<VaultFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [pin, setPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [pinError, setPinError] = useState('');
    const [mode, setMode] = useState<'loading' | 'setup' | 'locked' | 'unlocked' | 'settings'>('loading');

    // Media player state
    const [showPlayer, setShowPlayer] = useState(false);
    const [playerFilePath, setPlayerFilePath] = useState('');
    const [playerTitle, setPlayerTitle] = useState('');
    const [playerIsAudio, setPlayerIsAudio] = useState(false);

    // Settings modal
    const [showSettings, setShowSettings] = useState(false);
    const [currentPin, setCurrentPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmNewPin, setConfirmNewPin] = useState('');

    // Player preference settings
    const [playerPreference, setPlayerPreference] = useState<PlayerPreference>('internal');
    const [externalPlayerPath, setExternalPlayerPath] = useState<string>('');

    // Play method choice modal (for "ask every time" option)
    const [showPlayChoice, setShowPlayChoice] = useState(false);
    const [pendingPlayFile, setPendingPlayFile] = useState<VaultFile | null>(null);

    const vaultPinRef = useRef<string>(''); // Store PIN for cloud sync (in memory only)

    // Cloud download popup state
    const [showCloudDownload, setShowCloudDownload] = useState(false);
    const [cloudDownloadProgress, setCloudDownloadProgress] = useState<DownloadProgress | null>(null);
    const [pendingCloudPlayFile, setPendingCloudPlayFile] = useState<VaultFile | null>(null);

    // Cloud sync modal state
    const [showSyncModal, setShowSyncModal] = useState(false);
    const [pendingSyncFiles, setPendingSyncFiles] = useState<PendingFile[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);

    // Login state for offline mode
    const [isLoggingIn, setIsLoggingIn] = useState(false);

    // Folder browser modal state
    const [showFolderBrowser, setShowFolderBrowser] = useState(false);
    const [selectedFolder, setSelectedFolder] = useState<VaultFile | null>(null);

    // Image viewer state
    const [showImageViewer, setShowImageViewer] = useState(false);
    const [viewerImagePath, setViewerImagePath] = useState('');
    const [viewerImageName, setViewerImageName] = useState('');

    // Vault download modal state
    const [showDownloadModal, setShowDownloadModal] = useState(false);

    // Handle Google Sign In from vault when in offline mode
    const handleVaultGoogleSignIn = async () => {
        setIsLoggingIn(true);
        try {
            await signInWithGoogleBrowser();
            // Wait a bit for the token to be available
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Recheck GDrive token availability
            const hasToken = await recheckGDriveToken();
            if (hasToken) {
                setOfflineMode(false); // Exit offline mode
                toast.success('Signed in! Loading vault...');
                // Reload vault status
                loadStatus();
            } else {
                toast.error('Login completed but Google Drive access was not granted.');
            }
        } catch (err) {
            console.error('[Vault] Google sign-in error:', err);
            toast.error(err instanceof Error ? err.message : 'Failed to sign in with Google');
        } finally {
            setIsLoggingIn(false);
        }
    };


    // Handle sync to cloud button - shows modal with pending files
    const handleSyncToCloud = async () => {
        setIsSyncing(true);
        try {
            console.log('[Vault] Getting pending files...');
            const pending = await getPendingFiles();
            console.log('[Vault] Pending files:', pending.length, pending);

            if (pending.length === 0) {
                // Show a toast if nothing to upload
                toast.info('All files are already synced to cloud!');
                setShowSyncModal(false);
            } else {
                setPendingSyncFiles(pending.map(f => ({
                    id: f.id,
                    original_name: f.original_name,
                    encrypted_name: f.encrypted_name,
                    size_bytes: f.size_bytes,
                    file_type: f.file_type
                })));
                setShowSyncModal(true);
            }
        } catch (error) {
            console.error('[Vault] Failed to get pending files:', error);
            toast.error('Failed to check pending files');
        } finally {
            setIsSyncing(false);
        }
    };

    // Handle upload from sync modal
    const handleUploadSelected = async (fileIds: string[]) => {
        try {
            const result = await uploadSelectedFiles(fileIds, (current, total, fileName) => {
                console.log(`[Vault] Uploading ${current}/${total}: ${fileName}`);
            });

            if (result.failed === 0) {
                toast.success(`Successfully uploaded ${result.uploaded} file${result.uploaded !== 1 ? 's' : ''} to cloud!`);
            } else {
                toast.warning(`Uploaded ${result.uploaded}/${result.total} files. ${result.failed} failed.`);
            }

            // Refresh the files list to show updated sync status
            await loadFiles();
        } catch (error) {
            console.error('[Vault] Upload failed:', error);
            toast.error('Failed to upload files');
            throw error;
        }
    };

    // Sync vault index to Google Drive (encrypted with PIN)


    const loadStatus = useCallback(async () => {
        try {
            console.log('[Vault] Loading status...');

            // Check cloud status first (primary source of truth)
            if (isGDriveAvailable()) {
                const cloudSetup = await isVaultSetup();
                console.log('[Vault] Cloud vault setup:', cloudSetup);

                if (!cloudSetup) {
                    setMode('setup');
                    setLoading(false);
                    return;
                }

                // Vault is set up in cloud - check if unlocked
                if (isVaultCloudInitialized()) {
                    setMode('unlocked');
                    await loadFiles();
                } else {
                    setMode('locked');
                }

                // Get file count from disk for status display
                const localStatus = await api.vaultGetStatus();
                setStatus({
                    is_setup: true,
                    is_unlocked: isVaultCloudInitialized(),
                    file_count: localStatus.file_count,
                    total_size_bytes: localStatus.total_size_bytes
                });
            } else {
                // No GDrive - can't use vault in cloud-only mode
                console.warn('[Vault] Google Drive not available - vault requires cloud');
                setMode('setup');
                toast.error('Vault requires Google Drive. Please sign in.');
            }
        } catch (err) {
            console.error('Failed to load vault status:', err);
            setMode('setup');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadFiles = async () => {
        try {
            // Cloud-only mode: Load vault index from Google Drive
            if (isGDriveAvailable() && vaultPinRef.current) {
                console.log('[Vault] Loading files from Google Drive (cloud-only mode)');
                const cloudFiles = await loadVaultIndexFromGDrive(vaultPinRef.current);
                if (cloudFiles && Array.isArray(cloudFiles)) {
                    // Convert VaultFileEntry to VaultFile format (including sync status and folder info)
                    const vaultFiles = cloudFiles.map((f: VaultFileEntry & { cloud_sync_status?: string; cloud_file_id?: string }) => ({
                        id: f.id,
                        original_name: f.original_name,
                        encrypted_name: f.encrypted_name,
                        size_bytes: f.size_bytes,
                        added_at: f.added_at,
                        file_type: f.file_type,
                        thumbnail: f.thumbnail,
                        // Include folder-specific fields
                        is_folder: f.is_folder || false,
                        folder_entries: f.folder_entries,
                        // Include cloud sync fields
                        cloud_sync_status: f.cloud_sync_status,
                        cloud_file_id: f.cloud_file_id
                    }));
                    setFiles(vaultFiles);
                    console.log('[Vault] Loaded', vaultFiles.length, 'files from cloud with sync status');
                    return;
                }
            }
            // Fallback: empty list (no local index in cloud-only mode)
            console.log('[Vault] No cloud files or GDrive unavailable');
            setFiles([]);
        } catch (err) {
            console.error('[Vault] Failed to load vault files:', err);
            setFiles([]);
        }
    };

    useEffect(() => {
        loadStatus();
        loadPlayerPreferences();
    }, [loadStatus]);

    // Load player preferences from settings (try cloud first, then local)
    const loadPlayerPreferences = async () => {
        try {
            // Try to load from cloud first if available
            let pref: string | null = null;
            let playerPath: string | null = null;

            if (isGDriveAvailable()) {
                pref = await gdriveService.getSetting('', 'vault_player_preference');
                playerPath = await gdriveService.getSetting('', 'vault_external_player_path');
            }

            // Fallback to local if cloud doesn't have it
            if (!pref) {
                pref = await api.getSetting('vault_player_preference');
            }
            if (!playerPath) {
                playerPath = await api.getSetting('vault_external_player_path');
            }

            if (pref && ['internal', 'external', 'ask'].includes(pref)) {
                setPlayerPreference(pref as PlayerPreference);
            }

            if (playerPath) {
                setExternalPlayerPath(playerPath);
            }
        } catch (err) {
            console.log('[Vault] Could not load player preferences, using defaults');
        }
    };

    // Save player preference - syncs to BOTH local and cloud
    const savePlayerPreference = async (pref: PlayerPreference) => {
        setPlayerPreference(pref);
        try {
            // Save locally
            await api.saveSetting('vault_player_preference', pref);

            // Also sync to cloud if available
            if (isGDriveAvailable()) {
                await gdriveService.saveSetting('', 'vault_player_preference', pref);
                console.log('[Vault] Player preference synced to cloud:', pref);
            }
        } catch (err) {
            console.error('[Vault] Failed to save player preference:', err);
        }
    };

    // Save external player path - syncs to BOTH local and cloud
    const saveExternalPlayerPath = async (path: string) => {
        setExternalPlayerPath(path);
        try {
            // Save locally
            await api.saveSetting('vault_external_player_path', path);

            // Also sync to cloud if available
            if (isGDriveAvailable()) {
                await gdriveService.saveSetting('', 'vault_external_player_path', path);
                console.log('[Vault] External player path synced to cloud');
            }
        } catch (err) {
            console.error('[Vault] Failed to save external player path:', err);
        }
    };

    // Select external player executable
    const handleSelectExternalPlayer = async () => {
        try {
            const selected = await open({
                multiple: false,
                title: 'Select External Player Executable',
                filters: [{
                    name: 'Executable',
                    extensions: ['exe']
                }]
            });

            if (selected && typeof selected === 'string') {
                await saveExternalPlayerPath(selected);
                toast.success('External player set!');
            }
        } catch (err) {
            toast.error('Failed to select player');
        }
    };



    // Cleanup temp files when leaving
    useEffect(() => {
        return () => {
            api.vaultCleanupTemp().catch(console.error);
        };
    }, []);

    // NOTE: Auto-unlock disabled - user must click "Unlock Vault" button manually
    // This provides a more intentional unlock experience

    const handleSetup = async () => {
        if (pin.length < 4) {
            setPinError('PIN must be at least 4 digits');
            return;
        }
        if (pin !== confirmPin) {
            setPinError('PINs do not match');
            return;
        }

        if (!isGDriveAvailable()) {
            setPinError('Google Drive required. Please sign in first.');
            return;
        }

        try {
            setLoading(true);
            setPinError('');

            // Use cloud service for setup (stores PIN hash in GDrive and sets up backend)
            // NOTE: setupVaultCloud already handles api.vaultSetup internally
            await setupVaultCloud(pin);

            // Store PIN for cloud sync (in memory only)
            vaultPinRef.current = pin;

            toast.success('Vault created successfully!');
            setPin('');
            setConfirmPin('');
            await loadStatus();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to setup vault';
            setPinError(msg);
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    const handleUnlock = async (pinOverride?: string) => {
        const pinToUse = pinOverride || pin;
        console.log('[Vault] Attempting unlock with PIN length:', pinToUse.length);

        if (pinToUse.length < 4) {
            setPinError('Please enter your PIN');
            return;
        }

        if (!isGDriveAvailable()) {
            setPinError('Google Drive required. Please sign in.');
            return;
        }

        try {
            setLoading(true);
            setPinError('');

            // Use cloud service for unlock (verifies against cloud PIN hash)
            // NOTE: unlockVaultCloud already handles unlocking the Rust backend internally
            const cloudFiles = await unlockVaultCloud(pinToUse);

            // Store PIN for cloud sync (in memory only)
            vaultPinRef.current = pinToUse;

            toast.success('Vault unlocked!');
            setPin('');

            // Set files from cloud unlock response
            if (cloudFiles && cloudFiles.length > 0) {
                const vaultFiles = cloudFiles.map((f: VaultFileEntry & { cloud_sync_status?: string; cloud_file_id?: string }) => ({
                    id: f.id,
                    original_name: f.original_name,
                    encrypted_name: f.encrypted_name,
                    size_bytes: f.size_bytes,
                    added_at: f.added_at,
                    file_type: f.file_type,
                    thumbnail: f.thumbnail,
                    // Include cloud sync fields
                    cloud_sync_status: f.cloud_sync_status,
                    cloud_file_id: f.cloud_file_id
                }));
                setFiles(vaultFiles);
                console.log('[Vault] Loaded', vaultFiles.length, 'files from cloud');
            } else {
                setFiles([]);
            }

            setMode('unlocked');
            setLoading(false);

            // Initialize vault file sync service (background upload/download)
            try {
                await initVaultFileSync();
                console.log('[Vault] File sync service initialized');
            } catch (syncErr) {
                console.warn('[Vault] File sync initialization failed (non-fatal):', syncErr);
            }

            // Update status with local file count
            const localStatus = await api.vaultGetStatus();
            setStatus({
                is_setup: true,
                is_unlocked: true,
                file_count: localStatus.file_count,
                total_size_bytes: localStatus.total_size_bytes
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Invalid PIN';
            setPinError(msg);
            toast.error(msg);
            setLoading(false);
        }
    };

    const handleLock = async () => {
        try {
            // Cleanup cloud sync service
            cleanupVaultFileSync();

            // Lock both cloud service and backend
            lockVaultCloud();
            await api.vaultLock();
            await api.vaultCleanupTemp();

            // Clear PIN from memory when locking
            vaultPinRef.current = '';

            setFiles([]);
            setMode('locked');
            setLoading(false);
            toast.success('Vault locked');
        } catch (err) {
            toast.error('Failed to lock vault');
        }
    };

    // Unified upload handler - supports files, folders, and archives
    const handleUpload = async () => {
        try {
            // Open file/folder picker - allow any file type
            const selected = await open({
                multiple: false,
                directory: false, // Set to false - users can select files OR folders via picker
                title: 'Select file or archive to add to Vault',
            });

            if (!selected || typeof selected !== 'string') return;

            const fileName = selected.split(/[/\\]/).pop() || 'unknown';
            const extension = fileName.split('.').pop()?.toLowerCase() || '';

            // Determine file type
            let fileType = 'file';
            const archiveExtensions = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz'];

            if (['mp4', 'webm', 'mkv', 'avi', 'mov'].includes(extension)) {
                fileType = 'video';
            } else if (['mp3', 'm4a', 'flac', 'wav', 'opus', 'ogg'].includes(extension)) {
                fileType = 'audio';
            } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(extension)) {
                fileType = 'image';
            } else if (archiveExtensions.includes(extension)) {
                fileType = 'archive';
            }

            // For ZIP files, try to add as browsable archive
            if (extension === 'zip') {
                try {
                    toast.loading('Processing ZIP archive...');
                    const addedZip = await api.vaultAddZip(selected, false);
                    toast.dismiss();
                    toast.success('Archive added to vault!');

                    // Add to cloud index
                    const newZipEntry: VaultFileEntry = {
                        id: addedZip.id,
                        original_name: addedZip.original_name,
                        encrypted_name: addedZip.encrypted_name,
                        size_bytes: addedZip.size_bytes,
                        added_at: addedZip.added_at,
                        file_type: addedZip.file_type,
                        thumbnail: addedZip.thumbnail || undefined,
                        is_folder: true,
                        folder_entries: addedZip.folder_entries,
                    };

                    await addToVaultIndex(newZipEntry);

                    setFiles(prev => {
                        if (prev.some(f => f.id === addedZip.id)) return prev;
                        return [...prev, addedZip];
                    });

                    enqueueUpload(addedZip.id);
                    return;
                } catch (zipErr) {
                    // If ZIP parsing fails, fall through to regular file upload
                    console.warn('[Vault] ZIP parsing failed, treating as regular file:', zipErr);
                    toast.dismiss();
                }
            }

            // Regular file upload (including failed archives)
            toast.loading('Encrypting file...');
            console.log('[Vault] Adding file:', fileName, 'type:', fileType);
            const addedFile = await api.vaultAddFile(selected, fileName, fileType, undefined, true);
            console.log('[Vault] File added successfully:', addedFile);
            toast.dismiss();
            toast.success('File added to vault!');

            // Update state and sync to cloud via service
            const newFileEntry: VaultFileEntry = {
                id: addedFile.id,
                original_name: addedFile.original_name,
                encrypted_name: addedFile.encrypted_name,
                size_bytes: addedFile.size_bytes,
                added_at: addedFile.added_at,
                file_type: addedFile.file_type,
                thumbnail: addedFile.thumbnail
            };

            await addToVaultIndex(newFileEntry);

            // Update local state for immediate feedback
            const newFile: VaultFile = {
                ...newFileEntry
            };

            setFiles(prev => {
                if (prev.some(f => f.id === newFile.id)) return prev;
                return [...prev, newFile];
            });

            // Queue file for background cloud upload
            enqueueUpload(addedFile.id);

            console.log('[Vault] Cloud sync completed for new file via service');
        } catch (err) {
            console.error('[Vault] Failed to add file:', err);
            const msg = typeof err === 'string' ? err : (err instanceof Error ? err.message : String(err));
            toast.dismiss();
            toast.error(`Failed: ${msg}`);
            // Reload files on error to ensure UI consistency
            await loadFiles();
        }
    };

    // Legacy handler kept for backward compatibility
    const handleAddFile = handleUpload;

    // Extract archive (convert to browsable folder)
    // Note: This KEEPS the original file_type (archive) but adds is_folder and folder_entries
    // This way if app restarts, we can re-scan the archive to rebuild folder_entries
    const handleExtractArchive = async (file: VaultFile) => {
        try {
            toast.loading('Extracting archive contents...');

            // Call backend to scan archive structure (decrypt -> scan -> index)
            const entries = await api.vaultConvertToFolder(file.id, file.encrypted_name);

            // Update local file data - KEEP original file_type, just add folder capabilities
            const updatedFile: VaultFile = {
                ...file,
                is_folder: true,
                folder_entries: entries,
                // DO NOT change file_type - keep it as 'archive' so we can rescan if needed
            };

            // Update Cloud Index - preserve original file_type but add folder data
            const entry: VaultFileEntry = {
                id: updatedFile.id,
                original_name: updatedFile.original_name,
                encrypted_name: updatedFile.encrypted_name,
                size_bytes: updatedFile.size_bytes,
                added_at: updatedFile.added_at,
                file_type: file.file_type, // KEEP original type (archive, not folder)
                thumbnail: updatedFile.thumbnail || undefined,
                is_folder: true,
                folder_entries: entries,
            };

            await addToVaultIndex(entry);

            // Update local state
            setFiles(prev => prev.map(f => f.id === file.id ? updatedFile : f));

            toast.dismiss();
            toast.success('Archive extracted! You can now browse contents.');

            // Auto open the folder
            handleOpenFolder(updatedFile);

        } catch (err) {
            console.error('[Vault] Extraction failed:', err);
            toast.dismiss();
            // Show actual error from backend for better debugging
            const errorMsg = typeof err === 'string'
                ? err
                : (err instanceof Error ? err.message : String(err));
            toast.error(`Extraction failed: ${errorMsg}`);
        }
    };

    // Open folder browser modal
    // If folder_entries is missing (e.g., after app restart), rescan the archive
    const handleOpenFolder = async (folder: VaultFile) => {
        // Check if we need to rescan the archive for folder entries
        if (folder.is_folder && (!folder.folder_entries || folder.folder_entries.length === 0)) {
            try {
                toast.loading('Scanning archive contents...');

                // Rescan the archive to get folder entries
                const entries = await api.vaultConvertToFolder(folder.id, folder.encrypted_name);

                // Update the folder with entries
                const updatedFolder: VaultFile = {
                    ...folder,
                    folder_entries: entries,
                };

                // Update cloud index with the rescanned entries
                const entry: VaultFileEntry = {
                    id: updatedFolder.id,
                    original_name: updatedFolder.original_name,
                    encrypted_name: updatedFolder.encrypted_name,
                    size_bytes: updatedFolder.size_bytes,
                    added_at: updatedFolder.added_at,
                    file_type: updatedFolder.file_type,
                    thumbnail: updatedFolder.thumbnail || undefined,
                    is_folder: true,
                    folder_entries: entries,
                };

                await addToVaultIndex(entry);

                // Update local state
                setFiles(prev => prev.map(f => f.id === folder.id ? updatedFolder : f));

                toast.dismiss();

                setSelectedFolder(updatedFolder);
                setShowFolderBrowser(true);
            } catch (err) {
                console.error('[Vault] Failed to rescan archive:', err);
                toast.dismiss();
                toast.error('Failed to scan archive contents');
            }
        } else {
            setSelectedFolder(folder);
            setShowFolderBrowser(true);
        }
    };

    // Play a media file from inside a folder
    const handlePlayFolderFile = async (filePathInFolder: string) => {
        if (!selectedFolder) return;

        try {
            toast.info('Extracting and preparing file...');
            const tempPath = await api.vaultExtractFolderFile(
                selectedFolder.id,
                selectedFolder.encrypted_name,
                filePathInFolder
            );

            // Determine if audio or video based on extension
            const ext = filePathInFolder.split('.').pop()?.toLowerCase() || '';
            const isAudio = ['mp3', 'm4a', 'flac', 'wav', 'opus', 'ogg', 'aac'].includes(ext);

            // Play with internal player
            const fileName = filePathInFolder.split('/').pop() || 'Media';
            setPlayerFilePath(tempPath);
            setPlayerTitle(fileName);
            setPlayerIsAudio(isAudio);
            setShowPlayer(true);
        } catch (err) {
            console.error('[Vault] Failed to play folder file:', err);
            toast.error('Failed to play file');
        }
    };

    // Export a file from inside a folder
    const handleExportFolderFile = async (filePathInFolder: string) => {
        if (!selectedFolder) return;

        try {
            const destDir = await open({
                directory: true,
                title: 'Select export destination',
            });

            if (!destDir || typeof destDir !== 'string') return;

            toast.info('Extracting file...');
            const tempPath = await api.vaultExtractFolderFile(
                selectedFolder.id,
                selectedFolder.encrypted_name,
                filePathInFolder
            );

            // File extracted to temp location
            toast.success(`File extracted! Location: ${tempPath}`);
        } catch (err) {
            console.error('[Vault] Failed to export folder file:', err);
            toast.error('Failed to export file');
        }
    };

    // View an image from inside a folder
    const handleViewFolderImage = async (filePathInFolder: string, fileName: string) => {
        if (!selectedFolder) return;

        try {
            toast.info('Extracting image...');
            const tempPath = await api.vaultExtractFolderFile(
                selectedFolder.id,
                selectedFolder.encrypted_name,
                filePathInFolder
            );

            setViewerImagePath(tempPath);
            setViewerImageName(fileName);
            setShowImageViewer(true);
        } catch (err) {
            console.error('[Vault] Failed to view folder image:', err);
            toast.error('Failed to view image');
        }
    };


    // Handle play button click - respects player preference
    // Now checks if file is available locally and triggers cloud download if needed
    const handlePlay = async (file: VaultFile) => {
        // Check if file exists locally
        const isLocal = await api.vaultCheckLocalFile(file.encrypted_name);

        if (!isLocal) {
            // File not local - check if it's in cloud
            const fileWithSync = file as VaultFileWithSync;
            if (fileWithSync.cloud_file_id || fileWithSync.cloud_sync_status === 'cloud_only') {
                // Check if auto-download (small file)
                if (shouldAutoDownload(fileWithSync)) {
                    toast.info('Downloading from cloud...');
                    try {
                        await downloadFileFromCloud(file.id);
                        toast.success('Downloaded! Playing now...');
                        // Continue to play after download
                    } catch (e) {
                        toast.error('Failed to download file');
                        return;
                    }
                } else {
                    // Show download popup for larger files
                    setPendingCloudPlayFile(file);
                    setCloudDownloadProgress({
                        fileId: file.id,
                        fileName: file.original_name,
                        progress: 0,
                        downloadedBytes: 0,
                        totalBytes: file.size_bytes,
                        speed: 0,
                        status: 'downloading'
                    });
                    setShowCloudDownload(true);

                    try {
                        await downloadFileFromCloud(file.id, (progress) => {
                            setCloudDownloadProgress(progress);
                        });

                        setShowCloudDownload(false);
                        toast.success('Downloaded! Playing now...');
                        // Continue to play after download
                    } catch (e) {
                        setCloudDownloadProgress(prev => prev ? { ...prev, status: 'failed' } : null);
                        return;
                    }
                }
            } else {
                toast.error('File not found locally or in cloud');
                return;
            }
        }

        // File is available locally (or just downloaded), proceed with play
        if (playerPreference === 'ask') {
            // Show choice modal
            setPendingPlayFile(file);
            setShowPlayChoice(true);
        } else if (playerPreference === 'external') {
            await playWithExternalPlayer(file);
        } else {
            await playWithInternalPlayer(file);
        }
    };

    // Cancel cloud download
    const handleCancelCloudDownload = () => {
        cancelDownload();
        setCloudDownloadProgress(prev => prev ? { ...prev, status: 'cancelled' } : null);
        setTimeout(() => {
            setShowCloudDownload(false);
            setCloudDownloadProgress(null);
            setPendingCloudPlayFile(null);
        }, 1500);
    };

    // Retry cloud download
    const handleRetryCloudDownload = async () => {
        if (!pendingCloudPlayFile) return;

        setCloudDownloadProgress(prev => prev ? { ...prev, status: 'downloading', progress: 0 } : null);

        try {
            await downloadFileFromCloud(pendingCloudPlayFile.id, (progress) => {
                setCloudDownloadProgress(progress);
            });

            setShowCloudDownload(false);
            toast.success('Downloaded! Playing now...');

            // Play the file
            await handlePlay(pendingCloudPlayFile);
        } catch (e) {
            setCloudDownloadProgress(prev => prev ? { ...prev, status: 'failed' } : null);
        }
    };

    // Play with external player (fast, but may leave traces)
    const playWithExternalPlayer = async (file: VaultFile) => {
        try {
            toast.info('Decrypting for playback...');
            const tempPath = await api.vaultGetTempPlaybackPath(
                file.id,
                file.encrypted_name,
                file.original_name
            );

            toast.info('Opening in external player...');
            await api.openWithExternalPlayer(
                tempPath,
                externalPlayerPath || undefined
            );
            toast.success('Opened in external player!');
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to open file';
            toast.error(msg);
        }
    };

    // Play with internal player (secure, may need transcoding)
    const playWithInternalPlayer = async (file: VaultFile) => {
        try {
            toast.info('Decrypting for playback...');
            const tempPath = await api.vaultGetTempPlaybackPath(
                file.id,
                file.encrypted_name,
                file.original_name
            );

            // Check if format needs transcoding for web playback
            const extension = file.original_name.split('.').pop()?.toLowerCase() || '';
            // Web-supported formats for HTML5 video/audio
            const webSupportedVideo = ['mp4', 'webm', 'ogg', 'mov'];
            const webSupportedAudio = ['mp3', 'm4a', 'wav', 'flac', 'opus', 'ogg'];
            const isAudio = file.file_type === 'audio';

            const webSupported = isAudio ? webSupportedAudio : webSupportedVideo;

            let playablePath = tempPath;

            if (!webSupported.includes(extension) && !isAudio) {
                // Need to transcode video formats like MKV, AVI, etc.
                toast.info('Preparing video for playback... This may take a moment.');

                try {
                    const result = await api.transcodeForPlayback(tempPath);
                    playablePath = result.output_path;

                    if (result.was_transcoded) {
                        toast.success('Video ready!');
                    }
                } catch (transcodeErr) {
                    // If transcoding fails, try to play anyway (might work for some formats)
                    console.error('[VaultPage] Transcode failed:', transcodeErr);
                    toast.warning('Could not transcode video. Attempting direct playback...');
                }
            }

            setPlayerFilePath(playablePath);
            setPlayerTitle(file.original_name);
            setPlayerIsAudio(isAudio);
            setShowPlayer(true);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to play file';
            toast.error(msg);
        }
    };

    // Handle choice from the play method dialog
    const handlePlayChoice = async (method: 'internal' | 'external') => {
        setShowPlayChoice(false);
        if (pendingPlayFile) {
            if (method === 'external') {
                await playWithExternalPlayer(pendingPlayFile);
            } else {
                await playWithInternalPlayer(pendingPlayFile);
            }
            setPendingPlayFile(null);
        }
    };

    const handleExport = async (file: VaultFile) => {
        try {
            const selected = await open({
                directory: true,
                title: 'Select export destination',
            });

            if (!selected || typeof selected !== 'string') return;

            toast.info('Decrypting and exporting file...');
            const exportedPath = await api.vaultExportFile(
                file.id,
                file.encrypted_name,
                file.original_name,
                selected
            );
            toast.success(`Exported to: ${exportedPath}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to export file';
            toast.error(msg);
        }
    };

    const handleDelete = async (file: VaultFile) => {
        if (!confirm(`Are you sure you want to delete "${file.original_name}"? This cannot be undone.`)) {
            return;
        }

        try {
            await api.vaultDeleteFile(file.id);

            // Remove from cloud index via service
            await removeFromVaultIndex(file.id);

            setFiles(prev => prev.filter(f => f.id !== file.id));
            toast.success('File deleted');
        } catch (err) {
            toast.error('Failed to delete file');
            await loadFiles(); // Reload on error
        }
    };

    const handleChangePin = async () => {
        if (newPin.length < 4) {
            toast.error('New PIN must be at least 4 digits');
            return;
        }
        if (newPin !== confirmNewPin) {
            toast.error('New PINs do not match');
            return;
        }

        try {
            setLoading(true);
            // Use cloud service to change PIN (handles syncing everywhere)
            await changeVaultPin(currentPin, newPin);

            // Update local ref
            vaultPinRef.current = newPin;

            toast.success('PIN changed successfully!');
            setShowSettings(false);
            setCurrentPin('');
            setNewPin('');
            setConfirmNewPin('');
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to change PIN';
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    const handleReset = async () => {
        if (!confirm('WARNING: This will DELETE all files in the vault permanently. Are you sure?')) {
            return;
        }

        try {
            // Use cloud service to reset (deletes cloud data)
            await resetVaultCloud(currentPin);

            // Also invoke backend reset to clear local files if any
            try {
                await api.vaultReset(currentPin);
            } catch (e) {
                console.warn('[Vault] Backend reset warning (non-fatal):', e);
            }

            toast.success('Vault reset. You can set up a new one.');
            setShowSettings(false);
            setCurrentPin('');

            // Clear local state
            setFiles([]);
            setMode('setup');
            vaultPinRef.current = '';
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to reset vault';
            toast.error(msg);
        }
    };

    // Offline mode - Vault requires login
    if (isOfflineMode || !isGDriveAvailable()) {
        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6 p-6"
            >
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border border-yellow-500/30">
                            <Shield className="w-8 h-8 text-yellow-400" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold">Secure Vault</h1>
                            <p className="text-sm text-muted-foreground">Encrypted file storage</p>
                        </div>
                    </div>
                </div>

                {/* Login Required Card */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="max-w-md mx-auto mt-12"
                >
                    <div className="relative rounded-2xl bg-neutral-950/80 border border-white/10 p-8 text-center overflow-hidden">
                        {/* Gradient accent */}
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-yellow-500 via-orange-500 to-red-500" />

                        {/* Icon */}
                        <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border border-yellow-500/20 flex items-center justify-center mb-6">
                            <Lock className="w-10 h-10 text-yellow-400" />
                        </div>

                        <h2 className="text-xl font-bold text-white mb-2">Login Required</h2>
                        <p className="text-muted-foreground mb-6">
                            The Vault feature requires Google login to securely store your encrypted files in the cloud.
                        </p>

                        {/* Features */}
                        <div className="text-left bg-muted/20 rounded-xl p-4 mb-6 space-y-2">
                            <div className="flex items-center gap-3 text-sm">
                                <ShieldCheck className="w-4 h-4 text-green-400 shrink-0" />
                                <span className="text-muted-foreground">AES-256 encrypted storage</span>
                            </div>
                            <div className="flex items-center gap-3 text-sm">
                                <Cloud className="w-4 h-4 text-blue-400 shrink-0" />
                                <span className="text-muted-foreground">Synced to your Google Drive</span>
                            </div>
                            <div className="flex items-center gap-3 text-sm">
                                <Key className="w-4 h-4 text-purple-400 shrink-0" />
                                <span className="text-muted-foreground">PIN protected access</span>
                            </div>
                        </div>

                        {/* Google Sign In Button */}
                        <button
                            onClick={handleVaultGoogleSignIn}
                            disabled={isLoggingIn}
                            className={cn(
                                'w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl',
                                'bg-white text-black font-semibold',
                                'hover:bg-white/90 transition-all duration-200',
                                'disabled:opacity-50 disabled:cursor-not-allowed'
                            )}
                        >
                            {isLoggingIn ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    <span>Signing in...</span>
                                </>
                            ) : (
                                <>
                                    {/* Google Icon */}
                                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                                        <path
                                            fill="#4285F4"
                                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                        />
                                        <path
                                            fill="#34A853"
                                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                        />
                                        <path
                                            fill="#FBBC05"
                                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                        />
                                        <path
                                            fill="#EA4335"
                                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                        />
                                    </svg>
                                    <span>Sign in with Google</span>
                                </>
                            )}
                        </button>

                        <p className="text-[10px] text-muted-foreground/60 mt-4">
                            Your vault data is stored securely in your personal Google Drive.
                        </p>
                    </div>
                </motion.div>
            </motion.div>
        );
    }

    // Loading state
    if (mode === 'loading') {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }


    // Setup mode
    if (mode === 'setup') {
        return (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-md mx-auto text-center space-y-8 py-12"
            >
                <div className="space-y-4">
                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mx-auto">
                        <Shield className="w-10 h-10 text-primary" />
                    </div>
                    <h1 className="text-3xl font-display font-bold">Create Your Vault</h1>
                    <p className="text-muted-foreground">
                        Set up a PIN-protected encrypted vault to store sensitive downloads.
                        Files are encrypted with AES-256-GCM.
                    </p>
                </div>

                <div className="glass rounded-2xl p-6 space-y-6">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm text-muted-foreground mb-2">Create PIN (4-8 digits)</label>
                            <PinInput
                                value={pin}
                                onChange={(v) => { setPin(v); setPinError(''); }}
                                length={8}
                                disabled={loading}
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-muted-foreground mb-2">Confirm PIN</label>
                            <PinInput
                                value={confirmPin}
                                onChange={(v) => { setConfirmPin(v); setPinError(''); }}
                                length={8}
                                error={pinError}
                                disabled={loading}
                            />
                        </div>
                    </div>

                    <button
                        onClick={handleSetup}
                        disabled={loading || pin.length < 4 || confirmPin.length < 4}
                        className={cn(
                            'w-full py-3 rounded-xl font-medium transition-all',
                            'bg-gradient-to-r from-primary to-accent text-white',
                            'hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed',
                            'flex items-center justify-center gap-2'
                        )}
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Creating Vault...
                            </>
                        ) : (
                            <>
                                <ShieldCheck className="w-5 h-5" />
                                Create Vault
                            </>
                        )}
                    </button>
                </div>

                <p className="text-xs text-muted-foreground">
                    ⚠️ If you forget your PIN, vault contents cannot be recovered.
                </p>
            </motion.div>
        );
    }

    // Locked mode
    if (mode === 'locked') {
        return (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-md mx-auto text-center space-y-8 py-12"
            >
                <div className="space-y-4">
                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-yellow-500/20 to-orange-500/20 flex items-center justify-center mx-auto">
                        <Lock className="w-10 h-10 text-yellow-400" />
                    </div>
                    <h1 className="text-3xl font-display font-bold">Vault Locked</h1>
                    <p className="text-muted-foreground">
                        Enter your PIN to access your encrypted files.
                    </p>
                </div>

                <div className="glass rounded-2xl p-6 space-y-6">
                    <PinInput
                        value={pin}
                        onChange={(v) => { setPin(v); setPinError(''); }}
                        length={8}
                        error={pinError}
                        disabled={loading}
                        onEnterPress={() => {
                            if (pin.length >= 4 && !loading) {
                                handleUnlock();
                            }
                        }}
                    />

                    <div className="space-y-3">
                        <button
                            onClick={() => handleUnlock()}
                            disabled={loading || pin.length < 4}
                            className={cn(
                                'w-full py-3 rounded-xl font-medium transition-all',
                                'bg-gradient-to-r from-yellow-500 to-amber-600 text-black',
                                'hover:from-yellow-400 hover:to-amber-500 hover:shadow-lg hover:shadow-yellow-500/20',
                                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none',
                                'flex items-center justify-center gap-2'
                            )}
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Securing Access...
                                </>
                            ) : (
                                <>
                                    <Unlock className="w-5 h-5" />
                                    Unlock Vault
                                </>
                            )}
                        </button>

                        {/* Security message during unlock */}
                        {loading && (
                            <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="p-4 rounded-xl bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20"
                            >
                                <div className="flex items-start gap-3">
                                    <div className="p-2 rounded-lg bg-cyan-500/20">
                                        <Shield className="w-5 h-5 text-cyan-400" />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-cyan-400">
                                            Applying Security Measures
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Verifying PIN against encrypted cloud hash...
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Preparing AES-256-GCM decryption engine...
                                        </p>
                                        <p className="text-[10px] text-muted-foreground/70 mt-2">
                                            Please be patient. This may take a moment to fully secure your files.
                                        </p>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </div>
                </div>

                {status && (
                    <p className="text-sm text-muted-foreground">
                        {status.file_count} encrypted file{status.file_count !== 1 ? 's' : ''} • {formatBytes(status.total_size_bytes)}
                    </p>
                )}
            </motion.div>
        );
    }

    // Unlocked mode - show files
    return (
        <>
            <motion.div
                variants={staggerContainer}
                initial="initial"
                animate="animate"
                className="w-full max-w-6xl mx-auto space-y-6 px-4"
            >
                {/* Header */}
                <motion.div variants={fadeInUp} className="glass-panel rounded-2xl p-6 border-glow">
                    {/* Top row: Title and Lock button */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center shrink-0">
                                <ShieldCheck className="w-7 h-7 text-green-400" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-display font-bold flex flex-wrap items-center gap-2">
                                    Private Vault
                                    <span className="px-2 py-0.5 text-xs font-medium bg-green-500/20 text-green-400 rounded-full">
                                        Unlocked
                                    </span>
                                    {isGDriveAvailable() && (
                                        <span className="px-2 py-0.5 text-xs font-medium bg-purple-500/20 text-purple-400 rounded-full flex items-center gap-1">
                                            <Cloud className="w-3 h-3" />
                                            Cloud
                                        </span>
                                    )}
                                </h1>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {files.length} file{files.length !== 1 ? 's' : ''} • {formatBytes(files.reduce((acc, f) => acc + f.size_bytes, 0))}
                                </p>
                            </div>
                        </div>

                        {/* Utility buttons (Settings, Lock) */}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={async () => {
                                    toast.info('Refreshing files...');
                                    await loadFiles();
                                    toast.success('Files refreshed!');
                                }}
                                className="p-2.5 rounded-xl glass-hover hover:bg-white/10 transition-colors"
                                title="Refresh Files"
                            >
                                <RefreshCw className="w-5 h-5" />
                            </button>
                            <button
                                onClick={() => setShowSettings(true)}
                                className="p-2.5 rounded-xl glass-hover hover:bg-white/10 transition-colors"
                                title="Vault Settings"
                            >
                                <Settings className="w-5 h-5" />
                            </button>
                            <button
                                onClick={handleLock}
                                className="px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors border border-yellow-500/20"
                            >
                                <Lock className="w-4 h-4" />
                                <span className="hidden sm:inline">Lock Vault</span>
                                <span className="sm:hidden">Lock</span>
                            </button>
                        </div>
                    </div>

                    {/* Action buttons row */}
                    <div className="flex flex-wrap items-center gap-3">
                        {/* Primary actions */}
                        <button
                            onClick={handleUpload}
                            className="px-5 py-2.5 rounded-xl bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium flex items-center gap-2 transition-colors border border-primary/20"
                            title="Upload files or folders"
                        >
                            <Upload className="w-4 h-4" />
                            Upload
                        </button>
                        <button
                            onClick={() => setShowDownloadModal(true)}
                            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary/20 to-accent/20 hover:from-primary/30 hover:to-accent/30 text-white text-sm font-medium flex items-center gap-2 transition-all border border-primary/30"
                            title="Download from URL to Vault"
                        >
                            <Download className="w-4 h-4" />
                            Download
                        </button>

                        {/* Separator */}
                        <div className="hidden sm:block w-px h-6 bg-white/10" />

                        {/* Cloud sync button */}
                        <button
                            onClick={handleSyncToCloud}
                            disabled={isSyncing}
                            className={cn(
                                "px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors border",
                                isSyncing
                                    ? "bg-blue-500/20 text-blue-400 cursor-wait border-blue-500/20"
                                    : "hover:bg-blue-500/20 text-blue-400 border-blue-500/20"
                            )}
                            title="Upload all local files to Google Drive"
                        >
                            <Cloud className={cn("w-4 h-4", isSyncing && "animate-pulse")} />
                            {isSyncing ? 'Syncing...' : 'Sync to Cloud'}
                        </button>
                    </div>
                </motion.div>

                {/* Files grid */}
                {files.length > 0 ? (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                    >
                        {files.map((file, index) => (
                            <motion.div
                                key={file.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.05 }}
                                className={cn(
                                    "glass-hover rounded-2xl p-4 border-glow",
                                    (file.is_folder || file.file_type === 'folder') && "border-yellow-500/30"
                                )}
                            >
                                <div className="flex items-start gap-4">
                                    <div className={cn(
                                        "w-14 h-14 rounded-xl flex items-center justify-center shrink-0 relative overflow-hidden",
                                        (file.is_folder || file.file_type === 'folder')
                                            ? "bg-gradient-to-br from-yellow-500/20 to-orange-500/20"
                                            : "bg-gradient-to-br from-primary/20 to-accent/20"
                                    )}>
                                        {file.thumbnail ? (
                                            <img
                                                src={file.thumbnail}
                                                alt={file.original_name}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (file.is_folder || file.file_type === 'folder') ? (
                                            <Folder className="w-7 h-7 text-yellow-400" />
                                        ) : (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz'].includes(file.original_name.split('.').pop()?.toLowerCase() || '') || file.file_type === 'archive') ? (
                                            <FileArchive className="w-7 h-7 text-purple-400" />
                                        ) : (['mp3', 'wav', 'flac', 'ogg', 'm4a'].includes(file.original_name.split('.').pop()?.toLowerCase() || '') || file.file_type === 'audio') ? (
                                            <Music className="w-7 h-7 text-green-400" />
                                        ) : (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(file.original_name.split('.').pop()?.toLowerCase() || '') || file.file_type === 'image') ? (
                                            <Image className="w-7 h-7 text-blue-400" />
                                        ) : (['mp4', 'mkv', 'webm', 'avi', 'mov'].includes(file.original_name.split('.').pop()?.toLowerCase() || '') || file.file_type === 'video') ? (
                                            <Video className="w-7 h-7 text-primary" />
                                        ) : (
                                            <FileText className="w-7 h-7 text-gray-400" />
                                        )}
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                            <Lock className="w-5 h-5 text-white/80" />
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <h3 className="font-semibold truncate text-sm flex items-center gap-2">
                                                    {file.original_name}
                                                    {(file.is_folder || file.file_type === 'folder') && (
                                                        <span className="text-xs text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">
                                                            {file.folder_entries?.length || 0} items
                                                        </span>
                                                    )}
                                                </h3>
                                                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                                                    {formatBytes(file.size_bytes)} • {file.file_type}
                                                    <SyncStatusIcon status={(file as VaultFileWithSync).cloud_sync_status} />
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {new Date(file.added_at * 1000).toLocaleDateString()}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                {(file.is_folder || file.file_type === 'folder') ? (
                                                    <button
                                                        onClick={() => handleOpenFolder(file)}
                                                        className="p-2 rounded-lg hover:bg-yellow-500/20 text-yellow-400 transition-colors"
                                                        title="Open Folder"
                                                    >
                                                        <FolderOpen className="w-4 h-4" />
                                                    </button>
                                                ) : file.original_name.match(/\.(zip|rar|7z|tar|gz|bz2|xz|tgz)$/i) ? (
                                                    <button
                                                        onClick={() => handleExtractArchive(file)}
                                                        className="p-2 rounded-lg hover:bg-purple-500/20 text-purple-400 transition-colors"
                                                        title="Extract Archive"
                                                    >
                                                        <PackageOpen className="w-4 h-4" />
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handlePlay(file)}
                                                        className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                                                        title="Play"
                                                    >
                                                        <Play className="w-4 h-4" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleExport(file)}
                                                    className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                                                    title="Export"
                                                >
                                                    <Download className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(file)}
                                                    className="p-2 rounded-lg hover:bg-red-500/20 text-red-400 transition-colors"
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </motion.div>
                ) : (
                    <motion.div
                        variants={fadeInUp}
                        className="glass-panel rounded-2xl p-12 border-glow"
                    >
                        <div className="flex flex-col items-center justify-center text-center">
                            <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center mb-6">
                                <FolderOpen className="w-12 h-12 text-muted-foreground" />
                            </div>
                            <h3 className="text-2xl font-display font-semibold mb-3">Your Vault is Empty</h3>
                            <p className="text-muted-foreground max-w-md mb-8">
                                Add files to your encrypted vault to keep them hidden and protected.
                                Upload from your device or download directly from any URL.
                            </p>
                            <div className="flex flex-wrap items-center justify-center gap-4">
                                <button
                                    onClick={handleAddFile}
                                    className="px-6 py-3 rounded-xl bg-primary/20 hover:bg-primary/30 text-primary font-medium flex items-center gap-2 transition-colors border border-primary/20"
                                >
                                    <Upload className="w-5 h-5" />
                                    Add Files
                                </button>
                                <button
                                    onClick={() => setShowDownloadModal(true)}
                                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-accent text-white font-medium flex items-center gap-2 hover:opacity-90 transition-opacity"
                                >
                                    <Download className="w-5 h-5" />
                                    Download from URL
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </motion.div>

            {/* Media Player */}
            <MediaPlayer
                isOpen={showPlayer}
                onClose={() => {
                    setShowPlayer(false);
                    // Cleanup temp files after closing player
                    api.vaultCleanupTemp().catch(console.error);
                }}
                filePath={playerFilePath}
                title={playerTitle}
                isAudio={playerIsAudio}
            />

            {/* Settings Modal */}
            <AnimatePresence>
                {showSettings && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                        onClick={() => setShowSettings(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="w-full max-w-md glass rounded-2xl p-6 space-y-6"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <Key className="w-5 h-5" />
                                    Vault Settings
                                </h2>
                                <button
                                    onClick={() => setShowSettings(false)}
                                    className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Change PIN */}
                            <div className="space-y-4">
                                <h3 className="font-medium">Change PIN</h3>
                                <div className="space-y-3">
                                    <input
                                        type="password"
                                        value={currentPin}
                                        onChange={e => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                                        placeholder="Current PIN"
                                        className="w-full px-4 py-2 rounded-lg bg-muted/50 border border-white/10 outline-none focus:border-primary"
                                    />
                                    <input
                                        type="password"
                                        value={newPin}
                                        onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                                        placeholder="New PIN (4-8 digits)"
                                        className="w-full px-4 py-2 rounded-lg bg-muted/50 border border-white/10 outline-none focus:border-primary"
                                    />
                                    <input
                                        type="password"
                                        value={confirmNewPin}
                                        onChange={e => setConfirmNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                                        placeholder="Confirm New PIN"
                                        className="w-full px-4 py-2 rounded-lg bg-muted/50 border border-white/10 outline-none focus:border-primary"
                                    />
                                    <button
                                        onClick={handleChangePin}
                                        disabled={loading || currentPin.length < 4 || newPin.length < 4}
                                        className="w-full py-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                        Change PIN
                                    </button>
                                </div>
                            </div>
                            {/* Player Settings */}
                            <div className="space-y-3 pt-4 border-t border-white/10">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-medium flex items-center gap-2">
                                        <Play className="w-4 h-4" />
                                        Player Settings
                                    </h3>
                                </div>

                                {/* Player Preference - Horizontal Grid */}
                                <div className="grid grid-cols-3 gap-2">
                                    {/* Internal Player */}
                                    <label className={cn(
                                        "flex flex-col items-center p-2 rounded-lg border cursor-pointer transition-all text-center",
                                        playerPreference === 'internal'
                                            ? "border-primary bg-primary/10"
                                            : "border-white/10 hover:border-white/20"
                                    )}>
                                        <input
                                            type="radio"
                                            name="playerPreference"
                                            checked={playerPreference === 'internal'}
                                            onChange={() => savePlayerPreference('internal')}
                                            className="sr-only"
                                        />
                                        <Monitor className="w-5 h-5 mb-1" />
                                        <span className="text-xs font-medium">Internal</span>
                                        <span className="text-[10px] text-muted-foreground">🔒 Secure</span>
                                    </label>

                                    {/* External Player */}
                                    <label className={cn(
                                        "flex flex-col items-center p-2 rounded-lg border cursor-pointer transition-all text-center",
                                        playerPreference === 'external'
                                            ? "border-primary bg-primary/10"
                                            : "border-white/10 hover:border-white/20"
                                    )}>
                                        <input
                                            type="radio"
                                            name="playerPreference"
                                            checked={playerPreference === 'external'}
                                            onChange={() => savePlayerPreference('external')}
                                            className="sr-only"
                                        />
                                        <ExternalLink className="w-5 h-5 mb-1" />
                                        <span className="text-xs font-medium">External</span>
                                        <span className="text-[10px] text-muted-foreground">⚡ Fast</span>
                                    </label>

                                    {/* Ask Every Time */}
                                    <label className={cn(
                                        "flex flex-col items-center p-2 rounded-lg border cursor-pointer transition-all text-center",
                                        playerPreference === 'ask'
                                            ? "border-primary bg-primary/10"
                                            : "border-white/10 hover:border-white/20"
                                    )}>
                                        <input
                                            type="radio"
                                            name="playerPreference"
                                            checked={playerPreference === 'ask'}
                                            onChange={() => savePlayerPreference('ask')}
                                            className="sr-only"
                                        />
                                        <HelpCircle className="w-5 h-5 mb-1" />
                                        <span className="text-xs font-medium">Ask</span>
                                        <span className="text-[10px] text-muted-foreground">📋 Choose</span>
                                    </label>
                                </div>

                                {/* Description based on selection */}
                                <p className="text-[10px] text-muted-foreground">
                                    {playerPreference === 'internal' && '🔒 Secure but slower (decryption + transcoding based on your system)'}
                                    {playerPreference === 'external' && '⚡ Fast but may leave traces in recent files'}
                                    {playerPreference === 'ask' && '📋 Choose internal or external each time you play'}
                                </p>

                                {/* External Player Path - Compact */}
                                <div className="flex gap-2 items-center">
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">Player:</span>
                                    <input
                                        type="text"
                                        value={externalPlayerPath ? externalPlayerPath.split('\\').pop() : ''}
                                        readOnly
                                        placeholder="System default"
                                        className="flex-1 px-2 py-1 rounded bg-muted/50 border border-white/10 outline-none text-xs truncate"
                                    />
                                    <button
                                        onClick={handleSelectExternalPlayer}
                                        className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs transition-colors"
                                    >
                                        Browse
                                    </button>
                                    {externalPlayerPath && (
                                        <button
                                            onClick={() => saveExternalPlayerPath('')}
                                            className="text-xs text-muted-foreground hover:text-white transition-colors"
                                            title="Clear"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Danger Zone */}
                            <div className="space-y-3 pt-4 border-t border-white/10">
                                <h3 className="font-medium text-red-400 flex items-center gap-2">
                                    <AlertTriangle className="w-4 h-4" />
                                    Danger Zone
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                    Resetting the vault will permanently delete all encrypted files and cannot be undone.
                                </p>
                                <button
                                    onClick={handleReset}
                                    disabled={loading || currentPin.length < 4}
                                    className="w-full py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                                >
                                    Reset Vault
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Play Method Choice Modal */}
            <AnimatePresence>
                {showPlayChoice && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                        onClick={() => {
                            setShowPlayChoice(false);
                            setPendingPlayFile(null);
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="w-full max-w-sm glass rounded-2xl p-6 space-y-4"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="text-center">
                                <h2 className="text-lg font-bold">Choose Player</h2>
                                <p className="text-sm text-muted-foreground mt-1">
                                    How would you like to play this file?
                                </p>
                            </div>

                            <div className="space-y-3">
                                <button
                                    onClick={() => handlePlayChoice('internal')}
                                    className="w-full p-4 rounded-xl border border-white/10 hover:border-primary hover:bg-primary/10 transition-all text-left"
                                >
                                    <div className="font-medium flex items-center gap-2">
                                        <Monitor className="w-5 h-5" />
                                        Internal Player
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        🔒 Secure but may take time for transcoding
                                    </p>
                                </button>

                                <button
                                    onClick={() => handlePlayChoice('external')}
                                    className="w-full p-4 rounded-xl border border-white/10 hover:border-accent hover:bg-accent/10 transition-all text-left"
                                >
                                    <div className="font-medium flex items-center gap-2">
                                        <ExternalLink className="w-5 h-5" />
                                        External Player
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        ⚡ Fast but may leave traces
                                    </p>
                                </button>
                            </div>

                            <button
                                onClick={() => {
                                    setShowPlayChoice(false);
                                    setPendingPlayFile(null);
                                }}
                                className="w-full py-2 text-sm text-muted-foreground hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Cloud Download Popup */}
            <CloudDownloadPopup
                isOpen={showCloudDownload}
                fileName={cloudDownloadProgress?.fileName || ''}
                fileSize={cloudDownloadProgress?.totalBytes || 0}
                progress={cloudDownloadProgress?.progress || 0}
                downloadedBytes={cloudDownloadProgress?.downloadedBytes || 0}
                downloadSpeed={cloudDownloadProgress?.speed || 0}
                status={cloudDownloadProgress?.status || 'downloading'}
                onCancel={handleCancelCloudDownload}
                onRetry={handleRetryCloudDownload}
            />

            {/* Cloud Sync Modal */}
            <CloudSyncModal
                isOpen={showSyncModal}
                pendingFiles={pendingSyncFiles}
                onClose={() => setShowSyncModal(false)}
                onUpload={handleUploadSelected}
            />

            {/* Folder Browser Modal */}
            <FolderBrowserModal
                isOpen={showFolderBrowser}
                folder={selectedFolder}
                onClose={() => {
                    setShowFolderBrowser(false);
                    setSelectedFolder(null);
                }}
                onPlayFile={handlePlayFolderFile}
                onExportFile={handleExportFolderFile}
                onViewImage={handleViewFolderImage}
            />

            {/* Image Viewer Modal */}
            <AnimatePresence>
                {showImageViewer && viewerImagePath && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50"
                            onClick={() => {
                                setShowImageViewer(false);
                                setViewerImagePath('');
                                api.vaultCleanupTemp().catch(console.error);
                            }}
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 max-w-[90vw] max-h-[90vh]"
                        >
                            <div className="relative">
                                <button
                                    onClick={() => {
                                        setShowImageViewer(false);
                                        setViewerImagePath('');
                                        api.vaultCleanupTemp().catch(console.error);
                                    }}
                                    className="absolute -top-10 right-0 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                                <img
                                    src={`asset://localhost/${viewerImagePath.replace(/\\/g, '/')}`}
                                    alt={viewerImageName}
                                    className="max-w-[85vw] max-h-[85vh] rounded-lg shadow-2xl object-contain"
                                />
                                <p className="text-center text-sm text-muted-foreground mt-2">
                                    {viewerImageName}
                                </p>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Vault Download Modal */}
            <VaultDownloadModal
                isOpen={showDownloadModal}
                onClose={() => setShowDownloadModal(false)}
                onDownloadComplete={(file) => {
                    // Add the new file to the list
                    setFiles(prev => {
                        if (prev.some(f => f.id === file.id)) return prev;
                        return [...prev, file];
                    });
                    setShowDownloadModal(false);
                }}
            />
        </>
    );
}
