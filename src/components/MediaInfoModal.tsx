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
    Image as ImageIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MediaInfo, formatBytes, formatDuration } from '@/services/api';

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

// Helper function to extract max video height from formats
function getMaxVideoHeight(formats: { resolution?: string; vcodec?: string }[]): number {
    let maxHeight = 0;

    for (const format of formats) {
        // Skip audio-only formats
        if (!format.vcodec || format.vcodec === 'none') continue;

        // Try to extract height from resolution string (e.g., "1920x1080" or "1080p")
        if (format.resolution) {
            const match = format.resolution.match(/(\d+)x(\d+)/);
            if (match) {
                const height = parseInt(match[2], 10);
                if (height > maxHeight) maxHeight = height;
            } else {
                // Try format like "1080p"
                const pMatch = format.resolution.match(/(\d+)p/i);
                if (pMatch) {
                    const height = parseInt(pMatch[1], 10);
                    if (height > maxHeight) maxHeight = height;
                }
            }
        }
    }

    return maxHeight;
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
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Audio & Video format options
    const [audioQuality, setAudioQuality] = useState('0'); // 320kbps default
    const [audioFormat, setAudioFormat] = useState('mp3');
    const [videoFormat, setVideoFormat] = useState('mp4');

    // Calculate max available video resolution
    const maxVideoHeight = getMaxVideoHeight(mediaInfo.formats);

    // Auto-select the highest available quality
    useEffect(() => {
        if (maxVideoHeight > 0) {
            // Find the highest quality option that's available
            const availableOption = qualityOptions.find(opt => opt.height <= maxVideoHeight);
            if (availableOption) {
                setSelectedQuality(availableOption.value);
            }
        }
    }, [maxVideoHeight]);

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

    const handleDownload = () => {
        onDownload({
            format: showAdvanced ? selectedFormat : undefined,
            audioOnly: downloadMode === 'audio',
            quality: selectedQuality,
            embedThumbnail,
            embedMetadata,
            downloadSubtitles,
            audioQuality,
            audioFormat,
            videoFormat,
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
                                        className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-white/10 transition-colors"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                {/* Download Mode Toggle */}
                                <div className="flex gap-2 p-1 rounded-xl bg-muted/50 mb-4">
                                    <button
                                        onClick={() => setDownloadMode('video')}
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

                                {/* Quality Selection */}
                                {downloadMode === 'video' && (
                                    <div className="mb-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <h3 className="text-xs font-medium text-muted-foreground">Quality</h3>
                                            {maxVideoHeight > 0 && (
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white">
                                                    Max: {maxVideoHeight >= 2160 ? '4K' : maxVideoHeight >= 1440 ? '1440p' : `${maxVideoHeight}p`}
                                                </span>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                            {qualityOptions.map((option) => {
                                                // Disable quality options higher than max available
                                                const isDisabled = option.height > 0 && maxVideoHeight > 0 && option.height > maxVideoHeight;

                                                return (
                                                    <button
                                                        key={option.value}
                                                        onClick={() => !isDisabled && setSelectedQuality(option.value)}
                                                        disabled={isDisabled}
                                                        className={cn(
                                                            'p-2 rounded-lg border transition-all text-left',
                                                            isDisabled
                                                                ? 'border-white/5 opacity-40 cursor-not-allowed'
                                                                : selectedQuality === option.value
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
                                {downloadMode === 'video' && (
                                    <div className="mb-4">
                                        <h3 className="text-xs font-medium text-muted-foreground mb-2">Output Format</h3>
                                        <div className="grid grid-cols-3 gap-2">
                                            {videoFormatOptions.map((option) => (
                                                <button
                                                    key={option.value}
                                                    onClick={() => setVideoFormat(option.value)}
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
                                {downloadMode === 'audio' && (
                                    <div className="mb-4">
                                        <h3 className="text-xs font-medium text-muted-foreground mb-2">Audio Quality</h3>
                                        <div className="grid grid-cols-4 gap-2">
                                            {audioQualityOptions.map((option) => (
                                                <button
                                                    key={option.value}
                                                    onClick={() => setAudioQuality(option.value)}
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
                                {downloadMode === 'audio' && (
                                    <div className="mb-4">
                                        <h3 className="text-xs font-medium text-muted-foreground mb-2">Audio Format</h3>
                                        <div className="grid grid-cols-5 gap-2">
                                            {audioFormatOptions.map((option) => (
                                                <button
                                                    key={option.value}
                                                    onClick={() => setAudioFormat(option.value)}
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

                                {/* Options */}
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
                                    </div>
                                </div>

                                {/* Advanced: Format Selection */}
                                <div className="mb-4">
                                    <button
                                        onClick={() => setShowAdvanced(!showAdvanced)}
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

                                {/* Download Button */}
                                <button
                                    onClick={handleDownload}
                                    disabled={isDownloading}
                                    className={cn(
                                        'w-full btn-neon flex items-center justify-center gap-2 py-3 text-base',
                                        isDownloading && 'opacity-70 cursor-not-allowed'
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
                                            <span>Download {downloadMode === 'audio' ? 'Audio' : 'Video'}</span>
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
                </div>
            )}
        </AnimatePresence>
    );

    // Use portal to render at document body level
    if (typeof document !== 'undefined') {
        return createPortal(modalContent, document.body);
    }

    return modalContent;
}
