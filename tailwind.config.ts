import type { Config } from 'tailwindcss';

const config: Config = {
    darkMode: 'class',
    content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
    theme: {
        extend: {
            colors: {
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                primary: {
                    DEFAULT: 'hsl(var(--primary))',
                    foreground: 'hsl(var(--primary-foreground))',
                },
                secondary: {
                    DEFAULT: 'hsl(var(--secondary))',
                    foreground: 'hsl(var(--secondary-foreground))',
                },
                accent: {
                    DEFAULT: 'hsl(var(--accent))',
                    foreground: 'hsl(var(--accent-foreground))',
                },
                muted: {
                    DEFAULT: 'hsl(var(--muted))',
                    foreground: 'hsl(var(--muted-foreground))',
                },
                card: {
                    DEFAULT: 'hsl(var(--card))',
                    foreground: 'hsl(var(--card-foreground))',
                },
                border: 'hsl(var(--border))',
                ring: 'hsl(var(--ring))',
                success: 'hsl(var(--success))',
                warning: 'hsl(var(--warning))',
                destructive: 'hsl(var(--destructive))',
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                display: ['Outfit', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            animation: {
                'float': 'float 6s ease-in-out infinite',
                'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
                'grid-flow': 'grid-flow 20s linear infinite',
                'particle-drift': 'particle-drift 15s linear infinite',
                'shimmer': 'shimmer 2s linear infinite',
            },
            keyframes: {
                float: {
                    '0%, 100%': { transform: 'translateY(0px)' },
                    '50%': { transform: 'translateY(-20px)' },
                },
                'glow-pulse': {
                    '0%, 100%': { opacity: '1', filter: 'brightness(1)' },
                    '50%': { opacity: '0.8', filter: 'brightness(1.2)' },
                },
                'grid-flow': {
                    '0%': { transform: 'perspective(1000px) rotateX(60deg) translateY(0)' },
                    '100%': { transform: 'perspective(1000px) rotateX(60deg) translateY(100%)' },
                },
                'particle-drift': {
                    '0%': { transform: 'translateY(100vh) translateX(0)' },
                    '100%': { transform: 'translateY(-100vh) translateX(100px)' },
                },
                shimmer: {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
            },
            backdropBlur: {
                xs: '2px',
            },
            boxShadow: {
                'elegant': '0 4px 20px rgba(255, 255, 255, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.05)',
                'elegant-hover': '0 8px 40px rgba(255, 255, 255, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.1)',
                'soft': '0 2px 10px rgba(0, 0, 0, 0.3)',
                'glass': '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05)',
                '3d-subtle': '0 20px 40px -15px rgba(0, 0, 0, 0.5)',
                'inner-glow': 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
            },
        },
    },
    plugins: [],
};

export default config;
