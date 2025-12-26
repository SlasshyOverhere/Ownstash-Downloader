import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, useScroll, useTransform, useInView, AnimatePresence } from 'framer-motion';
import {
    ArrowRight, Shield, Zap, Download, Lock, Smartphone, Globe,
    Chrome, Youtube, Music, Video, HardDrive, Cpu, Gauge,
    CloudLightning, Fingerprint, Server, Waves, Play, CheckCircle2,
    Sparkles, ArrowDown
} from 'lucide-react';
import { cn } from '../lib/utils';
import { GlowingEffect } from './ui/glowing-effect';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from './ui/accordion';

// --- Animated Counter Component ---
const AnimatedCounter = ({ value, suffix = '', duration = 2 }: { value: number; suffix?: string; duration?: number }) => {
    const [count, setCount] = useState(0);
    const ref = useRef(null);
    const isInView = useInView(ref, { once: true });

    useEffect(() => {
        if (isInView) {
            let start = 0;
            const end = value;
            const incrementTime = (duration * 1000) / end;
            const timer = setInterval(() => {
                start += 1;
                setCount(start);
                if (start >= end) clearInterval(timer);
            }, incrementTime);
            return () => clearInterval(timer);
        }
    }, [isInView, value, duration]);

    return <span ref={ref}>{count}{suffix}</span>;
};

// --- Floating Orbs Background ---
const FloatingOrbs = () => (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
            className="absolute top-[10%] left-[15%] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[150px]"
            animate={{
                x: [0, 50, 0],
                y: [0, -30, 0],
                scale: [1, 1.1, 1]
            }}
            transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
            className="absolute bottom-[20%] right-[10%] w-[600px] h-[600px] bg-blue-600/15 rounded-full blur-[150px]"
            animate={{
                x: [0, -40, 0],
                y: [0, 40, 0],
                scale: [1, 1.2, 1]
            }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
            className="absolute top-[50%] left-[50%] w-[400px] h-[400px] bg-cyan-500/10 rounded-full blur-[120px]"
            animate={{
                x: [0, 30, -30, 0],
                y: [0, -50, 20, 0]
            }}
            transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        />
    </div>
);

// --- Grid Background ---
const GridBackground = () => (
    <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
        <div className="absolute inset-0" style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
            backgroundSize: '60px 60px'
        }} />
    </div>
);

// --- Hero Section ---
const Hero = ({ onLoginClick }: { onLoginClick: () => void }) => {
    const { scrollY } = useScroll();
    const y = useTransform(scrollY, [0, 500], [0, 150]);
    const opacity = useTransform(scrollY, [0, 300], [1, 0]);

    const [titleNumber, setTitleNumber] = useState(0);
    const titles = useMemo(
        () => ["boundaries.", "limits.", "restrictions.", "compromise.", "speed limits."],
        []
    );

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (titleNumber === titles.length - 1) {
                setTitleNumber(0);
            } else {
                setTitleNumber(titleNumber + 1);
            }
        }, 2000);
        return () => clearTimeout(timeoutId);
    }, [titleNumber, titles]);

    return (
        <div className="relative overflow-hidden min-h-screen flex items-center justify-center bg-black">
            <FloatingOrbs />
            <GridBackground />

            <motion.div style={{ y, opacity }} className="container relative z-10 px-4 md:px-6 flex flex-col items-center text-center">
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5 }}
                    className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-white/80 mb-8 backdrop-blur-sm"
                >
                    <Sparkles className="h-4 w-4 mr-2 text-yellow-400" />
                    v2.0 Now Available with Cloud Vault & 8K Support
                </motion.div>

                <motion.h1
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                    className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-6"
                >
                    <span className="bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-white/40">
                        Downloads without
                    </span>
                    <br />
                    <span className="relative flex w-full justify-center overflow-hidden text-center h-[1.1em]">
                        &nbsp;
                        {titles.map((title, index) => (
                            <motion.span
                                key={index}
                                className="absolute font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400"
                                initial={{ opacity: 0, y: 50 }}
                                animate={
                                    titleNumber === index
                                        ? { y: 0, opacity: 1 }
                                        : { y: titleNumber > index ? -50 : 50, opacity: 0 }
                                }
                                transition={{ type: "spring", stiffness: 50 }}
                            >
                                {title}
                            </motion.span>
                        ))}
                    </span>
                </motion.h1>

                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.4 }}
                    className="text-lg md:text-xl text-zinc-400 max-w-[700px] mb-12 leading-relaxed"
                >
                    The world's most advanced privacy-focused media downloader.
                    Military-grade AES-256 encryption, 8K video support, multi-threaded Rust engine,
                    and a secure vault that syncs across all your devices.
                </motion.p>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.6 }}
                    className="flex flex-col sm:flex-row gap-4"
                >
                    <motion.button
                        onClick={onLoginClick}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="group relative inline-flex h-14 items-center justify-center overflow-hidden rounded-xl bg-white px-10 font-semibold text-black transition-all hover:shadow-[0_0_40px_rgba(255,255,255,0.3)]"
                    >
                        <span className="mr-2">Get Started Free</span>
                        <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                    </motion.button>
                </motion.div>

                {/* Stats Row */}
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.8 }}
                    className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-16"
                >
                    {[
                        { value: 1000, suffix: '+', label: 'Supported Sites' },
                        { value: 100, suffix: '%', label: 'Free Forever' },
                        { value: 256, suffix: '-bit', label: 'Encryption' },
                        { value: 8, suffix: 'K', label: 'Max Resolution' },
                    ].map((stat, i) => (
                        <div key={i} className="text-center">
                            <div className="text-3xl md:text-4xl font-bold text-white mb-1">
                                <AnimatedCounter value={stat.value} suffix={stat.suffix} duration={1.5} />
                            </div>
                            <div className="text-sm text-zinc-500">{stat.label}</div>
                        </div>
                    ))}
                </motion.div>
            </motion.div>

            {/* Scroll Indicator */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5, duration: 1 }}
                className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
            >
                <motion.div
                    animate={{ y: [0, 8, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                >
                    <ArrowDown className="h-5 w-5 text-zinc-500" />
                </motion.div>
            </motion.div>
        </div>
    );
};

// --- Platform Logos Section ---
const PlatformLogos = () => {
    const platforms = [
        { name: 'YouTube', icon: Youtube, color: 'text-red-500' },
        { name: 'Spotify', icon: Music, color: 'text-green-500' },
        { name: 'Twitch', icon: Video, color: 'text-purple-500' },
        { name: 'SoundCloud', icon: Waves, color: 'text-orange-500' },
        { name: 'Vimeo', icon: Play, color: 'text-blue-400' },
    ];

    return (
        <section className="py-16 border-y border-white/5 bg-zinc-950/50">
            <div className="container px-4 md:px-6">
                <motion.p
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    className="text-center text-sm text-zinc-500 mb-8 uppercase tracking-widest"
                >
                    Works with 1000+ platforms including
                </motion.p>
                <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16">
                    {platforms.map((platform, i) => (
                        <motion.div
                            key={platform.name}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: i * 0.1 }}
                            whileHover={{ scale: 1.1, y: -5 }}
                            className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                        >
                            <platform.icon className={cn("h-6 w-6", platform.color)} />
                            <span className="font-medium">{platform.name}</span>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
};

// --- Features Grid ---
const FeatureCard = ({ icon: Icon, title, description, delay }: any) => {
    const ref = useRef(null);
    const isInView = useInView(ref, { once: true, margin: "-100px" });

    return (
        <motion.div
            ref={ref}
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay }}
            className="group relative rounded-3xl overflow-hidden"
        >
            <div className="relative h-full rounded-3xl border border-white/5 p-1">
                <GlowingEffect
                    spread={40}
                    glow={true}
                    disabled={false}
                    proximity={64}
                    inactiveZone={0.01}
                    borderWidth={2}
                />
                <div className="relative z-10 h-full p-8 rounded-[1.25rem] bg-zinc-900/80 backdrop-blur-xl flex flex-col justify-start">
                    <motion.div
                        className="h-14 w-14 rounded-2xl bg-white/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 border border-white/10"
                        whileHover={{ rotate: [0, -10, 10, 0] }}
                        transition={{ duration: 0.5 }}
                    >
                        <Icon className="h-7 w-7 text-white" />
                    </motion.div>
                    <h3 className="text-xl font-semibold mb-3 text-white">{title}</h3>
                    <p className="text-zinc-400 leading-relaxed">{description}</p>
                </div>
            </div>
        </motion.div>
    );
};

const FeaturesSection = () => {
    const features = [
        {
            icon: Shield,
            title: "Military-Grade Encryption",
            description: "Your data is secured with AES-256-GCM encryption. Zero-knowledge architecture means even we can't see what you store.",
            gradient: "bg-gradient-to-br from-green-500/10 to-transparent"
        },
        {
            icon: Download,
            title: "8K Video & FLAC Audio",
            description: "Download media in the highest quality available. Full support for 60fps, HDR10+, Dolby Vision, and lossless audio.",
            gradient: "bg-gradient-to-br from-blue-500/10 to-transparent"
        },
        {
            icon: Cpu,
            title: "Multi-Threaded Rust Engine",
            description: "Blazing-fast downloads powered by our custom Rust engine with intelligent connection pooling and adaptive chunk sizing.",
            gradient: "bg-gradient-to-br from-orange-500/10 to-transparent"
        },
        {
            icon: Smartphone,
            title: "Cross-Device Sync",
            description: "Your encrypted vault syncs seamlessly using your own Google Drive. No third-party servers. Your data, your control.",
            gradient: "bg-gradient-to-br from-purple-500/10 to-transparent"
        },
        {
            icon: Chrome,
            title: "Browser Extension",
            description: "One-click downloads directly from your browser. Automatically detects media on the page and queues it for download.",
            gradient: "bg-gradient-to-br from-yellow-500/10 to-transparent"
        },
        {
            icon: Fingerprint,
            title: "Biometric Vault Lock",
            description: "Secure your vault with PIN, password, or biometric authentication. Auto-lock after inactivity keeps your files safe.",
            gradient: "bg-gradient-to-br from-pink-500/10 to-transparent"
        },
    ];

    return (
        <section id="features" className="py-32 relative scroll-mt-20">
            <FloatingOrbs />
            <div className="container px-4 md:px-6 relative z-10">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center mb-16"
                >
                    <h2 className="text-4xl md:text-5xl font-bold mb-4">
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-500">
                            Built for Power Users
                        </span>
                    </h2>
                    <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
                        Every feature designed with privacy, performance, and flexibility in mind.
                    </p>
                </motion.div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {features.map((feature, i) => (
                        <FeatureCard key={i} {...feature} delay={i * 0.1} />
                    ))}
                </div>
            </div>
        </section>
    );
};

// --- Technical Specs Section ---
const SpecRow = ({ icon: Icon, label, value, highlight }: any) => (
    <motion.div
        initial={{ opacity: 0, x: -20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        className="flex items-center justify-between py-4 px-4 border-b border-white/5 hover:bg-white/[0.02] rounded-lg transition-colors group"
    >
        <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                <Icon className="h-4 w-4 text-zinc-400" />
            </div>
            <span className="text-zinc-400 font-medium">{label}</span>
        </div>
        <span className={cn("font-mono font-semibold", highlight ? "text-green-400" : "text-white")}>
            {value}
        </span>
    </motion.div>
);

const TechnicalSpecs = () => {
    const specs = [
        { icon: Shield, label: "Encryption Standard", value: "AES-256-GCM", highlight: true },
        { icon: Lock, label: "Key Derivation", value: "Argon2id (v19)" },
        { icon: Cpu, label: "Download Engine", value: "Multi-threaded Rust" },
        { icon: Gauge, label: "Max Connections", value: "32 parallel" },
        { icon: Video, label: "Max Resolution", value: "7680 × 4320 (8K)" },
        { icon: Waves, label: "Audio Quality", value: "Up to 320kbps / FLAC" },
        { icon: HardDrive, label: "Storage Backend", value: "SQLite + GDrive" },
        { icon: Server, label: "Cloud Sync", value: "End-to-end encrypted" },
        { icon: CloudLightning, label: "Protocol Support", value: "HTTP/2 + HTTP/3" },
        { icon: Globe, label: "Supported Sites", value: "1000+ platforms" },
    ];

    return (
        <section id="specs" className="py-32 bg-gradient-to-b from-black via-zinc-950 to-black relative scroll-mt-20">
            <GridBackground />
            <div className="container px-4 md:px-6 relative z-10">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
                    <div>
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                        >
                            <span className="text-sm font-medium text-blue-400 uppercase tracking-widest mb-4 block">Technical Specifications</span>
                            <h2 className="text-4xl md:text-5xl font-bold mb-6">
                                <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-500">
                                    Enterprise-Grade Tech
                                </span>
                            </h2>
                            <p className="text-zinc-400 text-lg mb-8 leading-relaxed">
                                Built on a foundation of security and performance. Every component is carefully selected
                                and optimized for the best possible experience.
                            </p>
                        </motion.div>

                        <div className="bg-zinc-900/50 rounded-3xl border border-white/5 p-4 backdrop-blur-sm">
                            {specs.map((spec, i) => (
                                <SpecRow key={i} {...spec} />
                            ))}
                        </div>
                    </div>

                    <motion.div
                        initial={{ opacity: 0, x: 50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8 }}
                        className="relative lg:sticky lg:top-24"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-3xl blur-3xl" />
                        <div className="relative bg-black rounded-3xl border border-white/10 p-8 shadow-2xl overflow-hidden">
                            {/* Live Download Preview */}
                            <div className="absolute top-0 right-0 px-3 py-1 bg-green-500/20 text-green-400 text-xs font-medium rounded-bl-lg">
                                LIVE
                            </div>

                            <div className="space-y-6">
                                {/* Download Item 1 */}
                                <motion.div
                                    className="bg-zinc-900/80 rounded-2xl p-5 border border-white/5"
                                    initial={{ opacity: 0, y: 20 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true }}
                                >
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-4">
                                            <div className="h-12 w-12 bg-red-500/20 rounded-xl flex items-center justify-center">
                                                <Youtube className="h-6 w-6 text-red-500" />
                                            </div>
                                            <div>
                                                <div className="font-semibold text-white">The Matrix 4K HDR</div>
                                                <div className="text-xs text-zinc-500">3.8 GB • 45 MB/s • ETA 1:24</div>
                                            </div>
                                        </div>
                                        <motion.div
                                            className="h-3 w-3 bg-green-500 rounded-full"
                                            animate={{ scale: [1, 1.2, 1] }}
                                            transition={{ duration: 1, repeat: Infinity }}
                                        />
                                    </div>
                                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                                        <motion.div
                                            className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                                            initial={{ width: "0%" }}
                                            whileInView={{ width: "72%" }}
                                            viewport={{ once: true }}
                                            transition={{ duration: 2, ease: "easeOut" }}
                                        />
                                    </div>
                                </motion.div>

                                {/* Download Item 2 */}
                                <motion.div
                                    className="bg-zinc-900/80 rounded-2xl p-5 border border-white/5"
                                    initial={{ opacity: 0, y: 20 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ delay: 0.2 }}
                                >
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-4">
                                            <div className="h-12 w-12 bg-green-500/20 rounded-xl flex items-center justify-center">
                                                <Music className="h-6 w-6 text-green-500" />
                                            </div>
                                            <div>
                                                <div className="font-semibold text-white">Daft Punk - Discovery</div>
                                                <div className="text-xs text-zinc-500">FLAC • 14 tracks</div>
                                            </div>
                                        </div>
                                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                                    </div>
                                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-green-500 w-full" />
                                    </div>
                                </motion.div>

                                {/* Security Status */}
                                <div className="grid grid-cols-2 gap-4">
                                    <motion.div
                                        className="bg-zinc-900/50 rounded-xl p-4 flex items-center gap-3"
                                        whileHover={{ scale: 1.02 }}
                                    >
                                        <Shield className="text-green-500 h-5 w-5" />
                                        <span className="text-sm text-zinc-300">Encrypted</span>
                                    </motion.div>
                                    <motion.div
                                        className="bg-zinc-900/50 rounded-xl p-4 flex items-center gap-3"
                                        whileHover={{ scale: 1.02 }}
                                    >
                                        <Lock className="text-blue-500 h-5 w-5" />
                                        <span className="text-sm text-zinc-300">Vault Synced</span>
                                    </motion.div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </div>
        </section>
    );
};

// --- CTA Section ---
const CTASection = ({ onLoginClick }: { onLoginClick: () => void }) => (
    <section id="download" className="py-32 relative overflow-hidden scroll-mt-20">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 via-purple-600/10 to-pink-600/10" />
        <FloatingOrbs />

        <div className="container px-4 md:px-6 relative z-10 text-center">
            <motion.div
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
            >
                <h2 className="text-4xl md:text-6xl font-bold mb-6">
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-zinc-400">
                        Ready to Take Control?
                    </span>
                </h2>
                <p className="text-xl text-zinc-400 max-w-2xl mx-auto mb-10">
                    Join thousands of power users who trust Slasshy OmniDownloader for their media downloads.
                    Free forever. No strings attached.
                </p>

                <motion.button
                    onClick={onLoginClick}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="relative inline-flex h-14 items-center justify-center rounded-xl px-12 font-semibold text-black bg-white hover:shadow-[0_0_50px_rgba(255,255,255,0.4)] transition-shadow"
                >
                    <span className="mr-2">Sign In with Google</span>
                    <ArrowRight className="h-5 w-5" />
                </motion.button>
            </motion.div>
        </div>
    </section>
);

// --- Login Modal ---
const LoginModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
    <AnimatePresence>
        {isOpen && (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.9, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.9, opacity: 0, y: 20 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-zinc-950 w-full max-w-md rounded-3xl border border-white/10 shadow-2xl overflow-hidden"
                >
                    <button
                        onClick={onClose}
                        className="absolute top-6 right-6 text-zinc-500 hover:text-white transition-colors text-xl z-20"
                    >
                        ✕
                    </button>

                    <div className="p-8">
                        <div className="flex items-center gap-3 mb-2 justify-center">
                            <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center text-black">
                                <Zap className="h-6 w-6 fill-current" />
                            </div>
                            <span className="text-2xl font-bold">Get Started</span>
                        </div>
                        <p className="text-center text-zinc-400 mb-8">
                            Join millions of users downloading safely.
                        </p>

                        <div className="space-y-4">
                            <button
                                className="flex w-full items-center justify-center gap-3 rounded-xl bg-white py-4 px-4 text-black font-semibold hover:bg-zinc-200 transition-all active:scale-[0.98]"
                                onClick={() => {
                                    window.location.href = "https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_CALLBACK&response_type=token&scope=email profile openid https://www.googleapis.com/auth/drive.appdata";
                                }}
                            >
                                <svg className="h-5 w-5" viewBox="0 0 24 24">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                </svg>
                                Continue with Google
                            </button>
                        </div>

                        <p className="mt-8 text-center text-xs text-zinc-500">
                            By signing in, you agree to our{' '}
                            <a href="#" className="underline hover:text-white">Terms</a> and{' '}
                            <a href="#" className="underline hover:text-white">Privacy Policy</a>.
                        </p>
                    </div>

                    <div className="bg-zinc-900/50 py-4 px-6 border-t border-white/5 text-center">
                        <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
                            <Shield className="h-3 w-3" />
                            Protected with AES-256 Encryption
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        )}
    </AnimatePresence>
);

// --- FAQ Section ---
const FAQSection = () => {
    return (
        <section id="faq" className="py-24 relative z-10 border-t border-white/5 bg-zinc-950/30 scroll-mt-20">
            <div className="container px-4 md:px-6 max-w-4xl mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center mb-12"
                >
                    <h2 className="text-3xl md:text-4xl font-bold mb-4">
                        Frequently Asked Questions
                    </h2>
                    <p className="text-zinc-400">
                        Everything you need to know about Slasshy OmniDownloader.
                    </p>
                </motion.div>

                <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="item-1">
                        <AccordionTrigger className="text-lg">Is Slasshy OmniDownloader really free?</AccordionTrigger>
                        <AccordionContent className="text-zinc-400 text-base leading-relaxed">
                            Yes, Slasshy OmniDownloader is 100% free and open-source. We believe privacy and unrestricted internet access are fundamental rights. There are no hidden fees, subscriptions, or ads.
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="item-2">
                        <AccordionTrigger className="text-lg">How does the encryption work?</AccordionTrigger>
                        <AccordionContent className="text-zinc-400 text-base leading-relaxed">
                            We use military-grade AES-256-GCM encryption. Your files are encrypted locally on your device before they are ever synced. The encryption keys are derived from your password using Argon2id, ensuring that not even we can access your data.
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="item-3">
                        <AccordionTrigger className="text-lg">Which platforms are supported?</AccordionTrigger>
                        <AccordionContent className="text-zinc-400 text-base leading-relaxed">
                            Slasshy OmniDownloader supports downloading from over 1000 websites, including YouTube, Spotify, SoundCloud, Twitch, Vimeo, and many more. It handles video, audio, and playlists seamlessly.
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="item-4">
                        <AccordionTrigger className="text-lg">Where are my files stored?</AccordionTrigger>
                        <AccordionContent className="text-zinc-400 text-base leading-relaxed">
                            Your files are stored locally on your device by default. If you enable Cloud Sync, an encrypted copy is stored in your personal Google Drive (App Folder), keeping you in full control of your storage.
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="item-5">
                        <AccordionTrigger className="text-lg">Is it legal to download videos?</AccordionTrigger>
                        <AccordionContent className="text-zinc-400 text-base leading-relaxed">
                            Slasshy OmniDownloader is a tool for personal archiving and offline viewing. Laws regarding downloading content vary by country and platform. We encourage users to respect copyright laws and the terms of service of the platforms they use.
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
        </section>
    );
};

// --- Footer ---
const Footer = () => (
    <footer className="py-12 bg-black border-t border-white/5">
        <div className="container px-4 md:px-6">
            <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                <div className="flex items-center gap-3 group cursor-pointer">
                    <div className="h-8 w-8 rounded-lg bg-white flex items-center justify-center text-black group-hover:scale-105 transition-transform duration-300">
                        <Zap className="h-4 w-4 fill-current" />
                    </div>
                    <div className="flex flex-col -space-y-1">
                        <span className="text-lg font-bold tracking-tighter text-white">
                            Slasshy
                        </span>
                        <span className="text-[9px] uppercase tracking-[0.2em] font-semibold text-zinc-500">
                            OmniDownloader
                        </span>
                    </div>
                </div>

                <div className="flex gap-8">
                    <a href="#" className="text-zinc-500 hover:text-white transition-colors text-sm">Documentation</a>
                    <a href="#" className="text-zinc-500 hover:text-white transition-colors text-sm">GitHub</a>
                    <a href="#" className="text-zinc-500 hover:text-white transition-colors text-sm">Discord</a>
                    <a href="#" className="text-zinc-500 hover:text-white transition-colors text-sm">Twitter</a>
                </div>

                <p className="text-zinc-600 text-sm">© 2025 Slasshy OmniDownloader. All rights reserved.</p>
            </div>
        </div>
    </footer>
);

// --- Main Component ---
export default function LandingPage() {
    const [showLogin, setShowLogin] = useState(false);
    const [isScrolled, setIsScrolled] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <div className="min-h-screen bg-black text-white selection:bg-white/20 overflow-x-hidden">
            {/* Navbar */}
            <motion.nav
                initial={{ y: -100 }}
                animate={{ y: 0 }}
                className={cn(
                    "fixed top-0 w-full z-50 transition-all duration-300",
                    isScrolled 
                        ? "bg-black/80 backdrop-blur-xl border-b border-white/5 py-3" 
                        : "bg-transparent py-6"
                )}
            >
                <div className="container flex items-center justify-between px-4 md:px-6">
                    <div className="flex items-center gap-3 group cursor-pointer" onClick={() => window.scrollTo(0, 0)}>
                        <div className="h-9 w-9 rounded-xl bg-white flex items-center justify-center text-black shadow-[0_0_20px_rgba(255,255,255,0.3)] group-hover:scale-105 transition-all duration-300">
                            <Zap className="h-5 w-5 fill-current" />
                        </div>
                        <div className="flex flex-col -space-y-1">
                            <span className="text-xl font-bold tracking-tighter text-white">
                                Slasshy
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.2em] font-semibold text-zinc-500">
                                OmniDownloader
                            </span>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-1 md:gap-2">
                        <div className="hidden md:flex items-center bg-white/5 rounded-full p-1 border border-white/5 backdrop-blur-md mr-4">
                            {[
                                { name: 'Features', href: '#features' },
                                { name: 'Specs', href: '#specs' },
                                { name: 'FAQ', href: '#faq' }
                            ].map((item) => (
                                <a 
                                    key={item.name}
                                    href={item.href}
                                    className="px-5 py-2 rounded-full text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/10 transition-all duration-200"
                                >
                                    {item.name}
                                </a>
                            ))}
                        </div>
                        
                        <button
                            onClick={() => {
                                const downloadLink = import.meta.env.VITE_DOWNLOAD_LINK;
                                if (downloadLink) {
                                    window.location.href = downloadLink;
                                } else {
                                    document.getElementById('download')?.scrollIntoView();
                                }
                            }}
                            className="hidden md:inline-flex text-sm font-semibold px-6 py-2.5 rounded-full bg-white text-black hover:bg-zinc-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                        >
                            Get App
                        </button>
                        
                        <button
                            onClick={() => setShowLogin(true)}
                            className="text-sm font-semibold px-6 py-2.5 rounded-full bg-blue-600 text-white hover:bg-blue-500 transition-colors shadow-[0_0_20px_rgba(37,99,235,0.4)] ml-2"
                        >
                            Sign In
                        </button>
                    </div>
                </div>
            </motion.nav>

            <Hero onLoginClick={() => setShowLogin(true)} />
            <PlatformLogos />
            <FeaturesSection />
            <TechnicalSpecs />
            <FAQSection />
            <CTASection onLoginClick={() => setShowLogin(true)} />
            <Footer />

            <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
        </div>
    );
}
