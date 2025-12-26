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
    Upload
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
    VaultFileEntry
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
                    // Convert VaultFileEntry to VaultFile format (including sync status)
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

    // Load player preferences from settings
    const loadPlayerPreferences = async () => {
        try {
            const pref = await api.getSetting('vault_player_preference');
            if (pref && ['internal', 'external', 'ask'].includes(pref)) {
                setPlayerPreference(pref as PlayerPreference);
            }

            const playerPath = await api.getSetting('vault_external_player_path');
            if (playerPath) {
                setExternalPlayerPath(playerPath);
            }
        } catch (err) {
            console.log('[Vault] Could not load player preferences, using defaults');
        }
    };

    // Save player preference
    const savePlayerPreference = async (pref: PlayerPreference) => {
        setPlayerPreference(pref);
        try {
            await api.saveSetting('vault_player_preference', pref);
        } catch (err) {
            console.error('[Vault] Failed to save player preference:', err);
        }
    };

    // Save external player path
    const saveExternalPlayerPath = async (path: string) => {
        setExternalPlayerPath(path);
        try {
            await api.saveSetting('vault_external_player_path', path);
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

    const handleAddFile = async () => {
        try {
            const selected = await open({
                multiple: false,
                title: 'Select file to add to Vault',
            });

            if (!selected || typeof selected !== 'string') return;

            const fileName = selected.split(/[/\\]/).pop() || 'unknown';
            const extension = fileName.split('.').pop()?.toLowerCase() || '';

            let fileType = 'file';
            if (['mp4', 'webm', 'mkv', 'avi', 'mov'].includes(extension)) {
                fileType = 'video';
            } else if (['mp3', 'm4a', 'flac', 'wav', 'opus', 'ogg'].includes(extension)) {
                fileType = 'audio';
            }

            toast.info('Encrypting and adding file to vault...');
            console.log('[Vault] Adding file:', fileName, 'type:', fileType);
            const addedFile = await api.vaultAddFile(selected, fileName, fileType, undefined, true);
            console.log('[Vault] File added successfully:', addedFile);
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
            // Convert to VaultFile (same structure roughly, but type safety)
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
            toast.error(`Failed: ${msg}`);
            // Reload files on error to ensure UI consistency
            await loadFiles();
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
                className="max-w-4xl mx-auto space-y-6"
            >
                {/* Header */}
                <motion.div variants={fadeInUp} className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
                            <ShieldCheck className="w-6 h-6 text-green-400" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-display font-bold flex items-center gap-2">
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
                            <p className="text-sm text-muted-foreground">
                                {files.length} file{files.length !== 1 ? 's' : ''} • {formatBytes(files.reduce((acc, f) => acc + f.size_bytes, 0))}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleAddFile}
                            className="px-4 py-2 rounded-xl glass-hover text-sm font-medium flex items-center gap-2 hover:bg-primary/20 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            Add File
                        </button>
                        <button
                            onClick={handleSyncToCloud}
                            disabled={isSyncing}
                            className={cn(
                                "p-2 rounded-xl glass-hover transition-colors",
                                isSyncing
                                    ? "bg-primary/20 text-primary cursor-wait"
                                    : "hover:bg-primary/20 text-primary"
                            )}
                            title="Upload all to Cloud"
                        >
                            <Upload className={cn("w-5 h-5", isSyncing && "animate-pulse")} />
                        </button>
                        <button
                            onClick={async () => {
                                toast.info('Refreshing files...');
                                await loadFiles();
                                toast.success('Files refreshed!');
                            }}
                            className="p-2 rounded-xl glass-hover hover:bg-white/10 transition-colors"
                            title="Refresh Files"
                        >
                            <RefreshCw className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => setShowSettings(true)}
                            className="p-2 rounded-xl glass-hover hover:bg-white/10 transition-colors"
                            title="Vault Settings"
                        >
                            <Settings className="w-5 h-5" />
                        </button>
                        <button
                            onClick={handleLock}
                            className="px-4 py-2 rounded-xl glass-hover text-sm font-medium flex items-center gap-2 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors"
                        >
                            <Lock className="w-4 h-4" />
                            Lock
                        </button>
                    </div>
                </motion.div>

                {/* Files grid */}
                {files.length > 0 ? (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="grid grid-cols-1 md:grid-cols-2 gap-4"
                    >
                        {files.map((file, index) => (
                            <motion.div
                                key={file.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.05 }}
                                className="glass-hover rounded-2xl p-4 border-glow"
                            >
                                <div className="flex items-start gap-4">
                                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0 relative overflow-hidden">
                                        {file.thumbnail ? (
                                            <img
                                                src={file.thumbnail}
                                                alt={file.original_name}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <Video className="w-7 h-7 text-primary" />
                                        )}
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                            <Lock className="w-5 h-5 text-white/80" />
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <h3 className="font-semibold truncate text-sm">{file.original_name}</h3>
                                                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                                                    {formatBytes(file.size_bytes)} • {file.file_type}
                                                    <SyncStatusIcon status={(file as VaultFileWithSync).cloud_sync_status} />
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {new Date(file.added_at * 1000).toLocaleDateString()}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    onClick={() => handlePlay(file)}
                                                    className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                                                    title="Play"
                                                >
                                                    <Play className="w-4 h-4" />
                                                </button>
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
                        className="flex flex-col items-center justify-center py-20 text-center"
                    >
                        <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                            <FolderOpen className="w-10 h-10 text-muted-foreground" />
                        </div>
                        <h3 className="text-xl font-semibold mb-2">Vault is Empty</h3>
                        <p className="text-muted-foreground max-w-sm mb-4">
                            Add files to your encrypted vault to keep them hidden and protected.
                        </p>
                        <button
                            onClick={handleAddFile}
                            className="px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-accent text-white font-medium flex items-center gap-2"
                        >
                            <Plus className="w-5 h-5" />
                            Add First File
                        </button>
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
        </>
    );
}
