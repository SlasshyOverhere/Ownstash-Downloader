// Google OAuth via System Browser for Tauri Desktop Apps
// Uses authorization code flow with backend for secure token exchange
// Client secrets are stored server-side, never in the app

import { open } from '@tauri-apps/plugin-shell';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import {
    getAuthConfig,
    exchangeCodeForTokens,
    refreshAccessToken as backendRefreshToken,
    checkBackendHealth,
    getBackendUrl,
    getUserInfo
} from './backendApi';

// Detect if we're in development mode
const isDev = import.meta.env.DEV;

// Backend callback URL - the backend handles the OAuth callback and redirects to app
const getCallbackUrl = () => {
    const backendUrl = getBackendUrl();
    return `${backendUrl}/auth/callback`;
};

// Fallback: Direct redirect URI for implicit flow (if backend is unavailable)
const FALLBACK_REDIRECT_URI = isDev
    ? 'http://localhost:1420'
    : (import.meta.env.VITE_AUTH_FALLBACK_URL || 'http://localhost:1420');

// Scopes required
const SCOPES = [
    'email',
    'profile',
    'openid',
    'https://www.googleapis.com/auth/drive.appdata'
];

// State management
let authState: string | null = null;
let authCallbackHandler: ((result: { success: boolean; error?: string; user?: GoogleUser }) => void) | null = null;
let useBackendFlow = true; // Will be set based on backend availability

// User type for backend OAuth
export interface GoogleUser {
    id: string;
    email: string;
    name: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
    verified_email?: boolean;
}

// Storage keys
const USER_STORAGE_KEY = 'ownstash_user';
const ACCESS_TOKEN_KEY = 'gdrive_access_token';
const REFRESH_TOKEN_KEY = 'gdrive_refresh_token';

/**
 * Get stored user from localStorage
 */
export function getStoredUser(): GoogleUser | null {
    try {
        const stored = localStorage.getItem(USER_STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        console.error('Error reading stored user:', e);
    }
    return null;
}

/**
 * Store user in localStorage
 */
export function storeUser(user: GoogleUser): void {
    try {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } catch (e) {
        console.error('Error storing user:', e);
    }
}

/**
 * Clear stored user
 */
export function clearStoredUser(): void {
    try {
        localStorage.removeItem(USER_STORAGE_KEY);
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch (e) {
        console.error('Error clearing stored user:', e);
    }
}

/**
 * Generate a random state string for CSRF protection
 */
function generateState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the Google OAuth URL using authorization code flow (with backend)
 */
async function buildGoogleAuthUrlWithBackend(): Promise<string> {
    authState = generateState();

    try {
        const config = await getAuthConfig();
        const callbackUrl = getCallbackUrl();

        const params = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: callbackUrl,
            response_type: 'code',
            scope: SCOPES.join(' '),
            state: authState,
            access_type: 'offline',
            prompt: 'consent',
            include_granted_scopes: 'true',
        });

        return `${config.authUrl}?${params.toString()}`;
    } catch (error) {
        console.error('Failed to get auth config from backend:', error);
        throw error;
    }
}

/**
 * Build the Google OAuth URL using implicit flow (fallback, no backend needed)
 */
function buildGoogleAuthUrlImplicit(): string {
    authState = generateState();
    const nonce = generateState();
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

    if (!clientId) {
        throw new Error('Google Client ID not configured');
    }

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: FALLBACK_REDIRECT_URI,
        response_type: 'id_token token',
        scope: SCOPES.join(' '),
        state: authState,
        nonce: nonce,
        prompt: 'select_account',
        include_granted_scopes: 'true',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Parse OAuth callback from URL
 * Supports both hash (implicit flow) and query params (code flow)
 */
function parseOAuthCallback(urlPart: string): {
    code?: string;
    idToken?: string;
    accessToken?: string;
    refreshToken?: string;
    state?: string;
    error?: string;
    expiresIn?: number;
} {
    try {
        // Remove leading # or ?
        const cleanPart = urlPart.startsWith('#') || urlPart.startsWith('?')
            ? urlPart.substring(1)
            : urlPart;

        const params = new URLSearchParams(cleanPart);

        return {
            code: params.get('code') || undefined,
            idToken: params.get('id_token') || undefined,
            accessToken: params.get('access_token') || undefined,
            refreshToken: params.get('refresh_token') || undefined,
            state: params.get('state') || undefined,
            error: params.get('error') || undefined,
            expiresIn: params.get('expires_in') ? parseInt(params.get('expires_in')!) : undefined,
        };
    } catch (e) {
        console.error('Error parsing OAuth callback:', e);
        return { error: 'Failed to parse authentication data' };
    }
}

/**
 * Handle OAuth callback - processes tokens and gets user info from backend
 */
async function handleOAuthCallback(data: {
    code?: string;
    idToken?: string;
    accessToken?: string;
    refreshToken?: string;
    error?: string;
    state?: string;
    expiresIn?: number;
}): Promise<void> {
    if (data.error) {
        console.error('OAuth error:', data.error);
        authCallbackHandler?.({ success: false, error: data.error });
        return;
    }

    // Verify state (don't block if authState is null - common in some Tauri cold start scenarios)
    if (data.state && authState && data.state !== authState) {
        console.error('State mismatch - possible CSRF attack');
        authCallbackHandler?.({ success: false, error: 'Security verification failed' });
        return;
    }

    // If we have a code, exchange it for tokens (authorization code flow)
    if (data.code) {
        try {
            console.log('Exchanging authorization code for tokens...');
            const tokens = await exchangeCodeForTokens(data.code, getCallbackUrl());

            data.accessToken = tokens.access_token;
            data.refreshToken = tokens.refresh_token;
            data.idToken = tokens.id_token;
            data.expiresIn = tokens.expires_in;

            console.log('Token exchange successful');
        } catch (error: any) {
            console.error('Token exchange failed:', error);
            authCallbackHandler?.({ success: false, error: error.message || 'Token exchange failed' });
            return;
        }
    }

    if (!data.accessToken) {
        authCallbackHandler?.({ success: false, error: 'No access token received' });
        return;
    }

    try {
        // 1. Store access token for Google Drive API
        const { setGDriveAccessToken } = await import('./gdriveService');
        await setGDriveAccessToken(data.accessToken);
        console.log('Google Drive access token prepared and stored');

        // Store in localStorage as backup
        localStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);

        // Also store refresh token if available (for token refresh later)
        if (data.refreshToken) {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('secure_save_setting', {
                    key: 'gdrive_refresh_token',
                    value: data.refreshToken
                });
                console.log('Refresh token stored securely');
            } catch (e) {
                // Fallback to localStorage if secure storage fails
                localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
                console.log('Refresh token stored in localStorage');
            }
        }

        // 2. Get user info from backend using access token
        console.log('Getting user info from backend...');
        const userInfo = await getUserInfo(data.accessToken);

        const user: GoogleUser = {
            id: userInfo.id,
            email: userInfo.email,
            name: userInfo.name,
            given_name: userInfo.given_name,
            family_name: userInfo.family_name,
            picture: userInfo.picture,
            verified_email: userInfo.verified_email
        };

        // 3. Store user locally
        storeUser(user);
        console.log('Successfully signed in with Google via backend OAuth');

        authCallbackHandler?.({ success: true, user });
    } catch (err: any) {
        console.error('Sign-in error:', err);
        authCallbackHandler?.({ success: false, error: err.message || 'Sign-in failed' });
    } finally {
        authState = null;
    }
}

/**
 * Check if we're running inside Tauri (desktop app) vs browser
 */
function isRunningInTauri(): boolean {
    return typeof window !== 'undefined' && (window as any).__TAURI__ !== undefined;
}

/**
 * Initialize listeners for OAuth callback
 */
export async function initGoogleAuthListener(): Promise<void> {
    // Check backend availability
    try {
        useBackendFlow = await checkBackendHealth();
        console.log(`OAuth mode: ${useBackendFlow ? 'Backend (secure)' : 'Fallback (implicit)'}`);
    } catch {
        useBackendFlow = false;
        console.log('Backend not available, using fallback OAuth flow');
    }

    // Check if current URL contains OAuth callback data
    if (typeof window !== 'undefined') {
        const hash = window.location.hash;
        const search = window.location.search;

        // Check for tokens in hash (implicit flow) or code in query (code flow)
        const hasTokens = hash.includes('access_token') || hash.includes('id_token');
        const hasCode = search.includes('code=');

        if (hasTokens || hasCode) {
            console.log('Found OAuth callback in URL');

            // Check if we're in a browser (not Tauri)
            if (!isRunningInTauri()) {
                // We're in the browser after OAuth redirect
                // Redirect to custom scheme to open the Tauri app with tokens
                console.log('In browser, redirecting to Tauri app via deep link...');

                const callbackData = hasTokens ? hash : search;
                const deepLinkUrl = `ownstash://auth/callback${callbackData}`;

                // Show redirect page
                document.open();
                document.write(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authentication Successful</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
        body { display: flex; align-items: center; justify-content: center; font-family: 'Segoe UI', system-ui, sans-serif; color: #fff; }
        .card { background: #111; border: 1px solid #222; border-radius: 16px; padding: 48px 40px; max-width: 380px; text-align: center; }
        .success-icon { width: 56px; height: 56px; margin: 0 auto 24px; background: #fff; color: #000; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; }
        h1 { font-size: 24px; margin-bottom: 12px; }
        .subtitle { color: #888; font-size: 14px; margin-bottom: 32px; }
        .loading { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 24px; color: #999; }
        .spinner { width: 16px; height: 16px; border: 2px solid #333; border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .btn { display: inline-block; padding: 14px 28px; background: #fff; color: #000; text-decoration: none; border-radius: 8px; font-weight: 600; }
        .hint { margin-top: 24px; color: #555; font-size: 12px; }
    </style>
</head>
<body>
    <div class="card">
        <div class="success-icon">✓</div>
        <h1>You're All Set!</h1>
        <p class="subtitle">Authentication successful.<br>Opening Ownstash Downloader...</p>
        <div class="loading"><div class="spinner"></div><span>Launching app...</span></div>
        <a href="${deepLinkUrl}" class="btn">Open App</a>
        <p class="hint">You can close this tab after the app opens</p>
    </div>
    <script>setTimeout(function() { window.location.href = "${deepLinkUrl}"; }, 500);</script>
</body>
</html>
                `);
                document.close();
                return;
            }

            // We're in Tauri, process the callback directly
            const data = parseOAuthCallback(hasTokens ? hash : search);
            await handleOAuthCallback(data);
            // Clear the URL to clean up
            window.history.replaceState(null, '', window.location.pathname);
        }
    }

    // Set up deep link listener
    try {
        await onOpenUrl(async (urls) => {
            for (const url of urls) {
                console.log('Deep link received via onOpenUrl:', url);
                if (url.includes('oauth') || url.includes('auth') || url.includes('callback')) {
                    // Try to find tokens/code in hash or query
                    const hashIndex = url.indexOf('#');
                    const queryIndex = url.indexOf('?');

                    let data;
                    if (hashIndex !== -1) {
                        data = parseOAuthCallback(url.substring(hashIndex));
                    } else if (queryIndex !== -1) {
                        data = parseOAuthCallback(url.substring(queryIndex));
                    }

                    if (data) {
                        await handleOAuthCallback(data);
                    }
                }
            }
        });
        console.log('Deep link OAuth listener initialized');
    } catch (error) {
        console.log('Deep link onOpenUrl not available:', error);
    }

    // Listen for oauth-deep-link events from single-instance plugin
    try {
        const { listen } = await import('@tauri-apps/api/event');
        await listen<string>('oauth-deep-link', async (event) => {
            console.log('OAuth deep link event received:', event.payload);
            const url = event.payload;

            const hashIndex = url.indexOf('#');
            const queryIndex = url.indexOf('?');

            let data;
            if (hashIndex !== -1) {
                data = parseOAuthCallback(url.substring(hashIndex));
            } else if (queryIndex !== -1) {
                data = parseOAuthCallback(url.substring(queryIndex));
            }

            if (data) {
                await handleOAuthCallback(data);
            }
        });
        console.log('OAuth deep link event listener initialized');
    } catch (error) {
        console.log('Tauri event listener not available:', error);
    }
}

/**
 * Open Google sign-in in the system browser
 */
export async function signInWithGoogleBrowser(): Promise<GoogleUser> {
    return new Promise(async (resolve, reject) => {
        authCallbackHandler = (result) => {
            authCallbackHandler = null;
            if (result.success && result.user) {
                resolve(result.user);
            } else {
                reject(new Error(result.error || 'Sign-in failed'));
            }
        };

        try {
            let authUrl: string;

            if (useBackendFlow) {
                // Use secure backend flow (authorization code)
                console.log('Using backend OAuth flow (authorization code)');
                authUrl = await buildGoogleAuthUrlWithBackend();
            } else {
                // Fallback to implicit flow (less secure, but works without backend)
                console.log('Using fallback OAuth flow (implicit)');
                authUrl = buildGoogleAuthUrlImplicit();
            }

            console.log('Opening Google sign-in in browser...');

            await open(authUrl);
        } catch (err: any) {
            authCallbackHandler = null;
            reject(new Error(`Failed to start authentication: ${err.message}`));
        }

        // 5 minute timeout
        setTimeout(() => {
            if (authCallbackHandler) {
                console.log('Auth flow still active - user may still be authenticating');
            }
        }, 5 * 60 * 1000);
    });
}

/**
 * Refresh the access token using the stored refresh token
 */
export async function refreshGDriveToken(): Promise<string | null> {
    try {
        // Try to get refresh token from secure storage
        let refreshToken: string | null = null;

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            refreshToken = await invoke<string>('secure_get_setting', { key: 'gdrive_refresh_token' });
        } catch {
            // Fallback to localStorage
            refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
        }

        if (!refreshToken) {
            console.log('No refresh token available');
            return null;
        }

        console.log('Refreshing access token via backend...');
        const result = await backendRefreshToken(refreshToken);

        // Store the new access token
        const { setGDriveAccessToken } = await import('./gdriveService');
        await setGDriveAccessToken(result.access_token);
        localStorage.setItem(ACCESS_TOKEN_KEY, result.access_token);

        console.log('Access token refreshed successfully');
        return result.access_token;
    } catch (error) {
        console.error('Failed to refresh token:', error);
        return null;
    }
}

/**
 * Check if Google browser auth is available
 */
export function isGoogleBrowserAuthAvailable(): boolean {
    // Either backend is available or we have a client ID for fallback
    return useBackendFlow || !!import.meta.env.VITE_GOOGLE_CLIENT_ID;
}

/**
 * Get instructions for setting up Google Auth
 */
export function getGoogleAuthSetupInstructions(): string {
    return `
To enable Google Sign-in:

Option 1: Backend (Recommended - Secure)
1. Deploy the backend folder to Render or similar
2. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend environment
3. Set VITE_BACKEND_URL in your app's .env file

Option 2: Fallback (Less Secure)
1. Set VITE_GOOGLE_CLIENT_ID in your .env file
2. Add redirect URIs to Google Cloud Console
`;
}
