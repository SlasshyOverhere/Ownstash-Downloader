import { useState, useEffect, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Copy } from 'lucide-react';

export function TitleBar() {
    const [isMaximized, setIsMaximized] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const win = getCurrentWindow();

    // Remove native decorations after window is fully loaded
    useEffect(() => {
        const timer = setTimeout(() => {
            win.setDecorations(false).then(() => {
                setIsReady(true);
            }).catch((err) => {
                console.warn('[TitleBar] Failed to set decorations:', err);
                setIsReady(true); // Show titlebar anyway
            });
        }, 500); // Small delay to let WebView2 fully initialize
        return () => clearTimeout(timer);
    }, [win]);

    useEffect(() => {
        const unlisten = win.onResized(() => {
            win.isMaximized().then(setIsMaximized).catch(() => {});
        });
        return () => { unlisten.then(fn => fn()); };
    }, [win]);

    // Fallback: start dragging on mousedown
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button')) return;
        if (e.button !== 0) return;
        win.startDragging().catch(() => {});
    }, [win]);

    const handleMinimize = () => win.minimize().catch(() => {});
    const handleMaximize = () => win.toggleMaximize().catch(() => {});
    const handleClose = () => win.close().catch(() => {});

    // Don't render until decorations are removed (prevents double titlebar flash)
    if (!isReady) return null;

    return (
        <div
            data-tauri-drag-region
            onMouseDown={handleMouseDown}
            className="h-9 flex items-center select-none shrink-0 bg-background/80 border-b border-white/5"
        >
            {/* Left: App title */}
            <div className="flex items-center gap-2 px-3 pointer-events-none">
                <span className="text-xs font-medium text-muted-foreground tracking-wide">
                    SlasshyDownloader
                </span>
            </div>

            {/* Center: drag region */}
            <div className="flex-1 h-full" data-tauri-drag-region />

            {/* Right: Window controls */}
            <div className="flex h-full">
                <button
                    onClick={handleMinimize}
                    className="h-full w-12 flex items-center justify-center hover:bg-white/10 transition-colors"
                    aria-label="Minimize"
                >
                    <Minus className="size-3.5 text-muted-foreground" />
                </button>
                <button
                    onClick={handleMaximize}
                    className="h-full w-12 flex items-center justify-center hover:bg-white/10 transition-colors"
                    aria-label={isMaximized ? 'Restore' : 'Maximize'}
                >
                    {isMaximized ? (
                        <Copy className="size-3 text-muted-foreground" />
                    ) : (
                        <Square className="size-3 text-muted-foreground" />
                    )}
                </button>
                <button
                    onClick={handleClose}
                    className="h-full w-12 flex items-center justify-center hover:bg-red-500/80 hover:text-white transition-colors group"
                    aria-label="Close"
                >
                    <X className="size-3.5 text-muted-foreground group-hover:text-white" />
                </button>
            </div>
        </div>
    );
}
