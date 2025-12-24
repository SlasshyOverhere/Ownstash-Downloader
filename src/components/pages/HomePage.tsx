import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Link,
    Sparkles,
    Download,
    Youtube,
    Music,
    Video,
    Loader2,
    AlertCircle,
    CheckCircle,
    Instagram,
    Twitter
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { staggerContainer, staggerItem, fadeInUp } from '@/lib/animations';
import { use3DTilt } from '@/hooks/use3DTilt';
import { toast } from 'sonner';
import api, {
    MediaInfo,
    DownloadRequest,
    Download as DownloadType,
    generateDownloadId,
    SpotifyMediaInfo,
    SpotifyDownloadRequest,
    isSpotifyUrl
} from '@/services/api';
import { MediaInfoModal, DownloadOptions } from '@/components/MediaInfoModal';
import { SpotifyInfoModal, SpotifyDownloadOptions } from '@/components/SpotifyInfoModal';

// Platform detection patterns
const platformPatterns = [
    { pattern: /youtube\.com|youtu\.be/i, name: 'YouTube', icon: Youtube, color: 'from-white/80 to-white/60' },
    { pattern: /spotify\.com/i, name: 'Spotify', icon: Music, color: 'from-white/80 to-white/60' },
    { pattern: /vimeo\.com/i, name: 'Vimeo', icon: Video, color: 'from-blue-400 to-blue-500' },
    { pattern: /soundcloud\.com/i, name: 'SoundCloud', icon: Music, color: 'from-orange-500 to-orange-600' },
    { pattern: /instagram\.com/i, name: 'Instagram', icon: Instagram, color: 'from-pink-500 to-rose-600' },
    { pattern: /twitter\.com|x\.com/i, name: 'Twitter', icon: Twitter, color: 'from-blue-400 to-blue-500' },
    { pattern: /tiktok\.com/i, name: 'TikTok', icon: Video, color: 'from-black to-gray-800' },
    { pattern: /twitch\.tv/i, name: 'Twitch', icon: Video, color: 'from-violet-500 to-violet-700' },
    { pattern: /facebook\.com|fb\.watch/i, name: 'Facebook', icon: Video, color: 'from-blue-600 to-blue-700' },
    { pattern: /dailymotion\.com/i, name: 'Dailymotion', icon: Video, color: 'from-blue-500 to-blue-600' },
];

function detectPlatform(url: string) {
    for (const platform of platformPatterns) {
        if (platform.pattern.test(url)) {
            return platform;
        }
    }
    return null;
}

interface QuickStatProps {
    title: string;
    value: string;
    icon: React.ElementType;
    gradient: string;
}

function QuickStat({ title, value, icon: Icon, gradient }: QuickStatProps) {
    const { ref, tiltStyle, handlers } = use3DTilt({ maxTilt: 10 });

    return (
        <motion.div
            ref={ref}
            style={tiltStyle}
            {...handlers}
            variants={staggerItem}
            className="glass-hover rounded-2xl p-4 cursor-pointer border-glow"
        >
            <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center mb-3', gradient)}>
                <Icon className="w-5 h-5 text-white" />
            </div>
            <p className="text-2xl font-bold font-display">{value}</p>
            <p className="text-sm text-muted-foreground">{title}</p>
        </motion.div>
    );
}

interface HomePageProps {
    onNavigateToDownloads?: () => void;
    extensionUrl?: string | null;
    onExtensionUrlConsumed?: () => void;
}

export function HomePage({ onNavigateToDownloads, extensionUrl, onExtensionUrlConsumed }: HomePageProps) {
    const [url, setUrl] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
    const [spotifyMediaInfo, setSpotifyMediaInfo] = useState<SpotifyMediaInfo | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [showSpotifyModal, setShowSpotifyModal] = useState(false);
    const [ytDlpStatus, setYtDlpStatus] = useState<'checking' | 'ready' | 'error'>('checking');
    const [spotDlStatus, setSpotDlStatus] = useState<'checking' | 'ready' | 'error'>('checking');
    const [stats, setStats] = useState({ downloads: 0, storage: '0 MB', platforms: 0 });
    const [downloadPath, setDownloadPath] = useState<string>('');

    const detectedPlatform = detectPlatform(url);
    const isSpotify = isSpotifyUrl(url);

    // Check yt-dlp and spotdl availability on mount
    useEffect(() => {
        checkYtDlp();
        checkSpotDl();
        loadStats();
        loadDownloadPath();

        // Reload download path when component becomes visible/active
        // This ensures changes from settings are reflected
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                loadDownloadPath();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Also reload when window gets focus
        const handleFocus = () => {
            loadDownloadPath();
        };
        window.addEventListener('focus', handleFocus);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleFocus);
        };
    }, []);

    // Handle URL received from Chrome extension via deep link
    useEffect(() => {
        if (extensionUrl && extensionUrl.trim()) {
            console.log('[Extension] Auto-filling URL:', extensionUrl);

            // Clear any previous state to avoid showing stale data
            setMediaInfo(null);
            setSpotifyMediaInfo(null);
            setShowModal(false);
            setShowSpotifyModal(false);
            setError(null);
            setIsLoading(false);

            // Set the new URL
            setUrl(extensionUrl);

            // Notify parent that we've consumed the URL
            if (onExtensionUrlConsumed) {
                onExtensionUrlConsumed();
            }

            // Auto-trigger fetch after a short delay
            // Use the extensionUrl directly, not the state which might be stale
            const urlToFetch = extensionUrl;
            setTimeout(() => {
                const isSpotifyLink = isSpotifyUrl(urlToFetch);
                if ((!isSpotifyLink && ytDlpStatus === 'ready') || (isSpotifyLink && spotDlStatus === 'ready')) {
                    // Trigger fetch with the specific URL
                    fetchMediaForUrl(urlToFetch);
                }
            }, 300);
        }
    }, [extensionUrl]);

    const checkYtDlp = async () => {
        try {
            const info = await api.checkYtDlp();
            setYtDlpStatus('ready');
            console.log('yt-dlp ready:', info);
        } catch (err) {
            setYtDlpStatus('error');
            toast.error('yt-dlp not found. Please install yt-dlp to enable downloads.');
        }
    };

    const checkSpotDl = async () => {
        try {
            const info = await api.checkSpotDl();
            setSpotDlStatus('ready');
            console.log('SpotDL ready:', info);
        } catch (err) {
            setSpotDlStatus('error');
            console.log('SpotDL not available:', err);
        }
    };

    const loadStats = async () => {
        try {
            const downloads = await api.getDownloads();
            const platforms = new Set(downloads.map(d => d.platform).filter(Boolean));

            // Get actual folder size from disk
            let totalBytes = 0;
            try {
                const savedPath = await api.getSetting('download_path');
                const downloadPath = savedPath || await api.getDefaultDownloadPath();
                totalBytes = await api.getDownloadFolderSize(downloadPath);
            } catch (err) {
                console.error('Failed to get folder size:', err);
                // Fallback to database size_bytes if folder scan fails
                totalBytes = downloads.reduce((acc, d) => acc + (d.size_bytes || 0), 0);
            }

            setStats({
                downloads: downloads.length,
                storage: formatStorageSize(totalBytes),
                platforms: platforms.size,
            });
        } catch (err) {
            console.error('Failed to load stats:', err);
        }
    };

    const loadDownloadPath = async () => {
        try {
            // Try to get saved download path
            const savedPath = await api.getSetting('download_path');
            if (savedPath) {
                setDownloadPath(savedPath);
            } else {
                // Use default path
                const defaultPath = await api.getDefaultDownloadPath();
                setDownloadPath(defaultPath);
            }
        } catch (err) {
            console.error('Failed to load download path:', err);
        }
    };

    const formatStorageSize = (bytes: number): string => {
        if (bytes === 0) return '0 MB';
        const mb = bytes / (1024 * 1024);
        if (mb < 1000) return `${mb.toFixed(1)} MB`;
        return `${(mb / 1024).toFixed(2)} GB`;
    };

    // Fetch media info for a specific URL (used by extension hook to avoid stale closures)
    const fetchMediaForUrl = async (targetUrl: string) => {
        if (!targetUrl.trim()) {
            setError('Please enter a URL');
            return;
        }

        const isSpotifyLink = isSpotifyUrl(targetUrl);

        // Check if it's a Spotify URL
        if (isSpotifyLink) {
            if (spotDlStatus !== 'ready') {
                toast.error('SpotDL is not available. Please install it with: pip install spotdl');
                return;
            }

            setIsLoading(true);
            setError(null);

            toast.info('🎵 Fetching Spotify info... This may take a moment as we search for the best audio match.', {
                duration: 5000,
            });

            try {
                const info = await api.getSpotifyInfo(targetUrl);
                await api.addSearch(targetUrl, info.title, info.thumbnail);
                setSpotifyMediaInfo(info);
                setShowSpotifyModal(true);
                toast.success(`Found: ${info.title}`);
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'Failed to fetch Spotify info';
                setError(errorMsg);
                toast.error(errorMsg);
            } finally {
                setIsLoading(false);
            }
        } else {
            if (ytDlpStatus !== 'ready') {
                toast.error('yt-dlp is not available. Please install it first.');
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                const info = await api.getMediaInfo(targetUrl);

                // For direct file hosting services, probe for accurate file size
                const directFilePlatforms = ['googledrive', 'generic', 'onedrive', 'dropbox', 'mega', 'mediafire'];
                const isDirectFile = directFilePlatforms.some(p => info.platform.toLowerCase().includes(p));

                if (isDirectFile) {
                    try {
                        const probeResult = await api.probeDirectFile(targetUrl);
                        if (probeResult.file_size > 0 && info.formats.length > 0) {
                            info.formats[0].filesize = probeResult.file_size;
                            if (probeResult.filename && probeResult.filename !== 'download') {
                                info.title = probeResult.filename.replace(/\.[^/.]+$/, '');
                            }
                        }
                    } catch {
                        // Silently ignore probe failures
                    }
                }

                await api.addSearch(targetUrl, info.title, info.thumbnail);
                setMediaInfo(info);
                setShowModal(true);
                toast.success(`Found: ${info.title}`);
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'Failed to fetch media info';
                setError(errorMsg);
                toast.error(errorMsg);
            } finally {
                setIsLoading(false);
            }
        }
    };

    const handleFetchInfo = async () => {
        if (!url.trim()) {
            setError('Please enter a URL');
            return;
        }

        // Check if it's a Spotify URL
        if (isSpotify) {
            if (spotDlStatus !== 'ready') {
                toast.error('SpotDL is not available. Please install it with: pip install spotdl');
                return;
            }

            setIsLoading(true);
            setError(null);

            // Show info toast for Spotify - it takes longer because it needs to search YouTube
            toast.info('🎵 Fetching Spotify info... This may take a moment as we search for the best audio match.', {
                duration: 5000,
            });

            try {
                // Fetch Spotify media info
                const info = await api.getSpotifyInfo(url);

                // Add to search history
                await api.addSearch(url, info.title, info.thumbnail);

                setSpotifyMediaInfo(info);
                setShowSpotifyModal(true);
                toast.success(`Found: ${info.title}`);
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'Failed to fetch Spotify info';
                setError(errorMsg);
                toast.error(errorMsg);
            } finally {
                setIsLoading(false);
            }
        } else {
            // Use yt-dlp for other platforms
            if (ytDlpStatus !== 'ready') {
                toast.error('yt-dlp is not available. Please install it first.');
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                // Fetch media info first
                const info = await api.getMediaInfo(url);

                // For direct file hosting services, also probe the URL directly for accurate file size
                const directFilePlatforms = ['googledrive', 'generic', 'onedrive', 'dropbox', 'mega', 'mediafire'];
                const isDirectFile = directFilePlatforms.some(p => info.platform.toLowerCase().includes(p));

                if (isDirectFile) {
                    try {
                        const probeResult = await api.probeDirectFile(url);
                        // Update the first format's filesize with the probed value
                        if (probeResult.file_size > 0 && info.formats.length > 0) {
                            info.formats[0].filesize = probeResult.file_size;
                            // Also update title if we got a better filename
                            if (probeResult.filename && probeResult.filename !== 'download') {
                                info.title = probeResult.filename.replace(/\.[^/.]+$/, ''); // Remove extension
                            }
                        }
                    } catch (probeErr) {
                        console.log('[HomePage] Direct file probe failed, using yt-dlp info:', probeErr);
                    }
                }

                // Add to search history with title and thumbnail
                await api.addSearch(url, info.title, info.thumbnail);

                setMediaInfo(info);
                setShowModal(true);
                toast.success(`Found: ${info.title}`);
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'Failed to fetch media info';
                setError(errorMsg);
                toast.error(errorMsg);
            } finally {
                setIsLoading(false);
            }
        }
    };

    const handleDownload = async (options: DownloadOptions) => {
        if (!mediaInfo) return;

        setIsDownloading(true);

        try {
            const downloadId = generateDownloadId();

            // Create download record in database
            const download: DownloadType = {
                id: downloadId,
                title: mediaInfo.title,
                url: url,
                format: options.audioOnly ? 'mp3' : options.quality,
                path: downloadPath,
                timestamp: Date.now(),
                status: 'downloading',
                platform: mediaInfo.platform,
                thumbnail: mediaInfo.thumbnail,
            };

            await api.addDownload(download);

            // Start the actual download
            const request: DownloadRequest = {
                id: downloadId,
                url: url,
                output_path: downloadPath,
                format: options.format,
                audio_only: options.audioOnly,
                quality: options.quality,
                embed_thumbnail: options.embedThumbnail,
                embed_metadata: options.embedMetadata,
                download_subtitles: options.downloadSubtitles,
                audio_quality: options.audioQuality,
                audio_format: options.audioFormat,
                video_format: options.videoFormat,
            };

            // Fire and forget - don't await the download completion
            // The download runs in background and emits progress events
            api.startDownload(request).catch(err => {
                console.error('[HomePage] Download error:', err);
                // Update the download status to failed
                api.updateDownloadStatus(downloadId, 'failed').catch(() => { });
            });

            // Immediately close modal and navigate
            setShowModal(false);
            setUrl('');
            setMediaInfo(null);
            toast.success('Download started!');
            loadStats();

            // Navigate to downloads tab immediately
            if (onNavigateToDownloads) {
                onNavigateToDownloads();
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to start download';
            toast.error(errorMsg);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleSpotifyDownload = async (options: SpotifyDownloadOptions) => {
        if (!spotifyMediaInfo) return;

        setIsDownloading(true);

        try {
            const downloadId = generateDownloadId();

            // Create download record in database
            const download: DownloadType = {
                id: downloadId,
                title: spotifyMediaInfo.title,
                url: spotifyMediaInfo.url,
                format: options.audioFormat,
                path: downloadPath,
                timestamp: Date.now(),
                status: 'downloading',
                platform: 'Spotify',
                thumbnail: spotifyMediaInfo.thumbnail,
            };

            await api.addDownload(download);

            // Start the Spotify download
            const request: SpotifyDownloadRequest = {
                id: downloadId,
                url: spotifyMediaInfo.url,
                output_path: downloadPath,
                audio_format: options.audioFormat,
                audio_quality: options.audioQuality,
                embed_lyrics: options.embedLyrics,
            };

            await api.startSpotifyDownload(request);

            toast.success('🎵 Spotify download started! SpotDL is finding the best audio match from YouTube.', {
                duration: 4000,
            });
            setShowSpotifyModal(false);
            setUrl('');
            setSpotifyMediaInfo(null);
            loadStats();

            // Auto-navigate to downloads tab
            if (onNavigateToDownloads) {
                setTimeout(() => {
                    onNavigateToDownloads();
                }, 500);
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to start Spotify download';
            toast.error(errorMsg);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleFetchInfo();
        }
    };

    return (
        <>
            <motion.div
                variants={staggerContainer}
                initial="initial"
                animate="animate"
                className="max-w-4xl mx-auto space-y-8"
            >
                {/* Hero Section */}
                <motion.div variants={fadeInUp} className="text-center space-y-4 pt-8">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-sm flex-wrap justify-center">
                        <Sparkles className="w-4 h-4 text-primary" />
                        <span className="text-muted-foreground">1000+ Platforms + Spotify</span>
                        {ytDlpStatus === 'ready' && (
                            <span className="flex items-center gap-1 text-white">
                                <CheckCircle className="w-3 h-3" />
                                yt-dlp
                            </span>
                        )}
                        {ytDlpStatus === 'error' && (
                            <span className="flex items-center gap-1 text-white/50">
                                <AlertCircle className="w-3 h-3" />
                                yt-dlp missing
                            </span>
                        )}
                        {spotDlStatus === 'ready' && (
                            <span className="flex items-center gap-1 text-white">
                                <CheckCircle className="w-3 h-3" />
                                SpotDL
                            </span>
                        )}
                        {spotDlStatus === 'error' && (
                            <span className="flex items-center gap-1 text-white/50" title="Install with: pip install spotdl">
                                <AlertCircle className="w-3 h-3" />
                                SpotDL
                            </span>
                        )}
                    </div>
                    <h1 className="text-5xl font-display font-bold gradient-text">
                        Download Anything
                    </h1>
                    <p className="text-lg text-muted-foreground max-w-md mx-auto">
                        Paste a URL from any platform. We'll handle the rest.
                    </p>
                </motion.div>

                {/* URL Input Section */}
                <motion.div variants={fadeInUp} className="space-y-4">
                    <div className="relative">
                        {/* Glow effect behind input */}
                        <div className="absolute -inset-1 bg-gradient-to-r from-primary via-accent to-secondary rounded-2xl blur-lg opacity-30" />

                        <div className="relative glass rounded-2xl p-2 flex items-center gap-3">
                            {/* Platform indicator */}
                            <div className={cn(
                                'w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-300',
                                detectedPlatform
                                    ? `bg-gradient-to-br ${detectedPlatform.color}`
                                    : 'bg-muted'
                            )}>
                                {detectedPlatform ? (
                                    <detectedPlatform.icon className="w-6 h-6 text-white" />
                                ) : (
                                    <Link className="w-6 h-6 text-muted-foreground" />
                                )}
                            </div>

                            {/* Input */}
                            <input
                                type="url"
                                value={url}
                                onChange={(e) => {
                                    setUrl(e.target.value);
                                    setError(null);
                                }}
                                onKeyDown={handleKeyDown}
                                placeholder="Paste URL here..."
                                className={cn(
                                    'flex-1 bg-transparent border-none outline-none text-lg',
                                    'placeholder:text-muted-foreground/50'
                                )}
                            />

                            {/* Download button */}
                            <button
                                onClick={handleFetchInfo}
                                disabled={
                                    !url.trim() ||
                                    isLoading ||
                                    (isSpotify ? spotDlStatus !== 'ready' : ytDlpStatus !== 'ready')
                                }
                                className={cn(
                                    'btn-neon flex items-center gap-2',
                                    'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100',
                                    isSpotify && 'bg-gradient-to-r from-white/90 to-white/70 text-black hover:from-white hover:to-white/80'
                                )}
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        <span>Fetching...</span>
                                    </>
                                ) : (
                                    <>
                                        <Download className="w-5 h-5" />
                                        <span>{isSpotify ? 'Fetch Spotify' : 'Fetch'}</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Error display */}
                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 px-4 py-2 rounded-xl"
                        >
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{error}</span>
                        </motion.div>
                    )}

                    {/* Platform badge */}
                    {detectedPlatform && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-2 text-sm text-muted-foreground"
                        >
                            <span>Detected:</span>
                            <span className={cn(
                                'px-3 py-1 rounded-full bg-gradient-to-r text-white text-xs font-medium',
                                detectedPlatform.color
                            )}>
                                {detectedPlatform.name}
                            </span>
                        </motion.div>
                    )}

                    {/* Spotify Info Banner */}
                    {isSpotify && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-3 text-sm bg-white/5 border border-white/10 px-4 py-3 rounded-xl"
                        >
                            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                                <Music className="w-4 h-4 text-white" />
                            </div>
                            <div>
                                <p className="text-white font-medium">Spotify Link Detected</p>
                                <p className="text-muted-foreground text-xs">
                                    SpotDL will search YouTube for the best audio match. This may take a moment for playlists.
                                </p>
                            </div>
                        </motion.div>
                    )}
                </motion.div>

                {/* Quick Stats */}
                <motion.div
                    variants={staggerContainer}
                    className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-8"
                >
                    <QuickStat
                        title="Total Downloads"
                        value={stats.downloads.toString()}
                        icon={Download}
                        gradient="from-white/20 to-white/10"
                    />
                    <QuickStat
                        title="Storage Used"
                        value={stats.storage}
                        icon={Video}
                        gradient="from-white/15 to-white/5"
                    />
                    <QuickStat
                        title="Platforms Used"
                        value={stats.platforms.toString()}
                        icon={Sparkles}
                        gradient="from-white/20 to-white/10"
                    />
                </motion.div>

                {/* yt-dlp Status Card */}
                {ytDlpStatus === 'error' && (
                    <motion.div
                        variants={fadeInUp}
                        className="glass rounded-2xl p-6 border-l-4 border-orange-500"
                    >
                        <div className="flex items-start gap-4">
                            <AlertCircle className="w-6 h-6 text-orange-500 shrink-0 mt-1" />
                            <div>
                                <h3 className="font-semibold text-lg">yt-dlp Not Found</h3>
                                <p className="text-muted-foreground mt-1">
                                    yt-dlp is required for downloading. Please install it:
                                </p>
                                <ul className="mt-3 space-y-2 text-sm">
                                    <li className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-primary" />
                                        <span><strong>Windows:</strong> <code className="bg-muted px-2 py-1 rounded">winget install yt-dlp</code></span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-primary" />
                                        <span><strong>macOS:</strong> <code className="bg-muted px-2 py-1 rounded">brew install yt-dlp</code></span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-primary" />
                                        <span><strong>Linux:</strong> <code className="bg-muted px-2 py-1 rounded">pip install yt-dlp</code></span>
                                    </li>
                                </ul>
                                <button
                                    onClick={checkYtDlp}
                                    className="mt-4 btn-neon text-sm py-2 px-4"
                                >
                                    Check Again
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </motion.div>

            {/* Media Info Modal */}
            {mediaInfo && (
                <MediaInfoModal
                    isOpen={showModal}
                    onClose={() => setShowModal(false)}
                    mediaInfo={mediaInfo}
                    onDownload={handleDownload}
                    isDownloading={isDownloading}
                />
            )}

            {/* Spotify Info Modal */}
            {spotifyMediaInfo && (
                <SpotifyInfoModal
                    isOpen={showSpotifyModal}
                    onClose={() => setShowSpotifyModal(false)}
                    mediaInfo={spotifyMediaInfo}
                    onDownload={handleSpotifyDownload}
                    isDownloading={isDownloading}
                />
            )}
        </>
    );
}
