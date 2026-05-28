import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Smooths a stream of numeric values using EMA, rendering at a controlled cadence.
 * Events update a ref at high frequency; RAF pushes to state at display cadence.
 */
export function useSmoothedValue(
    rawValue: number | null | undefined,
    options: {
        alpha?: number;
        enabled?: boolean;
    } = {}
): { value: number; reset: () => void } {
    const { alpha = 0.15, enabled = true } = options;
    const smoothedRef = useRef<number>(0);
    const hasValueRef = useRef(false);
    const [displayValue, setDisplayValue] = useState<number>(0);

    // Update smoothed value on each raw input
    useEffect(() => {
        if (!enabled || rawValue == null || rawValue === 0) return;

        if (!hasValueRef.current) {
            // First value: initialize directly
            smoothedRef.current = rawValue;
            hasValueRef.current = true;
        } else {
            // EMA update
            smoothedRef.current = alpha * rawValue + (1 - alpha) * smoothedRef.current;
        }
    }, [rawValue, alpha, enabled]);

    // Push to display at RAF cadence (~60fps, but effectively throttled by React)
    useEffect(() => {
        if (!enabled) return;

        let rafId: number;
        const tick = () => {
            if (hasValueRef.current) {
                setDisplayValue(smoothedRef.current);
            }
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);

        return () => cancelAnimationFrame(rafId);
    }, [enabled]);

    const reset = useCallback(() => {
        smoothedRef.current = 0;
        hasValueRef.current = false;
        setDisplayValue(0);
    }, []);

    return { value: displayValue, reset };
}

/**
 * Parses a speed string like "10.5 MiB/s" or "500 KB/s" to bytes per second.
 */
export function parseSpeedString(speed: string): number | null {
    if (!speed || speed === 'Stalled' || speed === 'Merging...') return null;

    const match = speed.match(/([\d.]+)\s*(B|KB|KiB|MB|MiB|GB|GiB)\/s/i);
    if (!match) return null;

    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    const multipliers: Record<string, number> = {
        'b': 1,
        'kb': 1000,
        'kib': 1024,
        'mb': 1_000_000,
        'mib': 1_048_576,
        'gb': 1_000_000_000,
        'gib': 1_073_741_824,
    };

    return value * (multipliers[unit] ?? 1);
}

/**
 * Formats bytes per second to a human-readable speed string.
 */
export function formatSpeedBps(bps: number): string {
    if (bps <= 0) return '';

    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;

    if (bps >= GB) return `${(bps / GB).toFixed(2)} GB/s`;
    if (bps >= MB) return `${(bps / MB).toFixed(1)} MB/s`;
    if (bps >= KB) return `${(bps / KB).toFixed(0)} KB/s`;
    return `${Math.round(bps)} B/s`;
}
