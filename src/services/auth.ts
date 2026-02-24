// Authentication Service - Backend OAuth
// Uses backend for Google OAuth, no Firebase dependency

import {
    signInWithGoogleBrowser,
    getStoredUser,
    clearStoredUser,
    GoogleUser,
    isGoogleBrowserAuthAvailable
} from './googleAuth';

export interface AuthUser {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
}

export interface AuthError {
    code: string;
    message: string;
}

// Convert GoogleUser to AuthUser
function toAuthUser(user: GoogleUser): AuthUser {
    return {
        uid: user.id,
        email: user.email,
        displayName: user.name,
        photoURL: user.picture || null,
    };
}

// Auth state change listeners
type AuthStateListener = (user: AuthUser | null) => void;
const authStateListeners: Set<AuthStateListener> = new Set();
let currentUser: AuthUser | null = null;

// Notify all listeners of auth state change
function notifyAuthStateChange(user: AuthUser | null) {
    currentUser = user;
    authStateListeners.forEach(listener => {
        try {
            listener(user);
        } catch (e) {
            console.error('Auth state listener error:', e);
        }
    });
}

// Initialize auth state from stored user
export function initializeAuthState(): AuthUser | null {
    const storedUser = getStoredUser();
    if (storedUser) {
        currentUser = toAuthUser(storedUser);
        return currentUser;
    }
    return null;
}

// Authentication Service
export const authService = {
    // Sign up with email and password - NOT SUPPORTED with backend OAuth
    async signUp(_email: string, _password: string, _displayName?: string): Promise<AuthUser> {
        throw {
            code: 'auth/not-supported',
            message: 'Email/password sign-up is not supported. Please use Google Sign-in.',
        } as AuthError;
    },

    // Sign in with email and password - NOT SUPPORTED with backend OAuth
    async signIn(_email: string, _password: string): Promise<AuthUser> {
        throw {
            code: 'auth/not-supported',
            message: 'Email/password sign-in is not supported. Please use Google Sign-in.',
        } as AuthError;
    },

    // Sign in with Google - opens in system browser
    async signInWithGoogle(): Promise<AuthUser | null> {
        // Check if browser auth is available
        if (!isGoogleBrowserAuthAvailable()) {
            throw {
                code: 'auth/not-configured',
                message: 'Google Sign-in requires configuration. Please set VITE_BACKEND_URL in your .env file.',
            } as AuthError;
        }

        console.log('[Auth] Starting Google sign-in via system browser...');
        try {
            const googleUser = await signInWithGoogleBrowser();
            const authUser = toAuthUser(googleUser);
            console.log('[Auth] Browser sign-in completed, user:', authUser.email);

            // Notify listeners
            notifyAuthStateChange(authUser);

            return authUser;
        } catch (error: any) {
            console.error('[Auth] Browser Google sign-in error:', error);
            throw {
                code: 'auth/browser-auth-failed',
                message: error.message || 'Google sign-in failed. Please try again.',
            } as AuthError;
        }
    },

    // Check for redirect result - returns stored user if available
    async checkRedirectResult(): Promise<AuthUser | null> {
        // With backend OAuth, we just check for stored user
        const storedUser = getStoredUser();
        if (storedUser) {
            const authUser = toAuthUser(storedUser);
            notifyAuthStateChange(authUser);
            return authUser;
        }
        return null;
    },

    // Sign out
    async signOut(): Promise<void> {
        try {
            // Clear Google Drive access token
            const { clearGDriveAccessToken } = await import('./gdriveService');
            clearGDriveAccessToken();

            // Clear stored user
            clearStoredUser();

            // Notify listeners
            notifyAuthStateChange(null);
        } catch (error: any) {
            throw {
                code: error.code || 'auth/sign-out-failed',
                message: getErrorMessage(error.code) || 'Sign out failed',
            } as AuthError;
        }
    },

    // Send password reset email - NOT SUPPORTED
    async resetPassword(_email: string): Promise<void> {
        throw {
            code: 'auth/not-supported',
            message: 'Password reset is not supported with Google Sign-in.',
        } as AuthError;
    },

    // Get current user
    getCurrentUser(): AuthUser | null {
        if (currentUser) {
            return currentUser;
        }
        // Try to load from storage
        const storedUser = getStoredUser();
        if (storedUser) {
            currentUser = toAuthUser(storedUser);
            return currentUser;
        }
        return null;
    },

    // Subscribe to auth state changes
    onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void {
        authStateListeners.add(callback);

        // Immediately call with current state
        const storedUser = getStoredUser();
        if (storedUser) {
            callback(toAuthUser(storedUser));
        } else {
            callback(null);
        }

        // Return unsubscribe function
        return () => {
            authStateListeners.delete(callback);
        };
    },
};

// Human-readable error messages
function getErrorMessage(code: string): string {
    switch (code) {
        case 'auth/not-supported':
            return 'This authentication method is not supported. Please use Google Sign-in.';
        case 'auth/not-configured':
            return 'Authentication is not configured. Please check your environment settings.';
        case 'auth/browser-auth-failed':
            return 'Google sign-in failed. Please try again.';
        case 'auth/network-request-failed':
            return 'Network error. Please check your internet connection.';
        case 'auth/sign-out-failed':
            return 'Sign out failed. Please try again.';
        default:
            return 'An error occurred. Please try again.';
    }
}

export default authService;
