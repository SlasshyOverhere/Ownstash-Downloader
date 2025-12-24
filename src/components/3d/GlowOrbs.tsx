import { motion } from 'framer-motion';
import { floatAnimation } from '@/lib/animations';

interface GlowOrbProps {
    intensity: 'bright' | 'medium' | 'subtle';
    size: 'sm' | 'md' | 'lg';
    position: { x: string; y: string };
    delay?: number;
}

const intensityMap = {
    bright: 'from-white/8 to-white/3',
    medium: 'from-white/5 to-white/2',
    subtle: 'from-white/3 to-transparent',
};

const sizeMap = {
    sm: 'w-32 h-32',
    md: 'w-64 h-64',
    lg: 'w-96 h-96',
};

const blurMap = {
    sm: 'blur-2xl',
    md: 'blur-3xl',
    lg: 'blur-[100px]',
};

function GlowOrb({ intensity, size, position, delay = 0 }: GlowOrbProps) {
    return (
        <motion.div
            className={`absolute rounded-full bg-gradient-to-br ${intensityMap[intensity]} ${sizeMap[size]} ${blurMap[size]}`}
            style={{
                left: position.x,
                top: position.y,
                transform: 'translate(-50%, -50%)',
            }}
            variants={floatAnimation}
            initial="initial"
            animate="animate"
            transition={{ delay }}
        />
    );
}

export function GlowOrbs() {
    return (
        <div className="absolute inset-0 -z-30 overflow-hidden pointer-events-none">
            {/* Large background orbs */}
            <GlowOrb intensity="bright" size="lg" position={{ x: '20%', y: '30%' }} delay={0} />
            <GlowOrb intensity="medium" size="lg" position={{ x: '80%', y: '60%' }} delay={2} />
            <GlowOrb intensity="subtle" size="md" position={{ x: '60%', y: '20%' }} delay={1} />

            {/* Smaller accent orbs */}
            <GlowOrb intensity="medium" size="sm" position={{ x: '10%', y: '70%' }} delay={3} />
            <GlowOrb intensity="subtle" size="sm" position={{ x: '90%', y: '20%' }} delay={1.5} />
            <GlowOrb intensity="bright" size="sm" position={{ x: '40%', y: '85%' }} delay={2.5} />
        </div>
    );
}

