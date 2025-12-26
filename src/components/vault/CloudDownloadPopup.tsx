/**
 * Cloud Download Popup Component
 * 
 * Displays when a vault file needs to be downloaded from cloud storage.
 * Shows progress, speed, and allows cancellation.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Cloud, Download, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CloudDownloadPopupProps {
    isOpen: boolean;
    fileName: string;
    fileSize: number;
    progress: number; // 0-100
    downloadedBytes: number;
    downloadSpeed: number; // bytes/sec
    status: 'downloading' | 'completed' | 'failed' | 'cancelled';
    onCancel: () => void;
    onRetry?: () => void;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec: number): string {
    if (bytesPerSec === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function CloudDownloadPopup({
    isOpen,
    fileName,
    fileSize,
    progress,
    downloadedBytes,
    downloadSpeed,
    status,
    onCancel,
    onRetry
}: CloudDownloadPopupProps) {
    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                        onClick={status === 'downloading' ? undefined : onCancel}
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        transition={{ type: 'spring', duration: 0.5 }}
                        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                                   w-[420px] max-w-[90vw] bg-card border border-white/10 rounded-2xl
                                   shadow-2xl overflow-hidden"
                    >
                        {/* Header */}
                        <div className="bg-gradient-to-r from-primary/20 to-accent/20 px-6 py-4 border-b border-white/10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                                    <Cloud className="w-5 h-5 text-primary" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-lg">Cloud Sync</h3>
                                    <p className="text-sm text-muted-foreground">File not found locally</p>
                                </div>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-5">
                            {/* File name */}
                            <div className="text-center">
                                <p className="text-sm text-muted-foreground mb-1">Downloading</p>
                                <p className="font-medium text-lg truncate" title={fileName}>
                                    "{fileName}"
                                </p>
                            </div>

                            {/* Progress section */}
                            {status === 'downloading' && (
                                <>
                                    {/* Progress bar */}
                                    <div className="relative h-3 bg-muted/50 rounded-full overflow-hidden">
                                        <motion.div
                                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-accent rounded-full"
                                            initial={{ width: 0 }}
                                            animate={{ width: `${progress}%` }}
                                            transition={{ duration: 0.3, ease: 'easeOut' }}
                                        />
                                        {/* Shimmer effect */}
                                        <motion.div
                                            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                                            animate={{ x: ['-100%', '100%'] }}
                                            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                                        />
                                    </div>

                                    {/* Stats */}
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">
                                            {formatBytes(downloadedBytes)} / {formatBytes(fileSize)}
                                        </span>
                                        <span className="font-medium text-primary">
                                            {formatSpeed(downloadSpeed)}
                                        </span>
                                    </div>

                                    {/* Percentage */}
                                    <div className="text-center">
                                        <span className="text-3xl font-bold">{Math.round(progress)}%</span>
                                    </div>
                                </>
                            )}

                            {/* Completed state */}
                            {status === 'completed' && (
                                <div className="text-center py-4">
                                    <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
                                        <Download className="w-8 h-8 text-green-400" />
                                    </div>
                                    <p className="text-green-400 font-medium">Download Complete!</p>
                                </div>
                            )}

                            {/* Failed state */}
                            {status === 'failed' && (
                                <div className="text-center py-4">
                                    <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-3">
                                        <X className="w-8 h-8 text-red-400" />
                                    </div>
                                    <p className="text-red-400 font-medium">Download Failed</p>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        Please check your internet connection
                                    </p>
                                </div>
                            )}

                            {/* Cancelled state */}
                            {status === 'cancelled' && (
                                <div className="text-center py-4">
                                    <div className="w-16 h-16 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto mb-3">
                                        <X className="w-8 h-8 text-yellow-400" />
                                    </div>
                                    <p className="text-yellow-400 font-medium">Download Cancelled</p>
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="px-6 pb-6 flex gap-3">
                            {status === 'downloading' && (
                                <button
                                    onClick={onCancel}
                                    className={cn(
                                        'flex-1 py-3 rounded-xl font-medium transition-all',
                                        'border border-red-500/30 text-red-400 hover:bg-red-500/10',
                                        'flex items-center justify-center gap-2'
                                    )}
                                >
                                    <X className="w-4 h-4" />
                                    Cancel Download
                                </button>
                            )}

                            {status === 'failed' && onRetry && (
                                <button
                                    onClick={onRetry}
                                    className={cn(
                                        'flex-1 py-3 rounded-xl font-medium transition-all',
                                        'bg-gradient-to-r from-primary to-accent text-white',
                                        'hover:opacity-90',
                                        'flex items-center justify-center gap-2'
                                    )}
                                >
                                    <Download className="w-4 h-4" />
                                    Retry Download
                                </button>
                            )}

                            {(status === 'completed' || status === 'cancelled' || status === 'failed') && (
                                <button
                                    onClick={onCancel}
                                    className={cn(
                                        'flex-1 py-3 rounded-xl font-medium transition-all',
                                        'bg-muted/50 hover:bg-muted',
                                        'flex items-center justify-center gap-2'
                                    )}
                                >
                                    Close
                                </button>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

export default CloudDownloadPopup;
