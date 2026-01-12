// Backend API Service
// Handles communication with the Ownstash backend for OAuth and other secure operations

// Backend URL - configured via environment variable or defaults to localhost for dev
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

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
 * Generate OAuth authorization URL
 */
export async function getAuthUrl(redirectUri: string, state?: string): Promise<{ url: string }> {
    const params = new URLSearchParams({ redirect_uri: redirectUri });
    if (state) params.append('state', state);
    return backendRequest(`/auth/url?${params.toString()}`);
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
 * Revoke a token (logout)
 */
export async function revokeToken(token: string): Promise<{ success: boolean }> {
    return backendRequest('/auth/revoke', {
        method: 'POST',
        body: JSON.stringify({ token }),
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

// ==================== Drive Endpoints ====================

/**
 * List files in appdata folder
 */
export async function listDriveFiles(
    accessToken: string,
    options: { q?: string; pageSize?: number; pageToken?: string; fields?: string } = {}
): Promise<{
    files: Array<{ id: string; name: string; mimeType: string; modifiedTime: string }>;
    nextPageToken?: string;
}> {
    return backendRequest('/drive/files/list', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(options),
    });
}

/**
 * Get file metadata
 */
export async function getDriveFile(
    accessToken: string,
    fileId: string,
    fields?: string
): Promise<{ id: string; name: string; mimeType: string; size?: string }> {
    const params = fields ? `?fields=${encodeURIComponent(fields)}` : '';
    return backendRequest(`/drive/files/${fileId}${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
}

/**
 * Download file content
 */
export async function downloadDriveFile(
    accessToken: string,
    fileId: string
): Promise<ArrayBuffer> {
    const url = `${BACKEND_URL}/drive/files/${fileId}/content`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.details || data.error || `Download failed: ${response.status}`);
    }

    return response.arrayBuffer();
}

/**
 * Create a new file in appdata folder
 */
export async function createDriveFile(
    accessToken: string,
    name: string,
    content: string | object,
    mimeType: string = 'application/json'
): Promise<{ id: string; name: string }> {
    return backendRequest('/drive/files', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ name, content, mimeType }),
    });
}

/**
 * Update file content
 */
export async function updateDriveFile(
    accessToken: string,
    fileId: string,
    content: string | object,
    mimeType: string = 'application/json'
): Promise<{ id: string; name: string }> {
    return backendRequest(`/drive/files/${fileId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ content, mimeType }),
    });
}

/**
 * Delete a file
 */
export async function deleteDriveFile(
    accessToken: string,
    fileId: string
): Promise<{ success: boolean }> {
    return backendRequest(`/drive/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
    });
}

/**
 * Get Drive storage quota info
 */
export async function getDriveAbout(accessToken: string): Promise<{
    storageQuota: {
        limit: string;
        usage: string;
        usageInDrive: string;
        usageInDriveTrash: string;
    };
    user: {
        displayName: string;
        emailAddress: string;
        photoLink: string;
    };
}> {
    return backendRequest('/drive/about', {
        headers: { Authorization: `Bearer ${accessToken}` },
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
