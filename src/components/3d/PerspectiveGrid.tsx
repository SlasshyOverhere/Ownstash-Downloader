import { motion } from 'framer-motion';

export function PerspectiveGrid() {
    return (
        <div className="absolute inset-0 -z-20 overflow-hidden">
            {/* Grid container with perspective */}
            <div
                className="absolute inset-0"
                style={{
                    perspective: '1000px',
                    perspectiveOrigin: '50% 50%',
                }}
            >
                {/* Animated grid */}
                <motion.div
                    className="absolute w-[200%] h-[200%] left-[-50%] top-[-50%]"
                    style={{
                        transformStyle: 'preserve-3d',
                        transform: 'rotateX(60deg)',
                    }}
                    initial={{ backgroundPosition: '0 0' }}
                    animate={{ backgroundPosition: '0 100px' }}
                    transition={{
                        duration: 20,
                        repeat: Infinity,
                        ease: 'linear',
                    }}
                >
                    {/* Grid lines */}
                    <div
                        className="absolute inset-0 opacity-20"
                        style={{
                            backgroundImage: `
                linear-gradient(to right, hsl(280, 100%, 60%) 1px, transparent 1px),
                linear-gradient(to bottom, hsl(280, 100%, 60%) 1px, transparent 1px)
              `,
                            backgroundSize: '80px 80px',
                        }}
                    />
                </motion.div>

                {/* Horizon gradient overlay */}
                <div
                    className="absolute inset-0"
                    style={{
                        background: `
              linear-gradient(
                to bottom,
                hsl(240, 15%, 5%) 0%,
                transparent 20%,
                transparent 60%,
                hsl(240, 15%, 5%) 100%
              )
            `,
                    }}
                />
            </div>

            {/* Radial fade at center */}
            <div
                className="absolute inset-0"
                style={{
                    background: `
            radial-gradient(
              ellipse at center,
              transparent 0%,
              hsl(240, 15%, 5%) 70%
            )
          `,
                }}
            />
        </div>
    );
}
