import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Download,
    Shield,
    X,
    Clock,
    Gauge,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Lock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import api, { VaultDownloadProgress, formatBytes } from '@/services/api';

interface ExtensionDownloadProgressProps {
    downloadId: string;
    filename: string;
    onComplete: () => void;
    onFailed: (error: string) => void;
}

export function ExtensionDownloadProgress({
    downloadId,
    filename,
    onComplete,
    onFailed
}: ExtensionDownloadProgressProps) {
    const [progress, setProgress] = useState<VaultDownloadProgress | null>(null);
    const [isMinimized, setIsMinimized] = useState(false);

    useEffect(() => {
        let unlisten: (() => void) | undefined;

        api.onVaultDownloadProgress((prog) => {
            if (prog.id === downloadId) {
                setProgress(prog);
                if (prog.status === 'completed') {
                    // Delay before calling onComplete to show success state
                    setTimeout(() => {
                        onComplete();
                    }, 2000);
                } else if (prog.status === 'failed' || prog.status === 'cancelled') {
                    onFailed(prog.status === 'cancelled' ? 'Download cancelled' : 'Download failed');
                }
            }
        }).then(fn => { unlisten = fn; });

        return () => {
            if (unlisten) unlisten();
        };
    }, [downloadId, onComplete, onFailed]);

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

    const getStatusIcon = () => {
        switch (progress?.status) {
            case 'preparing': return <Clock className="w-4 h-4" />;
            case 'downloading': return <Download className="w-4 h-4 animate-bounce" />;
            case 'encrypting': return <Shield className="w-4 h-4 animate-pulse" />;
            case 'completed': return <CheckCircle2 className="w-4 h-4" />;
            case 'failed':
            case 'cancelled': return <AlertCircle className="w-4 h-4" />;
            default: return <Loader2 className="w-4 h-4 animate-spin" />;
        }
    };

    const getStatusText = () => {
        switch (progress?.status) {
            case 'preparing': return 'Preparing...';
            case 'downloading': return 'Downloading...';
            case 'encrypting': return 'Encrypting...';
            case 'completed': return 'Complete!';
            case 'failed': return 'Failed';
            case 'cancelled': return 'Cancelled';
            default: return 'Starting...';
        }
    };

    const handleCancel = async () => {
        try {
            await api.vaultCancelDownload(downloadId);
        } catch (err) {
            console.error('[ExtensionDownload] Cancel failed:', err);
        }
    };

    if (isMinimized) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.8, y: 50 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="fixed bottom-4 right-4 z-50"
            >
                <button
                    onClick={() => setIsMinimized(false)}
                    className={cn(
                        "relative p-3 rounded-full shadow-lg transition-all",
                        "bg-gradient-to-br from-primary to-accent",
                        "hover:scale-110"
                    )}
                >
                    <Lock className="w-5 h-5 text-white" />
                    {/* Progress ring */}
                    <svg className="absolute inset-0 w-full h-full -rotate-90">
                        <circle
                            cx="50%"
                            cy="50%"
                            r="45%"
                            stroke="currentColor"
                            strokeWidth="3"
                            fill="none"
                            className="text-white/20"
                        />
                        <circle
                            cx="50%"
                            cy="50%"
                            r="45%"
                            stroke="currentColor"
                            strokeWidth="3"
                            fill="none"
                            strokeDasharray={`${(progress?.progress || 0) * 2.83} 283`}
                            className="text-white transition-all duration-300"
                        />
                    </svg>
                </button>
            </motion.div>
        );
    }

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: 50, x: 50 }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                exit={{ opacity: 0, y: 50, x: 50 }}
                className="fixed bottom-4 right-4 z-50 w-80"
            >
                <div className="bg-neutral-900/95 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between p-3 border-b border-white/10 bg-gradient-to-r from-primary/10 to-accent/10">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-lg bg-primary/20">
                                <Lock className="w-4 h-4 text-primary" />
                            </div>
                            <span className="text-sm font-medium">Vault Download</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setIsMinimized(true)}
                                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-muted-foreground hover:text-white"
                                title="Minimize"
                            >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                            </button>
                            {progress?.status !== 'completed' && (
                                <button
                                    onClick={handleCancel}
                                    className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors text-muted-foreground hover:text-red-400"
                                    title="Cancel"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-3 space-y-3">
                        {/* Filename */}
                        <div className="text-sm truncate text-muted-foreground" title={filename}>
                            {filename}
                        </div>

                        {/* Progress Bar */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                                <span className={cn("flex items-center gap-1.5", getStatusColor())}>
                                    {getStatusIcon()}
                                    {getStatusText()}
                                </span>
                                <span className="font-mono text-muted-foreground">
                                    {(progress?.progress || 0).toFixed(1)}%
                                </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${progress?.progress || 0}%` }}
                                    className={cn(
                                        "h-full transition-colors",
                                        progress?.status === 'encrypting'
                                            ? "bg-gradient-to-r from-purple-500 to-pink-500"
                                            : progress?.status === 'completed'
                                                ? "bg-gradient-to-r from-green-500 to-emerald-500"
                                                : "bg-gradient-to-r from-primary to-accent"
                                    )}
                                    transition={{ duration: 0.3 }}
                                />
                            </div>
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            {progress?.speed && (
                                <div className="flex items-center gap-1">
                                    <Gauge className="w-3 h-3" />
                                    <span className="font-mono">{progress.speed}</span>
                                </div>
                            )}
                            {progress?.eta && (
                                <div className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    <span className="font-mono">{progress.eta}</span>
                                </div>
                            )}
                            {progress?.downloaded_bytes && (
                                <div className="font-mono">
                                    {formatBytes(progress.downloaded_bytes)}
                                    {progress?.total_bytes && ` / ${formatBytes(progress.total_bytes)}`}
                                </div>
                            )}
                        </div>

                        {/* Completed message */}
                        {progress?.status === 'completed' && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs"
                            >
                                <CheckCircle2 className="w-4 h-4" />
                                <span>Securely encrypted to vault!</span>
                            </motion.div>
                        )}
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
