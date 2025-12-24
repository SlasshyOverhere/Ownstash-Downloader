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
    const [tilt, setTilt] = useState<TiltState>({ rotateX: 0, rotateY: 0, scale: 1 });

    const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
        if (!ref.current) return;

        const rect = ref.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const mouseX = e.clientX - centerX;
        const mouseY = e.clientY - centerY;

        const rotateX = (mouseY / (rect.height / 2)) * -maxTilt;
        const rotateY = (mouseX / (rect.width / 2)) * maxTilt;

        setTilt({ rotateX, rotateY, scale });
    }, [maxTilt, scale]);

    const handleMouseEnter = useCallback(() => {
        setTilt(prev => ({ ...prev, scale }));
    }, [scale]);

    const handleMouseLeave = useCallback(() => {
        setTilt({ rotateX: 0, rotateY: 0, scale: 1 });
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
