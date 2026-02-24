
import LandingPage from './components/LandingPage';
import AuthCallback from './components/AuthCallback';
import MobileAuth from './components/MobileAuth';
import { useState, useEffect } from 'react';
import { FloatingPaths } from './components/ui/background-paths';
import { ReactLenis } from '@studio-freight/react-lenis';

type PageType = 'landing' | 'callback' | 'mobile-auth';

function App() {
    const [page, setPage] = useState<PageType>('landing');

    useEffect(() => {
        // Simple routing based on URL
        const path = window.location.pathname;
        const hash = window.location.hash;

        if (path === '/mobile-auth' || path.startsWith('/mobile-auth')) {
            setPage('mobile-auth');
        } else if (hash.includes('access_token') || hash.includes('error=')) {
            setPage('callback');
        }
    }, []);

    // Mobile auth has its own background
    if (page === 'mobile-auth') {
        return <MobileAuth />;
    }

    return (
        <ReactLenis root options={{ lerp: 0.1, duration: 1.5, smoothWheel: true }}>
            <div className="relative min-h-screen bg-black">
                <div className="fixed inset-0 pointer-events-none z-0">
                    <FloatingPaths position={1} />
                    <FloatingPaths position={-1} />
                </div>
                <div className="relative z-10">
                    {page === 'callback' ? <AuthCallback /> : <LandingPage />}
                </div>
            </div>
        </ReactLenis>
    );
}

export default App;
