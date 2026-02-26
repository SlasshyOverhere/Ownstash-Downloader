import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    Download,
    Video,
    Music,
    Clock,
    Eye,
    ThumbsUp,
    User,
    Loader2,
    Check,
    ChevronDown,
    Image as ImageIcon,
    Scissors
} from 'lucide-react';
import { cn } from '@/lib/utils';
import api, { FormatInfo, MediaInfo, formatBytes, formatDuration } from '@/services/api';

interface MediaInfoModalProps {
    isOpen: boolean;
    onClose: () => void;
    mediaInfo: MediaInfo;
    onDownload: (options: DownloadOptions) => void;
    isDownloading: boolean;
}

export interface DownloadOptions {
    format?: string;
    audioOnly: boolean;
    quality: string;
    embedThumbnail: boolean;
    embedMetadata: boolean;
    downloadSubtitles: boolean;
    audioQuality: string;
    audioFormat: string;
    videoFormat: string;
    useSponsorblock: boolean;
}

const qualityOptions = [
    { value: '4k', label: '4K Ultra HD', desc: 'Up to 3840x2160', height: 2160 },
    { value: '1080p', label: '1080p Full HD', desc: 'Up to 1920x1080', height: 1080 },
    { value: '720p', label: '720p HD', desc: 'Up to 1280x720', height: 720 },
    { value: '480p', label: '480p SD', desc: 'Up to 854x480', height: 480 },
    { value: '360p', label: '360p', desc: 'Low quality, small file', height: 360 },
];

const audioQualityOptions = [
    { value: '0', label: '320kbps', desc: 'Best quality' },
    { value: '2', label: '256kbps', desc: 'High quality' },
    { value: '4', label: '192kbps', desc: 'Good quality' },
    { value: '6', label: '128kbps', desc: 'Standard quality' },
];

const audioFormatOptions = [
    { value: 'mp3', label: 'MP3', desc: 'Most compatible' },
    { value: 'aac', label: 'AAC', desc: 'Better quality' },
    { value: 'flac', label: 'FLAC', desc: 'Lossless audio' },
    { value: 'wav', label: 'WAV', desc: 'Uncompressed' },
    { value: 'opus', label: 'Opus', desc: 'Modern codec' },
];

const videoFormatOptions = [
    { value: 'mp4', label: 'MP4', desc: 'Most compatible' },
    { value: 'mkv', label: 'MKV', desc: 'Better container' },
    { value: 'webm', label: 'WebM', desc: 'Web optimized' },
];

function extractHeightFromText(value?: string): number {
    if (!value) return 0;

    const resolutionMatch = value.match(/(\d{3,5})x(\d{3,5})/);
    if (resolutionMatch) {
        return parseInt(resolutionMatch[2], 10);
    }

    const qualityMatch = value.match(/(\d{3,4})p/i);
    if (qualityMatch) {
        return parseInt(qualityMatch[1], 10);
    }

    return 0;
}

function getFormatHeight(format: FormatInfo): number {
    return Math.max(
        format.height || 0,
        extractHeightFromText(format.resolution),
        extractHeightFromText(format.quality_label),
        extractHeightFromText(format.format_note)
    );
}

function isVideoFormat(format: FormatInfo): boolean {
    if (format.vcodec && format.vcodec !== 'none') return true;

    // Fallback: sometimes codec fields are incomplete, but quality text still indicates video.
    const textHints = [format.resolution, format.quality_label, format.format_note];
    return textHints.some((value) => extractHeightFromText(value) > 0);
}

function isAudioOnlyFormat(format: FormatInfo): boolean {
    const hasAudio = !!format.acodec && format.acodec !== 'none';
    const hasVideo = isVideoFormat(format);
    return hasAudio && !hasVideo;
}

// Helper function to extract max video height from formats
function getMaxVideoHeight(formats: FormatInfo[]): number {
    let maxHeight = 0;

    for (const format of formats) {
        // Skip audio-only formats
        if (!isVideoFormat(format)) continue;

        const height = getFormatHeight(format);
        if (height > maxHeight) {
            maxHeight = height;
        }
    }

    return maxHeight;
}

function getBestAudioFormatId(formats: FormatInfo[]): string | null {
    const audioFormats = formats.filter(isAudioOnlyFormat);
    if (audioFormats.length === 0) return null;

    const sorted = [...audioFormats].sort((a, b) => {
        const aRate = a.tbr || 0;
        const bRate = b.tbr || 0;
        return bRate - aRate;
    });

    return sorted[0].format_id;
}

function getTargetHeightForQuality(quality: string): number | null {
    switch (quality) {
        case '4k':
        case '2160p':
            return 2160;
        case '1080p':
            return 1080;
        case '720p':
            return 720;
        case '480p':
            return 480;
        case '360p':
            return 360;
        default:
            return null;
    }
}

function selectBestVideoFormatForQuality(formats: FormatInfo[], quality: string): FormatInfo | null {
    const videos = formats
        .filter(isVideoFormat)
        .map((format) => ({ format, height: getFormatHeight(format) }))
        .filter((entry) => entry.height > 0);

    if (videos.length === 0) return null;

    const targetHeight = getTargetHeightForQuality(quality);
    let candidates = videos;

    if (targetHeight === 2160) {
        candidates = videos.filter((entry) => entry.height >= 2160);
    } else if (targetHeight) {
        const capped = videos.filter((entry) => entry.height <= targetHeight);
        if (capped.length > 0) {
            candidates = capped;
        }
    }

    const sorted = [...candidates].sort((a, b) => {
        if (b.height !== a.height) return b.height - a.height;
        const fpsA = a.format.fps || 0;
        const fpsB = b.format.fps || 0;
        if (fpsB !== fpsA) return fpsB - fpsA;
        const tbrA = a.format.tbr || 0;
        const tbrB = b.format.tbr || 0;
        return tbrB - tbrA;
    });

    return sorted.length > 0 ? sorted[0].format : null;
}

function buildAutoFormatSelector(formats: FormatInfo[], quality: string): string | undefined {
    const selectedVideo = selectBestVideoFormatForQuality(formats, quality);
    if (!selectedVideo) return undefined;

    const hasAudioInVideo = !!selectedVideo.acodec && selectedVideo.acodec !== 'none';
    if (hasAudioInVideo) {
        return selectedVideo.format_id;
    }

    const audioFormatId = getBestAudioFormatId(formats);
    if (audioFormatId) {
        return `${selectedVideo.format_id}+${audioFormatId}`;
    }

    return selectedVideo.format_id;
}

function isQualityAvailable(formats: FormatInfo[], quality: string): boolean {
    return buildAutoFormatSelector(formats, quality) !== undefined;
}

export function MediaInfoModal({
    isOpen,
    onClose,
    mediaInfo,
    onDownload,
    isDownloading
}: MediaInfoModalProps) {
    const [downloadMode, setDownloadMode] = useState<'video' | 'audio'>('video');
    const [selectedQuality, setSelectedQuality] = useState('1080p');
    const [selectedFormat, setSelectedFormat] = useState<string | undefined>(undefined);
    const [embedThumbnail, setEmbedThumbnail] = useState(true);
    const [embedMetadata, setEmbedMetadata] = useState(true);
    const [downloadSubtitles, setDownloadSubtitles] = useState(true); // Default ON
    const [useSponsorblock, setUseSponsorblock] = useState(false); // Default OFF
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Audio & Video format options
    const [audioQuality, setAudioQuality] = useState('0'); // 320kbps default
    const [audioFormat, setAudioFormat] = useState('mp3');
    const [videoFormat, setVideoFormat] = useState('mp4');

    // Calculate max available video resolution
    const maxVideoHeight = getMaxVideoHeight(mediaInfo.formats);

    // Detect if this is a direct file download (not a media stream)
    // Direct files: Google Drive, OneDrive, Dropbox, or any URL with file extension
    const isDirectFile = (() => {
        const platform = mediaInfo.platform.toLowerCase();
        const directFilePlatforms = ['googledrive', 'generic', 'onedrive', 'dropbox', 'mega', 'mediafire'];

        // Check if it's a known file hosting service
        if (directFilePlatforms.some(p => platform.includes(p))) {
            return true;
        }

        // Check if there are no video codecs in any format (likely a direct file)
        const hasVideoFormats = mediaInfo.formats.some(f => f.vcodec && f.vcodec !== 'none');
        const hasMultipleFormats = mediaInfo.formats.length > 1;

        // If there's only one format and no video codec, it's likely a direct file
        if (!hasVideoFormats && !hasMultipleFormats) {
            return true;
        }

        return false;
    })();

    // Auto-select the highest available quality
    useEffect(() => {
        if (maxVideoHeight > 0) {
            // Find the highest quality option that's actually available.
            const availableOption = qualityOptions.find((opt) => isQualityAvailable(mediaInfo.formats, opt.value));
            if (availableOption) {
                setSelectedQuality(availableOption.value);
            }
        }
    }, [maxVideoHeight, mediaInfo.formats]);

    // Load SponsorBlock setting
    useEffect(() => {
        api.getSetting('use_sponsorblock').then(val => {
            if (val !== null) setUseSponsorblock(val === 'true');
        });
    }, []);

    // Helper to find sponsor segments
    const sponsorSegments = mediaInfo.chapters?.filter(c =>
        c.title.includes('SponsorBlock') ||
        c.title.toLowerCase().includes('sponsor') ||
        c.title.toLowerCase().includes('intro') ||
        c.title.toLowerCase().includes('outro') ||
        c.title.toLowerCase().includes('selfpromo')
    ) || [];

    // Prevent body scroll when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    const autoFormatSelector = !isDirectFile && downloadMode === 'video' && !showAdvanced
        ? buildAutoFormatSelector(mediaInfo.formats, selectedQuality)
        : undefined;
    const qualityUnavailable = !isDirectFile && downloadMode === 'video' && !showAdvanced && !autoFormatSelector;

    const handleDownload = () => {
        if (qualityUnavailable) {
            return;
        }

        onDownload({
            format: showAdvanced ? selectedFormat : autoFormatSelector,
            audioOnly: downloadMode === 'audio',
            quality: selectedQuality,
            embedThumbnail,
            embedMetadata,
            downloadSubtitles,
            audioQuality,
            audioFormat,
            videoFormat,
            useSponsorblock,
        });
    };

    // Handle escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    const modalContent = (
        <AnimatePresence>
            {isOpen && (
                <div
                    className="fixed inset-0 z-[9999]"
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                    }}
                >
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                    />

                    {/* Modal Container - for centering */}
                    <div
                        className="absolute inset-0 flex items-center justify-center p-4"
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                    >
                        {/* Modal */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ type: 'spring', duration: 0.3 }}
                            onClick={(e) => e.stopPropagation()}
                            className="relative w-full max-w-xl bg-neutral-950 rounded-2xl border border-white/10 shadow-2xl"
                            style={{
                                maxHeight: 'calc(100vh - 2rem)',
                                display: 'flex',
                                flexDirection: 'column',
                            }}
                        >
                            {/* Scrollable Content */}
                            <div
                                className="overflow-y-auto flex-1 p-5"
                                style={{ maxHeight: 'calc(100vh - 2rem)' }}
                            >
                                {/* Header */}
                                <div className="flex items-start gap-3 mb-4">
                                    {/* Thumbnail */}
                                    <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 bg-muted">
                                        {mediaInfo.thumbnail ? (
                                            <img
                                                src={mediaInfo.thumbnail}
                                                alt={mediaInfo.title}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <ImageIcon className="w-6 h-6 text-muted-foreground" />
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <h2 className="text-lg font-bold truncate pr-8">{mediaInfo.title}</h2>
                                        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
                                            <span className="px-2 py-0.5 rounded-full bg-white/10 text-white capitalize">
                                                {mediaInfo.platform}
                                            </span>
                                            {mediaInfo.duration && (
                                                <span className="flex items-center gap-1">
                                                    <Clock className="w-3 h-3" />
                                                    {formatDuration(mediaInfo.duration)}
                                                </span>
                                            )}
                                            {mediaInfo.uploader && (
                                                <span className="flex items-center gap-1">
                                                    <User className="w-3 h-3" />
                                                    {mediaInfo.uploader}
                                                </span>
                                            )}
                                        </div>

                                        {/* Stats */}
                                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                            {mediaInfo.view_count && (
                                                <span className="flex items-center gap-1">
                                                    <Eye className="w-3 h-3" />
                                                    {mediaInfo.view_count.toLocaleString()} views
                                                </span>
                                            )}
                                            {mediaInfo.like_count && (
                                                <span className="flex items-center gap-1">
                                                    <ThumbsUp className="w-3 h-3" />
                                                    {mediaInfo.like_count.toLocaleString()}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Close button */}
                                    <button
                                        onClick={onClose}
                                        aria-label="Close"
                                        className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-white/10 transition-colors"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                {/* Direct File Download Banner */}
                                {isDirectFile && (
                                    <div className="flex items-center gap-3 p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 mb-4">
                                        <Download className="w-5 h-5 text-cyan-400 shrink-0" />
                                        <div>
                                            <p className="text-sm font-medium text-cyan-400">Direct File Download</p>
                                            <p className="text-xs text-muted-foreground">
                                                This is a direct file. Click download to save it.
                                                {mediaInfo.formats[0]?.filesize && (
                                                    <span className="ml-1">
                                                        Size: {formatBytes(mediaInfo.formats[0].filesize)}
                                                    </span>
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Download Mode Toggle - Only for media streams */}
                                {!isDirectFile && (
                                    <div className="flex gap-2 p-1 rounded-xl bg-muted/50 mb-4">
                                        <button
                                            onClick={() => setDownloadMode('video')}
                                            aria-pressed={downloadMode === 'video'}
                                            className={cn(
                                                'flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg transition-all text-sm',
                                                downloadMode === 'video'
                                                    ? 'bg-white text-black font-semibold'
                                                    : 'text-muted-foreground hover:bg-white/5'
                                            )}
                                        >
                                            <Video className="w-4 h-4" />
                                            <span className="font-medium">Video</span>
                                        </button>
                                        <button
                                            onClick={() => setDownloadMode('audio')}
                                            aria-pressed={downloadMode === 'audio'}
                                            className={cn(
                                                'flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg transition-all text-sm',
                                                downloadMode === 'audio'
                                                    ? 'bg-white text-black font-semibold'
                                                    : 'text-muted-foreground hover:bg-white/5'
                                            )}
                                        >
                                            <Music className="w-4 h-4" />
                                            <span className="font-medium">Audio Only</span>
                                        </button>
                                    </div>
                                )}

                                {/* Quality Selection */}
                                {!isDirectFile && downloadMode === 'video' && (
                                    <div className="mb-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <h3 className="text-xs font-medium text-muted-foreground" id="quality-label">Quality</h3>
                                            {maxVideoHeight > 0 && (
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white">
                                                    Max: {maxVideoHeight >= 2160 ? '4K' : maxVideoHeight >= 1440 ? '1440p' : `${maxVideoHeight}p`}
                                                </span>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="quality-label">
                                            {qualityOptions.map((option) => {
                                                const isDisabled = !isQualityAvailable(mediaInfo.formats, option.value);
                                                const isSelected = selectedQuality === option.value;

                                                return (
                                                    <button
                                                        key={option.value}
                                                        onClick={() => !isDisabled && setSelectedQuality(option.value)}
                                                        disabled={isDisabled}
                                                        role="radio"
                                                        aria-checked={isSelected}
                                                        className={cn(
                                                            'p-2 rounded-lg border transition-all text-left',
                                                            isDisabled
                                                                ? 'border-white/5 opacity-40 cursor-not-allowed'
                                                                : isSelected
                                                                    ? 'border-white bg-white/10'
                                                                    : 'border-white/10 hover:border-white/20'
                                                        )}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <span className="font-medium text-xs">{option.label}</span>
                                                            {isDisabled ? (
                                                                <span className="text-[9px] text-muted-foreground">N/A</span>
                                                            ) : selectedQuality === option.value && (
                                                                <Check className="w-3 h-3 text-white" />
                                                            )}
                                                        </div>
                                                        <span className="text-[10px] text-muted-foreground">{option.desc}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Video Format Selection */}
                                {!isDirectFile && downloadMode === 'video' && (
                                    <div className="mb-4">
                                        <h3 className="text-xs font-medium text-muted-foreground mb-2" id="video-format-label">Output Format</h3>
                                        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="video-format-label">
                                            {videoFormatOptions.map((option) => (
                                                <button
                                                    key={option.value}
                                                    onClick={() => setVideoFormat(option.value)}
                                                    role="radio"
                                                    aria-checked={videoFormat === option.value}
                                                    className={cn(
                                                        'p-2 rounded-lg border transition-all text-left',
                                                        videoFormat === option.value
                                                            ? 'border-white bg-white/10'
                                                            : 'border-white/10 hover:border-white/20'
                                                    )}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-medium text-xs">{option.label}</span>
                                                        {videoFormat === option.value && (
                                                            <Check className="w-3 h-3 text-white" />
                                                        )}
                                                    </div>
                                                    <span className="text-[10px] text-muted-foreground">{option.desc}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Audio Quality Selection */}
                                {!isDirectFile && downloadMode === 'audio' && (
                                    <div className="mb-4">
                                        <h3 className="text-xs font-medium text-muted-foreground mb-2" id="audio-quality-label">Audio Quality</h3>
                                        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-labelledby="audio-quality-label">
                                            {audioQualityOptions.map((option) => (
                                                <button
                                                    key={option.value}
                                                    onClick={() => setAudioQuality(option.value)}
                                                    role="radio"
                                                    aria-checked={audioQuality === option.value}
                                                    className={cn(
                                                        'p-2 rounded-lg border transition-all text-left',
                                                        audioQuality === option.value
                                                            ? 'border-white bg-white/10'
                                                            : 'border-white/10 hover:border-white/20'
                                                    )}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-medium text-xs">{option.label}</span>
                                                        {audioQuality === option.value && (
                                                            <Check className="w-3 h-3 text-white" />
                                                        )}
                                                    </div>
                                                    <span className="text-[10px] text-muted-foreground">{option.desc}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Audio Format Selection */}
                                {!isDirectFile && downloadMode === 'audio' && (
                                    <div className="mb-4">
                                        <h3 className="text-xs font-medium text-muted-foreground mb-2" id="audio-format-label">Audio Format</h3>
                                        <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-labelledby="audio-format-label">
                                            {audioFormatOptions.map((option) => (
                                                <button
                                                    key={option.value}
                                                    onClick={() => setAudioFormat(option.value)}
                                                    role="radio"
                                                    aria-checked={audioFormat === option.value}
                                                    className={cn(
                                                        'p-2 rounded-lg border transition-all text-center',
                                                        audioFormat === option.value
                                                            ? 'border-white bg-white/10'
                                                            : 'border-white/10 hover:border-white/20'
                                                    )}
                                                >
                                                    <span className="font-medium text-xs">{option.label}</span>
                                                    {audioFormat === option.value && (
                                                        <Check className="w-3 h-3 text-white mx-auto mt-1" />
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Options - only for media streams */}
                                {!isDirectFile && (
                                    <div className="mb-4">
                                        <h3 className="text-xs font-medium text-muted-foreground mb-2">Options</h3>
                                        <div className="space-y-2">
                                            <label className="flex items-center justify-between p-2.5 rounded-lg border border-white/10 cursor-pointer hover:bg-white/5 transition-colors">
                                                <span className="text-sm">Embed thumbnail</span>
                                                <input
                                                    type="checkbox"
                                                    checked={embedThumbnail}
                                                    onChange={(e) => setEmbedThumbnail(e.target.checked)}
                                                    className="w-4 h-4 accent-white"
                                                />
                                            </label>
                                            <label className="flex items-center justify-between p-2.5 rounded-lg border border-white/10 cursor-pointer hover:bg-white/5 transition-colors">
                                                <span className="text-sm">Embed metadata (title, artist, etc.)</span>
                                                <input
                                                    type="checkbox"
                                                    checked={embedMetadata}
                                                    onChange={(e) => setEmbedMetadata(e.target.checked)}
                                                    className="w-4 h-4 accent-white"
                                                />
                                            </label>
                                            {downloadMode === 'video' && (
                                                <label className="flex items-center justify-between p-2.5 rounded-lg border border-white/10 cursor-pointer hover:bg-white/5 transition-colors">
                                                    <div className="flex flex-col">
                                                        <span className="text-sm">Download subtitles</span>
                                                        <span className="text-[10px] text-muted-foreground">Will download if available (auto-subs included)</span>
                                                    </div>
                                                    <input
                                                        type="checkbox"
                                                        checked={downloadSubtitles}
                                                        onChange={(e) => setDownloadSubtitles(e.target.checked)}
                                                        className="w-4 h-4 accent-white"
                                                    />
                                                </label>
                                            )}
                                            {downloadMode === 'video' && (
                                                <label className="flex items-center justify-between p-2.5 rounded-lg border border-white/10 cursor-pointer hover:bg-white/5 transition-colors">
                                                    <div className="flex flex-col">
                                                        <span className="flex items-center gap-2 text-sm">
                                                            <Scissors className="w-3.5 h-3.5 text-rose-400" />
                                                            Remove Sponsors
                                                        </span>
                                                        <span className="text-[10px] text-muted-foreground">Skip intros, outros & ads (SponsorBlock)</span>
                                                    </div>
                                                    <input
                                                        type="checkbox"
                                                        checked={useSponsorblock}
                                                        onChange={(e) => setUseSponsorblock(e.target.checked)}
                                                        className="w-4 h-4 accent-rose-500"
                                                    />
                                                </label>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* SponsorBlock Preview */}
                                {useSponsorblock && sponsorSegments.length > 0 && (
                                    <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                                        <div className="flex items-center gap-2 mb-2 text-rose-400">
                                            <Scissors className="w-3.5 h-3.5" />
                                            <span className="text-xs font-semibold">Segments to Remove ({sponsorSegments.length})</span>
                                        </div>
                                        <div className="space-y-1 max-h-24 overflow-y-auto pr-1 custom-scrollbar">
                                            {sponsorSegments.map((seg, i) => (
                                                <div key={i} className="flex items-center justify-between text-[10px] px-2 py-1 rounded bg-black/20 text-rose-200/80">
                                                    <span className="truncate max-w-[70%]">{seg.title}</span>
                                                    <span className="font-mono opacity-70">
                                                        {formatDuration(seg.start_time)} - {formatDuration(seg.end_time)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Advanced: Format Selection - Only for media */}
                                {!isDirectFile && (
                                    <div className="mb-4">
                                        <button
                                            onClick={() => setShowAdvanced(!showAdvanced)}
                                            aria-expanded={showAdvanced}
                                            aria-controls="advanced-formats"
                                            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            <ChevronDown className={cn(
                                                'w-3 h-3 transition-transform',
                                                showAdvanced && 'rotate-180'
                                            )} />
                                            Advanced: Select specific format
                                        </button>

                                        {showAdvanced && (
                                            <motion.div
                                                id="advanced-formats"
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                className="mt-2 space-y-1 max-h-32 overflow-y-auto"
                                            >
                                                {mediaInfo.formats.slice(0, 15).map((format) => (
                                                    <button
                                                        key={format.format_id}
                                                        onClick={() => setSelectedFormat(format.format_id)}
                                                        className={cn(
                                                            'w-full p-2 rounded-lg border text-left text-xs transition-all',
                                                            selectedFormat === format.format_id
                                                                ? 'border-white bg-white/10'
                                                                : 'border-white/10 hover:border-white/20'
                                                        )}
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="flex items-center gap-1">
                                                                {format.vcodec && format.vcodec !== 'none' && (
                                                                    <Video className="w-3 h-3 text-white/70" />
                                                                )}
                                                                {format.acodec && format.acodec !== 'none' && (
                                                                    <Music className="w-3 h-3 text-white/70" />
                                                                )}
                                                                <span className="font-mono">{format.format_id}</span>
                                                                <span className="text-muted-foreground">({format.ext})</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                                {format.resolution && <span>{format.resolution}</span>}
                                                                {(format.filesize || format.filesize_approx) && (
                                                                    <span>
                                                                        {formatBytes(format.filesize || format.filesize_approx || 0)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </button>
                                                ))}
                                            </motion.div>
                                        )}
                                    </div>
                                )}

                                {/* Download Button */}
                                <button
                                    onClick={handleDownload}
                                    disabled={isDownloading || qualityUnavailable}
                                    className={cn(
                                        'w-full btn-neon flex items-center justify-center gap-2 py-3 text-base',
                                        (isDownloading || qualityUnavailable) && 'opacity-70 cursor-not-allowed'
                                    )}
                                >
                                    {isDownloading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            <span>Starting Download...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Download className="w-4 h-4" />
                                            <span>Download {isDirectFile ? 'File' : (downloadMode === 'audio' ? 'Audio' : 'Video')}</span>
                                        </>
                                    )}
                                </button>

                                {/* Description Preview */}
                                {mediaInfo.description && (
                                    <details className="text-xs mt-3">
                                        <summary className="text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                                            Show description
                                        </summary>
                                        <p className="mt-2 text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                                            {mediaInfo.description}
                                        </p>
                                    </details>
                                )}
                            </div>
                        </motion.div>
                    </div>
                </div >
            )
            }
        </AnimatePresence >
    );

    // Use portal to render at document body level
    if (typeof document !== 'undefined') {
        return createPortal(modalContent, document.body);
    }

    return modalContent;
}
