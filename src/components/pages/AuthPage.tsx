// Authentication Page - Google Sign-In Only
// Clean, minimal monochrome design with just a "Continue with Google" button
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AuthError } from '@/services/auth';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Google Logo SVG Component
function GoogleLogo({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
    );
}

export function AuthPage() {
    const { signInWithGoogle } = useAuth();

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGoogleSignIn = async () => {
        setError(null);
        setIsLoading(true);

        try {
            await signInWithGoogle();
            setIsLoading(false);
        } catch (err) {
            const authError = err as AuthError;
            setError(authError.message);
            setIsLoading(false);
        }
    };

    return (
        <div className="w-full min-h-screen flex bg-black">
            {/* Left Panel - Brand & Info (Monochrome) */}
            <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
                {/* Monochrome gradient background */}
                <div className="absolute inset-0 bg-gradient-to-br from-neutral-900 via-neutral-800 to-black" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white/5 via-transparent to-transparent" />

                {/* Subtle grid pattern */}
                <div
                    className="absolute inset-0 opacity-[0.03]"
                    style={{
                        backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), 
                                          linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
                        backgroundSize: '50px 50px'
                    }}
                />

                {/* Floating shapes (monochrome) */}
                <div className="absolute top-20 left-20 w-64 h-64 bg-white/[0.02] rounded-full blur-3xl animate-float" />
                <div className="absolute bottom-20 right-20 w-96 h-96 bg-white/[0.03] rounded-full blur-3xl animate-float-delayed" />
                <div className="absolute top-1/2 left-1/3 w-32 h-32 border border-white/10 rounded-full animate-pulse-slow" />

                {/* Content */}
                <div className="relative z-10 flex flex-col justify-center p-12 text-white">
                    <div className="space-y-6 max-w-lg">
                        {/* Logo and Brand Name */}
                        <div className="flex items-center gap-4 mb-8">
                            <img
                                src="/logo.png"
                                alt="Slasshy OmniDownloader Logo"
                                className="w-14 h-14 rounded-xl object-contain"
                            />
                            <div className="flex flex-col">
                                <span className="text-2xl font-display font-bold">Slasshy</span>
                                <span className="text-sm text-white/60 font-medium">OmniDownloader</span>
                            </div>
                        </div>

                        <h1 className="text-4xl lg:text-5xl font-display font-bold leading-tight">
                            Download anything.<br />
                            <span className="text-white/60">From anywhere.</span>
                        </h1>

                        <p className="text-lg text-white/50 leading-relaxed">
                            Sign in with your Google account to sync your downloads
                            across devices and access premium features.
                        </p>

                        <div className="flex flex-wrap gap-3 pt-4">
                            {['1000+ Platforms', 'Cloud Sync', 'Secure Vault', 'Auto Updates'].map((feature) => (
                                <span
                                    key={feature}
                                    className="px-3 py-1.5 rounded-full text-sm bg-white/5 backdrop-blur-sm border border-white/10 text-white/70"
                                >
                                    {feature}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Bottom gradient fade */}
                <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent" />
            </div>

            {/* Right Panel - Auth Form */}
            <div className="flex-1 flex items-center justify-center p-6 bg-gradient-to-br from-neutral-950 via-black to-neutral-950">
                <div className="w-full max-w-md space-y-8">
                    {/* Mobile Logo */}
                    <div className="lg:hidden flex flex-col items-center gap-3 mb-4">
                        <img
                            src="/logo.png"
                            alt="Slasshy OmniDownloader Logo"
                            className="w-16 h-16 rounded-xl object-contain"
                        />
                        <div className="text-center">
                            <span className="text-xl font-display font-bold text-white block">Slasshy</span>
                            <span className="text-sm text-white/60 font-medium">OmniDownloader</span>
                        </div>
                    </div>

                    {/* Welcome Text */}
                    <div className="text-center space-y-2">
                        <h2 className="text-3xl font-display font-bold text-white">
                            Welcome
                        </h2>
                        <p className="text-white/50">
                            Sign in with your Google account to continue
                        </p>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm text-center animate-in fade-in slide-in-from-top-2">
                            {error}
                        </div>
                    )}

                    {/* Google Sign-In Button */}
                    <button
                        onClick={handleGoogleSignIn}
                        disabled={isLoading}
                        className={cn(
                            "w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl",
                            "bg-white text-gray-900 font-medium text-lg",
                            "hover:bg-gray-100 hover:shadow-lg hover:shadow-white/5",
                            "focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-black",
                            "transition-all duration-200",
                            "disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span>Signing in...</span>
                            </>
                        ) : (
                            <>
                                <GoogleLogo className="w-5 h-5" />
                                <span>Continue with Google</span>
                            </>
                        )}
                    </button>

                    {/* Privacy Notice */}
                    <div className="text-center space-y-4">
                        <p className="text-xs text-white/30 leading-relaxed">
                            By signing in, you agree to our Terms of Service and Privacy Policy.
                            Your data is stored securely in your own Google Drive.
                        </p>

                        <div className="flex items-center justify-center gap-2 text-white/20">
                            <div className="w-8 h-px bg-white/10" />
                            <span className="text-xs">Privacy-First Design</span>
                            <div className="w-8 h-px bg-white/10" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Tailwind animation styles */}
            <style>{`
                @keyframes float {
                    0%, 100% { transform: translateY(0px); }
                    50% { transform: translateY(-20px); }
                }
                @keyframes float-delayed {
                    0%, 100% { transform: translateY(0px); }
                    50% { transform: translateY(15px); }
                }
                @keyframes pulse-slow {
                    0%, 100% { opacity: 0.3; transform: scale(1); }
                    50% { opacity: 0.1; transform: scale(1.1); }
                }
                .animate-float {
                    animation: float 8s ease-in-out infinite;
                }
                .animate-float-delayed {
                    animation: float-delayed 10s ease-in-out infinite;
                }
                .animate-pulse-slow {
                    animation: pulse-slow 4s ease-in-out infinite;
                }
            `}</style>
        </div>
    );
}

export default AuthPage;
