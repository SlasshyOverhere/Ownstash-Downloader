import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Download,
    X,
    Video,
    Music,
    FileDown,
    Trash2,
    RefreshCw,
    CheckCircle,
    AlertCircle,
    Loader2,
    FolderOpen
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { staggerContainer, staggerItem, fadeInUp } from '@/lib/animations';
import { use3DTilt } from '@/hooks/use3DTilt';
import { toast } from 'sonner';
import api, { Download as DownloadType, DownloadProgress, SpotifyDownloadProgress, formatBytes } from '@/services/api';

interface DownloadItem extends DownloadType {
    progress?: number;
    speed?: string;
    eta?: string;
}

const typeIcons = {
    video: Video,
    audio: Music,
    file: FileDown,
};

const statusColors: Record<string, string> = {
    downloading: 'text-white',
    paused: 'text-white/60',
    completed: 'text-white',
    failed: 'text-white/50',
    cancelled: 'text-white/40',
    pending: 'text-white/70',
};

interface DownloadCardProps {
    item: DownloadItem;
    onCancel: (id: string) => void;
    onDelete: (id: string) => void;
    onRetry?: (item: DownloadItem) => void;
    onOpenFolder?: (path: string, title: string, format: string) => void;
}

function DownloadCard({ item, onCancel, onDelete, onRetry, onOpenFolder }: DownloadCardProps) {
    const { ref, tiltStyle, handlers } = use3DTilt({ maxTilt: 5, scale: 1.01 });

    // Determine type based on format
    const getType = (): 'video' | 'audio' | 'file' => {
        const format = item.format?.toLowerCase() || '';
        if (format === 'mp3' || format.includes('audio')) return 'audio';
        return 'video';
    };

    const TypeIcon = typeIcons[getType()];
    const progress = item.progress || 0;
    const isActive = item.status === 'downloading' || item.status === 'paused';

    return (
        <motion.div
            ref={ref}
            style={tiltStyle}
            {...handlers}
            variants={staggerItem}
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -100, transition: { duration: 0.2 } }}
            className="glass-hover rounded-2xl p-4 border-glow"
        >
            <div className="flex items-start gap-4">
                {/* Thumbnail / Icon */}
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0 relative overflow-hidden">
                    {item.thumbnail ? (
                        <img
                            src={item.thumbnail}
                            alt={item.title}
                            className="w-full h-full object-cover z-10"
                        />
                    ) : (
                        <TypeIcon className="w-8 h-8 text-primary z-10" />
                    )}
                    {isActive && (
                        <motion.div
                            className="absolute inset-0 bg-gradient-to-t from-primary/30 to-transparent"
                            initial={{ height: 0 }}
                            animate={{ height: `${progress}%` }}
                            style={{ bottom: 0, top: 'auto' }}
                        />
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <h3 className="font-semibold truncate">{item.title}</h3>
                            <p className="text-sm text-muted-foreground">
                                {item.platform || 'Unknown'} • {item.format || 'Best'}
                                {item.size_bytes && ` • ${formatBytes(item.size_bytes)}`}
                            </p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                            {item.status === 'downloading' && (
                                <button
                                    onClick={() => onCancel(item.id)}
                                    className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                                    title="Cancel download"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                            {item.status === 'failed' && onRetry && (
                                <button
                                    onClick={() => onRetry(item)}
                                    className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                                    title="Retry download"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                </button>
                            )}
                            <button
                                onClick={() => onDelete(item.id)}
                                className="p-2 rounded-lg hover:bg-red-500/20 text-red-400 transition-colors"
                                title="Remove from list"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Progress bar */}
                    {isActive && (
                        <div className="mt-3">
                            <div className="flex items-center justify-between text-xs mb-1">
                                <span className={cn('capitalize flex items-center gap-1', statusColors[item.status])}>
                                    {item.status === 'downloading' && (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                    )}
                                    {item.status}
                                </span>
                                <div className="flex items-center gap-3 text-muted-foreground">
                                    {item.speed && <span>{item.speed}</span>}
                                    {item.eta && <span>ETA: {item.eta}</span>}
                                    <span>{progress.toFixed(1)}%</span>
                                </div>
                            </div>
                            <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                                <motion.div
                                    className="h-full bg-gradient-to-r from-primary to-accent rounded-full progress-shimmer"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${progress}%` }}
                                    transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Completed indicator */}
                    {item.status === 'completed' && (
                        <div className="mt-2 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-white text-sm">
                                <CheckCircle className="w-4 h-4" />
                                <span>Download complete</span>
                            </div>
                            {onOpenFolder && item.path && (
                                <button
                                    onClick={() => onOpenFolder(item.path, item.title, item.format || 'mp4')}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium transition-colors"
                                    title="Open download folder"
                                >
                                    <FolderOpen className="w-4 h-4" />
                                    <span>Open Folder</span>
                                </button>
                            )}
                        </div>
                    )}

                    {/* Failed indicator */}
                    {item.status === 'failed' && (
                        <div className="mt-2 flex items-center gap-2 text-white/50 text-sm">
                            <AlertCircle className="w-4 h-4" />
                            <span>Download failed</span>
                        </div>
                    )}

                    {/* Cancelled indicator */}
                    {item.status === 'cancelled' && (
                        <div className="mt-2 flex items-center gap-2 text-gray-400 text-sm">
                            <X className="w-4 h-4" />
                            <span>Cancelled</span>
                        </div>
                    )}

                    {/* Timestamp */}
                    <p className="text-xs text-muted-foreground mt-2">
                        {new Date(item.timestamp).toLocaleString()}
                    </p>
                </div>
            </div>
        </motion.div>
    );
}

export function DownloadsPage() {
    const [downloads, setDownloads] = useState<DownloadItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [progressMap, setProgressMap] = useState<Map<string, DownloadProgress>>(new Map());

    // Load downloads and set up progress listeners
    useEffect(() => {
        loadDownloads();

        // Set up yt-dlp progress listener
        let unlistenYtdlp: (() => void) | undefined;
        let unlistenSpotify: (() => void) | undefined;

        console.log('[DownloadsPage] Setting up progress listeners...');

        // yt-dlp progress listener
        api.onDownloadProgress((progress) => {
            console.log('[DownloadsPage] yt-dlp Progress event received:', progress);

            setProgressMap(prev => {
                const newMap = new Map(prev);
                newMap.set(progress.id, progress);
                return newMap;
            });

            // Update download status in database if completed or failed
            if (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'cancelled') {
                console.log(`[DownloadsPage] Download ${progress.id} status changed to: ${progress.status}`);
                api.updateDownloadStatus(progress.id, progress.status);
                // Refresh downloads list
                setTimeout(loadDownloads, 500);
            }
        }).then(fn => {
            console.log('[DownloadsPage] yt-dlp Progress listener registered successfully');
            unlistenYtdlp = fn;
        }).catch(err => {
            console.error('[DownloadsPage] Failed to set up yt-dlp progress listener:', err);
        });

        // Spotify progress listener
        api.onSpotifyDownloadProgress((progress: SpotifyDownloadProgress) => {
            console.log('[DownloadsPage] Spotify Progress event received:', progress);

            // Convert SpotifyDownloadProgress to DownloadProgress format
            setProgressMap(prev => {
                const newMap = new Map(prev);
                newMap.set(progress.id, {
                    id: progress.id,
                    progress: progress.progress,
                    speed: progress.speed || (progress.current_track ? `Downloading: ${progress.current_track}` : ''),
                    eta: progress.total_tracks && progress.completed_tracks
                        ? `${progress.completed_tracks}/${progress.total_tracks} tracks`
                        : '',
                    status: progress.status,
                });
                return newMap;
            });

            // Update download status in database if completed or failed
            if (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'cancelled') {
                console.log(`[DownloadsPage] Spotify Download ${progress.id} status changed to: ${progress.status}`);
                api.updateDownloadStatus(progress.id, progress.status);
                // Refresh downloads list
                setTimeout(loadDownloads, 500);
            }
        }).then(fn => {
            console.log('[DownloadsPage] Spotify Progress listener registered successfully');
            unlistenSpotify = fn;
        }).catch(err => {
            console.error('[DownloadsPage] Failed to set up Spotify progress listener:', err);
        });

        return () => {
            console.log('[DownloadsPage] Cleaning up progress listeners');
            if (unlistenYtdlp) unlistenYtdlp();
            if (unlistenSpotify) unlistenSpotify();
        };
    }, []);

    const loadDownloads = async () => {
        try {
            setIsLoading(true);
            const data = await api.getDownloads();
            setDownloads(data);
        } catch (err) {
            toast.error('Failed to load downloads');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCancel = async (id: string) => {
        try {
            // Try to cancel yt-dlp download first
            try {
                await api.cancelDownload(id);
            } catch {
                // If yt-dlp cancel fails, try Spotify cancel
                await api.cancelSpotifyDownload(id);
            }
            toast.success('Download cancelled');
            await api.updateDownloadStatus(id, 'cancelled');
            loadDownloads();
        } catch (err) {
            toast.error('Failed to cancel download');
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.deleteDownload(id);
            setDownloads(prev => prev.filter(d => d.id !== id));
            toast.success('Download removed');
        } catch (err) {
            toast.error('Failed to remove download');
        }
    };

    const handleClearAll = async () => {
        try {
            await api.clearDownloads();
            setDownloads([]);
            toast.success('All downloads cleared');
        } catch (err) {
            toast.error('Failed to clear downloads');
        }
    };

    const handleOpenFolder = async (path: string, title: string, format: string) => {
        try {
            // Construct the likely filename from title and format
            // yt-dlp sanitizes titles, but we pass the original for matching
            const fileName = `${title}.${format}`;
            await api.openFolder(path, fileName);
        } catch (err) {
            toast.error('Failed to open folder');
        }
    };

    // Merge progress data with downloads
    const downloadsWithProgress: DownloadItem[] = downloads.map(download => {
        const progress = progressMap.get(download.id);
        if (progress) {
            return {
                ...download,
                progress: progress.progress,
                speed: progress.speed,
                eta: progress.eta,
                status: progress.status,
            };
        }
        return download;
    });

    const activeDownloads = downloadsWithProgress.filter(d =>
        d.status === 'downloading' || d.status === 'paused' || d.status === 'pending'
    );
    const completedDownloads = downloadsWithProgress.filter(d => d.status === 'completed');
    const failedDownloads = downloadsWithProgress.filter(d =>
        d.status === 'failed' || d.status === 'cancelled'
    );

    return (
        <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="max-w-4xl mx-auto space-y-8"
        >
            {/* Header */}
            <motion.div variants={fadeInUp} className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-display font-bold">Downloads</h1>
                    <p className="text-muted-foreground">Manage your active and completed downloads</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={loadDownloads}
                        className="px-4 py-2 rounded-xl glass-hover text-sm font-medium flex items-center gap-2"
                    >
                        <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
                        Refresh
                    </button>
                    {downloads.length > 0 && (
                        <button
                            onClick={handleClearAll}
                            className="px-4 py-2 rounded-xl glass-hover text-sm font-medium text-red-400"
                        >
                            Clear All
                        </button>
                    )}
                </div>
            </motion.div>

            {/* Loading state */}
            {isLoading && downloads.length === 0 && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            )}

            {/* Active Downloads */}
            {activeDownloads.length > 0 && (
                <motion.section variants={fadeInUp} className="space-y-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        Active Downloads
                        <span className="text-sm font-normal text-muted-foreground">
                            ({activeDownloads.length})
                        </span>
                    </h2>
                    <motion.div variants={staggerContainer} className="space-y-3">
                        <AnimatePresence mode="popLayout">
                            {activeDownloads.map(item => (
                                <DownloadCard
                                    key={item.id}
                                    item={item}
                                    onCancel={handleCancel}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </AnimatePresence>
                    </motion.div>
                </motion.section>
            )}

            {/* Completed Downloads */}
            {completedDownloads.length > 0 && (
                <motion.section variants={fadeInUp} className="space-y-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2 text-muted-foreground">
                        <CheckCircle className="w-4 h-4 text-white" />
                        Completed
                        <span className="text-sm font-normal">
                            ({completedDownloads.length})
                        </span>
                    </h2>
                    <motion.div variants={staggerContainer} className="space-y-3">
                        <AnimatePresence mode="popLayout">
                            {completedDownloads.map(item => (
                                <DownloadCard
                                    key={item.id}
                                    item={item}
                                    onCancel={handleCancel}
                                    onDelete={handleDelete}
                                    onOpenFolder={handleOpenFolder}
                                />
                            ))}
                        </AnimatePresence>
                    </motion.div>
                </motion.section>
            )}

            {/* Failed Downloads */}
            {failedDownloads.length > 0 && (
                <motion.section variants={fadeInUp} className="space-y-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2 text-muted-foreground">
                        <AlertCircle className="w-4 h-4 text-white/50" />
                        Failed / Cancelled
                        <span className="text-sm font-normal">
                            ({failedDownloads.length})
                        </span>
                    </h2>
                    <motion.div variants={staggerContainer} className="space-y-3">
                        <AnimatePresence mode="popLayout">
                            {failedDownloads.map(item => (
                                <DownloadCard
                                    key={item.id}
                                    item={item}
                                    onCancel={handleCancel}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </AnimatePresence>
                    </motion.div>
                </motion.section>
            )}

            {/* Empty state */}
            {!isLoading && downloads.length === 0 && (
                <motion.div
                    variants={fadeInUp}
                    className="flex flex-col items-center justify-center py-20 text-center"
                >
                    <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                        <Download className="w-10 h-10 text-muted-foreground" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">No downloads yet</h3>
                    <p className="text-muted-foreground max-w-sm">
                        Paste a URL on the home page to start downloading your favorite content.
                    </p>
                </motion.div>
            )}
        </motion.div>
    );
}
