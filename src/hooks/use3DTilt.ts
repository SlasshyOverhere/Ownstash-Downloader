import { useRef, useState, useCallback, MouseEvent } from 'react';

interface TiltState {
    rotateX: number;
    rotateY: number;
    scale: number;
}

interface Use3DTiltOptions {
    maxTilt?: number;
    scale?: number;
    perspective?: number;
    speed?: number;
}

export function use3DTilt(options: Use3DTiltOptions = {}) {
    const {
        maxTilt = 15,
        scale = 1.02,
        perspective = 1000,
        speed = 500,
    } = options;

    const ref = useRef<HTMLDivElement>(null);
    const animationFrameRef = useRef<number | null>(null);
    const latestTiltRef = useRef<TiltState>({ rotateX: 0, rotateY: 0, scale: 1 });
    const [tilt, setTilt] = useState<TiltState>({ rotateX: 0, rotateY: 0, scale: 1 });

    const scheduleTiltUpdate = useCallback((nextTilt: TiltState) => {
        latestTiltRef.current = nextTilt;

        if (animationFrameRef.current !== null) {
            return;
        }

        animationFrameRef.current = requestAnimationFrame(() => {
            animationFrameRef.current = null;
            setTilt(latestTiltRef.current);
        });
    }, []);

    const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
        if (!ref.current) return;

        const rect = ref.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const mouseX = e.clientX - centerX;
        const mouseY = e.clientY - centerY;

        const rotateX = (mouseY / (rect.height / 2)) * -maxTilt;
        const rotateY = (mouseX / (rect.width / 2)) * maxTilt;

        const nextTilt = { rotateX, rotateY, scale };
        const currentTilt = latestTiltRef.current;
        const deltaX = Math.abs(nextTilt.rotateX - currentTilt.rotateX);
        const deltaY = Math.abs(nextTilt.rotateY - currentTilt.rotateY);

        if (deltaX < 0.1 && deltaY < 0.1 && currentTilt.scale === nextTilt.scale) {
            return;
        }

        scheduleTiltUpdate(nextTilt);
    }, [maxTilt, scale, scheduleTiltUpdate]);

    const handleMouseEnter = useCallback(() => {
        scheduleTiltUpdate({ ...latestTiltRef.current, scale });
    }, [scale, scheduleTiltUpdate]);

    const handleMouseLeave = useCallback(() => {
        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        const resetTilt = { rotateX: 0, rotateY: 0, scale: 1 };
        latestTiltRef.current = resetTilt;
        setTilt(resetTilt);
    }, []);

    const tiltStyle = {
        transform: `perspective(${perspective}px) rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg) scale(${tilt.scale})`,
        transition: `transform ${speed}ms cubic-bezier(0.03, 0.98, 0.52, 0.99)`,
    };

    return {
        ref,
        tiltStyle,
        handlers: {
            onMouseMove: handleMouseMove,
            onMouseEnter: handleMouseEnter,
            onMouseLeave: handleMouseLeave,
        },
    };
}
