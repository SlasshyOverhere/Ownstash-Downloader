import { useState, useEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import { listen } from '@tauri-apps/api/event';
import { AppLayout } from '@/components/layout/AppLayout';
import { HomePage } from '@/components/pages/HomePage';
import { DownloadsPage } from '@/components/pages/DownloadsPage';
import { HistoryPage } from '@/components/pages/HistoryPage';
import { SettingsPage } from '@/components/pages/SettingsPage';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import api, { DownloadProgress, SpotifyDownloadProgress } from '@/services/api';

export type PageType = 'home' | 'downloads' | 'history' | 'settings';

function App() {
    const { loading } = useAuth();
    const [currentPage, setCurrentPage] = useState<PageType>('home');
    const [extensionUrl, setExtensionUrl] = useState<string | null>(null);
    const [_activeDownloadCount, setActiveDownloadCount] = useState(0);
    const [isInstallingAppUpdate, setIsInstallingAppUpdate] = useState(false);
    const hasCheckedStartupUpdateRef = useRef(false);
    const isInstallingAppUpdateRef = useRef(false);

    const installAppUpdate = async () => {
        if (isInstallingAppUpdateRef.current) return;

        isInstallingAppUpdateRef.current = true;
        setIsInstallingAppUpdate(true);

        try {
            toast.info('Downloading app update...');
            await api.downloadAndInstallUpdate();
            toast.success('Update downloaded. App will restart to apply it.');
        } catch (err) {
            console.error('[Updater] Update installation failed:', err);
            toast.error('Failed to install update');
        } finally {
            isInstallingAppUpdateRef.current = false;
            setIsInstallingAppUpdate(false);
        }
    };

    // Listen for URLs from Chrome extension (via deep link)
    useEffect(() => {
        const unlisten = listen<string>('extension-download-request', (event) => {
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

    // Startup auto-update check (if enabled in settings)
    useEffect(() => {
        if (loading || hasCheckedStartupUpdateRef.current) return;

        hasCheckedStartupUpdateRef.current = true;
        let cancelled = false;

        const timer = setTimeout(async () => {
            try {
                const saved = await api.getSetting('auto_check_app_updates');
                const autoCheckEnabled = saved === null ? true : saved === 'true';

                // Default is enabled unless user explicitly disabled it
                if (saved === null) {
                    await api.saveSetting('auto_check_app_updates', 'true');
                }

                if (!autoCheckEnabled || cancelled) {
                    return;
                }

                const info = await api.checkForUpdates();
                if (!info.available || cancelled) {
                    return;
                }

                toast('Update available', {
                    description: `v${info.version} is available (current v${info.current_version}).`,
                    duration: 20000,
                    action: {
                        label: isInstallingAppUpdate ? 'Installing...' : 'Install',
                        onClick: () => {
                            void installAppUpdate();
                        },
                    },
                });
            } catch (error) {
                console.error('[Updater] Startup update check failed:', error);
            }
        }, 2500);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [loading, isInstallingAppUpdate]);

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
        </>
    );
}

export default App;
