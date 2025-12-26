
import LandingPage from './components/LandingPage';
import AuthCallback from './components/AuthCallback';
import { useState, useEffect } from 'react';
import { FloatingPaths } from './components/ui/background-paths';

function App() {
    const [isCallback, setIsCallback] = useState(false);

    useEffect(() => {
        // Simple routing based on URL hash content
        if (window.location.hash.includes('access_token') || window.location.hash.includes('error=')) {
            setIsCallback(true);
        }
    }, []);

    return (
        <div className="relative min-h-screen bg-black">
            <div className="fixed inset-0 pointer-events-none z-0">
                <FloatingPaths position={1} />
                <FloatingPaths position={-1} />
            </div>
            <div className="relative z-10">
                {isCallback ? <AuthCallback /> : <LandingPage />}
            </div>
        </div>
    );
}

export default App;
