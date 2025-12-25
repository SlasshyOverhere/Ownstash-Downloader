// Google Drive Database Service - Stores user data in their own Google Drive
// Uses the App Data folder which is hidden from the user but accessible by the app
// This provides privacy: user data never leaves their own Google account

import { Download, SearchHistory, Setting } from './firestore';

// File names in Google Drive App Data folder
const FILES = {
    DOWNLOADS: 'slasshy_downloads.json',
    SEARCH_HISTORY: 'slasshy_search_history.json',
    SETTINGS: 'slasshy_settings.json',
};

// Google Drive API endpoints
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

// Token storage key
const ACCESS_TOKEN_KEY = 'gdrive_access_token';

// Subscription callbacks for real-time updates (simulated via polling)
type UnsubscribeCallback = () => void;
const subscriptions = {
    downloads: new Set<(downloads: Download[]) => void>(),
    searchHistory: new Set<(history: SearchHistory[]) => void>(),
    settings: new Set<(settings: Setting[]) => void>(),
};

// Polling interval for checking updates (30 seconds)
let pollInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Store the access token (called after OAuth)
 */
export function setGDriveAccessToken(token: string): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
    console.log('[GDrive] Access token stored');
}

/**
 * Get the stored access token
 */
export function getGDriveAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
}

/**
 * Clear the access token (on logout)
 */
export function clearGDriveAccessToken(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    console.log('[GDrive] Access token cleared');
}

/**
 * Check if Google Drive is available (has access token)
 */
export function isGDriveAvailable(): boolean {
    return !!getGDriveAccessToken();
}

/**
 * Make an authenticated request to Google Drive API
 */
async function driveRequest(
    endpoint: string,
    options: RequestInit = {},
    useUploadBase = false
): Promise<Response> {
    const token = getGDriveAccessToken();
    if (!token) {
        throw new Error('Google Drive not authenticated. Please sign in again.');
    }

    const baseUrl = useUploadBase ? DRIVE_UPLOAD_BASE : DRIVE_API_BASE;
    const response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            ...options.headers,
        },
    });

    if (response.status === 401) {
        // Token expired, clear it
        clearGDriveAccessToken();
        throw new Error('Google Drive session expired. Please sign in again.');
    }

    return response;
}

/**
 * Find a file in App Data folder by name
 */
async function findFile(fileName: string): Promise<string | null> {
    const query = encodeURIComponent(`name='${fileName}' and 'appDataFolder' in parents and trashed=false`);
    const response = await driveRequest(`/files?spaces=appDataFolder&q=${query}&fields=files(id,name)`);

    if (!response.ok) {
        console.error('[GDrive] Failed to search files:', await response.text());
        return null;
    }

    const data = await response.json();
    return data.files?.[0]?.id || null;
}

/**
 * Read file content from Google Drive
 */
async function readFile<T>(fileName: string): Promise<T | null> {
    const fileId = await findFile(fileName);
    if (!fileId) {
        console.log(`[GDrive] File ${fileName} not found, returning null`);
        return null;
    }

    const response = await driveRequest(`/files/${fileId}?alt=media`);
    if (!response.ok) {
        console.error('[GDrive] Failed to read file:', await response.text());
        return null;
    }

    try {
        return await response.json();
    } catch (e) {
        console.error('[GDrive] Failed to parse file content:', e);
        return null;
    }
}

/**
 * Write file content to Google Drive (create or update)
 */
async function writeFile<T>(fileName: string, content: T): Promise<void> {
    const fileId = await findFile(fileName);
    const jsonContent = JSON.stringify(content, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });

    if (fileId) {
        // Update existing file
        const response = await driveRequest(
            `/files/${fileId}?uploadType=media`,
            {
                method: 'PATCH',
                body: blob,
            },
            true
        );

        if (!response.ok) {
            throw new Error(`Failed to update file: ${await response.text()}`);
        }
        console.log(`[GDrive] Updated ${fileName}`);
    } else {
        // Create new file in appDataFolder
        const metadata = {
            name: fileName,
            parents: ['appDataFolder'],
        };

        // Use multipart upload for creating with content
        const boundary = '-------314159265358979323846';
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelimiter = `\r\n--${boundary}--`;

        const multipartBody =
            delimiter +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            jsonContent +
            closeDelimiter;

        const response = await driveRequest(
            `/files?uploadType=multipart`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/related; boundary="${boundary}"`,
                },
                body: multipartBody,
            },
            true
        );

        if (!response.ok) {
            throw new Error(`Failed to create file: ${await response.text()}`);
        }
        console.log(`[GDrive] Created ${fileName}`);
    }
}

/**
 * Notify all subscribers of data changes
 */
function notifySubscribers(type: 'downloads' | 'searchHistory' | 'settings', data: any): void {
    const subs = subscriptions[type];
    subs.forEach(callback => {
        try {
            callback(data);
        } catch (e) {
            console.error('[GDrive] Subscriber callback error:', e);
        }
    });
}

/**
 * Start polling for updates (simulates real-time sync)
 */
function startPolling(): void {
    if (pollInterval) return;

    pollInterval = setInterval(async () => {
        if (!isGDriveAvailable()) return;

        try {
            // Only poll if there are subscribers
            // Note: userId is not used in GDrive (data is per-account), but we need to pass it for API compatibility
            if (subscriptions.downloads.size > 0) {
                const downloads = await gdriveService.getDownloads('');
                notifySubscribers('downloads', downloads);
            }
            if (subscriptions.searchHistory.size > 0) {
                const history = await gdriveService.getSearchHistory('', 50);
                notifySubscribers('searchHistory', history);
            }
            if (subscriptions.settings.size > 0) {
                const settings = await gdriveService.getAllSettings('');
                notifySubscribers('settings', settings);
            }
        } catch (e) {
            console.error('[GDrive] Polling error:', e);
        }
    }, 30000); // 30 seconds

    console.log('[GDrive] Started polling for updates');
}

/**
 * Stop polling
 */
function stopPolling(): void {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
        console.log('[GDrive] Stopped polling');
    }
}

// ==================== GOOGLE DRIVE DATA SERVICE ====================
// Mirrors the firestoreService API for drop-in replacement

export const gdriveService = {
    // ==================== DOWNLOADS ====================

    async addDownload(_userId: string, download: Download): Promise<void> {
        const downloads = await this.getDownloads(_userId);

        // Check if download already exists
        const existingIndex = downloads.findIndex(d => d.id === download.id);
        if (existingIndex >= 0) {
            downloads[existingIndex] = { ...download };
        } else {
            downloads.unshift(download); // Add to beginning
        }

        await writeFile(FILES.DOWNLOADS, downloads);
        notifySubscribers('downloads', downloads);
    },

    async getDownloads(_userId: string): Promise<Download[]> {
        const downloads = await readFile<Download[]>(FILES.DOWNLOADS);
        if (!downloads) return [];

        // Sort by timestamp (newest first)
        return downloads.sort((a, b) => b.timestamp - a.timestamp);
    },

    async updateDownloadStatus(_userId: string, id: string, status: string): Promise<void> {
        const downloads = await this.getDownloads(_userId);
        const index = downloads.findIndex(d => d.id === id);

        if (index >= 0) {
            downloads[index].status = status;
            await writeFile(FILES.DOWNLOADS, downloads);
            notifySubscribers('downloads', downloads);
        }
    },

    async deleteDownload(_userId: string, id: string): Promise<void> {
        const downloads = await this.getDownloads(_userId);
        const filtered = downloads.filter(d => d.id !== id);
        await writeFile(FILES.DOWNLOADS, filtered);
        notifySubscribers('downloads', filtered);
    },

    async clearDownloads(_userId: string): Promise<void> {
        await writeFile(FILES.DOWNLOADS, []);
        notifySubscribers('downloads', []);
    },

    subscribeToDownloads(_userId: string, callback: (downloads: Download[]) => void): UnsubscribeCallback {
        subscriptions.downloads.add(callback);
        startPolling();

        // Initial load
        this.getDownloads(_userId).then(downloads => {
            callback(downloads);
        }).catch(console.error);

        return () => {
            subscriptions.downloads.delete(callback);
            if (subscriptions.downloads.size === 0 &&
                subscriptions.searchHistory.size === 0 &&
                subscriptions.settings.size === 0) {
                stopPolling();
            }
        };
    },

    // ==================== SEARCH HISTORY ====================

    async addSearch(_userId: string, searchQuery: string, title?: string, thumbnail?: string): Promise<void> {
        const history = await this.getSearchHistory(_userId, 1000);

        const newEntry: SearchHistory = {
            id: crypto.randomUUID(),
            query: searchQuery,
            timestamp: Date.now(),
            title,
            thumbnail,
        };

        history.unshift(newEntry);

        // Keep only last 500 entries
        const trimmed = history.slice(0, 500);
        await writeFile(FILES.SEARCH_HISTORY, trimmed);
        notifySubscribers('searchHistory', trimmed.slice(0, 50));
    },

    async getSearchHistory(_userId: string, limitCount: number = 50): Promise<SearchHistory[]> {
        const history = await readFile<SearchHistory[]>(FILES.SEARCH_HISTORY);
        if (!history) return [];

        // Sort by timestamp (newest first) and limit
        return history
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limitCount);
    },

    async clearSearchHistory(_userId: string): Promise<void> {
        await writeFile(FILES.SEARCH_HISTORY, []);
        notifySubscribers('searchHistory', []);
    },

    subscribeToSearchHistory(_userId: string, callback: (history: SearchHistory[]) => void, limitCount: number = 50): UnsubscribeCallback {
        subscriptions.searchHistory.add(callback);
        startPolling();

        // Initial load
        this.getSearchHistory(_userId, limitCount).then(history => {
            callback(history);
        }).catch(console.error);

        return () => {
            subscriptions.searchHistory.delete(callback);
            if (subscriptions.downloads.size === 0 &&
                subscriptions.searchHistory.size === 0 &&
                subscriptions.settings.size === 0) {
                stopPolling();
            }
        };
    },

    // ==================== SETTINGS ====================

    async saveSetting(_userId: string, key: string, value: string): Promise<void> {
        const settings = await this.getAllSettings(_userId);
        const index = settings.findIndex(s => s.key === key);

        if (index >= 0) {
            settings[index].value = value;
        } else {
            settings.push({ key, value });
        }

        await writeFile(FILES.SETTINGS, settings);
        notifySubscribers('settings', settings);
    },

    async getSetting(_userId: string, key: string): Promise<string | null> {
        const settings = await this.getAllSettings(_userId);
        const setting = settings.find(s => s.key === key);
        return setting?.value ?? null;
    },

    async getAllSettings(_userId: string): Promise<Setting[]> {
        const settings = await readFile<Setting[]>(FILES.SETTINGS);
        return settings || [];
    },

    async deleteSetting(_userId: string, key: string): Promise<void> {
        const settings = await this.getAllSettings(_userId);
        const filtered = settings.filter(s => s.key !== key);
        await writeFile(FILES.SETTINGS, filtered);
        notifySubscribers('settings', filtered);
    },

    subscribeToSettings(_userId: string, callback: (settings: Setting[]) => void): UnsubscribeCallback {
        subscriptions.settings.add(callback);
        startPolling();

        // Initial load
        this.getAllSettings(_userId).then(settings => {
            callback(settings);
        }).catch(console.error);

        return () => {
            subscriptions.settings.delete(callback);
            if (subscriptions.downloads.size === 0 &&
                subscriptions.searchHistory.size === 0 &&
                subscriptions.settings.size === 0) {
                stopPolling();
            }
        };
    },

    // ==================== DATA MIGRATION ====================

    async migrateLocalData(
        _userId: string,
        localDownloads: Download[],
        localSearchHistory: SearchHistory[],
        localSettings: Setting[]
    ): Promise<void> {
        console.log('[GDrive] Starting migration...');

        // Get existing data from Drive
        const [existingDownloads, existingHistory, existingSettings] = await Promise.all([
            this.getDownloads(_userId),
            this.getSearchHistory(_userId, 1000),
            this.getAllSettings(_userId),
        ]);

        // Merge downloads (avoid duplicates by ID)
        const downloadMap = new Map<string, Download>();
        existingDownloads.forEach(d => downloadMap.set(d.id, d));
        localDownloads.forEach(d => {
            if (!downloadMap.has(d.id)) {
                downloadMap.set(d.id, d);
            }
        });
        const mergedDownloads = Array.from(downloadMap.values())
            .sort((a, b) => b.timestamp - a.timestamp);

        // Merge search history (avoid duplicates by ID)
        const historyMap = new Map<string, SearchHistory>();
        existingHistory.forEach(h => historyMap.set(h.id, h));
        localSearchHistory.forEach(h => {
            if (!historyMap.has(h.id)) {
                historyMap.set(h.id, h);
            }
        });
        const mergedHistory = Array.from(historyMap.values())
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 500);

        // Merge settings (local overwrites cloud)
        const settingsMap = new Map<string, Setting>();
        existingSettings.forEach(s => settingsMap.set(s.key, s));
        localSettings.forEach(s => settingsMap.set(s.key, s)); // Local takes priority
        const mergedSettings = Array.from(settingsMap.values());

        // Write all data
        await Promise.all([
            writeFile(FILES.DOWNLOADS, mergedDownloads),
            writeFile(FILES.SEARCH_HISTORY, mergedHistory),
            writeFile(FILES.SETTINGS, mergedSettings),
        ]);

        console.log('[GDrive] Migration complete!');
        console.log(`  Downloads: ${mergedDownloads.length}`);
        console.log(`  Search History: ${mergedHistory.length}`);
        console.log(`  Settings: ${mergedSettings.length}`);

        // Notify subscribers
        notifySubscribers('downloads', mergedDownloads);
        notifySubscribers('searchHistory', mergedHistory.slice(0, 50));
        notifySubscribers('settings', mergedSettings);
    },

    // ==================== UTILITY ====================

    /**
     * Check if Google Drive connection is working
     */
    async testConnection(): Promise<boolean> {
        try {
            const response = await driveRequest('/about?fields=user');
            if (!response.ok) return false;
            const data = await response.json();
            console.log('[GDrive] Connected as:', data.user?.displayName || data.user?.emailAddress);
            return true;
        } catch (e) {
            console.error('[GDrive] Connection test failed:', e);
            return false;
        }
    },

    /**
     * Get Drive storage info
     */
    async getStorageInfo(): Promise<{ used: number; limit: number } | null> {
        try {
            const response = await driveRequest('/about?fields=storageQuota');
            if (!response.ok) return null;
            const data = await response.json();
            return {
                used: parseInt(data.storageQuota?.usage || '0'),
                limit: parseInt(data.storageQuota?.limit || '0'),
            };
        } catch (e) {
            console.error('[GDrive] Failed to get storage info:', e);
            return null;
        }
    },

    /**
     * Clear all app data (for testing/reset)
     */
    async clearAllData(_userId: string): Promise<void> {
        await Promise.all([
            writeFile(FILES.DOWNLOADS, []),
            writeFile(FILES.SEARCH_HISTORY, []),
            writeFile(FILES.SETTINGS, []),
        ]);

        notifySubscribers('downloads', []);
        notifySubscribers('searchHistory', []);
        notifySubscribers('settings', []);

        console.log('[GDrive] All data cleared');
    },
};

// ==================== ENCRYPTED VAULT SYNC ====================
// The vault index contains sensitive metadata (file names, dates, etc.)
// We encrypt it with the vault PIN before uploading to Google Drive

const VAULT_FILE = 'slasshy_vault_index.enc';

// Vault file interface (matching Rust struct)
export interface VaultFileEntry {
    id: string;
    original_name: string;
    encrypted_name: string;
    size_bytes: number;
    added_at: number;
    file_type: string;
    thumbnail?: string;
}

/**
 * Encrypt data using Web Crypto API with AES-GCM
 * Uses the vault PIN to derive a key
 */
async function encryptVaultData(data: string, pin: string): Promise<string> {
    // Derive key from PIN using PBKDF2
    const encoder = new TextEncoder();
    const pinData = encoder.encode(pin);

    // Generate a random salt
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // Import PIN as key material
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        pinData,
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    // Derive AES key from PIN
    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );

    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt the data
    const dataBuffer = encoder.encode(data);
    const encryptedBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        dataBuffer
    );

    // Combine: salt (16) + iv (12) + ciphertext
    const result = new Uint8Array(salt.length + iv.length + encryptedBuffer.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encryptedBuffer), salt.length + iv.length);

    // Convert to base64 for storage
    return btoa(String.fromCharCode(...result));
}

/**
 * Decrypt data that was encrypted with encryptVaultData
 */
async function decryptVaultData(encryptedBase64: string, pin: string): Promise<string> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Decode base64
    const encryptedData = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));

    // Extract salt, IV, and ciphertext
    const salt = encryptedData.slice(0, 16);
    const iv = encryptedData.slice(16, 28);
    const ciphertext = encryptedData.slice(28);

    // Import PIN as key material
    const pinData = encoder.encode(pin);
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        pinData,
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    // Derive same AES key from PIN
    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );

    // Decrypt
    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        ciphertext
    );

    return decoder.decode(decryptedBuffer);
}

/**
 * Save encrypted vault index to Google Drive
 */
export async function saveVaultIndexToGDrive(
    vaultFiles: VaultFileEntry[],
    pin: string
): Promise<void> {
    if (!isGDriveAvailable()) {
        console.log('[GDrive] Not available, skipping vault sync');
        return;
    }

    try {
        const jsonData = JSON.stringify(vaultFiles);
        const encrypted = await encryptVaultData(jsonData, pin);

        await writeFile(VAULT_FILE, { encrypted, version: 1 });
        console.log('[GDrive] Vault index synced (encrypted)');
    } catch (e) {
        console.error('[GDrive] Failed to save vault index:', e);
        throw e;
    }
}

/**
 * Load and decrypt vault index from Google Drive
 */
export async function loadVaultIndexFromGDrive(
    pin: string
): Promise<VaultFileEntry[] | null> {
    if (!isGDriveAvailable()) {
        console.log('[GDrive] Not available, skipping vault load');
        return null;
    }

    try {
        const data = await readFile<{ encrypted: string; version: number }>(VAULT_FILE);
        if (!data || !data.encrypted) {
            console.log('[GDrive] No vault index found in Drive');
            return null;
        }

        const decrypted = await decryptVaultData(data.encrypted, pin);
        const vaultFiles = JSON.parse(decrypted) as VaultFileEntry[];

        console.log(`[GDrive] Loaded ${vaultFiles.length} vault entries from Drive`);
        return vaultFiles;
    } catch (e) {
        console.error('[GDrive] Failed to load vault index:', e);
        // Could be wrong PIN or corrupted data
        return null;
    }
}

/**
 * Check if vault index exists in Google Drive
 */
export async function hasVaultInGDrive(): Promise<boolean> {
    if (!isGDriveAvailable()) {
        return false;
    }

    try {
        const data = await readFile<{ encrypted: string; version: number }>(VAULT_FILE);
        return data !== null && data.encrypted !== undefined;
    } catch (e) {
        return false;
    }
}

/**
 * Delete vault index from Google Drive
 */
export async function deleteVaultFromGDrive(): Promise<void> {
    if (!isGDriveAvailable()) {
        return;
    }

    try {
        // Write empty object to clear the vault data
        await writeFile(VAULT_FILE, { encrypted: null, version: 0 });
        console.log('[GDrive] Vault index deleted from Drive');
    } catch (e) {
        console.error('[GDrive] Failed to delete vault index:', e);
    }
}

export default gdriveService;

