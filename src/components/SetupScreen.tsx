import { useState, useEffect, useCallback, useRef } from 'react';
import { m } from 'framer-motion';
import { Loader2, CheckCircle, AlertCircle, Download, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { staggerContainer, staggerItem, fadeInUp } from '@/lib/animations';
import api, { SetupProgress } from '@/services/api';

type SetupState = 'checking' | 'downloading' | 'complete' | 'error';

interface BinaryStatus {
    name: string;
    label: string;
    phase: string;
    progress: number;
    error?: string | null;
    done: boolean;
}

export function SetupScreen({ onComplete }: { onComplete: () => void }) {
    const [state, setState] = useState<SetupState>('checking');
    const [binaries, setBinaries] = useState<Record<string, BinaryStatus>>({
        'yt-dlp': { name: 'yt-dlp', label: 'yt-dlp (Media Downloader)', phase: 'pending', progress: 0, done: false },
        'ffmpeg': { name: 'ffmpeg', label: 'ffmpeg (Video Processing)', phase: 'pending', progress: 0, done: false },
    });
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const unlistenRef = useRef<(() => void) | null>(null);

    const startSetup = useCallback(async () => {
        setState('downloading');
        setErrorMessage(null);

        setBinaries(prev => {
            const next = { ...prev };
            for (const key of Object.keys(next)) {
                next[key] = { ...next[key], phase: 'pending', progress: 0, error: null, done: false };
            }
            return next;
        });

        try {
            await api.setupDownloadBinaries();
            setState('complete');
            setTimeout(onComplete, 1500);
        } catch (err) {
            setState('error');
            setErrorMessage(String(err));
        }
    }, [onComplete]);

    useEffect(() => {
        api.onSetupProgress((progress: SetupProgress) => {
            if (progress.binary === 'done' && progress.phase === 'complete') {
                setState('complete');
                setTimeout(onComplete, 1500);
                return;
            }

            setBinaries(prev => {
                const existing = prev[progress.binary];
                if (!existing) return prev;
                return {
                    ...prev,
                    [progress.binary]: {
                        ...existing,
                        phase: progress.phase,
                        progress: progress.progress,
                        error: progress.error,
                        done: progress.phase === 'complete',
                    },
                };
            });
        }).then(fn => { unlistenRef.current = fn; });

        const timer = setTimeout(startSetup, 500);
        return () => {
            clearTimeout(timer);
            if (unlistenRef.current) unlistenRef.current();
        };
    }, [startSetup, onComplete]);

    const overallProgress = Object.values(binaries).reduce(
        (sum, b) => sum + (b.done ? 100 : b.progress), 0
    ) / Object.keys(binaries).length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
            <m.div
                variants={staggerContainer}
                initial="initial"
                animate="animate"
                className="w-full max-w-md mx-4"
            >
                {/* Logo / Title */}
                <m.div variants={fadeInUp} className="text-center mb-10">
                    <div className="size-16 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mx-auto mb-4">
                        <Download className="size-8 text-primary" />
                    </div>
                    <h1 className="text-2xl font-display font-bold mb-2">
                        Setting up SlasshyDownloader
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        Downloading required components. This only happens once.
                    </p>
                </m.div>

                {/* Binary progress list */}
                <m.div variants={staggerContainer} className="space-y-4 mb-8">
                    {Object.values(binaries).map((binary) => (
                        <m.div
                            key={binary.name}
                            variants={staggerItem}
                            className="glass rounded-xl p-4"
                        >
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-3">
                                    {binary.done ? (
                                        <CheckCircle className="size-5 text-green-400" />
                                    ) : binary.phase === 'error' ? (
                                        <AlertCircle className="size-5 text-red-400" />
                                    ) : binary.phase === 'downloading' || binary.phase === 'extracting' ? (
                                        <Loader2 className="size-5 text-primary animate-spin" />
                                    ) : (
                                        <div className="size-5 rounded-full border border-white/20" />
                                    )}
                                    <span className="text-sm font-medium">{binary.label}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                    {binary.done ? 'Ready' : binary.phase === 'error' ? 'Failed' : binary.phase === 'downloading' ? `${binary.progress.toFixed(0)}%` : binary.phase === 'extracting' ? 'Extracting...' : 'Waiting'}
                                </span>
                            </div>

                            {/* Progress bar */}
                            {!binary.done && binary.phase !== 'error' && (
                                <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
                                    <m.div
                                        className={cn(
                                            "h-full rounded-full progress-shimmer",
                                            binary.phase === 'extracting'
                                                ? "bg-amber-400 animate-pulse"
                                                : "bg-gradient-to-r from-primary to-accent"
                                        )}
                                        initial={{ width: 0 }}
                                        animate={{ width: `${binary.progress}%` }}
                                        transition={{ type: 'tween', duration: 0.3, ease: 'easeOut' }}
                                    />
                                </div>
                            )}

                            {/* Error message */}
                            {binary.phase === 'error' && binary.error && (
                                <p className="text-xs text-red-400 mt-2">{binary.error}</p>
                            )}
                        </m.div>
                    ))}
                </m.div>

                {/* Overall progress bar */}
                {state === 'downloading' && (
                    <m.div variants={fadeInUp} className="mb-6">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                            <span>Overall progress</span>
                            <span>{overallProgress.toFixed(0)}%</span>
                        </div>
                        <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                            <m.div
                                className="h-full bg-gradient-to-r from-primary to-accent rounded-full progress-shimmer"
                                initial={{ width: 0 }}
                                animate={{ width: `${overallProgress}%` }}
                                transition={{ type: 'tween', duration: 0.3, ease: 'easeOut' }}
                            />
                        </div>
                    </m.div>
                )}

                {/* Error state with retry */}
                {state === 'error' && (
                    <m.div variants={fadeInUp} className="text-center">
                        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
                            <AlertCircle className="size-5 text-red-400 mx-auto mb-2" />
                            <p className="text-sm text-red-400">{errorMessage || 'Setup failed'}</p>
                        </div>
                        <button
                            onClick={startSetup}
                            className="btn-neon text-sm py-2 px-6 flex items-center gap-2 mx-auto"
                        >
                            <RefreshCw className="size-4" />
                            Retry
                        </button>
                    </m.div>
                )}

                {/* Complete state */}
                {state === 'complete' && (
                    <m.div
                        variants={fadeInUp}
                        className="text-center"
                    >
                        <m.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                        >
                            <CheckCircle className="size-12 text-green-400 mx-auto mb-3" />
                        </m.div>
                        <p className="text-lg font-semibold">Ready!</p>
                        <p className="text-sm text-muted-foreground">Launching app...</p>
                    </m.div>
                )}
            </m.div>
        </div>
    );
}
