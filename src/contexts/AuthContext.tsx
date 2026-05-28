// Authentication Context - Provides auth state throughout the app
// Uses backend OAuth - no Firebase dependency
import { createContext, use, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { authService, AuthUser, initializeAuthState } from '@/services/auth';

interface AuthContextType {
    user: AuthUser | null;
    loading: boolean;
    isGDriveReady: boolean;
    /** Indicates if GDrive token was successfully loaded from persistent storage */
    hasGDriveToken: boolean;
    /** Force re-check GDrive availability (useful after manual sign-in) */
    recheckGDriveToken: () => Promise<boolean>;
    signInWithGoogle: () => Promise<void>;
    signOut: () => Promise<void>;
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
    // Internal coordination flags — never read in JSX, so use refs to avoid unnecessary re-renders
    const authResolvedRef = useRef(false);
    const tokenLoadAttemptedRef = useRef(false);

    // When both coordination flags are true, promote to render-driving state
    const checkGDriveReady = useCallback(() => {
        if (authResolvedRef.current && tokenLoadAttemptedRef.current) {
            console.log('[Auth] Both auth and token load complete, setting isGDriveReady=true');
            setIsGDriveReady(true);
        }
    }, []);

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
            // Step 1: Initialize auth state from stored user
            console.log('[Auth] Step 1: Initializing auth state from storage...');
            const storedUser = initializeAuthState();
            if (storedUser && isMounted) {
                setUser(storedUser);
                console.log('[Auth] Found stored user:', storedUser.email ? storedUser.email.replace(/^(.)(.*?)(@.*)$/, '$1***$3') : 'unknown');
            }

            // Step 2: Load persisted Google Drive token
            console.log('[Auth] Step 2: Loading persisted GDrive token...');
            try {
                const tokenLoaded = await recheckGDriveToken();
                if (isMounted) {
                    tokenLoadAttemptedRef.current = true;
                    checkGDriveReady();
                    console.log('[Auth] GDrive token load complete, hasToken:', tokenLoaded);
                }
            } catch (err) {
                console.error('[Auth] Error in token load:', err);
                if (isMounted) {
                    tokenLoadAttemptedRef.current = true;
                    checkGDriveReady();
                }
            }

            // Step 3: Initialize Google browser auth listener for deep link callbacks
            console.log('[Auth] Step 3: Initializing Google auth listener...');
            try {
                const { initGoogleAuthListener } = await import('@/services/googleAuth');
                await initGoogleAuthListener();
            } catch (err) {
                console.log('[Auth] Google auth listener init error (non-fatal):', err);
            }

            // Mark as resolved
            if (isMounted) {
                setLoading(false);
                authResolvedRef.current = true;
                checkGDriveReady();
            }
        };

        // Start async initialization
        initializeAuth();

        // Subscribe to auth state changes
        const unsubscribe = authService.onAuthStateChanged((authUser) => {
            if (isMounted) {
                setUser(authUser);
                setLoading(false);
                authResolvedRef.current = true;
                checkGDriveReady();
            }
        });

        return () => {
            isMounted = false;
            unsubscribe();
        };
    }, [recheckGDriveToken, checkGDriveReady]);

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

    const value: AuthContextType = {
        user,
        loading,
        isGDriveReady,
        hasGDriveToken,
        recheckGDriveToken,
        signInWithGoogle,
        signOut,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = use(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

export default AuthContext;
