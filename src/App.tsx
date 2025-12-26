import { useState, useEffect } from 'react';
import { Toaster, toast } from 'sonner';
import { listen, emit } from '@tauri-apps/api/event';
import { AppLayout } from '@/components/layout/AppLayout';
import { HomePage } from '@/components/pages/HomePage';
import { DownloadsPage } from '@/components/pages/DownloadsPage';
import { HistoryPage } from '@/components/pages/HistoryPage';
import { SettingsPage } from '@/components/pages/SettingsPage';
import { VaultPage } from '@/components/pages/VaultPage';
import { AuthPage } from '@/components/pages/AuthPage';
import { LoginExpiredModal } from '@/components/LoginExpiredModal';
import { ExtensionDownloadProgress } from '@/components/vault/ExtensionDownloadProgress';
import { useAuth } from '@/contexts/AuthContext';
import { useData } from '@/contexts/DataContext';
import { Loader2 } from 'lucide-react';
import api, { DownloadProgress, SpotifyDownloadProgress } from '@/services/api';
import { addToVaultIndex, isVaultCloudInitialized, lockVaultCloud } from '@/services/vaultCloudService';
import { VaultFileEntry } from '@/services/gdriveService';
import { enqueueUpload } from '@/services/vaultFileSyncService';

export type PageType = 'home' | 'downloads' | 'history' | 'settings' | 'vault';

function App() {
    const { user, loading, isGDriveReady, isOfflineMode, setOfflineMode } = useAuth();
    const { storageType, isLoading: isDataLoading, syncWithGDrive } = useData();
    const [currentPage, setCurrentPage] = useState<PageType>('home');
    const [previousPage, setPreviousPage] = useState<PageType>('home');
    const [extensionUrl, setExtensionUrl] = useState<string | null>(null);
    const [_activeDownloadCount, setActiveDownloadCount] = useState(0);
    const [showLoginExpiredModal, setShowLoginExpiredModal] = useState(false);
    const [hasShownLoginPrompt, setHasShownLoginPrompt] = useState(false);

    // Extension vault download tracking
    const [extensionDownload, setExtensionDownload] = useState<{
        id: string;
        filename: string;
    } | null>(null);

    // Listen for URLs from Chrome extension (via deep link)
    useEffect(() => {
        const unlisten = listen<string>('extension-download-request', (event) => {
            console.log('[Extension] Received download request:', event.payload);
            const url = event.payload;

            if (url && url.trim()) {
                // Show toast notification
                toast.success('URL received from browser extension!', {
                    description: url.length > 60 ? url.substring(0, 60) + '...' : url,
                });

                // Navigate to home page and set the URL
                setCurrentPage('home');
                setExtensionUrl(url);
            }
        });

        return () => {
            unlisten.then(fn => fn());
        };
    }, []);

    // Listen for Vault download requests from Chrome extension (intercepted downloads)
    useEffect(() => {
        interface VaultDownloadPayload {
            url: string;
            filename: string;
            fileSize: number;
            source: string;
        }

        const unlisten = listen<VaultDownloadPayload>('extension-vault-download-request', async (event) => {
            console.log('[Extension] Received vault download request:', event.payload);
            const { url, filename, fileSize: _fileSize } = event.payload;

            if (url && url.trim()) {
                // Check if vault is unlocked first
                if (!isVaultCloudInitialized()) {
                    toast.error('Vault is locked', {
                        description: 'Please unlock your vault first to download files',
                        duration: 5000
                    });
                    setCurrentPage('vault');
                    return;
                }

                // Navigate to vault page
                setCurrentPage('vault');

                // Determine file type from filename
                const ext = filename.split('.').pop()?.toLowerCase() || '';
                let fileType = 'file';
                if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv'].includes(ext)) {
                    fileType = 'video';
                } else if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'].includes(ext)) {
                    fileType = 'audio';
                } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
                    fileType = 'image';
                } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
                    fileType = 'archive';
                }

                // Create vault download request
                const downloadId = `ext_vault_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                const vaultRequest = {
                    id: downloadId,
                    url: url,
                    original_name: filename,
                    file_type: fileType,
                    audio_only: false,
                    audio_format: 'mp3',
                    embed_metadata: true,
                    use_sponsorblock: false
                };

                // Set extension download state to show progress UI
                setExtensionDownload({ id: downloadId, filename });

                // Start the vault download in background
                api.vaultDirectDownload(vaultRequest)
                    .then(async (vaultFile) => {
                        console.log('[Extension] Vault download complete:', vaultFile);

                        // Add to vault index for persistence
                        const fileEntry: VaultFileEntry = {
                            id: vaultFile.id,
                            original_name: vaultFile.original_name,
                            encrypted_name: vaultFile.encrypted_name,
                            size_bytes: vaultFile.size_bytes,
                            added_at: vaultFile.added_at,
                            file_type: vaultFile.file_type,
                            thumbnail: vaultFile.thumbnail
                        };
                        await addToVaultIndex(fileEntry);
                        console.log('[Extension] Added to vault index:', fileEntry.id);

                        // Queue for cloud upload
                        enqueueUpload(vaultFile.id);

                        // Emit event for VaultPage to refresh its file list
                        await emit('vault-files-changed', { action: 'added', file: vaultFile });
                    })
                    .catch((error) => {
                        console.error('[Extension] Vault download failed:', error);
                        // Error will be handled by progress component
                    });
            }
        });

        return () => {
            unlisten.then(fn => fn());
        };
    }, []);

    // Setup download progress listeners for taskbar and notifications
    useEffect(() => {
        let unlistenYtdlp: (() => void) | undefined;
        let unlistenSpotify: (() => void) | undefined;
        let unlistenNotificationClick: (() => void) | undefined;
        let activeCount = 0;
        const downloadTitles = new Map<string, string>();

        // yt-dlp progress listener
        api.onDownloadProgress((progress: DownloadProgress) => {
            // Track download title for notifications
            if (progress.filename) {
                downloadTitles.set(progress.id, progress.filename);
            }

            // Update taskbar progress
            if (progress.status === 'downloading') {
                activeCount = Math.max(1, activeCount);
                setActiveDownloadCount(activeCount);
                api.updateTaskbarProgress(progress.progress, 'downloading').catch(console.error);
            } else if (progress.status === 'completed') {
                activeCount = Math.max(0, activeCount - 1);
                setActiveDownloadCount(activeCount);

                // Clear taskbar if no active downloads
                if (activeCount === 0) {
                    api.clearTaskbarProgress().catch(console.error);
                }

                // Send native notification
                const title = downloadTitles.get(progress.id) || 'Download';
                api.notifyDownloadComplete(title, '').catch(console.error);
                downloadTitles.delete(progress.id);
            } else if (progress.status === 'failed') {
                activeCount = Math.max(0, activeCount - 1);
                setActiveDownloadCount(activeCount);

                // Show error in taskbar
                api.updateTaskbarProgress(100, 'error').catch(console.error);
                setTimeout(() => {
                    if (activeCount === 0) {
                        api.clearTaskbarProgress().catch(console.error);
                    }
                }, 3000);

                // Send failure notification
                const title = downloadTitles.get(progress.id) || 'Download';
                api.notifyDownloadFailed(title, 'Download failed').catch(console.error);
                downloadTitles.delete(progress.id);
            }
        }).then(fn => { unlistenYtdlp = fn; }).catch(console.error);

        // Spotify progress listener
        api.onSpotifyDownloadProgress((progress: SpotifyDownloadProgress) => {
            if (progress.current_track) {
                downloadTitles.set(progress.id, progress.current_track);
            }

            if (progress.status === 'downloading') {
                api.updateTaskbarProgress(progress.progress, 'downloading').catch(console.error);
            } else if (progress.status === 'completed') {
                api.clearTaskbarProgress().catch(console.error);
                const title = downloadTitles.get(progress.id) || 'Spotify Download';
                api.notifyDownloadComplete(title, '').catch(console.error);
            } else if (progress.status === 'failed') {
                api.updateTaskbarProgress(100, 'error').catch(console.error);
                setTimeout(() => api.clearTaskbarProgress().catch(console.error), 3000);
                api.notifyDownloadFailed(downloadTitles.get(progress.id) || 'Spotify Download', 'Download failed').catch(console.error);
            }
        }).then(fn => { unlistenSpotify = fn; }).catch(console.error);

        // Listen for notification clicks
        api.onNotificationClick((event) => {
            console.log('[Notification] Clicked:', event);
            if (event.type === 'download_complete') {
                setCurrentPage('downloads');
            }
        }).then(fn => { unlistenNotificationClick = fn; }).catch(console.error);

        return () => {
            if (unlistenYtdlp) unlistenYtdlp();
            if (unlistenSpotify) unlistenSpotify();
            if (unlistenNotificationClick) unlistenNotificationClick();
            api.clearTaskbarProgress().catch(console.error);
        };
    }, []);

    // Auto-lock vault when navigating away from vault tab
    useEffect(() => {
        // If we were on vault page and now we're not, lock the vault
        if (previousPage === 'vault' && currentPage !== 'vault') {
            console.log('[App] Navigating away from vault, auto-locking...');
            if (isVaultCloudInitialized()) {
                lockVaultCloud();
                // Also lock the backend
                api.vaultLock().catch(console.error);
                api.vaultCleanupTemp().catch(console.error);
            }
        }
        // Update previousPage to track page changes
        setPreviousPage(currentPage);
    }, [currentPage, previousPage]);

    // Show login expired prompt when app is in local-only state on startup
    useEffect(() => {
        // Only check once GDrive ready state is determined and data has loaded
        if (!isGDriveReady || isDataLoading) return;

        // Skip if user is already in offline mode
        if (isOfflineMode) return;

        // Only show prompt if:
        // 1. User is logged in
        // 2. Storage type is local (no GDrive access)
        // 3. We haven't already shown the prompt this session
        if (user && storageType === 'local' && !hasShownLoginPrompt) {
            console.log('[App] Detected local-only state, showing login expired prompt');
            // Small delay to let the app fully render first
            const timer = setTimeout(() => {
                setShowLoginExpiredModal(true);
                setHasShownLoginPrompt(true);
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [user, storageType, isGDriveReady, isDataLoading, hasShownLoginPrompt, isOfflineMode]);

    // Handle successful login from modal
    const handleLoginSuccess = async () => {
        console.log('[App] Login successful, triggering GDrive sync');
        setOfflineMode(false); // Exit offline mode on successful login
        const result = await syncWithGDrive();
        if (result.success) {
            toast.success('Google Drive sync restored!', {
                description: result.message
            });
        }
    };

    // Handle continue without login (offline mode)
    const handleContinueWithoutLogin = () => {
        console.log('[App] User chose to continue without login (offline mode)');
        setOfflineMode(true);
        setShowLoginExpiredModal(false);
        toast.info('Offline mode enabled', {
            description: 'Downloads saved locally. Vault requires login.'
        });
    };

    // Clear extension URL after it's been consumed
    const handleExtensionUrlConsumed = () => {
        setExtensionUrl(null);
    };

    // Loading state while checking auth
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-neutral-950 to-black">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 text-white/60 animate-spin mx-auto mb-4" />
                    <p className="text-slate-400">Loading...</p>
                </div>
            </div>
        );
    }

    // Authentication is REQUIRED - show auth page if not logged in
    if (!user) {
        return <AuthPage />;
    }

    const renderPage = () => {
        switch (currentPage) {
            case 'home':
                return (
                    <HomePage
                        onNavigateToDownloads={() => setCurrentPage('downloads')}
                        extensionUrl={extensionUrl}
                        onExtensionUrlConsumed={handleExtensionUrlConsumed}
                    />
                );
            case 'downloads':
                return <DownloadsPage />;
            case 'history':
                return <HistoryPage />;
            case 'settings':
                return <SettingsPage />;
            case 'vault':
                return <VaultPage />;
            default:
                return (
                    <HomePage
                        onNavigateToDownloads={() => setCurrentPage('downloads')}
                        extensionUrl={extensionUrl}
                        onExtensionUrlConsumed={handleExtensionUrlConsumed}
                    />
                );
        }
    };

    return (
        <>
            <AppLayout currentPage={currentPage} onPageChange={setCurrentPage}>
                {renderPage()}
            </AppLayout>
            <Toaster
                theme="dark"
                position="bottom-right"
                toastOptions={{
                    style: {
                        background: 'hsl(0 0% 7% / 0.95)',
                        border: '1px solid hsl(0 0% 20%)',
                        backdropFilter: 'blur(12px)',
                    },
                }}
            />
            {/* Login Expired Modal - shown when app starts in local-only state */}
            <LoginExpiredModal
                isOpen={showLoginExpiredModal}
                onLoginSuccess={() => {
                    setShowLoginExpiredModal(false);
                    handleLoginSuccess();
                }}
                onContinueWithoutLogin={handleContinueWithoutLogin}
            />
            {/* Extension Vault Download Progress */}
            {extensionDownload && (
                <ExtensionDownloadProgress
                    downloadId={extensionDownload.id}
                    filename={extensionDownload.filename}
                    onComplete={() => {
                        toast.success('🔒 Downloaded to Vault!', {
                            description: extensionDownload.filename
                        });
                        setExtensionDownload(null);
                    }}
                    onFailed={(error) => {
                        toast.error('Vault download failed', {
                            description: error
                        });
                        setExtensionDownload(null);
                    }}
                />
            )}
        </>
    );
}

export default App;


