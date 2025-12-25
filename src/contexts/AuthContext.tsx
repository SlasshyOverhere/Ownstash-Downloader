// Authentication Context - Provides auth state throughout the app
// Authentication is REQUIRED - all features require sign-in
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authService, AuthUser } from '@/services/auth';

interface AuthContextType {
    user: AuthUser | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string, displayName?: string) => Promise<void>;
    signInWithGoogle: () => Promise<void>;
    signOut: () => Promise<void>;
    resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
    children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);


    useEffect(() => {
        // Initialize Google browser auth listener for deep link callbacks
        import('@/services/googleAuth').then(({ initGoogleAuthListener }) => {
            initGoogleAuthListener().catch(console.error);
        }).catch(console.error);

        // Check for redirect result first (for Google auth fallback)
        authService.checkRedirectResult().then((redirectUser) => {
            if (redirectUser) {
                setUser(redirectUser);
                setLoading(false);
            }
        }).catch(console.error);

        // Subscribe to auth state changes
        const unsubscribe = authService.onAuthStateChanged((authUser) => {
            setUser(authUser);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const signIn = async (email: string, password: string) => {
        const authUser = await authService.signIn(email, password);
        setUser(authUser);
    };

    const signUp = async (email: string, password: string, displayName?: string) => {
        const authUser = await authService.signUp(email, password, displayName);
        setUser(authUser);
    };

    const signInWithGoogle = async () => {
        const authUser = await authService.signInWithGoogle();
        // authUser will be null if redirect was used - user state will be updated after redirect completes
        if (authUser) {
            setUser(authUser);
        }
    };

    const signOut = async () => {
        await authService.signOut();
        setUser(null);
    };

    const resetPassword = async (email: string) => {
        await authService.resetPassword(email);
    };

    const value: AuthContextType = {
        user,
        loading,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
        resetPassword,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

export default AuthContext;
