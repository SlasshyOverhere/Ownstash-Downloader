import { Variants } from 'framer-motion';

// Fade animations
export const fadeIn: Variants = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
};

export const fadeInUp: Variants = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
};

export const fadeInDown: Variants = {
    initial: { opacity: 0, y: -20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 20 },
};

export const fadeInLeft: Variants = {
    initial: { opacity: 0, x: -20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 20 },
};

export const fadeInRight: Variants = {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
};

// Scale animations
export const scaleIn: Variants = {
    initial: { opacity: 0, scale: 0.9 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.9 },
};

export const popIn: Variants = {
    initial: { opacity: 0, scale: 0.8 },
    animate: {
        opacity: 1,
        scale: 1,
        transition: { type: 'spring', stiffness: 300, damping: 20 }
    },
    exit: { opacity: 0, scale: 0.8 },
};

// Stagger children
export const staggerContainer: Variants = {
    initial: {},
    animate: {
        transition: {
            staggerChildren: 0.1,
            delayChildren: 0.1,
        },
    },
};

export const staggerItem: Variants = {
    initial: { opacity: 0, y: 20 },
    animate: {
        opacity: 1,
        y: 0,
        transition: { type: 'spring', stiffness: 300, damping: 24 }
    },
};

// 3D Card hover effect
export const card3DHover: Variants = {
    initial: {
        rotateX: 0,
        rotateY: 0,
        z: 0,
    },
    hover: {
        z: 50,
        transition: { type: 'spring', stiffness: 300, damping: 20 }
    },
};

// Glow pulse
export const glowPulse: Variants = {
    initial: { opacity: 0.5, scale: 1 },
    animate: {
        opacity: [0.5, 1, 0.5],
        scale: [1, 1.02, 1],
        transition: {
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
        },
    },
};

// Progress bar fill
export const progressFill: Variants = {
    initial: { scaleX: 0 },
    animate: (progress: number) => ({
        scaleX: progress / 100,
        transition: { type: 'spring', stiffness: 100, damping: 20 }
    }),
};

// Sidebar expand/collapse
export const sidebarVariants: Variants = {
    expanded: { width: 240 },
    collapsed: { width: 72 },
};

export const sidebarItemText: Variants = {
    expanded: { opacity: 1, x: 0, display: 'block' },
    collapsed: { opacity: 0, x: -10, transitionEnd: { display: 'none' } },
};

// Page transitions
export const pageTransition: Variants = {
    initial: { opacity: 0, x: 20, filter: 'blur(10px)' },
    animate: {
        opacity: 1,
        x: 0,
        filter: 'blur(0px)',
        transition: { duration: 0.3, ease: 'easeOut' }
    },
    exit: {
        opacity: 0,
        x: -20,
        filter: 'blur(10px)',
        transition: { duration: 0.2 }
    },
};

// Float animation for orbs
export const floatAnimation: Variants = {
    initial: { y: 0 },
    animate: {
        y: [-20, 20, -20],
        transition: {
            duration: 6,
            repeat: Infinity,
            ease: 'easeInOut',
        },
    },
};

// Spring configs
export const springConfig = {
    gentle: { type: 'spring', stiffness: 120, damping: 14 },
    snappy: { type: 'spring', stiffness: 300, damping: 20 },
    bouncy: { type: 'spring', stiffness: 400, damping: 10 },
};
