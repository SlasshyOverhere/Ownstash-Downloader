/**
 * Mobile Auth Component
 * Handles OAuth for mobile app, then redirects back via deep link
 */

import { useEffect, useState } from 'react';

const GOOGLE_CLIENT_ID = '920943392342-hng46l9696u4ml1lu44n1n2lo79t256v.apps.googleusercontent.com';

export default function MobileAuth() {
    const [status, setStatus] = useState<'loading' | 'authenticating' | 'success' | 'error'>('loading');
    const [callbackUrl, setCallbackUrl] = useState<string | null>(null);

    useEffect(() => {
        // Get callback URL from query params
        const params = new URLSearchParams(window.location.search);
        const callback = params.get('callback');
        setCallbackUrl(callback || 'slasshy-vault://auth');

        // Check if we have a token in the hash (OAuth redirect back)
        if (window.location.hash.includes('access_token=')) {
            handleOAuthCallback();
        } else {
            // Start OAuth flow
            setStatus('authenticating');
            startOAuth();
        }
    }, []);

    const startOAuth = () => {
        const redirectUri = window.location.origin + '/mobile-auth';
        const scopes = [
            'https://www.googleapis.com/auth/drive.appdata',
            'https://www.googleapis.com/auth/drive.file',
            'profile',
            'email',
        ].join(' ');

        // Save callback URL for later
        localStorage.setItem('mobile_auth_callback', callbackUrl || 'slasshy-vault://auth');

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'token');
        authUrl.searchParams.set('scope', scopes);
        authUrl.searchParams.set('prompt', 'select_account');

        window.location.href = authUrl.toString();
    };

    const handleOAuthCallback = async () => {
        try {
            const hash = window.location.hash.substring(1);
            const params = new URLSearchParams(hash);
            const accessToken = params.get('access_token');

            if (!accessToken) {
                setStatus('error');
                return;
            }

            // Fetch user info
            const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
            });

            if (!response.ok) {
                setStatus('error');
                return;
            }

            const userData = await response.json();
            const user = {
                email: userData.email,
                name: userData.name,
                photo: userData.picture,
                id: userData.id,
            };

            setStatus('success');

            // Get callback URL from storage
            const storedCallback = localStorage.getItem('mobile_auth_callback') || 'slasshy-vault://auth';
            localStorage.removeItem('mobile_auth_callback');

            // Build deep link URL
            const deepLinkUrl = `${storedCallback}?token=${encodeURIComponent(accessToken)}&user=${encodeURIComponent(JSON.stringify(user))}`;

            // Small delay to show success message
            setTimeout(() => {
                window.location.href = deepLinkUrl;
            }, 1000);

        } catch (e) {
            console.error('OAuth error:', e);
            setStatus('error');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-black text-white">
            <div className="text-center max-w-md mx-auto p-8">
                <div className="text-6xl mb-6">🔐</div>

                {status === 'loading' && (
                    <>
                        <h1 className="text-2xl font-bold mb-4">Loading...</h1>
                        <p className="text-gray-400">Preparing authentication</p>
                    </>
                )}

                {status === 'authenticating' && (
                    <>
                        <h1 className="text-2xl font-bold mb-4">Redirecting to Google...</h1>
                        <p className="text-gray-400">Please wait while we redirect you to sign in</p>
                        <div className="mt-6">
                            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-purple-500 mx-auto"></div>
                        </div>
                    </>
                )}

                {status === 'success' && (
                    <>
                        <h1 className="text-2xl font-bold mb-4 text-green-400">✓ Sign-in Successful!</h1>
                        <p className="text-gray-400">Returning to Slasshy Vault app...</p>
                        <div className="mt-6">
                            <div className="animate-pulse text-purple-400">Opening app...</div>
                        </div>
                    </>
                )}

                {status === 'error' && (
                    <>
                        <h1 className="text-2xl font-bold mb-4 text-red-400">Authentication Failed</h1>
                        <p className="text-gray-400 mb-6">Something went wrong. Please try again.</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors"
                        >
                            Try Again
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
