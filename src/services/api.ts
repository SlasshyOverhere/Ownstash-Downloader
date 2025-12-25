import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { firestoreService } from './firestore';

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
}

export interface FormatInfo {
    format_id: string;
    ext: string;
    resolution?: string;
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
}

export interface YtDlpInfo {
    version: string;
    path: string;
    is_embedded: boolean;
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
}

// Vault types
export interface VaultStatus {
    is_setup: boolean;
    is_unlocked: boolean;
    file_count: number;
    total_size_bytes: number;
}

export interface VaultFile {
    id: string;
    original_name: string;
    encrypted_name: string;
    size_bytes: number;
    added_at: number;
    file_type: string; // "video", "audio", "file"
    thumbnail?: string;
}

// Native integration types
export interface NotificationClickEvent {
    type: string;
    title: string;
    file_path?: string;
}

// Current user ID - will be set from AuthContext
let currentUserId: string | null = null;

export function setCurrentUserId(userId: string | null) {
    currentUserId = userId;
}

function getUserId(): string {
    if (!currentUserId) {
        throw new Error('User not authenticated. Please sign in first.');
    }
    return currentUserId;
}

// Download API - Uses Firestore exclusively
export const api = {
    // Downloads - Firestore only
    async addDownload(download: Download): Promise<void> {
        return firestoreService.addDownload(getUserId(), download);
    },

    async getDownloads(): Promise<Download[]> {
        return firestoreService.getDownloads(getUserId());
    },

    async updateDownloadStatus(id: string, status: string): Promise<void> {
        return firestoreService.updateDownloadStatus(getUserId(), id, status);
    },

    async deleteDownload(id: string): Promise<void> {
        return firestoreService.deleteDownload(getUserId(), id);
    },

    async clearDownloads(): Promise<void> {
        return firestoreService.clearDownloads(getUserId());
    },

    // Search History - Firestore only
    async addSearch(query: string, title?: string, thumbnail?: string): Promise<void> {
        return firestoreService.addSearch(getUserId(), query, title, thumbnail);
    },

    async getSearchHistory(limit: number = 50): Promise<SearchHistory[]> {
        return firestoreService.getSearchHistory(getUserId(), limit);
    },

    async clearSearchHistory(): Promise<void> {
        return firestoreService.clearSearchHistory(getUserId());
    },

    // Settings - Firestore only
    async saveSetting(key: string, value: string): Promise<void> {
        return firestoreService.saveSetting(getUserId(), key, value);
    },

    async getSetting(key: string): Promise<string | null> {
        return firestoreService.getSetting(getUserId(), key);
    },

    async getAllSettings(): Promise<Setting[]> {
        return firestoreService.getAllSettings(getUserId());
    },

    async deleteSetting(key: string): Promise<void> {
        return firestoreService.deleteSetting(getUserId(), key);
    },

    // Real-time subscriptions
    subscribeToDownloads(callback: (downloads: Download[]) => void): () => void {
        return firestoreService.subscribeToDownloads(getUserId(), callback);
    },

    subscribeToSearchHistory(callback: (history: SearchHistory[]) => void, limit: number = 50): () => void {
        return firestoreService.subscribeToSearchHistory(getUserId(), callback, limit);
    },

    subscribeToSettings(callback: (settings: Setting[]) => void): () => void {
        return firestoreService.subscribeToSettings(getUserId(), callback);
    },

    // Utility functions - still use Rust backend
    async openFolder(path: string, fileName?: string): Promise<void> {
        return invoke('open_folder', { path, fileName });
    },

    async playFile(path: string, title: string): Promise<void> {
        return invoke('play_file', { path, title });
    },

    async findMediaFile(path: string, title: string): Promise<MediaFileInfo> {
        return invoke('find_best_media_match', { path, title });
    },

    async transcodeForPlayback(inputPath: string): Promise<TranscodeResult> {
        return invoke('transcode_for_playback', { inputPath });
    },

    async getMediaStreamUrl(filePath: string): Promise<string> {
        return invoke('get_media_stream_url', { filePath });
    },

    // yt-dlp Management - Rust backend
    async checkYtDlp(): Promise<YtDlpInfo> {
        return invoke('check_yt_dlp');
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
    async getMediaInfo(url: string): Promise<MediaInfo> {
        return invoke('get_media_info', { url });
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
    async checkSpotDl(): Promise<SpotDlInfo> {
        return invoke('check_spotdl');
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

    async vaultExportFile(fileId: string, destinationPath: string): Promise<string> {
        return invoke('vault_export_file', { fileId, destinationPath });
    },

    async vaultGetTempPlaybackPath(fileId: string): Promise<string> {
        return invoke('vault_get_temp_playback_path', { fileId });
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
