// Backend API Service
// Handles communication with the Slasshy backend for OAuth and other secure operations

// Backend URL - configured via environment variable or defaults to localhost for dev
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://localhost:3000';

/**
 * Make a request to the backend API
 */
async function backendRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${BACKEND_URL}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.details || data.error || `Request failed: ${response.status}`);
    }

    return data;
}

// ==================== Auth Endpoints ====================

/**
 * Get OAuth configuration from backend
 */
export async function getAuthConfig(): Promise<{
    clientId: string;
    scopes: string;
    authUrl: string;
}> {
    return backendRequest('/auth/config');
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
    code: string,
    redirectUri: string
): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
    id_token?: string;
}> {
    return backendRequest('/auth/token', {
        method: 'POST',
        body: JSON.stringify({ code, redirect_uri: redirectUri }),
    });
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
}> {
    return backendRequest('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
    });
}

/**
 * Get user info using access token
 */
export async function getUserInfo(accessToken: string): Promise<{
    id: string;
    email: string;
    verified_email: boolean;
    name: string;
    given_name: string;
    family_name: string;
    picture: string;
}> {
    return backendRequest('/auth/userinfo', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });
}

// ==================== Health Check ====================

/**
 * Check if the backend is available
 */
export async function checkBackendHealth(): Promise<boolean> {
    try {
        await backendRequest('/health');
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the backend URL
 */
export function getBackendUrl(): string {
    return BACKEND_URL;
}
