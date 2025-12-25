// Firebase Authentication Service
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    User,
    getRedirectResult,
    sendPasswordResetEmail,
    updateProfile,
    UserCredential,
    browserLocalPersistence,
    setPersistence
} from 'firebase/auth';
import { auth, db } from '@/config/firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

// Set persistence to local storage for better desktop app support
setPersistence(auth, browserLocalPersistence).catch(console.error);

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

// Convert Firebase User to AuthUser
function toAuthUser(user: User): AuthUser {
    return {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
    };
}

// Create user profile in Firestore
async function createUserProfile(user: User, additionalData?: { displayName?: string }) {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        const { email, displayName, photoURL } = user;
        const createdAt = serverTimestamp();

        await setDoc(userRef, {
            email,
            displayName: additionalData?.displayName || displayName,
            photoURL,
            createdAt,
            lastLogin: createdAt,
        });
    } else {
        // Update last login
        await setDoc(userRef, { lastLogin: serverTimestamp() }, { merge: true });
    }
}

// Authentication Service
export const authService = {
    // Sign up with email and password
    async signUp(email: string, password: string, displayName?: string): Promise<AuthUser> {
        try {
            const userCredential: UserCredential = await createUserWithEmailAndPassword(auth, email, password);

            // Update display name if provided
            if (displayName && userCredential.user) {
                await updateProfile(userCredential.user, { displayName });
            }

            // Create user profile in Firestore
            await createUserProfile(userCredential.user, { displayName });

            return toAuthUser(userCredential.user);
        } catch (error: any) {
            throw {
                code: error.code,
                message: getErrorMessage(error.code),
            } as AuthError;
        }
    },

    // Sign in with email and password
    async signIn(email: string, password: string): Promise<AuthUser> {
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            await createUserProfile(userCredential.user);
            return toAuthUser(userCredential.user);
        } catch (error: any) {
            throw {
                code: error.code,
                message: getErrorMessage(error.code),
            } as AuthError;
        }
    },

    // Sign in with Google - opens in system browser (popups are blocked in Tauri WebView)
    async signInWithGoogle(): Promise<AuthUser | null> {
        // Import the browser auth module dynamically
        const { signInWithGoogleBrowser, isGoogleBrowserAuthAvailable } = await import('./googleAuth');

        // Use browser-based auth if Google Client ID is configured
        if (isGoogleBrowserAuthAvailable()) {
            console.log('[Auth] Starting Google sign-in via system browser...');
            try {
                await signInWithGoogleBrowser();
                // After successful sign-in, the auth state will be updated by Firebase
                // Return the current user
                const user = auth.currentUser;
                if (user) {
                    console.log('[Auth] Browser sign-in completed, user:', user.email);
                    await createUserProfile(user);
                    return toAuthUser(user);
                }
                return null;
            } catch (error: any) {
                console.error('[Auth] Browser Google sign-in error:', error);
                throw {
                    code: 'auth/browser-auth-failed',
                    message: error.message || 'Google sign-in failed. Please try again.',
                } as AuthError;
            }
        }

        // If browser auth isn't available, show setup instructions
        throw {
            code: 'auth/not-configured',
            message: 'Google Sign-in requires configuration. Please add VITE_GOOGLE_CLIENT_ID to your .env file.',
        } as AuthError;
    },

    // Check for redirect result (call on app init)
    async checkRedirectResult(): Promise<AuthUser | null> {
        try {
            const result = await getRedirectResult(auth);
            if (result && result.user) {
                await createUserProfile(result.user);
                return toAuthUser(result.user);
            }
            return null;
        } catch (error: any) {
            console.error('Redirect result error:', error);
            return null;
        }
    },


    // Sign out
    async signOut(): Promise<void> {
        try {
            // Clear Google Drive access token
            const { clearGDriveAccessToken } = await import('./gdriveService');
            clearGDriveAccessToken();

            await signOut(auth);
        } catch (error: any) {
            throw {
                code: error.code,
                message: getErrorMessage(error.code),
            } as AuthError;
        }
    },

    // Send password reset email
    async resetPassword(email: string): Promise<void> {
        try {
            await sendPasswordResetEmail(auth, email);
        } catch (error: any) {
            throw {
                code: error.code,
                message: getErrorMessage(error.code),
            } as AuthError;
        }
    },

    // Get current user
    getCurrentUser(): AuthUser | null {
        const user = auth.currentUser;
        return user ? toAuthUser(user) : null;
    },

    // Subscribe to auth state changes
    onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void {
        return onAuthStateChanged(auth, (user) => {
            callback(user ? toAuthUser(user) : null);
        });
    },
};

// Human-readable error messages
function getErrorMessage(code: string): string {
    switch (code) {
        case 'auth/email-already-in-use':
            return 'This email is already registered. Please sign in instead.';
        case 'auth/invalid-email':
            return 'Please enter a valid email address.';
        case 'auth/operation-not-allowed':
            return 'Email/password sign-in is not enabled. Please contact support.';
        case 'auth/weak-password':
            return 'Password should be at least 6 characters long.';
        case 'auth/user-disabled':
            return 'This account has been disabled. Please contact support.';
        case 'auth/user-not-found':
            return 'No account found with this email. Please sign up.';
        case 'auth/wrong-password':
            return 'Incorrect password. Please try again.';
        case 'auth/invalid-credential':
            return 'Invalid email or password. Please check your credentials.';
        case 'auth/too-many-requests':
            return 'Too many failed attempts. Please try again later.';
        case 'auth/popup-closed-by-user':
            return 'Sign-in was cancelled. Trying alternative method...';
        case 'auth/popup-blocked':
            return 'Popup was blocked. Trying redirect method...';
        case 'auth/cancelled-popup-request':
            return 'Sign-in cancelled. Please try again.';
        case 'auth/unauthorized-domain':
            return 'This domain is not authorized for sign-in. Please use email/password instead.';
        case 'auth/network-request-failed':
            return 'Network error. Please check your internet connection.';
        default:
            return 'An error occurred. Please try again.';
    }
}

export default authService;
