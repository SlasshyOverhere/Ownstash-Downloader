// Authentication Page - Login / Sign Up with beautiful UI
// Authentication is REQUIRED - no skip option
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AuthError } from '@/services/auth';
import { AuthUI } from '@/components/ui/auth-fuse';

export function AuthPage() {
    const { signIn, signUp, signInWithGoogle } = useAuth();

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSignIn = async (email: string, password: string) => {
        setError(null);
        setIsLoading(true);

        try {
            await signIn(email, password);
        } catch (err) {
            const authError = err as AuthError;
            setError(authError.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSignUp = async (email: string, password: string, displayName: string) => {
        setError(null);
        setIsLoading(true);

        try {
            await signUp(email, password, displayName);
        } catch (err) {
            const authError = err as AuthError;
            setError(authError.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setError(null);
        setIsLoading(true);

        try {
            await signInWithGoogle();
            // Auth state change will be detected by AuthContext
            // Reset loading state on success
            setIsLoading(false);
        } catch (err) {
            const authError = err as AuthError;
            setError(authError.message);
            setIsLoading(false);
        }
    };

    return (
        <AuthUI
            onSignIn={handleSignIn}
            onSignUp={handleSignUp}
            onGoogleSignIn={handleGoogleSignIn}
            // No onSkip - authentication is required
            isLoading={isLoading}
            error={error}
            signInContent={{
                image: {
                    src: "https://images.unsplash.com/photo-1614850523060-8da1d56ae167?w=1200&q=80",
                    alt: "Monochrome abstract"
                },
                quote: {
                    text: "Welcome back! Your downloads await.",
                    author: "Slasshy OmniDownloader"
                }
            }}
            signUpContent={{
                image: {
                    src: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&q=80",
                    alt: "Colorful gradient abstract"
                },
                quote: {
                    text: "Join us and download from 1000+ platforms.",
                    author: "Slasshy OmniDownloader"
                }
            }}
        />
    );
}

export default AuthPage;
