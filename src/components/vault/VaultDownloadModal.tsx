import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    Download,
    Loader2,
    Link2,
    Music,
    Youtube,
    CheckCircle2,
    AlertCircle,
    Clock,
    Gauge,
    Shield
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import api, {
    MediaInfo,
    SpotifyMediaInfo,
    VaultDownloadRequest,
    VaultDownloadProgress,
    formatBytes,
    formatDuration,
    isSpotifyUrl,
    generateDownloadId
} from '@/services/api';
import { addToVaultIndex } from '@/services/vaultCloudService';
import { enqueueUpload, VaultFileWithSync } from '@/services/vaultFileSyncService';
import { VaultFileEntry } from '@/services/gdriveService';

interface VaultDownloadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onDownloadComplete: (file: VaultFileWithSync) => void;
}

type DownloadType = 'unknown' | 'youtube' | 'spotify' | 'direct';
type DownloadStatus = 'idle' | 'fetching' | 'ready' | 'downloading' | 'completed' | 'failed';

interface MediaInfoState {
    type: DownloadType;
    ytInfo?: MediaInfo;
    spotifyInfo?: SpotifyMediaInfo;
    directInfo?: { filename: string; size: number; contentType: string };
}

export function VaultDownloadModal({ isOpen, onClose, onDownloadComplete }: VaultDownloadModalProps) {
    const [url, setUrl] = useState('');
    const [status, setStatus] = useState<DownloadStatus>('idle');
    const [mediaInfo, setMediaInfo] = useState<MediaInfoState | null>(null);
    const [progress, setProgress] = useState<VaultDownloadProgress | null>(null);
    const [downloadId, setDownloadId] = useState<string>('');
    const [error, setError] = useState<string>('');

    // Download options
    const [audioOnly, setAudioOnly] = useState(false);
    const [quality, setQuality] = useState<string>('best');
    const [audioFormat, setAudioFormat] = useState<string>('mp3');
    const [embedMetadata] = useState(true);
    const [useSponsorblock, setUseSponsorblock] = useState(false);

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setUrl('');
            setStatus('idle');
            setMediaInfo(null);
            setProgress(null);
            setError('');
        }
    }, [isOpen]);

    // Listen for vault download progress
    useEffect(() => {
        if (!downloadId) return;

        let unlisten: (() => void) | undefined;

        api.onVaultDownloadProgress((prog) => {
            if (prog.id === downloadId) {
                setProgress(prog);
                if (prog.status === 'completed') {
                    setStatus('completed');
                } else if (prog.status === 'failed' || prog.status === 'cancelled') {
                    setStatus('failed');
                    setError(prog.status === 'cancelled' ? 'Download cancelled' : 'Download failed');
                }
            }
        }).then(fn => { unlisten = fn; });

        return () => {
            if (unlisten) unlisten();
        };
    }, [downloadId]);

    // Extract filename from URL, falling back to a generated name
    const extractFilenameFromUrl = (inputUrl: string): string => {
        try {
            const urlObj = new URL(inputUrl);
            const pathname = urlObj.pathname;

            // Try to get filename from path
            const pathParts = pathname.split('/').filter(Boolean);
            const lastPart = pathParts[pathParts.length - 1];

            if (lastPart && lastPart.includes('.')) {
                // Decode URI component and clean up
                return decodeURIComponent(lastPart).split('?')[0];
            }

            // Check for filename in query params (common for cloud services)
            const filenameParam = urlObj.searchParams.get('filename') ||
                urlObj.searchParams.get('name') ||
                urlObj.searchParams.get('file');
            if (filenameParam) {
                return decodeURIComponent(filenameParam);
            }

            // Check for Google Drive's export filename pattern
            if (inputUrl.includes('drive.google.com') || inputUrl.includes('drive.usercontent.google.com')) {
                const id = urlObj.searchParams.get('id');
                if (id) {
                    return `gdrive_${id.substring(0, 8)}_download`;
                }
            }

            // Fallback: generate a name with timestamp
            return `download_${Date.now()}`;
        } catch {
            return `download_${Date.now()}`;
        }
    };

    // Detect URL type
    const detectUrlType = (inputUrl: string): DownloadType => {
        if (!inputUrl) return 'unknown';

        // Spotify URLs - need spotdl
        if (isSpotifyUrl(inputUrl)) {
            return 'spotify';
        }

        // Known media streaming sites that REQUIRE yt-dlp for extraction
        // These sites don't provide direct file downloads
        const ytDlpRequiredSites = [
            /youtube\.com/,
            /youtu\.be/,
            /vimeo\.com/,
            /dailymotion\.com/,
            /twitter\.com\/.*\/status/,  // Twitter video posts
            /x\.com\/.*\/status/,         // X video posts
            /instagram\.com\/(?:p|reel|tv)\//,  // Instagram posts
            /tiktok\.com\/@.*\/video/,    // TikTok videos
            /twitch\.tv\/videos/,         // Twitch VODs
            /clips\.twitch\.tv/,          // Twitch clips
            /reddit\.com\/.*\/comments/,  // Reddit posts
            /soundcloud\.com/,
            /bandcamp\.com/,
            /facebook\.com\/.*\/videos/,
            /fb\.watch/,
            /bilibili\.com\/video/,
            /nicovideo\.jp\/watch/,
        ];

        for (const pattern of ytDlpRequiredSites) {
            if (pattern.test(inputUrl)) {
                return 'youtube';
            }
        }

        // EVERYTHING ELSE is treated as a potential direct download
        // This includes: Google Drive, Dropbox, OneDrive, direct file URLs, 
        // CDN links, file hosting services, etc.
        // The backend will probe the URL and try HTTP download first,
        // falling back to yt-dlp only if needed
        return 'direct';
    };

    // Detect file type from content-type and filename
    const detectFileType = (contentType: string, filename: string): string => {
        const ct = contentType.toLowerCase();
        const ext = filename.split('.').pop()?.toLowerCase() || '';

        // Video
        if (ct.startsWith('video/') || ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv'].includes(ext)) {
            return 'video';
        }
        // Audio
        if (ct.startsWith('audio/') || ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus', 'aac', 'wma'].includes(ext)) {
            return 'audio';
        }
        // Image
        if (ct.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff'].includes(ext)) {
            return 'image';
        }
        // Archive
        if (ct.includes('zip') || ct.includes('rar') || ct.includes('7z') || ct.includes('tar') || ct.includes('gzip') ||
            ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'cab', 'iso'].includes(ext)) {
            return 'archive';
        }
        // PDF
        if (ct.includes('pdf') || ext === 'pdf') {
            return 'document';
        }
        // Documents
        if (ct.includes('document') || ct.includes('msword') || ct.includes('spreadsheet') ||
            ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'rtf', 'txt'].includes(ext)) {
            return 'document';
        }
        // Executable
        if (ct.includes('executable') || ct.includes('octet-stream') ||
            ['exe', 'msi', 'dmg', 'apk', 'deb', 'rpm', 'bin', 'app'].includes(ext)) {
            return 'file';
        }
        // Default to generic file
        return 'file';
    };

    // Fetch media info
    const handleFetchInfo = async () => {
        if (!url.trim()) {
            toast.error('Please enter a URL');
            return;
        }

        setStatus('fetching');
        setError('');
        setMediaInfo(null);

        const urlType = detectUrlType(url);

        try {
            if (urlType === 'spotify') {
                // Fetch Spotify info
                const info = await api.getSpotifyInfo(url);
                setMediaInfo({ type: 'spotify', spotifyInfo: info });
                setAudioOnly(true); // Spotify is always audio
                setStatus('ready');
            } else if (urlType === 'direct') {
                // Try to probe the direct file
                try {
                    const info = await api.probeDirectFile(url);
                    const filename = info.filename || extractFilenameFromUrl(url);
                    setMediaInfo({
                        type: 'direct',
                        directInfo: {
                            filename,
                            size: info.file_size,
                            contentType: info.content_type || 'application/octet-stream'
                        }
                    });
                    setStatus('ready');
                } catch (probeErr) {
                    // Probe failed - but that's OK! 
                    // Many URLs (Google Drive, etc.) don't respond to HEAD requests properly
                    // We'll still try to download and extract filename from response headers
                    console.log('[VaultDownload] Probe failed, will try direct download anyway:', probeErr);

                    // Create a fallback filename from URL or generate one
                    const fallbackFilename = extractFilenameFromUrl(url);
                    setMediaInfo({
                        type: 'direct',
                        directInfo: {
                            filename: fallbackFilename,
                            size: 0, // Unknown until download starts
                            contentType: 'application/octet-stream'
                        }
                    });
                    setStatus('ready');
                }
            } else {
                // Use yt-dlp for media streaming sites
                const info = await api.getMediaInfo(url, useSponsorblock);
                setMediaInfo({ type: 'youtube', ytInfo: info });
                setStatus('ready');
            }
        } catch (err) {
            console.error('[VaultDownload] Failed to fetch info:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch media info');
            setStatus('failed');
        }
    };

    // Start download to vault
    const handleStartDownload = async () => {
        if (!mediaInfo) return;

        const id = generateDownloadId();
        setDownloadId(id);
        setStatus('downloading');
        setProgress(null);
        setError('');

        try {
            if (mediaInfo.type === 'spotify') {
                // Spotify download - use spotdl with vault integration
                toast.info('Spotify vault downloads are being processed...');

                // For now, use the standard approach: download to temp then add to vault
                // TODO: Implement native spotdl vault integration in Rust
                const spotifyInfo = mediaInfo.spotifyInfo!;
                const request: VaultDownloadRequest = {
                    id,
                    url,
                    original_name: `${spotifyInfo.title} - ${spotifyInfo.artist || 'Unknown'}.${audioFormat}`,
                    file_type: 'audio',
                    thumbnail: spotifyInfo.thumbnail,
                    audio_only: true,
                    quality: undefined,
                    format: undefined,
                    audio_format: audioFormat,
                    embed_metadata: embedMetadata,
                    use_sponsorblock: false
                };

                const vaultFile = await api.vaultDirectDownload(request);

                // Add to vault index
                const entry: VaultFileEntry = {
                    id: vaultFile.id,
                    original_name: vaultFile.original_name,
                    encrypted_name: vaultFile.encrypted_name,
                    size_bytes: vaultFile.size_bytes,
                    added_at: vaultFile.added_at,
                    file_type: vaultFile.file_type,
                    thumbnail: vaultFile.thumbnail
                };
                await addToVaultIndex(entry);
                enqueueUpload(vaultFile.id);

                setStatus('completed');
                toast.success('Download complete and encrypted to vault!');
                onDownloadComplete(vaultFile as VaultFileWithSync);

            } else if (mediaInfo.type === 'direct') {
                // Direct file download - supports any file type
                const directInfo = mediaInfo.directInfo!;
                const detectedType = detectFileType(directInfo.contentType, directInfo.filename);
                const request: VaultDownloadRequest = {
                    id,
                    url,
                    original_name: directInfo.filename,
                    file_type: detectedType,
                    thumbnail: undefined,
                    audio_only: false,
                    quality: undefined,
                    format: undefined,
                    audio_format: audioFormat,
                    embed_metadata: false,
                    use_sponsorblock: false
                };

                const vaultFile = await api.vaultDirectDownload(request);

                // Add to vault index
                const entry: VaultFileEntry = {
                    id: vaultFile.id,
                    original_name: vaultFile.original_name,
                    encrypted_name: vaultFile.encrypted_name,
                    size_bytes: vaultFile.size_bytes,
                    added_at: vaultFile.added_at,
                    file_type: vaultFile.file_type,
                    thumbnail: vaultFile.thumbnail
                };
                await addToVaultIndex(entry);
                enqueueUpload(vaultFile.id);

                setStatus('completed');
                toast.success('File downloaded and encrypted to vault!');
                onDownloadComplete(vaultFile as VaultFileWithSync);

            } else {
                // YouTube/yt-dlp download
                const ytInfo = mediaInfo.ytInfo!;
                const request: VaultDownloadRequest = {
                    id,
                    url,
                    original_name: `${ytInfo.title}.${audioOnly ? audioFormat : 'mp4'}`,
                    file_type: audioOnly ? 'audio' : 'video',
                    thumbnail: ytInfo.thumbnail,
                    audio_only: audioOnly,
                    quality: audioOnly ? undefined : quality,
                    format: undefined,
                    audio_format: audioFormat,
                    embed_metadata: embedMetadata,
                    use_sponsorblock: useSponsorblock
                };

                const vaultFile = await api.vaultDirectDownload(request);

                // Add to vault index
                const entry: VaultFileEntry = {
                    id: vaultFile.id,
                    original_name: vaultFile.original_name,
                    encrypted_name: vaultFile.encrypted_name,
                    size_bytes: vaultFile.size_bytes,
                    added_at: vaultFile.added_at,
                    file_type: vaultFile.file_type,
                    thumbnail: vaultFile.thumbnail
                };
                await addToVaultIndex(entry);
                enqueueUpload(vaultFile.id);

                setStatus('completed');
                toast.success('Download complete and encrypted to vault!');
                onDownloadComplete(vaultFile as VaultFileWithSync);
            }
        } catch (err) {
            console.error('[VaultDownload] Download failed:', err);
            setError(err instanceof Error ? err.message : 'Download failed');
            setStatus('failed');
            toast.error('Download failed');
        }
    };

    // Cancel download
    const handleCancelDownload = async () => {
        if (downloadId) {
            try {
                await api.vaultCancelDownload(downloadId);
                setStatus('idle');
                setProgress(null);
                toast.info('Download cancelled');
            } catch (err) {
                console.error('[VaultDownload] Cancel failed:', err);
            }
        }
    };

    // Get status color
    const getStatusColor = () => {
        switch (progress?.status) {
            case 'preparing': return 'text-yellow-400';
            case 'downloading': return 'text-blue-400';
            case 'encrypting': return 'text-purple-400';
            case 'completed': return 'text-green-400';
            case 'failed':
            case 'cancelled': return 'text-red-400';
            default: return 'text-muted-foreground';
        }
    };

    // Get status icon
    const getStatusIcon = () => {
        switch (progress?.status) {
            case 'preparing': return <Clock className="w-4 h-4" />;
            case 'downloading': return <Download className="w-4 h-4" />;
            case 'encrypting': return <Shield className="w-4 h-4" />;
            case 'completed': return <CheckCircle2 className="w-4 h-4" />;
            case 'failed':
            case 'cancelled': return <AlertCircle className="w-4 h-4" />;
            default: return <Loader2 className="w-4 h-4 animate-spin" />;
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
                onClick={(e) => {
                    if (e.target === e.currentTarget && status !== 'downloading') {
                        onClose();
                    }
                }}
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-lg mx-4 rounded-2xl bg-neutral-900/95 border border-white/10 shadow-2xl overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-white/10">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20">
                                <Download className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                                <h2 className="font-semibold">Download to Vault</h2>
                                <p className="text-xs text-muted-foreground">
                                    Securely download and encrypt files
                                </p>
                            </div>
                        </div>
                        {status !== 'downloading' && (
                            <button
                                onClick={onClose}
                                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        )}
                    </div>

                    {/* Content */}
                    <div className="p-4 space-y-4">
                        {/* URL Input */}
                        {status === 'idle' || status === 'fetching' || status === 'failed' ? (
                            <div className="space-y-3">
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={url}
                                        onChange={(e) => setUrl(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleFetchInfo();
                                        }}
                                        placeholder="Paste URL (YouTube, Spotify, or direct link)"
                                        className="w-full px-4 py-3 pl-10 rounded-xl bg-muted/50 border border-white/10 focus:border-primary outline-none transition-colors"
                                        disabled={status === 'fetching'}
                                    />
                                    <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                </div>

                                {error && (
                                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                                        {error}
                                    </div>
                                )}

                                <button
                                    onClick={handleFetchInfo}
                                    disabled={!url.trim() || status === 'fetching'}
                                    className={cn(
                                        "w-full py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2",
                                        "bg-gradient-to-r from-primary to-accent text-white",
                                        "hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                                    )}
                                >
                                    {status === 'fetching' ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Fetching Info...
                                        </>
                                    ) : (
                                        <>
                                            <Download className="w-4 h-4" />
                                            Fetch Media Info
                                        </>
                                    )}
                                </button>

                                {/* Supported platforms hint */}
                                <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                        <Youtube className="w-3 h-3 text-red-500" />
                                        YouTube
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Music className="w-3 h-3 text-green-500" />
                                        Spotify
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Link2 className="w-3 h-3" />
                                        Direct Links
                                    </span>
                                </div>
                            </div>
                        ) : null}

                        {/* Media Info Display */}
                        {status === 'ready' && mediaInfo && (
                            <div className="space-y-4">
                                {/* Media Preview */}
                                <div className="flex gap-4 p-3 rounded-xl bg-muted/30 border border-white/5">
                                    {/* Thumbnail */}
                                    {(mediaInfo.ytInfo?.thumbnail || mediaInfo.spotifyInfo?.thumbnail) && (
                                        <div className="w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-black">
                                            <img
                                                src={mediaInfo.ytInfo?.thumbnail || mediaInfo.spotifyInfo?.thumbnail}
                                                alt="Thumbnail"
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-medium truncate">
                                            {mediaInfo.ytInfo?.title ||
                                                mediaInfo.spotifyInfo?.title ||
                                                mediaInfo.directInfo?.filename}
                                        </h3>
                                        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                                            {mediaInfo.type === 'youtube' && (
                                                <>
                                                    <Youtube className="w-3.5 h-3.5 text-red-500" />
                                                    <span>{mediaInfo.ytInfo?.platform}</span>
                                                </>
                                            )}
                                            {mediaInfo.type === 'spotify' && (
                                                <>
                                                    <Music className="w-3.5 h-3.5 text-green-500" />
                                                    <span>Spotify</span>
                                                </>
                                            )}
                                            {mediaInfo.type === 'direct' && (
                                                <>
                                                    <Link2 className="w-3.5 h-3.5" />
                                                    <span>Direct Download</span>
                                                </>
                                            )}
                                        </div>
                                        {mediaInfo.ytInfo?.duration && (
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Duration: {formatDuration(mediaInfo.ytInfo.duration)}
                                            </p>
                                        )}
                                        {mediaInfo.directInfo?.size && (
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Size: {formatBytes(mediaInfo.directInfo.size)}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Download Options (for yt-dlp) */}
                                {mediaInfo.type === 'youtube' && (
                                    <div className="space-y-3">
                                        {/* Audio Only Toggle */}
                                        <label className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 cursor-pointer hover:bg-muted/30 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={audioOnly}
                                                onChange={(e) => setAudioOnly(e.target.checked)}
                                                className="w-4 h-4 rounded accent-primary"
                                            />
                                            <Music className="w-4 h-4" />
                                            <span className="text-sm">Audio Only</span>
                                        </label>

                                        {/* Quality Selection */}
                                        {!audioOnly && (
                                            <div className="space-y-2">
                                                <label className="text-xs text-muted-foreground">Video Quality</label>
                                                <select
                                                    value={quality}
                                                    onChange={(e) => setQuality(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-white/10 text-sm"
                                                >
                                                    <option value="best">Best Quality</option>
                                                    <option value="1080p">1080p</option>
                                                    <option value="720p">720p</option>
                                                    <option value="480p">480p</option>
                                                </select>
                                            </div>
                                        )}

                                        {/* Audio Format (for audio only) */}
                                        {audioOnly && (
                                            <div className="space-y-2">
                                                <label className="text-xs text-muted-foreground">Audio Format</label>
                                                <select
                                                    value={audioFormat}
                                                    onChange={(e) => setAudioFormat(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-white/10 text-sm"
                                                >
                                                    <option value="mp3">MP3</option>
                                                    <option value="m4a">M4A</option>
                                                    <option value="opus">OPUS</option>
                                                    <option value="flac">FLAC</option>
                                                </select>
                                            </div>
                                        )}

                                        {/* SponsorBlock Toggle */}
                                        <label className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 cursor-pointer hover:bg-muted/30 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={useSponsorblock}
                                                onChange={(e) => setUseSponsorblock(e.target.checked)}
                                                className="w-4 h-4 rounded accent-primary"
                                            />
                                            <span className="text-sm">Remove Sponsors (SponsorBlock)</span>
                                        </label>
                                    </div>
                                )}

                                {/* Spotify Audio Format */}
                                {mediaInfo.type === 'spotify' && (
                                    <div className="space-y-2">
                                        <label className="text-xs text-muted-foreground">Audio Format</label>
                                        <select
                                            value={audioFormat}
                                            onChange={(e) => setAudioFormat(e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-white/10 text-sm"
                                        >
                                            <option value="mp3">MP3</option>
                                            <option value="m4a">M4A</option>
                                            <option value="flac">FLAC</option>
                                        </select>
                                    </div>
                                )}

                                {/* Security Notice */}
                                <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-sm">
                                    <div className="flex items-start gap-2">
                                        <Shield className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                                        <div>
                                            <p className="text-green-400 font-medium">Secure Vault Download</p>
                                            <p className="text-muted-foreground text-xs mt-1">
                                                File will be downloaded to a temporary location with a random UUID name,
                                                then encrypted directly to your vault. The temporary file is deleted immediately
                                                after encryption - leaving no traces.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => {
                                            setStatus('idle');
                                            setMediaInfo(null);
                                        }}
                                        className="flex-1 py-3 rounded-xl bg-muted/30 hover:bg-muted/50 text-sm font-medium transition-colors"
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleStartDownload}
                                        className="flex-1 py-3 rounded-xl bg-gradient-to-r from-primary to-accent text-white text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                                    >
                                        <Download className="w-4 h-4" />
                                        Download to Vault
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Download Progress */}
                        {status === 'downloading' && (
                            <div className="space-y-4">
                                {/* Progress Bar */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-sm">
                                        <span className={cn("flex items-center gap-2", getStatusColor())}>
                                            {getStatusIcon()}
                                            {progress?.status === 'preparing' && 'Preparing download...'}
                                            {progress?.status === 'downloading' && 'Downloading...'}
                                            {progress?.status === 'encrypting' && 'Encrypting to vault...'}
                                            {!progress?.status && 'Starting...'}
                                        </span>
                                        <span className="font-mono text-muted-foreground">
                                            {(progress?.progress || 0).toFixed(1)}%
                                        </span>
                                    </div>
                                    <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${progress?.progress || 0}%` }}
                                            className="h-full bg-gradient-to-r from-primary to-accent"
                                            transition={{ duration: 0.3 }}
                                        />
                                    </div>
                                </div>

                                {/* Stats */}
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    {progress?.speed && (
                                        <div className="p-3 rounded-xl bg-muted/20 flex items-center gap-2">
                                            <Gauge className="w-4 h-4 text-blue-400" />
                                            <span className="text-muted-foreground">Speed:</span>
                                            <span className="font-mono">{progress.speed}</span>
                                        </div>
                                    )}
                                    {progress?.eta && (
                                        <div className="p-3 rounded-xl bg-muted/20 flex items-center gap-2">
                                            <Clock className="w-4 h-4 text-yellow-400" />
                                            <span className="text-muted-foreground">ETA:</span>
                                            <span className="font-mono">{progress.eta}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Cancel Button */}
                                <button
                                    onClick={handleCancelDownload}
                                    className="w-full py-3 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 text-sm font-medium transition-colors"
                                >
                                    Cancel Download
                                </button>

                                {/* Security info */}
                                <div className="text-center text-xs text-muted-foreground">
                                    <Shield className="w-3 h-3 inline mr-1" />
                                    File is being downloaded with a random UUID name and will be encrypted immediately
                                </div>
                            </div>
                        )}

                        {/* Completed */}
                        {status === 'completed' && (
                            <div className="text-center py-4 space-y-4">
                                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
                                    <CheckCircle2 className="w-8 h-8 text-green-400" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-lg">Download Complete!</h3>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        File has been securely encrypted and added to your vault
                                    </p>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-accent text-white text-sm font-medium hover:opacity-90 transition-opacity"
                                >
                                    Done
                                </button>
                            </div>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
