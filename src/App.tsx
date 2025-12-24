import { useState, useEffect } from 'react';
import { Toaster, toast } from 'sonner';
import { listen } from '@tauri-apps/api/event';
import { AppLayout } from '@/components/layout/AppLayout';
import { HomePage } from '@/components/pages/HomePage';
import { DownloadsPage } from '@/components/pages/DownloadsPage';
import { HistoryPage } from '@/components/pages/HistoryPage';
import { SettingsPage } from '@/components/pages/SettingsPage';
import { AuthPage } from '@/components/pages/AuthPage';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

export type PageType = 'home' | 'downloads' | 'history' | 'settings';

function App() {
    const { user, loading } = useAuth();
    const [currentPage, setCurrentPage] = useState<PageType>('home');
    const [extensionUrl, setExtensionUrl] = useState<string | null>(null);

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
