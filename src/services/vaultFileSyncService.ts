/**
 * Vault File Cloud Sync Service
 * 
 * Handles syncing encrypted .slasshy files between local storage and Google Drive.
 * 
 * Features:
 * - Background upload of new files to cloud
 * - On-demand download when file is missing locally
 * - Periodic sync to keep everything in sync
 * - Migration from .vault to .slasshy extension
 */

import { api } from './api';
import {
    driveRequest,
    isGDriveAvailable,
    findFile,
    VaultFileEntry
} from './gdriveService';
import {
    getVaultIndex,
    syncToCloud,
    isVaultCloudInitialized
} from './vaultCloudService';

// ==================== CONSTANTS ====================

const VAULT_FILES_FOLDER_NAME = 'slasshy_vault_files';
const SMALL_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB - auto-download without popup
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ==================== TYPES ====================

export type CloudSyncStatus = 'pending' | 'synced' | 'cloud_only' | 'sync_failed' | 'syncing';

export interface VaultFileWithSync extends VaultFileEntry {
    cloud_sync_status?: CloudSyncStatus;
    cloud_file_id?: string;
    last_synced_at?: number;
    cloud_size_bytes?: number;
}

export interface SyncResult {
    success: boolean;
    uploaded: number;
    downloaded: number;
    errors: number;
    migrated: number;
}

export interface DownloadProgress {
    fileId: string;
    fileName: string;
    progress: number; // 0-100
    downloadedBytes: number;
    totalBytes: number;
    speed: number; // bytes/sec
    status: 'downloading' | 'completed' | 'failed' | 'cancelled';
}

// ==================== STATE ====================

let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let uploadQueue: string[] = [];
let isProcessingQueue = false;
let currentDownload: { fileId: string; cancelled: boolean } | null = null;
let vaultFilesFolderId: string | null = null;

// Callbacks for UI updates
let onDownloadProgressCallback: ((progress: DownloadProgress) => void) | null = null;
let onSyncStatusChangeCallback: ((fileId: string, status: CloudSyncStatus) => void) | null = null;

// ==================== FOLDER MANAGEMENT ====================

/**
 * Get or create the vault files folder in Google Drive
 */
async function getOrCreateVaultFilesFolder(): Promise<string> {
    if (vaultFilesFolderId) {
        return vaultFilesFolderId;
    }

    if (!isGDriveAvailable()) {
        throw new Error('Google Drive not available');
    }

    // Check if folder already exists
    const existingId = await findFile(VAULT_FILES_FOLDER_NAME);
    if (existingId) {
        vaultFilesFolderId = existingId;
        console.log('[VaultSync] Found existing vault files folder:', existingId);
        return existingId;
    }

    // Create the folder in appDataFolder
    console.log('[VaultSync] Creating vault files folder...');
    const metadata = {
        name: VAULT_FILES_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['appDataFolder']
    };

    const response = await driveRequest('/files', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
    });

    if (!response.ok) {
        throw new Error(`Failed to create folder: ${response.statusText}`);
    }

    const result = await response.json();
    vaultFilesFolderId = result.id;
    console.log('[VaultSync] Created vault files folder:', vaultFilesFolderId);
    return vaultFilesFolderId!;
}

/**
 * Find a file in the vault files folder by name
 */
async function findVaultFile(fileName: string): Promise<string | null> {
    if (!isGDriveAvailable()) return null;

    try {
        const folderId = await getOrCreateVaultFilesFolder();
        const query = encodeURIComponent(`name = '${fileName}' and '${folderId}' in parents and trashed = false`);

        const response = await driveRequest(`/files?q=${query}&spaces=appDataFolder&fields=files(id,name,size)`);
        if (!response.ok) return null;

        const result = await response.json();
        if (result.files && result.files.length > 0) {
            return result.files[0].id;
        }
        return null;
    } catch (e) {
        console.error('[VaultSync] Error finding vault file:', e);
        return null;
    }
}

/**
 * Verify if a cloud file actually exists in Google Drive
 */
async function verifyCloudFileExists(cloudFileId: string): Promise<boolean> {
    if (!isGDriveAvailable() || !cloudFileId) return false;

    try {
        const response = await driveRequest(`/files/${cloudFileId}?fields=id,name,size`);
        if (response.ok) {
            const data = await response.json();
            console.log(`[VaultSync] Verified cloud file exists: ${data.name} (${data.id})`);
            return true;
        } else if (response.status === 404) {
            console.log(`[VaultSync] Cloud file NOT found: ${cloudFileId}`);
            return false;
        }
        return false;
    } catch (e) {
        console.error('[VaultSync] Error verifying cloud file:', e);
        return false;
    }
}

// ==================== EXTENSION MIGRATION ====================

/**
 * Migrate .vault files to .slasshy extension
 * Called on vault unlock to ensure all files use new extension
 */
export async function migrateToSlasshyExtension(): Promise<number> {
    const index = getVaultIndex();
    if (!index) return 0;

    let migrated = 0;

    for (const entry of index) {
        if (entry.encrypted_name.endsWith('.vault')) {
            const oldName = entry.encrypted_name;
            const newName = oldName.replace('.vault', '.slasshy');

            try {
                // Rename local file
                await api.vaultRenameFile(oldName, newName);

                // Update index entry
                entry.encrypted_name = newName;
                migrated++;

                console.log(`[VaultSync] Migrated: ${oldName} -> ${newName}`);
            } catch (e) {
                // File might not exist locally (cloud-only), just update the name
                console.warn(`[VaultSync] Could not rename ${oldName}, updating index only:`, e);
                entry.encrypted_name = newName;
                migrated++;
            }
        }
    }

    if (migrated > 0) {
        await syncToCloud();
        console.log(`[VaultSync] Migration complete. Migrated ${migrated} files.`);
    }

    return migrated;
}

// ==================== UPLOAD FUNCTIONS ====================

/**
 * Upload a single encrypted file to Google Drive
 */
export async function uploadFileToCloud(fileId: string): Promise<string> {
    const index = getVaultIndex() as VaultFileWithSync[] | null;
    if (!index) throw new Error('Vault not initialized');

    const entry = index.find(e => e.id === fileId);
    if (!entry) throw new Error('File not found in index');

    // Update status
    entry.cloud_sync_status = 'syncing';
    onSyncStatusChangeCallback?.(fileId, 'syncing');

    try {
        // Check if file exists locally
        const exists = await api.vaultCheckLocalFile(entry.encrypted_name);
        if (!exists) {
            throw new Error('File not found locally');
        }

        // Get file content as base64
        console.log(`[VaultSync] Reading file for upload: ${entry.encrypted_name}`);
        const base64Content = await api.vaultGetFileBase64(entry.encrypted_name);

        // Get or create folder
        const folderId = await getOrCreateVaultFilesFolder();

        // Check if file already exists in cloud
        let cloudFileId = await findVaultFile(entry.encrypted_name);

        if (cloudFileId) {
            // Update existing file
            console.log(`[VaultSync] Updating existing cloud file: ${cloudFileId}`);
            const response = await driveRequest(`/files/${cloudFileId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/octet-stream'
                },
                body: base64ToBlob(base64Content)
            }, true);

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }
        } else {
            // Create new file
            console.log(`[VaultSync] Uploading new file: ${entry.encrypted_name}`);

            // Use resumable upload for all files (more reliable)
            cloudFileId = await uploadWithProgress(
                entry.encrypted_name,
                base64Content,
                folderId
            );
        }

        // Update entry with cloud info
        entry.cloud_file_id = cloudFileId;
        entry.cloud_sync_status = 'synced';
        entry.last_synced_at = Math.floor(Date.now() / 1000);
        entry.cloud_size_bytes = base64Content.length * 0.75; // Approximate decoded size

        onSyncStatusChangeCallback?.(fileId, 'synced');

        // Sync index to cloud
        await syncToCloud();

        console.log(`[VaultSync] Upload complete: ${entry.encrypted_name} -> ${cloudFileId}`);
        return cloudFileId;
    } catch (error) {
        entry.cloud_sync_status = 'sync_failed';
        onSyncStatusChangeCallback?.(fileId, 'sync_failed');
        throw error;
    }
}

/**
 * Upload file with resumable upload (more reliable for large files)
 */
async function uploadWithProgress(
    fileName: string,
    base64Content: string,
    folderId: string
): Promise<string> {
    // Convert base64 to blob
    const blob = base64ToBlob(base64Content);

    // Initiate resumable upload
    const metadata = {
        name: fileName,
        parents: [folderId]
    };

    const initResponse = await driveRequest('/files?uploadType=resumable', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': 'application/octet-stream',
            'X-Upload-Content-Length': blob.size.toString()
        },
        body: JSON.stringify(metadata)
    }, true);

    if (!initResponse.ok) {
        throw new Error(`Failed to initiate upload: ${initResponse.statusText}`);
    }

    const uploadUrl = initResponse.headers.get('Location');
    if (!uploadUrl) {
        throw new Error('No upload URL returned');
    }

    // Upload the content
    const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': blob.size.toString()
        },
        body: blob
    });

    if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`);
    }

    const result = await uploadResponse.json();
    return result.id;
}

/**
 * Convert base64 string to Blob
 */
function base64ToBlob(base64: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: 'application/octet-stream' });
}

// ==================== DOWNLOAD FUNCTIONS ====================

/**
 * Download a file from cloud to local storage
 */
export async function downloadFileFromCloud(
    fileId: string,
    onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
    const index = getVaultIndex() as VaultFileWithSync[] | null;
    if (!index) throw new Error('Vault not initialized');

    const entry = index.find(e => e.id === fileId);
    if (!entry) throw new Error('File not found in index');
    if (!entry.cloud_file_id) throw new Error('File not in cloud');

    // Set up cancellation
    currentDownload = { fileId, cancelled: false };

    const progress: DownloadProgress = {
        fileId,
        fileName: entry.original_name,
        progress: 0,
        downloadedBytes: 0,
        totalBytes: entry.cloud_size_bytes || entry.size_bytes,
        speed: 0,
        status: 'downloading'
    };

    onProgress?.(progress);
    onDownloadProgressCallback?.(progress);

    try {
        const startTime = Date.now();

        // Download file from Google Drive
        const response = await driveRequest(`/files/${entry.cloud_file_id}?alt=media`);

        if (!response.ok) {
            throw new Error(`Download failed: ${response.statusText}`);
        }

        // Get total size from headers if available
        const contentLength = response.headers.get('Content-Length');
        if (contentLength) {
            progress.totalBytes = parseInt(contentLength, 10);
        }

        // Read response as blob and convert to base64
        const blob = await response.blob();

        // Check if download was cancelled
        if (currentDownload?.cancelled) {
            progress.status = 'cancelled';
            onProgress?.(progress);
            onDownloadProgressCallback?.(progress);
            return;
        }

        // Convert blob to base64
        const base64 = await blobToBase64(blob);

        progress.downloadedBytes = blob.size;
        progress.progress = 100;

        const elapsed = (Date.now() - startTime) / 1000;
        progress.speed = blob.size / elapsed;

        // Save to local vault
        await api.vaultSaveFileBase64(entry.encrypted_name, base64);

        // Update entry status
        entry.cloud_sync_status = 'synced';
        await syncToCloud();

        progress.status = 'completed';
        onProgress?.(progress);
        onDownloadProgressCallback?.(progress);

        console.log(`[VaultSync] Download complete: ${entry.encrypted_name}`);
    } catch (error) {
        progress.status = 'failed';
        onProgress?.(progress);
        onDownloadProgressCallback?.(progress);
        throw error;
    } finally {
        currentDownload = null;
    }
}

/**
 * Cancel current download
 */
export function cancelDownload(): void {
    if (currentDownload) {
        currentDownload.cancelled = true;
    }
}

/**
 * Convert Blob to base64 string
 */
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ==================== QUEUE MANAGEMENT ====================

/**
 * Add file to upload queue
 */
export function enqueueUpload(fileId: string): void {
    if (!uploadQueue.includes(fileId)) {
        uploadQueue.push(fileId);
        console.log(`[VaultSync] Enqueued upload: ${fileId}`);
        processUploadQueue();
    }
}

/**
 * Process the upload queue in background
 */
async function processUploadQueue(): Promise<void> {
    if (isProcessingQueue || uploadQueue.length === 0) {
        return;
    }

    isProcessingQueue = true;
    console.log(`[VaultSync] Processing upload queue (${uploadQueue.length} files)...`);

    while (uploadQueue.length > 0) {
        const fileId = uploadQueue.shift()!;

        try {
            await uploadFileToCloud(fileId);
            console.log(`[VaultSync] Upload succeeded: ${fileId}`);
        } catch (error) {
            console.error(`[VaultSync] Upload failed: ${fileId}`, error);
            // Don't re-queue on failure, status is marked as sync_failed
        }

        // Small delay between uploads to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    isProcessingQueue = false;
    console.log('[VaultSync] Upload queue processing complete');
}

/**
 * Retry all failed uploads
 */
export async function retryFailedUploads(): Promise<void> {
    const index = getVaultIndex() as VaultFileWithSync[] | null;
    if (!index) return;

    for (const entry of index) {
        if (entry.cloud_sync_status === 'sync_failed') {
            enqueueUpload(entry.id);
        }
    }
}

/**
 * Upload all pending files immediately
 * Returns the number of files uploaded and any errors
 */
export async function uploadAllPendingFiles(
    onProgress?: (current: number, total: number, fileName: string) => void
): Promise<{ uploaded: number; failed: number; total: number }> {
    if (!isGDriveAvailable()) {
        throw new Error('Google Drive not available');
    }

    const index = getVaultIndex() as VaultFileWithSync[] | null;
    if (!index) {
        throw new Error('Vault not initialized');
    }

    // Find all files that need uploading
    const pendingFiles: VaultFileWithSync[] = [];

    for (const entry of index) {
        const isLocal = await api.vaultCheckLocalFile(entry.encrypted_name);
        if (isLocal && entry.cloud_sync_status !== 'synced') {
            pendingFiles.push(entry);
        }
    }

    if (pendingFiles.length === 0) {
        return { uploaded: 0, failed: 0, total: 0 };
    }

    console.log(`[VaultSync] Uploading ${pendingFiles.length} pending files...`);

    let uploaded = 0;
    let failed = 0;

    for (let i = 0; i < pendingFiles.length; i++) {
        const entry = pendingFiles[i];
        onProgress?.(i + 1, pendingFiles.length, entry.original_name);

        try {
            await uploadFileToCloud(entry.id);
            uploaded++;
            console.log(`[VaultSync] Uploaded (${i + 1}/${pendingFiles.length}): ${entry.original_name}`);
        } catch (error) {
            failed++;
            console.error(`[VaultSync] Failed to upload: ${entry.original_name}`, error);
        }
    }

    console.log(`[VaultSync] Upload complete: ${uploaded} uploaded, ${failed} failed`);
    return { uploaded, failed, total: pendingFiles.length };
}

/**
 * Get all files that are pending upload (exist locally but not synced)
 * Also verifies that "synced" files actually exist in cloud
 */
export async function getPendingFiles(verifyCloud: boolean = true): Promise<VaultFileWithSync[]> {
    const index = getVaultIndex() as VaultFileWithSync[] | null;
    if (!index) {
        console.log('[VaultSync] getPendingFiles: No index found');
        return [];
    }

    console.log(`[VaultSync] getPendingFiles: Checking ${index.length} files... (verifyCloud=${verifyCloud})`);
    const pendingFiles: VaultFileWithSync[] = [];

    for (const entry of index) {
        const isLocal = await api.vaultCheckLocalFile(entry.encrypted_name);

        if (!isLocal) {
            console.log(`[VaultSync] File: ${entry.original_name} - NOT local, skipping`);
            continue;
        }

        let needsUpload = false;

        // File needs uploading if it has no cloud_file_id or status is not 'synced'
        if (!entry.cloud_file_id || entry.cloud_sync_status !== 'synced') {
            needsUpload = true;
            console.log(`[VaultSync] File: ${entry.original_name} - needs upload (no cloud_file_id or not synced)`);
        }
        // If marked as synced, verify it actually exists in cloud
        else if (verifyCloud && entry.cloud_file_id && entry.cloud_sync_status === 'synced') {
            console.log(`[VaultSync] File: ${entry.original_name} - verifying cloud file exists...`);
            const exists = await verifyCloudFileExists(entry.cloud_file_id);
            if (!exists) {
                console.log(`[VaultSync] File: ${entry.original_name} - cloud file MISSING, needs re-upload`);
                // Reset the sync status since the file doesn't exist
                entry.cloud_sync_status = 'pending';
                entry.cloud_file_id = undefined;
                needsUpload = true;
            } else {
                console.log(`[VaultSync] File: ${entry.original_name} - confirmed synced`);
            }
        }

        if (needsUpload) {
            pendingFiles.push(entry);
        }
    }

    console.log(`[VaultSync] getPendingFiles: Found ${pendingFiles.length} files needing upload`);
    return pendingFiles;
}

/**
 * Upload specific files by their IDs
 */
export async function uploadSelectedFiles(
    fileIds: string[],
    onProgress?: (current: number, total: number, fileName: string) => void
): Promise<{ uploaded: number; failed: number; total: number }> {
    if (!isGDriveAvailable()) {
        throw new Error('Google Drive not available');
    }

    const index = getVaultIndex() as VaultFileWithSync[] | null;
    if (!index) {
        throw new Error('Vault not initialized');
    }

    // Get the files to upload
    const filesToUpload = index.filter(e => fileIds.includes(e.id));

    if (filesToUpload.length === 0) {
        return { uploaded: 0, failed: 0, total: 0 };
    }

    console.log(`[VaultSync] Uploading ${filesToUpload.length} selected files...`);

    let uploaded = 0;
    let failed = 0;

    for (let i = 0; i < filesToUpload.length; i++) {
        const entry = filesToUpload[i];
        onProgress?.(i + 1, filesToUpload.length, entry.original_name);

        try {
            await uploadFileToCloud(entry.id);
            uploaded++;
            console.log(`[VaultSync] Uploaded (${i + 1}/${filesToUpload.length}): ${entry.original_name}`);
        } catch (error) {
            failed++;
            console.error(`[VaultSync] Failed to upload: ${entry.original_name}`, error);
        }
    }

    console.log(`[VaultSync] Upload complete: ${uploaded} uploaded, ${failed} failed`);
    return { uploaded, failed, total: filesToUpload.length };
}

// ==================== SYNC FUNCTIONS ====================

/**
 * Check if a file is available locally
 */
export async function isFileAvailableLocally(entry: VaultFileWithSync): Promise<boolean> {
    try {
        return await api.vaultCheckLocalFile(entry.encrypted_name);
    } catch {
        return false;
    }
}

/**
 * Check if a file should auto-download (small file)
 */
export function shouldAutoDownload(entry: VaultFileWithSync): boolean {
    const size = entry.cloud_size_bytes || entry.size_bytes;
    return size <= SMALL_FILE_THRESHOLD;
}

/**
 * Run a full background sync
 */
export async function runBackgroundSync(): Promise<SyncResult> {
    if (!isVaultCloudInitialized() || !isGDriveAvailable()) {
        return { success: false, uploaded: 0, downloaded: 0, errors: 0, migrated: 0 };
    }

    console.log('[VaultSync] Starting background sync...');

    const result: SyncResult = {
        success: true,
        uploaded: 0,
        downloaded: 0,
        errors: 0,
        migrated: 0
    };

    const index = getVaultIndex() as VaultFileWithSync[] | null;
    if (!index) {
        return { ...result, success: false };
    }

    for (const entry of index) {
        try {
            const isLocal = await isFileAvailableLocally(entry);

            if (isLocal) {
                // File exists locally
                if (!entry.cloud_sync_status || entry.cloud_sync_status === 'pending' || entry.cloud_sync_status === 'sync_failed') {
                    // Not synced to cloud yet, queue upload
                    enqueueUpload(entry.id);
                    result.uploaded++;
                }
            } else if (entry.cloud_file_id) {
                // File missing locally but exists in cloud
                entry.cloud_sync_status = 'cloud_only';
            }
        } catch (error) {
            console.error(`[VaultSync] Error syncing ${entry.id}:`, error);
            result.errors++;
        }
    }

    // Sync index changes to cloud
    try {
        await syncToCloud();
    } catch (e) {
        console.error('[VaultSync] Failed to sync index:', e);
        result.success = false;
    }

    console.log(`[VaultSync] Background sync complete:`, result);
    return result;
}

/**
 * Start periodic background sync
 */
export function startPeriodicSync(intervalMs: number = SYNC_INTERVAL_MS): void {
    if (syncIntervalId) {
        console.log('[VaultSync] Periodic sync already running');
        return;
    }

    console.log(`[VaultSync] Starting periodic sync (every ${intervalMs / 1000}s)...`);

    // Run immediately
    runBackgroundSync().catch(console.error);

    // Then run at interval
    syncIntervalId = setInterval(async () => {
        if (!isVaultCloudInitialized()) {
            console.log('[VaultSync] Vault not initialized, skipping sync');
            return;
        }

        try {
            await runBackgroundSync();
        } catch (e) {
            console.error('[VaultSync] Periodic sync failed:', e);
        }
    }, intervalMs);
}

/**
 * Stop periodic sync
 */
export function stopPeriodicSync(): void {
    if (syncIntervalId) {
        clearInterval(syncIntervalId);
        syncIntervalId = null;
        console.log('[VaultSync] Periodic sync stopped');
    }
}

// ==================== CALLBACKS ====================

/**
 * Set callback for download progress updates
 */
export function setDownloadProgressCallback(callback: ((progress: DownloadProgress) => void) | null): void {
    onDownloadProgressCallback = callback;
}

/**
 * Set callback for sync status changes
 */
export function setSyncStatusCallback(callback: ((fileId: string, status: CloudSyncStatus) => void) | null): void {
    onSyncStatusChangeCallback = callback;
}

// ==================== INITIALIZATION ====================

/**
 * Initialize the file sync service
 * Call this after vault is unlocked
 */
export async function initVaultFileSync(): Promise<void> {
    console.log('[VaultSync] Initializing vault file sync...');

    // Reset state
    vaultFilesFolderId = null;
    uploadQueue = [];
    isProcessingQueue = false;

    // Migrate old .vault files to .slasshy
    const migrated = await migrateToSlasshyExtension();
    if (migrated > 0) {
        console.log(`[VaultSync] Migrated ${migrated} files to .slasshy extension`);
    }

    // Start periodic sync
    startPeriodicSync();
}

/**
 * Cleanup the file sync service
 * Call this when vault is locked
 */
export function cleanupVaultFileSync(): void {
    console.log('[VaultSync] Cleaning up vault file sync...');
    stopPeriodicSync();
    vaultFilesFolderId = null;
    uploadQueue = [];
    isProcessingQueue = false;
    currentDownload = null;
}

// ==================== EXPORTS ====================

export default {
    // Initialization
    initVaultFileSync,
    cleanupVaultFileSync,

    // Migration
    migrateToSlasshyExtension,

    // Upload
    uploadFileToCloud,
    enqueueUpload,
    retryFailedUploads,
    uploadAllPendingFiles,
    getPendingFiles,
    uploadSelectedFiles,

    // Download
    downloadFileFromCloud,
    cancelDownload,

    // Sync
    runBackgroundSync,
    startPeriodicSync,
    stopPeriodicSync,

    // Status checks
    isFileAvailableLocally,
    shouldAutoDownload,

    // Callbacks
    setDownloadProgressCallback,
    setSyncStatusCallback
};
