// Authentication Context - Provides auth state throughout the app
// Authentication is REQUIRED - all features require sign-in
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authService, AuthUser } from '@/services/auth';

interface AuthContextType {
    user: AuthUser | null;
    loading: boolean;
    isGDriveReady: boolean;
    /** Indicates if GDrive token was successfully loaded from persistent storage */
    hasGDriveToken: boolean;
    /** Force re-check GDrive availability (useful after manual sign-in) */
    recheckGDriveToken: () => Promise<boolean>;
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
    const [isGDriveReady, setIsGDriveReady] = useState(false);
    const [hasGDriveToken, setHasGDriveToken] = useState(false);
    // Track if Firebase auth state has been resolved
    const [authResolved, setAuthResolved] = useState(false);
    // Track if GDrive token loading has been attempted
    const [tokenLoadAttempted, setTokenLoadAttempted] = useState(false);

    // Function to check and load persisted token
    const recheckGDriveToken = useCallback(async (): Promise<boolean> => {
        try {
            const { loadPersistedToken, isGDriveAvailable } = await import('@/services/gdriveService');

            // First check if token is already in memory
            if (isGDriveAvailable()) {
                console.log('[Auth] GDrive token already available in memory');
                setHasGDriveToken(true);
                return true;
            }

            // Try to load from persistent storage
            const loaded = await loadPersistedToken();
            if (loaded) {
                console.log('[Auth] GDrive token restored from persistent storage');
                setHasGDriveToken(true);
                return true;
            }

            console.log('[Auth] No valid GDrive token found in persistent storage');
            setHasGDriveToken(false);
            return false;
        } catch (err) {
            console.error('[Auth] Error loading GDrive token:', err);
            setHasGDriveToken(false);
            return false;
        }
    }, []);

    useEffect(() => {
        let isMounted = true;

        const initializeAuth = async () => {
            // Step 1: Load persisted Google Drive token FIRST
            // This ensures the token is in memory before Firebase auth triggers DataContext
            console.log('[Auth] Step 1: Loading persisted GDrive token...');
            try {
                const tokenLoaded = await recheckGDriveToken();
                if (isMounted) {
                    setTokenLoadAttempted(true);
                    console.log('[Auth] GDrive token load complete, hasToken:', tokenLoaded);
                }
            } catch (err) {
                console.error('[Auth] Error in token load:', err);
                if (isMounted) {
                    setTokenLoadAttempted(true);
                }
            }

            // Step 2: Initialize Google browser auth listener for deep link callbacks
            console.log('[Auth] Step 2: Initializing Google auth listener...');
            try {
                const { initGoogleAuthListener } = await import('@/services/googleAuth');
                await initGoogleAuthListener();
            } catch (err) {
                console.log('[Auth] Google auth listener init error (non-fatal):', err);
            }

            // Step 3: Check for redirect result (for Google auth fallback)
            console.log('[Auth] Step 3: Checking redirect result...');
            try {
                const redirectUser = await authService.checkRedirectResult();
                if (redirectUser && isMounted) {
                    setUser(redirectUser);
                    setLoading(false);
                    setAuthResolved(true);
                }
            } catch (err) {
                console.log('[Auth] Redirect check error (non-fatal):', err);
            }
        };

        // Start async initialization
        initializeAuth();

        // Subscribe to auth state changes
        const unsubscribe = authService.onAuthStateChanged((authUser) => {
            if (isMounted) {
                setUser(authUser);
                setLoading(false);
                setAuthResolved(true);
            }
        });

        return () => {
            isMounted = false;
            unsubscribe();
        };
    }, [recheckGDriveToken]);

    // Set isGDriveReady only when BOTH auth is resolved AND token load was attempted
    // This prevents DataContext from making decisions before we know the full state
    useEffect(() => {
        if (authResolved && tokenLoadAttempted) {
            console.log('[Auth] Both auth and token load complete, setting isGDriveReady=true');
            setIsGDriveReady(true);
        }
    }, [authResolved, tokenLoadAttempted]);

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
            // After successful Google sign-in, the token should now be available
            // Re-check to update hasGDriveToken flag
            await recheckGDriveToken();
        }
    };

    const signOut = async () => {
        // Clear Google Drive token on explicit logout
        const { clearGDriveAccessToken } = await import('@/services/gdriveService');
        await clearGDriveAccessToken();
        setHasGDriveToken(false);

        await authService.signOut();
        setUser(null);
    };

    const resetPassword = async (email: string) => {
        await authService.resetPassword(email);
    };

    const value: AuthContextType = {
        user,
        loading,
        isGDriveReady,
        hasGDriveToken,
        recheckGDriveToken,
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
