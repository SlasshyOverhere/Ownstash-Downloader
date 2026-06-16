import { useState, useEffect, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Copy } from 'lucide-react';

export function TitleBar() {
    const [isMaximized, setIsMaximized] = useState(false);
    const win = getCurrentWindow();

    const refreshWindowState = useCallback(async () => {
        try {
            setIsMaximized(await win.isMaximized());
        } catch {}
    }, [win]);

    useEffect(() => {
        let unlisten: (() => void) | null = null;
        const setup = async () => {
            await refreshWindowState();
            const fn = await win.onResized(async () => {
                await refreshWindowState();
            });
            unlisten = () => fn();
        };
        setup();
        return () => { unlisten?.(); };
    }, [refreshWindowState]);

    useEffect(() => {
        document.body.classList.toggle('app-window-maximized', isMaximized);
        return () => { document.body.classList.remove('app-window-maximized'); };
    }, [isMaximized]);

    // Start dragging on left-click in the drag area
    const handleDragMouseDown = useCallback(async (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        try {
            await win.startDragging();
        } catch {}
    }, [win]);

    return (
        <header className="fixed top-0 left-0 right-0 h-9 z-[220] border-b border-white/10 bg-background select-none">
            <div className="relative h-full w-full flex items-center justify-between">
                {/* Invisible top resize handle */}
                <div
                    onMouseDown={handleDragMouseDown}
                    className="absolute top-0 left-0 right-0 h-1.5 cursor-default"
                />

                {/* Drag region */}
                <div
                    onMouseDown={handleDragMouseDown}
                    onDoubleClick={async () => {
                        await win.toggleMaximize().catch(() => {});
                        await refreshWindowState();
                    }}
                    className="absolute left-0 top-1.5 bottom-0 right-[120px] cursor-default"
                />

                {/* Left: Logo + App name */}
                <div
                    onMouseDown={handleDragMouseDown}
                    className="flex items-center gap-2 pl-3"
                >
                    <img
                        src="/logo.png"
                        alt=""
                        draggable={false}
                        className="pointer-events-none size-4 object-contain"
                    />
                    <span className="pointer-events-none text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-400">
                        SlasshyDownloader
                    </span>
                </div>

                {/* Right: Window controls */}
                <div className="flex items-center h-full pr-1.5">
                    <button
                        type="button"
                        onClick={() => win.minimize().catch(() => {})}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="h-7 w-8 rounded-md border border-transparent text-neutral-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                        title="Minimize"
                        aria-label="Minimize window"
                    >
                        <Minus className="mx-auto size-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={async () => {
                            await win.toggleMaximize().catch(() => {});
                            await refreshWindowState();
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="h-7 w-8 rounded-md border border-transparent text-neutral-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                        title={isMaximized ? 'Restore' : 'Maximize'}
                        aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
                    >
                        {isMaximized ? (
                            <Copy className="mx-auto size-3" />
                        ) : (
                            <Square className="mx-auto size-3" />
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={async () => { await win.close().catch(() => {}); }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="h-7 w-8 rounded-md border border-transparent text-neutral-400 transition-colors hover:border-rose-500/40 hover:bg-rose-500/20 hover:text-rose-200"
                        title="Close"
                        aria-label="Close window"
                    >
                        <X className="mx-auto size-3.5" />
                    </button>
                </div>
            </div>
        </header>
    );
}
