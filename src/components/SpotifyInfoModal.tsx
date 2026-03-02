import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    Download,
    Music,
    Clock,
    User,
    Disc,
    ListMusic,
    Loader2,
    Check,
    ChevronDown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SpotifyMediaInfo, formatDuration } from '@/services/api';

interface SpotifyInfoModalProps {
    isOpen: boolean;
    onClose: () => void;
    mediaInfo: SpotifyMediaInfo;
    onDownload: (options: SpotifyDownloadOptions) => void;
    isDownloading: boolean;
}

export interface SpotifyDownloadOptions {
    audioFormat: string;
    audioQuality: string;
    embedLyrics: boolean;
    threads?: number;
}

const audioFormatOptions = [
    { value: 'mp3', label: 'MP3', desc: 'Most compatible' },
    { value: 'm4a', label: 'M4A', desc: 'Better quality' },
    { value: 'flac', label: 'FLAC', desc: 'Lossless audio' },
    { value: 'opus', label: 'Opus', desc: 'Efficient codec' },
    { value: 'ogg', label: 'OGG', desc: 'Open format' },
    { value: 'wav', label: 'WAV', desc: 'Uncompressed' },
];

const audioQualityOptions = [
    { value: '128k', label: '128 kbps', desc: 'Standard quality' },
    { value: '192k', label: '192 kbps', desc: 'Good quality' },
    { value: '320k', label: '320 kbps', desc: 'Best quality' },
];

function getContentTypeIcon(contentType: string) {
    switch (contentType) {
        case 'track':
            return Music;
        case 'album':
            return Disc;
        case 'playlist':
            return ListMusic;
        case 'artist':
            return User;
        default:
            return Music;
    }
}

function getContentTypeLabel(contentType: string) {
    switch (contentType) {
        case 'track':
            return 'Track';
        case 'album':
            return 'Album';
        case 'playlist':
            return 'Playlist';
        case 'artist':
            return 'Artist';
        default:
            return 'Unknown';
    }
}

export function SpotifyInfoModal({
    isOpen,
    onClose,
    mediaInfo,
    onDownload,
    isDownloading
}: SpotifyInfoModalProps) {
    const [audioFormat, setAudioFormat] = useState('mp3');
    const [audioQuality, setAudioQuality] = useState('320k');
    const [embedLyrics, setEmbedLyrics] = useState(true);
    const [showFormatDropdown, setShowFormatDropdown] = useState(false);
    const [showQualityDropdown, setShowQualityDropdown] = useState(false);

    // Load saved preferences
    useEffect(() => {
        const savedFormat = localStorage.getItem('spotify_audio_format');
        const savedQuality = localStorage.getItem('spotify_audio_quality');
        const savedLyrics = localStorage.getItem('spotify_embed_lyrics');

        if (savedFormat) setAudioFormat(savedFormat);
        if (savedQuality) setAudioQuality(savedQuality);
        if (savedLyrics !== null) setEmbedLyrics(savedLyrics === 'true');
    }, []);

    // Save preferences when they change
    useEffect(() => {
        localStorage.setItem('spotify_audio_format', audioFormat);
        localStorage.setItem('spotify_audio_quality', audioQuality);
        localStorage.setItem('spotify_embed_lyrics', embedLyrics.toString());
    }, [audioFormat, audioQuality, embedLyrics]);

    const handleDownload = () => {
        onDownload({
            audioFormat,
            audioQuality,
            embedLyrics,
        });
    };

    // Close on escape
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    const ContentIcon = getContentTypeIcon(mediaInfo.content_type);

    const modalContent = (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    onClick={(e) => e.target === e.currentTarget && onClose()}
                >
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="relative glass rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl"
                    >
                        {/* Header with Spotify gradient */}
                        <div className="relative h-32 bg-gradient-to-r from-neutral-800 to-neutral-900 overflow-hidden">
                            {mediaInfo.thumbnail && (
                                <img
                                    src={mediaInfo.thumbnail}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover opacity-50"
                                />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />

                            {/* Close button */}
                            <button
                                onClick={onClose}
                                className="absolute top-4 right-4 p-2 rounded-full bg-black/30 hover:bg-black/50 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>

                            {/* Content type badge */}
                            <div className="absolute bottom-4 left-6 flex items-center gap-2">
                                <div className="p-2 rounded-xl bg-white/20 backdrop-blur-sm">
                                    <ContentIcon className="w-5 h-5 text-white" />
                                </div>
                                <span className="text-sm font-medium text-white/80">
                                    Spotify {getContentTypeLabel(mediaInfo.content_type)}
                                </span>
                            </div>

                            {/* Track count badge */}
                            {mediaInfo.track_count && mediaInfo.track_count > 1 && (
                                <div className="absolute bottom-4 right-6 px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-sm font-medium">
                                    {mediaInfo.track_count} tracks
                                </div>
                            )}
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-8rem)]">
                            {/* Title and metadata */}
                            <div>
                                <h2 className="text-2xl font-bold font-display mb-2">
                                    {mediaInfo.title}
                                </h2>
                                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                                    {mediaInfo.artist && (
                                        <span className="flex items-center gap-1.5">
                                            <User className="w-4 h-4" />
                                            {mediaInfo.artist}
                                        </span>
                                    )}
                                    {mediaInfo.album && (
                                        <span className="flex items-center gap-1.5">
                                            <Disc className="w-4 h-4" />
                                            {mediaInfo.album}
                                        </span>
                                    )}
                                    {mediaInfo.duration && (
                                        <span className="flex items-center gap-1.5">
                                            <Clock className="w-4 h-4" />
                                            {formatDuration(mediaInfo.duration)}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Download Options */}
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold flex items-center gap-2">
                                    <Download className="w-5 h-5 text-white" />
                                    Download Options
                                </h3>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Audio Format */}
                                    <div className="relative">
                                        <label className="block text-sm font-medium mb-2 text-muted-foreground">
                                            Audio Format
                                        </label>
                                        <button
                                            onClick={() => {
                                                setShowFormatDropdown(!showFormatDropdown);
                                                setShowQualityDropdown(false);
                                            }}
                                            className={cn(
                                                "w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl",
                                                "bg-muted/50 hover:bg-muted transition-colors",
                                                "border border-transparent",
                                                showFormatDropdown && "border-white"
                                            )}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Music className="w-5 h-5 text-white" />
                                                <div className="text-left">
                                                    <p className="font-medium">
                                                        {audioFormatOptions.find(f => f.value === audioFormat)?.label}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {audioFormatOptions.find(f => f.value === audioFormat)?.desc}
                                                    </p>
                                                </div>
                                            </div>
                                            <ChevronDown className={cn(
                                                "w-5 h-5 transition-transform",
                                                showFormatDropdown && "rotate-180"
                                            )} />
                                        </button>

                                        {/* Format Dropdown */}
                                        <AnimatePresence>
                                            {showFormatDropdown && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -10 }}
                                                    className="absolute z-20 top-full left-0 right-0 mt-2 p-2 glass rounded-xl shadow-xl max-h-60 overflow-y-auto"
                                                >
                                                    {audioFormatOptions.map((format) => (
                                                        <button
                                                            key={format.value}
                                                            onClick={() => {
                                                                setAudioFormat(format.value);
                                                                setShowFormatDropdown(false);
                                                            }}
                                                            className={cn(
                                                                "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                                                                audioFormat === format.value
                                                                    ? "bg-white/10 text-white"
                                                                    : "hover:bg-muted"
                                                            )}
                                                        >
                                                            <Music className="w-4 h-4" />
                                                            <div className="text-left flex-1">
                                                                <p className="font-medium">{format.label}</p>
                                                                <p className="text-xs text-muted-foreground">{format.desc}</p>
                                                            </div>
                                                            {audioFormat === format.value && (
                                                                <Check className="w-4 h-4 text-white" />
                                                            )}
                                                        </button>
                                                    ))}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>

                                    {/* Audio Quality */}
                                    <div className="relative">
                                        <label className="block text-sm font-medium mb-2 text-muted-foreground">
                                            Audio Quality
                                        </label>
                                        <button
                                            onClick={() => {
                                                setShowQualityDropdown(!showQualityDropdown);
                                                setShowFormatDropdown(false);
                                            }}
                                            className={cn(
                                                "w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl",
                                                "bg-muted/50 hover:bg-muted transition-colors",
                                                "border border-transparent",
                                                showQualityDropdown && "border-white"
                                            )}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Music className="w-5 h-5 text-white" />
                                                <div className="text-left">
                                                    <p className="font-medium">
                                                        {audioQualityOptions.find(q => q.value === audioQuality)?.label}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {audioQualityOptions.find(q => q.value === audioQuality)?.desc}
                                                    </p>
                                                </div>
                                            </div>
                                            <ChevronDown className={cn(
                                                "w-5 h-5 transition-transform",
                                                showQualityDropdown && "rotate-180"
                                            )} />
                                        </button>

                                        {/* Quality Dropdown */}
                                        <AnimatePresence>
                                            {showQualityDropdown && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -10 }}
                                                    className="absolute z-20 top-full left-0 right-0 mt-2 p-2 glass rounded-xl shadow-xl"
                                                >
                                                    {audioQualityOptions.map((quality) => (
                                                        <button
                                                            key={quality.value}
                                                            onClick={() => {
                                                                setAudioQuality(quality.value);
                                                                setShowQualityDropdown(false);
                                                            }}
                                                            className={cn(
                                                                "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                                                                audioQuality === quality.value
                                                                    ? "bg-white/10 text-white"
                                                                    : "hover:bg-muted"
                                                            )}
                                                        >
                                                            <Music className="w-4 h-4" />
                                                            <div className="text-left flex-1">
                                                                <p className="font-medium">{quality.label}</p>
                                                                <p className="text-xs text-muted-foreground">{quality.desc}</p>
                                                            </div>
                                                            {audioQuality === quality.value && (
                                                                <Check className="w-4 h-4 text-white" />
                                                            )}
                                                        </button>
                                                    ))}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </div>

                                {/* Embed Lyrics Toggle */}
                                <button
                                    onClick={() => setEmbedLyrics(!embedLyrics)}
                                    className={cn(
                                        "w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors",
                                        embedLyrics ? "bg-white/10" : "bg-muted/50 hover:bg-muted"
                                    )}
                                >
                                    <div className="flex items-center gap-3">
                                        <ListMusic className={cn(
                                            "w-5 h-5",
                                            embedLyrics ? "text-white" : "text-muted-foreground"
                                        )} />
                                        <div className="text-left">
                                            <p className="font-medium">Embed Lyrics</p>
                                            <p className="text-xs text-muted-foreground">Include lyrics in audio file</p>
                                        </div>
                                    </div>
                                    <div className={cn(
                                        "w-12 h-6 rounded-full p-1 transition-colors",
                                        embedLyrics ? "bg-white" : "bg-muted"
                                    )}>
                                        <motion.div
                                            className="w-4 h-4 rounded-full bg-black"
                                            animate={{ x: embedLyrics ? 24 : 0 }}
                                            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                                        />
                                    </div>
                                </button>
                            </div>

                            {/* Download Button */}
                            <button
                                onClick={handleDownload}
                                disabled={isDownloading}
                                className={cn(
                                    "w-full flex items-center justify-center gap-3 py-4 rounded-2xl",
                                    "bg-white",
                                    "hover:bg-white/90",
                                    "text-black font-semibold text-lg",
                                    "transition-all duration-300",
                                    "disabled:opacity-50 disabled:cursor-not-allowed"
                                )}
                            >
                                {isDownloading ? (
                                    <>
                                        <Loader2 className="w-6 h-6 animate-spin" />
                                        <span>Starting Download...</span>
                                    </>
                                ) : (
                                    <>
                                        <Download className="w-6 h-6" />
                                        <span>Download from Spotify</span>
                                    </>
                                )}
                            </button>

                            {/* Info note */}
                            <p className="text-xs text-center text-muted-foreground">
                                SpotDL downloads audio from YouTube matching Spotify metadata.
                                Quality may vary based on available sources.
                            </p>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );

    return createPortal(modalContent, document.body);
}
