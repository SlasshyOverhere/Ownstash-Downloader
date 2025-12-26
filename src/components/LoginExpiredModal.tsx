import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    AlertCircle,
    CloudOff,
    Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { signInWithGoogleBrowser } from '@/services/googleAuth';
import { useAuth } from '@/contexts/AuthContext';

interface LoginExpiredModalProps {
    isOpen: boolean;
    onLoginSuccess?: () => void;
}

export function LoginExpiredModal({ isOpen, onLoginSuccess }: LoginExpiredModalProps) {
    const { recheckGDriveToken } = useAuth();
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Handle Google Sign In
    const handleGoogleSignIn = async () => {
        setIsLoggingIn(true);
        setError(null);

        try {
            await signInWithGoogleBrowser();
            // Wait a bit for the token to be available
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Recheck GDrive token availability
            const hasToken = await recheckGDriveToken();
            if (hasToken) {
                onLoginSuccess?.();
            } else {
                setError('Login completed but Google Drive access was not granted. Please try again.');
            }
        } catch (err) {
            console.error('[LoginExpiredModal] Google sign-in error:', err);
            setError(err instanceof Error ? err.message : 'Failed to sign in with Google');
        } finally {
            setIsLoggingIn(false);
        }
    };

    // Prevent body scroll when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    const modalContent = (
        <AnimatePresence>
            {isOpen && (
                <div
                    className="fixed inset-0 z-[9999]"
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                    }}
                >
                    {/* Backdrop - NOT clickable to close */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/90 backdrop-blur-md"
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                    />

                    {/* Modal Container */}
                    <div
                        className="absolute inset-0 flex items-center justify-center p-4"
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                    >
                        {/* Modal */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            transition={{ type: 'spring', duration: 0.4, bounce: 0.2 }}
                            onClick={(e) => e.stopPropagation()}
                            className="relative w-full max-w-md bg-neutral-950 rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
                        >
                            {/* Gradient accent */}
                            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-yellow-500 via-orange-500 to-red-500" />

                            {/* Content */}
                            <div className="p-6 pt-8">
                                {/* Icon */}
                                <div className="flex justify-center mb-4">
                                    <div className="relative">
                                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-yellow-500/20 to-orange-500/20 flex items-center justify-center">
                                            <CloudOff className="w-8 h-8 text-yellow-400" />
                                        </div>
                                        <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-neutral-950 flex items-center justify-center">
                                            <AlertCircle className="w-4 h-4 text-orange-400" />
                                        </div>
                                    </div>
                                </div>

                                {/* Title */}
                                <h2 className="text-xl font-bold text-center mb-2">
                                    Session Expired
                                </h2>

                                {/* Description */}
                                <p className="text-sm text-muted-foreground text-center mb-6">
                                    Your Google Drive sync session has expired. Please sign in again to continue using the app.
                                </p>

                                {/* Current Status */}
                                <div className="flex items-center gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
                                    <CloudOff className="w-5 h-5 text-red-400 shrink-0" />
                                    <div>
                                        <p className="text-sm font-medium text-red-400">Cloud Sync Required</p>
                                        <p className="text-xs text-muted-foreground">
                                            This app requires Google Drive to store your data securely.
                                        </p>
                                    </div>
                                </div>

                                {/* Error Message */}
                                {error && (
                                    <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
                                        <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                                        <p className="text-sm text-red-400">{error}</p>
                                    </div>
                                )}

                                {/* Google Sign In Button - ONLY way to proceed */}
                                <button
                                    onClick={handleGoogleSignIn}
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

                                {/* Footer note */}
                                <p className="text-[10px] text-muted-foreground/70 text-center mt-4">
                                    Your data is stored securely in your personal Google Drive.
                                </p>
                            </div>
                        </motion.div>
                    </div>
                </div>
            )}
        </AnimatePresence>
    );

    // Use portal to render at document body level
    if (typeof document !== 'undefined') {
        return createPortal(modalContent, document.body);
    }

    return modalContent;
}

