// Google OAuth via System Browser for Tauri Desktop Apps
// Opens Google sign-in in the default browser
// The callback is received via deep link

import { open } from '@tauri-apps/plugin-shell';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { GoogleAuthProvider, signInWithCredential, OAuthCredential } from 'firebase/auth';
import { auth } from '@/config/firebase';

// Configuration - Google Client ID can be found in Firebase Console or Google Cloud Console
// When you enable Google Sign-in in Firebase, it creates a Web client automatically
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Detect if we're in development mode
const isDev = import.meta.env.DEV;

// Redirect URI configuration:
// - DEV MODE: Uses localhost:1420 (Vite dev server handles the redirect)
// - PRODUCTION: Uses the hosted callback page on Netlify (or override with VITE_OAUTH_REDIRECT_URI)
const PRODUCTION_CALLBACK_URL = 'https://slasshy-omnidownloader-fallback.netlify.app/';
const REDIRECT_URI = isDev
    ? 'http://localhost:1420'
    : (import.meta.env.VITE_OAUTH_REDIRECT_URI || PRODUCTION_CALLBACK_URL);

const SCOPES = ['email', 'profile', 'openid'];

// State management
let authState: string | null = null;
let authCallbackHandler: ((result: { success: boolean; error?: string }) => void) | null = null;

/**
 * Generate a random state string for CSRF protection
 */
function generateState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the Google OAuth URL using implicit flow
 */
function buildGoogleAuthUrl(): string {
    authState = generateState();
    const nonce = generateState();

    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
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
 * Parse OAuth callback from URL hash
 */
function parseOAuthCallback(hash: string): { idToken?: string; accessToken?: string; state?: string; error?: string } {
    try {
        const params = new URLSearchParams(hash.startsWith('#') ? hash.substring(1) : hash);

        return {
            idToken: params.get('id_token') || undefined,
            accessToken: params.get('access_token') || undefined,
            state: params.get('state') || undefined,
            error: params.get('error') || undefined,
        };
    } catch (e) {
        console.error('Error parsing OAuth callback:', e);
        return { error: 'Failed to parse authentication data' };
    }
}

/**
 * Handle OAuth callback - signs into Firebase with the Google credential
 */
async function handleOAuthCallback(data: { idToken?: string; accessToken?: string; error?: string; state?: string }): Promise<void> {
    if (data.error) {
        console.error('OAuth error:', data.error);
        authCallbackHandler?.({ success: false, error: data.error });
        return;
    }

    // Verify state
    if (data.state && data.state !== authState) {
        console.error('State mismatch - possible CSRF attack');
        authCallbackHandler?.({ success: false, error: 'Security verification failed' });
        return;
    }

    if (!data.idToken && !data.accessToken) {
        authCallbackHandler?.({ success: false, error: 'No authentication tokens received' });
        return;
    }

    try {
        // Create Firebase credential from Google tokens
        const credential: OAuthCredential = GoogleAuthProvider.credential(
            data.idToken || null,
            data.accessToken || null
        );

        // Sign in to Firebase
        await signInWithCredential(auth, credential);

        console.log('Successfully signed in with Google via browser');
        authCallbackHandler?.({ success: true });
    } catch (err: any) {
        console.error('Firebase sign-in error:', err);
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
 * There are two ways we can receive the callback:
 * 1. Via location change if running in dev mode (localhost redirect)
 * 2. Via deep link if using custom scheme
 */
export async function initGoogleAuthListener(): Promise<void> {
    // Check if current URL contains OAuth callback data
    if (typeof window !== 'undefined' && window.location.hash) {
        const hash = window.location.hash;
        if (hash.includes('access_token') || hash.includes('id_token')) {
            console.log('Found OAuth callback in URL hash');

            // Check if we're in a browser (not Tauri)
            if (!isRunningInTauri()) {
                // We're in the browser after OAuth redirect
                // Redirect to custom scheme to open the Tauri app with tokens
                console.log('In browser, redirecting to Tauri app via deep link...');

                // Build the deep link URL with the tokens
                const deepLinkUrl = `slasshy://auth/callback${hash}`;

                // Completely replace the document to ensure no React/Vite styles interfere
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
        html, body { 
            width: 100%; 
            height: 100%; 
            background: #000; 
            overflow: hidden;
        }
        body {
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            color: #fff;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .card {
            background: #111;
            border: 1px solid #222;
            border-radius: 16px;
            padding: 48px 40px;
            max-width: 380px;
            width: calc(100% - 48px);
            text-align: center;
            animation: fadeIn 0.4s ease-out;
        }
        .success-icon {
            width: 56px;
            height: 56px;
            margin: 0 auto 24px;
            background: #fff;
            color: #000;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            font-weight: bold;
        }
        h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 12px;
            color: #fff;
        }
        .subtitle {
            color: #888;
            font-size: 14px;
            margin-bottom: 32px;
            line-height: 1.6;
        }
        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            margin-bottom: 24px;
            color: #999;
            font-size: 13px;
        }
        .spinner {
            width: 16px;
            height: 16px;
            border: 2px solid #333;
            border-top-color: #fff;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        .btn {
            display: inline-block;
            padding: 14px 28px;
            background: #fff;
            color: #000;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 14px;
            transition: background 0.2s ease;
        }
        .btn:hover {
            background: #e5e5e5;
        }
        .hint {
            margin-top: 24px;
            color: #555;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="success-icon">✓</div>
        <h1>You're All Set!</h1>
        <p class="subtitle">
            Authentication successful.<br>
            Opening Slasshy OmniDownloader...
        </p>
        <div class="loading">
            <div class="spinner"></div>
            <span>Launching app...</span>
        </div>
        <a href="${deepLinkUrl}" class="btn">Open App</a>
        <p class="hint">You can close this tab after the app opens</p>
    </div>
    <script>
        setTimeout(function() {
            window.location.href = "${deepLinkUrl}";
        }, 500);
    </script>
</body>
</html>
                `);
                document.close();

                // Try to redirect automatically
                setTimeout(() => {
                    window.location.href = deepLinkUrl;
                }, 500);

                return;
            }

            // We're in Tauri, process the callback directly
            const data = parseOAuthCallback(hash);
            await handleOAuthCallback(data);
            // Clear the hash to clean up URL
            window.history.replaceState(null, '', window.location.pathname);
        }
    }

    // Set up deep link listener from Tauri's deep-link plugin (for direct deep links)
    try {
        await onOpenUrl(async (urls) => {
            for (const url of urls) {
                console.log('Deep link received via onOpenUrl:', url);
                if (url.includes('oauth') || url.includes('auth') || url.includes('callback')) {
                    const hashIndex = url.indexOf('#');
                    if (hashIndex !== -1) {
                        const data = parseOAuthCallback(url.substring(hashIndex));
                        await handleOAuthCallback(data);
                    }
                }
            }
        });
        console.log('Deep link OAuth listener initialized');
    } catch (error) {
        console.log('Deep link onOpenUrl not available:', error);
    }

    // Also listen for oauth-deep-link events from the single-instance plugin
    // This is triggered when a second instance tries to open with a deep link
    try {
        const { listen } = await import('@tauri-apps/api/event');
        await listen<string>('oauth-deep-link', async (event) => {
            console.log('OAuth deep link event received:', event.payload);
            const url = event.payload;

            // Extract hash from the URL
            const hashIndex = url.indexOf('#');
            if (hashIndex !== -1) {
                const data = parseOAuthCallback(url.substring(hashIndex));
                await handleOAuthCallback(data);
            } else {
                // Maybe tokens are in query string
                const queryIndex = url.indexOf('?');
                if (queryIndex !== -1) {
                    const data = parseOAuthCallback(url.substring(queryIndex));
                    await handleOAuthCallback(data);
                }
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
export async function signInWithGoogleBrowser(): Promise<void> {
    if (!GOOGLE_CLIENT_ID) {
        throw new Error(
            'Google Client ID not configured.\n\n' +
            'To enable browser-based Google Sign-in:\n' +
            '1. Go to Google Cloud Console > APIs & Services > Credentials\n' +
            '2. Find "Web client (auto created by Google Service)"\n' +
            '3. Copy the Client ID\n' +
            '4. Add VITE_GOOGLE_CLIENT_ID to your .env file'
        );
    }

    return new Promise((resolve, reject) => {
        authCallbackHandler = (result) => {
            authCallbackHandler = null;
            if (result.success) {
                resolve();
            } else {
                reject(new Error(result.error || 'Sign-in failed'));
            }
        };

        const authUrl = buildGoogleAuthUrl();
        console.log('Opening Google sign-in in browser...');

        open(authUrl).catch((err) => {
            authCallbackHandler = null;
            reject(new Error(`Failed to open browser: ${err.message}`));
        });

        // 5 minute timeout (don't reject, just log)
        setTimeout(() => {
            if (authCallbackHandler) {
                console.log('Auth flow still active - user may still be authenticating');
            }
        }, 5 * 60 * 1000);
    });
}

/**
 * Check if Google browser auth is available
 */
export function isGoogleBrowserAuthAvailable(): boolean {
    // Only need Google Client ID - we now have a default production redirect URI
    return !!GOOGLE_CLIENT_ID;
}

/**
 * Get instructions for setting up Google Client ID
 */
export function getGoogleAuthSetupInstructions(): string {
    return `
To enable browser-based Google Sign-in:

1. Go to Google Cloud Console (https://console.cloud.google.com)
2. Select your Firebase project
3. Go to APIs & Services > Credentials
4. Under "OAuth 2.0 Client IDs", find "Web client (auto created by Google Service)"
5. Click on it and copy the Client ID
6. Add to your .env file: VITE_GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
7. Also add http://localhost:1420/oauth/callback to the "Authorized redirect URIs"
8. Restart the application
`;
}
