
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';

export default function AuthCallback() {
    const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');

    useEffect(() => {
        const hash = window.location.hash;
        if (hash) {
            // 1. Process the token from URL
            const params = new URLSearchParams(hash.substring(1));
            const accessToken = params.get('access_token');
            const error = params.get('error');

            if (error) {
                setStatus('error');
                return;
            }

            if (accessToken) {
                // 2. Save to Local Storage (website persistence)
                // This allows future visits to be recognized as logged in instantly
                localStorage.setItem('slasshy_gdrive_token', accessToken);
                const expiry = Date.now() + 3600 * 1000;
                localStorage.setItem('slasshy_token_expiry', expiry.toString());

                setStatus('success');

                // 3. Redirect to Desktop App via Deep Link
                // The desktop app will catch this custom protocol and save the token securely
                const deepLink = `slasshy://auth/callback${hash}`;

                // Small delay to show success UI then redirect
                setTimeout(() => {
                    window.location.href = deepLink;
                }, 1500);
            }
        }
    }, []);

    if (status === 'error') {
        return (
            <div className="flex h-screen items-center justify-center bg-black text-white">
                <div className="text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-900/20 mb-4 text-red-500">
                        ✕
                    </div>
                    <h1 className="text-2xl font-bold mb-2">Authentication Failed</h1>
                    <p className="text-zinc-500">Please try signing in again.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen items-center justify-center bg-black text-white">
            <div className="text-center max-w-md p-8 bg-zinc-900/50 rounded-2xl border border-white/10 backdrop-blur-xl">
                {status === 'processing' ? (
                    <>
                        <div className="mx-auto mb-6 flex justify-center">
                            <Spinner size="xl" color="white" />
                        </div>
                        <h1 className="text-2xl font-bold mb-2">Authenticating...</h1>
                        <p className="text-zinc-500">Verifying secure credentials</p>
                    </>
                ) : (
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                    >
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-900/20 mb-6 text-green-500 border border-green-500/20">
                            <Check className="h-8 w-8" />
                        </div>
                        <h1 className="text-2xl font-bold mb-2">You're All Set!</h1>
                        <p className="text-zinc-400 mb-6">
                            Opening Slasshy OmniDownloader...
                        </p>
                        <div className="text-xs text-zinc-600">
                            If the app doesn't open automatically, <a href="#" onClick={(e) => {
                                e.preventDefault();
                                window.location.href = `slasshy://auth/callback${window.location.hash}`;
                            }} className="underline hover:text-white">click here</a>.
                        </div>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
