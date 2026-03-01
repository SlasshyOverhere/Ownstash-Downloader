import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    Play,
    Pause,
    Volume2,
    VolumeX,
    Maximize,
    Minimize,
    SkipBack,
    SkipForward,
    Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { convertFileSrc } from '@tauri-apps/api/core';
import { api } from '@/services/api';

interface MediaPlayerProps {
    isOpen: boolean;
    onClose: () => void;
    filePath: string;
    title: string;
    isAudio?: boolean;
    onOpenExternal?: () => void; // Kept as optional prop for future flexibility
}

export function MediaPlayer({ isOpen, onClose, filePath, title, isAudio = false }: MediaPlayerProps) {
    const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showControls, setShowControls] = useState(true);
    const [hasRetriedTranscode, setHasRetriedTranscode] = useState(false);
    const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [mediaSrc, setMediaSrc] = useState<string>('');

    // Reset state and load media when file changes
    useEffect(() => {
        if (isOpen && filePath) {
            setIsPlaying(false);
            setProgress(0);
            setCurrentTime(0);
            setDuration(0);
            setIsLoading(true);
            setError(null);
            setHasRetriedTranscode(false);

            // Use the robust media server URL which handles special characters and Range requests better
            api.getMediaStreamUrl(filePath)
                .then(url => {
                    console.log('[MediaPlayer] Using stream URL:', url);
                    setMediaSrc(url);
                })
                .catch(err => {
                    console.error('[MediaPlayer] Failed to get stream URL, falling back:', err);
                    setMediaSrc(convertFileSrc(filePath));
                });
        }
    }, [isOpen, filePath]);

    // Handle keyboard shortcuts
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (isFullscreen) {
                    document.exitFullscreen();
                } else {
                    onClose();
                }
            } else if (e.key === ' ' || e.key === 'k') {
                e.preventDefault();
                togglePlay();
            } else if (e.key === 'm') {
                toggleMute();
            } else if (e.key === 'f') {
                toggleFullscreen();
            } else if (e.key === 'ArrowLeft') {
                skip(-10);
            } else if (e.key === 'ArrowRight') {
                skip(10);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, isFullscreen, isPlaying]);

    // Auto-hide controls
    useEffect(() => {
        if (!isAudio && isPlaying) {
            controlsTimeoutRef.current = setTimeout(() => {
                setShowControls(false);
            }, 3000);
        }

        return () => {
            if (controlsTimeoutRef.current) {
                clearTimeout(controlsTimeoutRef.current);
            }
        };
    }, [isPlaying, showControls, isAudio]);

    const togglePlay = () => {
        if (mediaRef.current) {
            if (isPlaying) {
                mediaRef.current.pause();
            } else {
                mediaRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const toggleMute = () => {
        if (mediaRef.current) {
            mediaRef.current.muted = !isMuted;
            setIsMuted(!isMuted);
        }
    };

    const toggleFullscreen = async () => {
        if (!containerRef.current) return;

        if (!isFullscreen) {
            await containerRef.current.requestFullscreen();
            setIsFullscreen(true);
        } else {
            await document.exitFullscreen();
            setIsFullscreen(false);
        }
    };

    const skip = (seconds: number) => {
        if (mediaRef.current) {
            mediaRef.current.currentTime += seconds;
        }
    };

    const handleTimeUpdate = () => {
        if (mediaRef.current) {
            const current = mediaRef.current.currentTime;
            const dur = mediaRef.current.duration;
            setCurrentTime(current);
            setProgress((current / dur) * 100);
        }
    };

    const handleLoadedMetadata = () => {
        if (mediaRef.current) {
            setDuration(mediaRef.current.duration);
            setIsLoading(false);
        }
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!mediaRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        mediaRef.current.currentTime = pos * duration;
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        setVolume(val);
        if (mediaRef.current) {
            mediaRef.current.volume = val;
        }
    };

    const handleError = async () => {
        if (!isAudio && !hasRetriedTranscode && filePath) {
            setHasRetriedTranscode(true);
            setIsLoading(true);
            setError(null);

            try {
                const result = await api.transcodeForPlayback(filePath, true);
                const retryPath = result.output_path;

                const retryUrl = await api.getMediaStreamUrl(retryPath)
                    .catch(() => convertFileSrc(retryPath));

                console.log('[MediaPlayer] Retrying playback with transcoded media:', retryPath);
                setMediaSrc(retryUrl);
                return;
            } catch (retryErr) {
                console.error('[MediaPlayer] Transcode retry failed:', retryErr);
            }
        }

        setError('Failed to load media file. The file may be corrupted or in an unsupported format.');
        setIsLoading(false);
    };

    const handleMouseMove = () => {
        setShowControls(true);
        if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current);
        }
        if (!isAudio && isPlaying) {
            controlsTimeoutRef.current = setTimeout(() => {
                setShowControls(false);
            }, 3000);
        }
    };

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const modalContent = (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[9999]">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/90 backdrop-blur-sm"
                    />

                    {/* Player Container */}
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                        <motion.div
                            ref={containerRef}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className={cn(
                                "relative bg-black rounded-2xl overflow-hidden shadow-2xl",
                                isFullscreen ? "w-full h-full rounded-none" : "w-full max-w-4xl",
                                isAudio && "max-w-lg"
                            )}
                            onClick={(e) => e.stopPropagation()}
                            onMouseMove={handleMouseMove}
                        >
                            {/* Close Button */}
                            <button
                                onClick={onClose}
                                aria-label="Close"
                                className={cn(
                                    "absolute top-4 right-4 z-50 p-2 rounded-full bg-black/50 hover:bg-black/70 transition-all",
                                    !showControls && !isAudio && "opacity-0"
                                )}
                            >
                                <X className="w-6 h-6 text-white" />
                            </button>

                            {/* Title */}
                            <div className={cn(
                                "absolute top-4 left-4 right-16 z-40 transition-opacity",
                                !showControls && !isAudio && "opacity-0"
                            )}>
                                <h2 className="text-white font-semibold truncate text-lg drop-shadow-lg">
                                    {title}
                                </h2>
                            </div>

                            {/* Media Element */}
                            {isAudio ? (
                                <div className="p-8 pt-16">
                                    {/* Audio visualization placeholder */}
                                    <div className="w-48 h-48 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-white/20 to-white/5 flex items-center justify-center">
                                        <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center">
                                            {isPlaying ? (
                                                <div className="flex items-center gap-1">
                                                    {[...Array(4)].map((_, i) => (
                                                        <motion.div
                                                            key={i}
                                                            className="w-1 bg-white rounded-full"
                                                            animate={{
                                                                height: [12, 24, 12],
                                                            }}
                                                            transition={{
                                                                duration: 0.5,
                                                                repeat: Infinity,
                                                                delay: i * 0.1,
                                                            }}
                                                        />
                                                    ))}
                                                </div>
                                            ) : (
                                                <Play className="w-12 h-12 text-white" />
                                            )}
                                        </div>
                                    </div>
                                    <audio
                                        ref={mediaRef as React.RefObject<HTMLAudioElement>}
                                        src={mediaSrc}
                                        onTimeUpdate={handleTimeUpdate}
                                        onLoadedMetadata={handleLoadedMetadata}
                                        onError={handleError}
                                        onEnded={() => setIsPlaying(false)}
                                    />
                                </div>
                            ) : (
                                <div className="aspect-video bg-black flex items-center justify-center">
                                    {isLoading && !error && (
                                        <Loader2 className="w-12 h-12 text-white animate-spin" />
                                    )}
                                    {error && (
                                        <div className="text-white/50 text-center p-8">
                                            <p>{error}</p>
                                        </div>
                                    )}
                                    <video
                                        ref={mediaRef as React.RefObject<HTMLVideoElement>}
                                        src={mediaSrc}
                                        className={cn("w-full h-full", isLoading && "hidden")}
                                        onTimeUpdate={handleTimeUpdate}
                                        onLoadedMetadata={handleLoadedMetadata}
                                        onError={handleError}
                                        onEnded={() => setIsPlaying(false)}
                                        onClick={togglePlay}
                                    />
                                </div>
                            )}

                            {/* Play/Pause Overlay for Video */}
                            {!isAudio && !isLoading && !error && (
                                <div
                                    className={cn(
                                        "absolute inset-0 flex items-center justify-center transition-opacity cursor-pointer",
                                        isPlaying && showControls ? "opacity-0" : "opacity-100"
                                    )}
                                    onClick={togglePlay}
                                >
                                    {!isPlaying && (
                                        <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                            <Play className="w-10 h-10 text-white ml-1" />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Controls */}
                            <div className={cn(
                                "absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent transition-opacity",
                                !showControls && !isAudio && isPlaying && "opacity-0"
                            )}>
                                {/* Progress Bar */}
                                <div
                                    className="w-full h-1 bg-white/20 rounded-full mb-4 cursor-pointer group"
                                    onClick={handleSeek}
                                >
                                    <div
                                        className="h-full bg-white rounded-full relative"
                                        style={{ width: `${progress}%` }}
                                    >
                                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                </div>

                                {/* Control Buttons */}
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        {/* Play/Pause */}
                                        <button
                                            onClick={togglePlay}
                                            aria-label={isPlaying ? "Pause" : "Play"}
                                            className="p-2 hover:bg-white/10 rounded-full transition-colors"
                                        >
                                            {isPlaying ? (
                                                <Pause className="w-6 h-6 text-white" />
                                            ) : (
                                                <Play className="w-6 h-6 text-white ml-0.5" />
                                            )}
                                        </button>

                                        {/* Skip Buttons */}
                                        <button
                                            onClick={() => skip(-10)}
                                            aria-label="Skip back 10 seconds"
                                            className="p-2 hover:bg-white/10 rounded-full transition-colors"
                                            title="Skip back 10s"
                                        >
                                            <SkipBack className="w-5 h-5 text-white" />
                                        </button>
                                        <button
                                            onClick={() => skip(10)}
                                            aria-label="Skip forward 10 seconds"
                                            className="p-2 hover:bg-white/10 rounded-full transition-colors"
                                            title="Skip forward 10s"
                                        >
                                            <SkipForward className="w-5 h-5 text-white" />
                                        </button>

                                        {/* Volume */}
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={toggleMute}
                                                aria-label={isMuted || volume === 0 ? "Unmute" : "Mute"}
                                                className="p-2 hover:bg-white/10 rounded-full transition-colors"
                                            >
                                                {isMuted || volume === 0 ? (
                                                    <VolumeX className="w-5 h-5 text-white" />
                                                ) : (
                                                    <Volume2 className="w-5 h-5 text-white" />
                                                )}
                                            </button>
                                            <input
                                                type="range"
                                                min="0"
                                                max="1"
                                                step="0.1"
                                                value={volume}
                                                onChange={handleVolumeChange}
                                                aria-label="Volume"
                                                className="w-20 accent-white"
                                            />
                                        </div>

                                        {/* Time Display */}
                                        <span className="text-white text-sm">
                                            {formatTime(currentTime)} / {formatTime(duration)}
                                        </span>
                                    </div>

                                    {/* Right Controls */}
                                    {!isAudio && (
                                        <button
                                            onClick={toggleFullscreen}
                                            aria-label={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                                            className="p-2 hover:bg-white/10 rounded-full transition-colors"
                                        >
                                            {isFullscreen ? (
                                                <Minimize className="w-5 h-5 text-white" />
                                            ) : (
                                                <Maximize className="w-5 h-5 text-white" />
                                            )}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </div>
            )}
        </AnimatePresence>
    );

    if (typeof document !== 'undefined') {
        return createPortal(modalContent, document.body);
    }

    return modalContent;
}
