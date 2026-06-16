import { useState, useEffect, useRef } from 'react';
import { m } from 'framer-motion';
import {
    Link,
    Sparkles,
    Download,
    Youtube,
    Music,
    Video,
    Loader2,
    AlertCircle,
    Instagram,
    Twitter,
    X
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
    icon: React.ComponentType<{ className?: string }>;
    gradient: string;
}

function QuickStat({ title, value, icon: Icon, gradient }: QuickStatProps) {
    const { ref, tiltStyle, handlers } = use3DTilt({ maxTilt: 10 });

    return (
        <m.div
            ref={ref}
            style={tiltStyle}
            {...handlers}
            variants={staggerItem}
            className="glass-hover rounded-2xl p-4 cursor-pointer border-glow"
        >
            <div className={cn('size-10 rounded-xl bg-gradient-to-br flex items-center justify-center mb-3', gradient)}>
                <Icon className="size-5 text-white" />
            </div>
            <p className="text-2xl font-bold font-display">{value}</p>
            <p className="text-sm text-muted-foreground">{title}</p>
        </m.div>
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
    const [stats, setStats] = useState({ downloads: 0, storage: '0 MB', platforms: 0 });
    const downloadPathRef = useRef<string>('');
    const cookiesFromBrowserRef = useRef<string>('');
    const hasConsumedExtensionRef = useRef(false);

    const detectedPlatform = detectPlatform(url);
    const isSpotify = isSpotifyUrl(url);

    useEffect(() => {
        loadStats();
        loadDownloadPath();
        loadCookiesSetting();

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
            // Clear any previous state to avoid showing stale data
            setMediaInfo(null);
            setSpotifyMediaInfo(null);
            setShowModal(false);
            setShowSpotifyModal(false);
            setError(null);
            setIsLoading(false);

            // Set the new URL
            setUrl(extensionUrl);

            // Notify parent that we've consumed the URL (once per URL)
            if (onExtensionUrlConsumed && !hasConsumedExtensionRef.current) {
                hasConsumedExtensionRef.current = true;
                onExtensionUrlConsumed();
            }

            // Auto-trigger fetch after a short delay
            const urlToFetch = extensionUrl;
            const timer = setTimeout(() => {
                fetchMediaForUrl(urlToFetch);
            }, 300);

            return () => clearTimeout(timer);
        } else {
            hasConsumedExtensionRef.current = false;
        }
    }, [extensionUrl, onExtensionUrlConsumed]);

    const loadStats = async () => {
        try {
            const downloads = await api.getDownloads();
            const platforms = new Set(downloads.flatMap(d => d.platform ? [d.platform] : []));

            // Get actual folder size from disk
            let totalBytes = 0;
            try {
                const savedPath = await api.getSetting('download_path');
                const dlPath = savedPath || await api.getDefaultDownloadPath();
                totalBytes = await api.getDownloadFolderSize(dlPath);
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
            const savedPath = await api.getSetting('download_path');
            if (savedPath) {
                downloadPathRef.current = savedPath;
            } else {
                const defaultPath = await api.getDefaultDownloadPath();
                downloadPathRef.current = defaultPath;
            }
        } catch (err) {
            console.error('Failed to load download path:', err);
        }
    };

    const loadCookiesSetting = async () => {
        try {
            const saved = await api.getSetting('cookies_from_browser');
            if (saved && saved !== 'none') {
                cookiesFromBrowserRef.current = saved;
            } else {
                cookiesFromBrowserRef.current = '';
            }
        } catch (err) {
            console.error('Failed to load cookies setting:', err);
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
                const errorMsg = typeof err === 'string' ? err : (err instanceof Error ? err.message : 'Failed to fetch Spotify info');
                setError(errorMsg);
                toast.error(errorMsg);
            } finally {
                setIsLoading(false);
            }
        } else {
            setIsLoading(true);
            setError(null);

            try {
                // Fast metadata path: skip SponsorBlock chapter probing during info fetch.
                const info = await api.getMediaInfo(targetUrl, false, cookiesFromBrowserRef.current || undefined);

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
                const errorMsg = typeof err === 'string' ? err : (err instanceof Error ? err.message : 'Failed to fetch media info');
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
                const errorMsg = typeof err === 'string' ? err : (err instanceof Error ? err.message : 'Failed to fetch Spotify info');
                setError(errorMsg);
                toast.error(errorMsg);
            } finally {
                setIsLoading(false);
            }
        } else {
            setIsLoading(true);
            setError(null);

            try {
                // Fetch media info first
                // Fast metadata path: skip SponsorBlock chapter probing during info fetch.
                const info = await api.getMediaInfo(url, false, cookiesFromBrowserRef.current || undefined);

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
                    } catch {
                        // Silently ignore direct probe failures
                    }
                }

                // Add to search history with title and thumbnail
                await api.addSearch(url, info.title, info.thumbnail);

                setMediaInfo(info);
                setShowModal(true);
                toast.success(`Found: ${info.title}`);
            } catch (err) {
                const errorMsg = typeof err === 'string' ? err : (err instanceof Error ? err.message : 'Failed to fetch media info');
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
                path: downloadPathRef.current,
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
                output_path: downloadPathRef.current,
                format: options.format,
                audio_only: options.audioOnly,
                quality: options.quality,
                embed_thumbnail: options.embedThumbnail,
                embed_metadata: options.embedMetadata,
                download_subtitles: options.downloadSubtitles,
                audio_quality: options.audioQuality,
                audio_format: options.audioFormat,
                video_format: options.videoFormat,
                use_sponsorblock: options.useSponsorblock,
                cookies_from_browser: cookiesFromBrowserRef.current || undefined,
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
            const errorMsg = typeof err === 'string' ? err : (err instanceof Error ? err.message : 'Failed to start download');
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
                path: downloadPathRef.current,
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
                output_path: downloadPathRef.current,
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
            const errorMsg = typeof err === 'string' ? err : (err instanceof Error ? err.message : 'Failed to start Spotify download');
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
            <m.div
                variants={staggerContainer}
                initial="initial"
                animate="animate"
                className="max-w-4xl mx-auto space-y-8"
            >
                {/* Hero Section */}
                <m.div variants={fadeInUp} className="text-center space-y-4 pt-8">
                    <h1 className="text-5xl font-display font-bold gradient-text">
                        Download Anything
                    </h1>
                    <p className="text-lg text-muted-foreground max-w-md mx-auto">
                        Paste a URL from any platform. We'll handle the rest.
                    </p>
                </m.div>

                {/* URL Input Section */}
                <m.div variants={fadeInUp} className="space-y-4">
                    <div className="relative">
                        {/* Glow effect behind input */}
                        <div className="absolute -inset-1 bg-gradient-to-r from-primary via-accent to-secondary rounded-2xl blur-lg opacity-30" />

                        <div className="relative glass rounded-2xl p-2 flex items-center gap-3">
                            {/* Platform indicator */}
                            <div className={cn(
                                'size-12 rounded-xl flex items-center justify-center transition-all duration-300',
                                detectedPlatform
                                    ? `bg-gradient-to-br ${detectedPlatform.color}`
                                    : 'bg-muted'
                            )}>
                                {detectedPlatform ? (
                                    <detectedPlatform.icon className="size-6 text-white" />
                                ) : (
                                    <Link className="size-6 text-muted-foreground" />
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
                                placeholder="Paste URL here…"
                                aria-label="Media URL"
                                className={cn(
                                    'flex-1 bg-transparent border-none outline-none text-lg',
                                    'placeholder:text-muted-foreground/50'
                                )}
                            />

                            {/* Clear Input Button */}
                            {url && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setUrl('');
                                        setError(null);
                                    }}
                                    className="p-1.5 text-muted-foreground hover:text-white rounded-lg hover:bg-white/10 transition-colors focus-visible:ring-2 focus-visible:ring-white/30 outline-none"
                                    aria-label="Clear URL input"
                                    title="Clear"
                                >
                                    <X className="size-5" />
                                </button>
                            )}

                            {/* Download button */}
                            <button
                                type="button"
                                onClick={handleFetchInfo}
                                disabled={
                                    !url.trim() ||
                                    isLoading
                                }
                                className={cn(
                                    'btn-neon flex items-center gap-2',
                                    'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100',
                                    isSpotify && 'bg-gradient-to-r from-white/90 to-white/70 text-black hover:from-white hover:to-white/80'
                                )}
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="size-5 animate-spin" />
                                        <span>Fetching…</span>
                                    </>
                                ) : (
                                    <>
                                        <Download className="size-5" />
                                        <span>{isSpotify ? 'Fetch Spotify' : 'Fetch'}</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Error display */}
                    {error && (
                        <m.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 px-4 py-2 rounded-xl"
                        >
                            <AlertCircle className="size-4 shrink-0" />
                            <span>{error}</span>
                        </m.div>
                    )}

                    {/* Platform badge */}
                    {detectedPlatform && (
                        <m.div
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
                        </m.div>
                    )}

                    {/* Spotify Info Banner */}
                    {isSpotify && (
                        <m.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-3 text-sm bg-white/5 border border-white/10 px-4 py-3 rounded-xl"
                        >
                            <div className="size-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                                <Music className="size-4 text-white" />
                            </div>
                            <div>
                                <p className="text-white font-medium">Spotify Link Detected</p>
                                <p className="text-muted-foreground text-xs">
                                    SpotDL will search YouTube for the best audio match. This may take a moment for playlists.
                                </p>
                            </div>
                        </m.div>
                    )}
                </m.div>

                {/* Quick Stats */}
                <m.div
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
                </m.div>
            </m.div>

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
