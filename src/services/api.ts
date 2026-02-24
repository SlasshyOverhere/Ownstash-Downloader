import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

// Types matching Firestore/Rust structs
export interface Download {
    id: string;
    title: string;
    url: string;
    format: string;
    path: string;
    timestamp: number;
    status: string;
    size_bytes?: number;
    platform?: string;
    thumbnail?: string;
}

export interface SearchHistory {
    id: string;
    query: string;
    timestamp: number;
    title?: string;
    thumbnail?: string;
}

export interface Setting {
    key: string;
    value: string;
}

export interface MediaInfo {
    title: string;
    duration?: number;
    thumbnail?: string;
    formats: FormatInfo[];
    platform: string;
    uploader?: string;
    description?: string;
    view_count?: number;
    like_count?: number;
    upload_date?: string;
    webpage_url?: string;
    chapters?: Chapter[];
}

export interface Chapter {
    start_time: number;
    end_time: number;
    title: string;
}

export interface FormatInfo {
    format_id: string;
    ext: string;
    resolution?: string;
    height?: number;
    width?: number;
    filesize?: number;
    filesize_approx?: number;
    vcodec?: string;
    acodec?: string;
    fps?: number;
    tbr?: number;
    format_note?: string;
    quality_label?: string;
}

export interface DownloadProgress {
    id: string;
    progress: number;
    speed: string;
    eta: string;
    status: string;
    downloaded_bytes?: number;
    total_bytes?: number;
    filename?: string;
    engine_badge?: string;  // "SNDE ACCELERATED", "SNDE SAFE", or "MEDIA ENGINE"
}

export interface DownloadRequest {
    id: string;
    url: string;
    output_path: string;
    format?: string;
    audio_only: boolean;
    quality?: string;
    embed_thumbnail: boolean;
    embed_metadata: boolean;
    download_subtitles: boolean;
    audio_quality: string;
    audio_format: string;
    video_format: string;
    use_sponsorblock: boolean;
}

export interface YtDlpInfo {
    version: string;
    path: string;
    is_embedded: boolean;
    latest_version?: string | null;
    update_available?: boolean;
}

export interface UpdateInfo {
    version: string;
    current_version: string;
    date?: string;
    body?: string;
    available: boolean;
}

export interface DirectFileInfo {
    file_size: number;
    filename: string | null;
    content_type: string | null;
    is_media: boolean;
}

export interface MediaFileInfo {
    file_path: string;
    is_audio: boolean;
}

export interface TranscodeResult {
    output_path: string;
    was_transcoded: boolean;
}

// Spotify/SpotDL types
export interface SpotifyMediaInfo {
    title: string;
    artist?: string;
    album?: string;
    duration?: number;
    thumbnail?: string;
    platform: string;
    track_count?: number;
    content_type: string; // "track", "album", "playlist", "artist"
    url: string;
}

export interface SpotifyDownloadProgress {
    id: string;
    progress: number;
    status: string;
    current_track?: string;
    total_tracks?: number;
    completed_tracks?: number;
    speed: string;
}

export interface SpotifyDownloadRequest {
    id: string;
    url: string;
    output_path: string;
    audio_format: string;        // mp3, m4a, flac, opus, ogg, wav
    audio_quality: string;       // 128k, 192k, 320k
    embed_lyrics: boolean;
    threads?: number;
}

export interface SpotDlInfo {
    version: string;
    path: string;
    is_available: boolean;
    latest_version?: string | null;
    update_available?: boolean;
}

// Vault types
export interface VaultStatus {
    is_setup: boolean;
    is_unlocked: boolean;
    file_count: number;
    total_size_bytes: number;
}

// Represents a file or directory inside a vault folder
export interface VaultFolderEntry {
    name: string;           // File/folder name
    path: string;           // Relative path within the folder
    size_bytes: number;     // Size in bytes (0 for directories)
    file_type: string;      // "video", "audio", "image", "file", "directory"
    is_directory: boolean;  // True if this is a directory
}

export interface VaultFile {
    id: string;
    original_name: string;
    encrypted_name: string;
    size_bytes: number;
    added_at: number;
    file_type: string; // "video", "audio", "file", "folder"
    thumbnail?: string;
    // Folder-specific fields
    is_folder?: boolean;
    folder_entries?: VaultFolderEntry[];
}

// Vault Direct Download types
export interface VaultDownloadRequest {
    id: string;
    url: string;
    original_name: string;
    file_type: string; // "video" | "audio" | "file" | "archive" | "image" | etc.
    thumbnail?: string;
    audio_only: boolean;
    quality?: string;
    format?: string;
    audio_format: string;
    embed_metadata: boolean;
    use_sponsorblock: boolean;
}

export interface VaultDownloadProgress {
    id: string;
    progress: number;
    speed: string;
    eta: string;
    status: 'preparing' | 'downloading' | 'encrypting' | 'completed' | 'failed' | 'cancelled';
    downloaded_bytes?: number;
    total_bytes?: number;
    encrypted_bytes?: number;
}

// Native integration types
export interface NotificationClickEvent {
    type: string;
    title: string;
    file_path?: string;
}

// Download API - Uses Local Tauri SQLite Database
// Cloud sync is handled separately by DataContext using Google Drive
export const api = {
    // Downloads - Local SQLite via Tauri
    async addDownload(download: Download): Promise<void> {
        return invoke('add_download', { download });
    },

    async getDownloads(): Promise<Download[]> {
        return invoke('get_downloads');
    },

    async updateDownloadStatus(id: string, status: string): Promise<void> {
        return invoke('update_download_status', { id, status });
    },

    async deleteDownload(id: string): Promise<void> {
        return invoke('delete_download', { id });
    },

    async clearDownloads(): Promise<void> {
        return invoke('clear_downloads');
    },

    // Search History - Local SQLite via Tauri
    async addSearch(query: string, title?: string, thumbnail?: string): Promise<void> {
        return invoke('add_search', { query, title, thumbnail });
    },

    async getSearchHistory(limit: number = 50): Promise<SearchHistory[]> {
        return invoke('get_search_history', { limit });
    },

    async clearSearchHistory(): Promise<void> {
        return invoke('clear_search_history');
    },

    // Settings - Local SQLite via Tauri
    async saveSetting(key: string, value: string): Promise<void> {
        return invoke('save_setting', { key, value });
    },

    async getSetting(key: string): Promise<string | null> {
        return invoke('get_setting', { key });
    },

    async getAllSettings(): Promise<Setting[]> {
        return invoke('get_all_settings');
    },

    async deleteSetting(key: string): Promise<void> {
        return invoke('delete_setting', { key });
    },

    // Secure Settings - Encrypted via Rust backend using machine-bound key
    async secureSaveSetting(key: string, value: string): Promise<void> {
        return invoke('secure_save_setting', { key, value });
    },

    async secureGetSetting(key: string): Promise<string | null> {
        return invoke('secure_get_setting', { key });
    },

    async secureDeleteSetting(key: string): Promise<void> {
        return invoke('secure_delete_setting', { key });
    },

    // Utility functions - Rust backend

    async openFolder(path: string, fileName?: string): Promise<void> {
        return invoke('open_folder', { path, fileName });
    },

    async playFile(path: string, title: string): Promise<void> {
        return invoke('play_file', { path, title });
    },

    async openWithExternalPlayer(filePath: string, playerPath?: string): Promise<void> {
        return invoke('open_with_external_player', { filePath, playerPath });
    },

    async findMediaFile(path: string, title: string): Promise<MediaFileInfo> {
        return invoke('find_best_media_match', { path, title });
    },

    async transcodeForPlayback(inputPath: string, force: boolean = false): Promise<TranscodeResult> {
        return invoke('transcode_for_playback', { inputPath, force });
    },

    async getMediaStreamUrl(filePath: string): Promise<string> {
        return invoke('get_media_stream_url', { filePath });
    },

    // yt-dlp Management - Rust backend
    async checkYtDlp(includeLatest: boolean = false): Promise<YtDlpInfo> {
        return invoke('check_yt_dlp', { includeLatest });
    },

    async updateYtDlp(): Promise<YtDlpInfo> {
        return invoke('update_yt_dlp');
    },

    async getDefaultDownloadPath(): Promise<string> {
        return invoke('get_default_download_path');
    },

    async getSupportedPlatforms(): Promise<string[]> {
        return invoke('get_supported_platforms');
    },

    async getDownloadFolderSize(path: string): Promise<number> {
        return invoke('get_download_folder_size', { path });
    },

    // Media Info & Downloading - Rust backend
    async getMediaInfo(url: string, enableSponsorblock?: boolean): Promise<MediaInfo> {
        return invoke('get_media_info', { url, enableSponsorblock });
    },

    async probeDirectFile(url: string): Promise<DirectFileInfo> {
        return invoke('probe_direct_file', { url });
    },

    async startDownload(request: DownloadRequest): Promise<void> {
        return invoke('start_download', { request });
    },

    async cancelDownload(id: string): Promise<void> {
        return invoke('cancel_download', { id });
    },

    // Event listeners - Rust backend
    onDownloadProgress(callback: (progress: DownloadProgress) => void): Promise<UnlistenFn> {
        return listen<DownloadProgress>('download-progress', (event) => {
            callback(event.payload);
        });
    },

    // App Updates - Rust backend
    async checkForUpdates(): Promise<UpdateInfo> {
        return invoke('check_for_updates');
    },

    async downloadAndInstallUpdate(): Promise<void> {
        return invoke('download_and_install_update');
    },

    async getCurrentVersion(): Promise<string> {
        return invoke('get_current_version');
    },

    // SpotDL (Spotify) Management - Rust backend
    async checkSpotDl(includeLatest: boolean = false): Promise<SpotDlInfo> {
        return invoke('check_spotdl', { includeLatest });
    },

    async updateSpotDl(): Promise<SpotDlInfo> {
        return invoke('update_spotdl');
    },

    async getSpotifyInfo(url: string): Promise<SpotifyMediaInfo> {
        return invoke('get_spotify_info', { url });
    },

    async startSpotifyDownload(request: SpotifyDownloadRequest): Promise<void> {
        return invoke('start_spotify_download', { request });
    },

    async cancelSpotifyDownload(id: string): Promise<void> {
        return invoke('cancel_spotify_download', { id });
    },

    // Spotify event listeners - Rust backend
    onSpotifyDownloadProgress(callback: (progress: SpotifyDownloadProgress) => void): Promise<UnlistenFn> {
        return listen<SpotifyDownloadProgress>('spotify-download-progress', (event) => {
            callback(event.payload);
        });
    },

    // ============ Vault API ============
    async vaultGetStatus(): Promise<VaultStatus> {
        return invoke('vault_get_status');
    },

    async vaultSetup(pin: string): Promise<void> {
        return invoke('vault_setup', { pin });
    },

    async vaultUnlock(pin: string): Promise<void> {
        return invoke('vault_unlock', { pin });
    },

    async vaultLock(): Promise<void> {
        return invoke('vault_lock');
    },

    async vaultAddFile(
        sourcePath: string,
        originalName: string,
        fileType: string,
        thumbnail?: string,
        deleteOriginal: boolean = true
    ): Promise<VaultFile> {
        console.log('[Vault API] Adding file:', { sourcePath, originalName, fileType, deleteOriginal });
        try {
            const result = await invoke<VaultFile>('vault_add_file', {
                sourcePath,
                originalName,
                fileType,
                thumbnail: thumbnail ?? null,
                deleteOriginal
            });
            console.log('[Vault API] File added successfully:', result);
            return result;
        } catch (error) {
            console.error('[Vault API] Failed to add file:', error);
            throw error;
        }
    },

    async vaultListFiles(): Promise<VaultFile[]> {
        return invoke('vault_list_files');
    },

    async vaultExportFile(fileId: string, encryptedName: string, originalName: string, destinationPath: string): Promise<string> {
        return invoke('vault_export_file', { fileId, encryptedName, originalName, destinationPath });
    },

    async vaultGetTempPlaybackPath(fileId: string, encryptedName: string, originalName: string): Promise<string> {
        return invoke('vault_get_temp_playback_path', { fileId, encryptedName, originalName });
    },

    async vaultCleanupTemp(): Promise<void> {
        return invoke('vault_cleanup_temp');
    },

    async vaultDeleteFile(fileId: string): Promise<void> {
        return invoke('vault_delete_file', { fileId });
    },

    async vaultChangePin(currentPin: string, newPin: string): Promise<void> {
        return invoke('vault_change_pin', { currentPin, newPin });
    },

    async vaultReset(pin: string): Promise<void> {
        return invoke('vault_reset', { pin });
    },

    async vaultGetConfig(): Promise<any> {
        return invoke('vault_get_config');
    },

    async vaultImportConfig(config: any): Promise<void> {
        return invoke('vault_import_config', { config });
    },

    async vaultWipeLocalConfig(): Promise<void> {
        return invoke('vault_wipe_local_config');
    },

    // ============ Vault Direct Download API ============
    // Downloads files directly into the vault with streaming encryption
    // No plaintext file ever touches the disk
    async vaultDirectDownload(request: VaultDownloadRequest): Promise<VaultFile> {
        console.log('[Vault API] Starting direct vault download:', request.original_name);
        try {
            const result = await invoke<VaultFile>('vault_direct_download', { request });
            console.log('[Vault API] Direct download completed:', result);
            return result;
        } catch (error) {
            console.error('[Vault API] Direct download failed:', error);
            throw error;
        }
    },

    async vaultCancelDownload(id: string): Promise<void> {
        return invoke('vault_cancel_download', { id });
    },

    onVaultDownloadProgress(callback: (progress: VaultDownloadProgress) => void): Promise<UnlistenFn> {
        return listen<VaultDownloadProgress>('vault-download-progress', (event) => {
            callback(event.payload);
        });
    },

    // ============ Vault Cloud Sync API ============
    // Check if encrypted file exists locally
    async vaultCheckLocalFile(encryptedName: string): Promise<boolean> {
        return invoke('vault_check_local_file', { encryptedName });
    },

    // Get encrypted file as base64 for cloud upload
    async vaultGetFileBase64(encryptedName: string): Promise<string> {
        return invoke('vault_get_file_base64', { encryptedName });
    },

    // Save base64 content as encrypted file (for cloud download)
    async vaultSaveFileBase64(encryptedName: string, base64Content: string): Promise<void> {
        return invoke('vault_save_file_base64', { encryptedName, base64Content });
    },

    // Rename encrypted file (for extension migration)
    async vaultRenameFile(oldName: string, newName: string): Promise<void> {
        return invoke('vault_rename_file', { oldName, newName });
    },

    // Get vault files directory path
    async vaultGetFilesDirPath(): Promise<string> {
        return invoke('vault_get_files_dir_path');
    },

    // Get file size of encrypted file
    async vaultGetFileSize(encryptedName: string): Promise<number> {
        return invoke('vault_get_file_size', { encryptedName });
    },

    // ============ Vault Folder API ============
    // Add a folder to the vault (compresses and encrypts)
    async vaultAddFolder(
        folderPath: string,
        folderName: string,
        deleteOriginal: boolean = false
    ): Promise<VaultFile> {
        console.log('[Vault API] Adding folder:', { folderPath, folderName, deleteOriginal });
        try {
            const result = await invoke<VaultFile>('vault_add_folder', {
                folderPath,
                folderName,
                deleteOriginal
            });
            console.log('[Vault API] Folder added successfully:', result);
            return result;
        } catch (error) {
            console.error('[Vault API] Failed to add folder:', error);
            throw error;
        }
    },

    // Extract a specific file from an encrypted folder
    async vaultExtractFolderFile(
        fileId: string,
        encryptedName: string,
        filePathInFolder: string
    ): Promise<string> {
        console.log('[Vault API] Extracting file from folder:', { fileId, filePathInFolder });
        try {
            const result = await invoke<string>('vault_extract_folder_file', {
                fileId,
                encryptedName,
                filePathInFolder
            });
            console.log('[Vault API] File extracted to:', result);
            return result;
        } catch (error) {
            console.error('[Vault API] Failed to extract file:', error);
            throw error;
        }
    },

    // List contents of an encrypted folder (fallback if folder_entries not in index)
    async vaultListFolderContents(
        fileId: string,
        encryptedName: string
    ): Promise<VaultFolderEntry[]> {
        console.log('[Vault API] Listing folder contents:', fileId);
        try {
            const result = await invoke<VaultFolderEntry[]>('vault_list_folder_contents', {
                fileId,
                encryptedName
            });
            console.log('[Vault API] Folder has', result.length, 'entries');
            return result;
        } catch (error) {
            console.error('[Vault API] Failed to list folder contents:', error);
            throw error;
        }
    },

    // Add a ZIP file to the vault (encrypted, browsable like a folder)
    async vaultAddZip(
        zipPath: string,
        deleteOriginal: boolean = false
    ): Promise<VaultFile> {
        console.log('[Vault API] Adding ZIP file:', zipPath);
        try {
            const result = await invoke<VaultFile>('vault_add_zip', {
                zipPath,
                deleteOriginal
            });
            console.log('[Vault API] ZIP added successfully:', result.id);
            return result;
        } catch (error) {
            console.error('[Vault API] Failed to add ZIP:', error);
            throw error;
        }
    },

    // Convert an existing encrypted file (that is actually a ZIP) to a browsable folder
    async vaultConvertToFolder(
        fileId: string,
        encryptedName: string
    ): Promise<VaultFolderEntry[]> {
        console.log('[Vault API] Converting file to folder:', fileId);
        try {
            const result = await invoke<VaultFolderEntry[]>('vault_convert_to_folder', {
                fileId,
                encryptedName
            });
            console.log('[Vault API] Converted successfully, entries:', result.length);
            return result;
        } catch (error) {
            console.error('[Vault API] Failed to convert to folder:', error);
            throw error;
        }
    },

    // ============ Native Integration API ============
    async updateTaskbarProgress(progress: number, state: string): Promise<void> {
        return invoke('update_taskbar_progress', { progress, state });
    },

    async clearTaskbarProgress(): Promise<void> {
        return invoke('clear_taskbar_progress');
    },

    async sendNotification(title: string, body: string, notificationType: string = 'info'): Promise<void> {
        return invoke('send_notification', { title, body, notificationType });
    },

    async notifyDownloadComplete(title: string, filePath: string): Promise<void> {
        return invoke('notify_download_complete', { title, filePath });
    },

    async notifyDownloadFailed(title: string, error: string): Promise<void> {
        return invoke('notify_download_failed', { title, error });
    },

    async checkNotificationPermission(): Promise<boolean> {
        return invoke('check_notification_permission');
    },

    async requestNotificationPermission(): Promise<boolean> {
        return invoke('request_notification_permission');
    },

    // Listen for notification clicks
    onNotificationClick(callback: (event: NotificationClickEvent) => void): Promise<UnlistenFn> {
        return listen<NotificationClickEvent>('notification-click', (event) => {
            callback(event.payload);
        });
    },

    // ============ Plugin/Addon Management API ============
    // These are stubs for the Secure Browser addon - will be implemented when sidecar is complete
    async pluginCheckStatus(): Promise<'not_installed' | 'installing' | 'installed' | 'error'> {
        // TODO: Check if secure browser sidecar is installed
        // For now, return not_installed as default
        try {
            return await invoke<'not_installed' | 'installing' | 'installed' | 'error'>('plugin_check_status');
        } catch {
            // Command not implemented yet - return default
            return 'not_installed';
        }
    },

    async pluginInstall(): Promise<void> {
        // TODO: Download and install secure browser sidecar
        try {
            return await invoke('plugin_install');
        } catch (error) {
            console.warn('[Plugin] Install command not implemented yet:', error);
            throw new Error('Secure Browser addon installation is not yet available');
        }
    },

    async pluginUninstall(): Promise<void> {
        // TODO: Remove secure browser sidecar
        try {
            return await invoke('plugin_uninstall');
        } catch (error) {
            console.warn('[Plugin] Uninstall command not implemented yet:', error);
            throw new Error('Secure Browser addon uninstallation is not yet available');
        }
    },

    async pluginReinstall(): Promise<void> {
        // TODO: Reinstall secure browser sidecar
        try {
            return await invoke('plugin_reinstall');
        } catch (error) {
            console.warn('[Plugin] Reinstall command not implemented yet:', error);
            throw new Error('Secure Browser addon reinstallation is not yet available');
        }
    },

    // ============ Autostart API ============
    async autostartEnable(): Promise<void> {
        return invoke('plugin:autostart|enable');
    },

    async autostartDisable(): Promise<void> {
        return invoke('plugin:autostart|disable');
    },

    async autostartIsEnabled(): Promise<boolean> {
        return invoke('plugin:autostart|is_enabled');
    },
};

// Helper functions
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function generateDownloadId(): string {
    return `dl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function isSpotifyUrl(url: string): boolean {
    return url.includes('spotify.com') || url.includes('open.spotify.com');
}

export default api;
