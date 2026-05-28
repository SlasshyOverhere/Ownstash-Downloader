import { Variants } from 'framer-motion';

export const fadeInUp: Variants = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
};

// Stagger children
export const staggerContainer: Variants = {
    initial: {},
    animate: {
        transition: {
            staggerChildren: 0.04,
            delayChildren: 0.02,
        },
    },
};

export const staggerItem: Variants = {
    initial: { opacity: 0, y: 10 },
    animate: {
        opacity: 1,
        y: 0,
        transition: { type: 'tween', duration: 0.18, ease: 'easeOut' }
    },
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
    initial: { opacity: 0, x: 8 },
    animate: {
        opacity: 1,
        x: 0,
        transition: { duration: 0.16, ease: 'easeOut' }
    },
    exit: {
        opacity: 0,
        x: -6,
        transition: { duration: 0.12 }
    },
};
