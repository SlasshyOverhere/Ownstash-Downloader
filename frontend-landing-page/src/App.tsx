
import LandingPage from './components/LandingPage';
import AuthCallback from './components/AuthCallback';
import { useState, useEffect } from 'react';
import { FloatingPaths } from './components/ui/background-paths';
import { ReactLenis } from '@studio-freight/react-lenis';

function App() {
    const [isCallback, setIsCallback] = useState(false);

    useEffect(() => {
        // Simple routing based on URL hash content
        if (window.location.hash.includes('access_token') || window.location.hash.includes('error=')) {
            setIsCallback(true);
        }
    }, []);

    return (
        <ReactLenis root options={{ lerp: 0.1, duration: 1.5, smoothWheel: true }}>
            <div className="relative min-h-screen bg-black">
                <div className="fixed inset-0 pointer-events-none z-0">
                    <FloatingPaths position={1} />
                    <FloatingPaths position={-1} />
                </div>
                <div className="relative z-10">
                    {isCallback ? <AuthCallback /> : <LandingPage />}
                </div>
            </div>
        </ReactLenis>
    );
}

export default App;
