import { useState } from 'react';
import { motion } from 'framer-motion';
import {
    Home,
    Download,
    History,
    Settings,
    ChevronLeft,
    ChevronRight,
    Sparkles,
    LogOut,
    Cloud,
    CloudOff,
    Loader2,
    Shield
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { sidebarVariants, sidebarItemText } from '@/lib/animations';
import { useAuth } from '@/contexts/AuthContext';
import { useData } from '@/contexts/DataContext';
import { UserAvatar } from '@/components/ui/UserAvatar';
import type { PageType } from '@/App';

interface AnimatedSidebarProps {
    currentPage: PageType;
    onPageChange: (page: PageType) => void;
}

const navItems = [
    { id: 'home' as const, label: 'Home', icon: Home },
    { id: 'downloads' as const, label: 'Downloads', icon: Download },
    { id: 'vault' as const, label: 'Vault', icon: Shield },
    { id: 'history' as const, label: 'History', icon: History },
    { id: 'settings' as const, label: 'Settings', icon: Settings },
];

export function AnimatedSidebar({ currentPage, onPageChange }: AnimatedSidebarProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const { user, signOut } = useAuth();
    const { isSyncing } = useData();
    const [isSigningOut, setIsSigningOut] = useState(false);

    const handleSignOut = async () => {
        setIsSigningOut(true);
        try {
            await signOut();
        } finally {
            setIsSigningOut(false);
        }
    };

    return (
        <motion.aside
            className="relative h-screen flex flex-col glass border-r border-white/5"
            variants={sidebarVariants}
            initial="expanded"
            animate={isExpanded ? 'expanded' : 'collapsed'}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
            {/* Logo */}
            <div className="flex items-center gap-3 p-4 border-b border-white/5">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-white to-white/80 flex items-center justify-center shadow-elegant">
                    <Sparkles className="w-5 h-5 text-black" />
                </div>
                <motion.div
                    variants={sidebarItemText}
                    className="overflow-hidden"
                >
                    <h1 className="font-display font-bold text-lg gradient-text whitespace-nowrap">
                        Slasshy
                    </h1>
                    <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                        OmniDownloader
                    </p>
                </motion.div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-3 space-y-2">
                {navItems.map((item) => {
                    const isActive = currentPage === item.id;
                    const Icon = item.icon;

                    return (
                        <button
                            key={item.id}
                            onClick={() => onPageChange(item.id)}
                            className={cn(
                                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200',
                                'hover:bg-white/5 group relative overflow-hidden',
                                isActive && 'bg-primary/10 border border-primary/20'
                            )}
                        >
                            {/* Active indicator glow */}
                            {isActive && (
                                <motion.div
                                    layoutId="activeTab"
                                    className="absolute inset-0 bg-gradient-to-r from-primary/20 to-transparent rounded-xl"
                                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                                />
                            )}

                            {/* Icon with glow effect */}
                            <div className={cn(
                                'relative z-10 p-1.5 rounded-lg transition-all duration-200',
                                isActive ? 'text-primary text-glow-sm' : 'text-muted-foreground group-hover:text-foreground'
                            )}>
                                <Icon className="w-5 h-5" />
                            </div>

                            {/* Label */}
                            <motion.span
                                variants={sidebarItemText}
                                className={cn(
                                    'relative z-10 font-medium whitespace-nowrap',
                                    isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
                                )}
                            >
                                {item.label}
                            </motion.span>

                            {/* Hover highlight */}
                            <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 rounded-xl transition-colors" />
                        </button>
                    );
                })}
            </nav>

            {/* User Profile Section */}
            <div className="p-3 border-t border-white/5">
                {user ? (
                    <div className="space-y-2">
                        {/* User Info */}
                        <div className="flex items-center gap-3 px-3 py-2">
                            <UserAvatar
                                photoURL={user.photoURL}
                                displayName={user.displayName}
                                email={user.email}
                                size="sm"
                            />
                            <motion.div
                                variants={sidebarItemText}
                                className="overflow-hidden flex-1 min-w-0"
                            >
                                <p className="text-sm font-medium text-foreground truncate">
                                    {user.displayName || 'User'}
                                </p>
                                <div className="flex items-center gap-1 text-[10px]">
                                    {isSyncing ? (
                                        <>
                                            <Loader2 className="w-3 h-3 text-white/60 animate-spin" />
                                            <span className="text-white/60">Syncing...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Cloud className="w-3 h-3 text-white" />
                                            <span className="text-white/80">Cloud Synced</span>
                                        </>
                                    )}
                                </div>
                            </motion.div>
                        </div>

                        {/* Sign Out Button */}
                        <button
                            onClick={handleSignOut}
                            disabled={isSigningOut}
                            className={cn(
                                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl',
                                'text-muted-foreground hover:text-red-400 hover:bg-red-500/10',
                                'transition-all duration-200 group',
                                isSigningOut && 'opacity-50 cursor-not-allowed'
                            )}
                        >
                            <div className="p-1.5 rounded-lg">
                                {isSigningOut ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <LogOut className="w-5 h-5" />
                                )}
                            </div>
                            <motion.span
                                variants={sidebarItemText}
                                className="font-medium whitespace-nowrap"
                            >
                                Sign Out
                            </motion.span>
                        </button>
                    </div>
                ) : (
                    /* Offline / Not Logged In */
                    <div className="flex items-center gap-3 px-3 py-2">
                        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                            <CloudOff className="w-4 h-4 text-slate-400" />
                        </div>
                        <motion.div
                            variants={sidebarItemText}
                            className="overflow-hidden flex-1 min-w-0"
                        >
                            <p className="text-sm font-medium text-muted-foreground">
                                Offline Mode
                            </p>
                            <p className="text-[10px] text-muted-foreground/70">
                                Local storage only
                            </p>
                        </motion.div>
                    </div>
                )}
            </div>

            {/* Collapse Toggle */}
            <div className="p-3 border-t border-white/5">
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl',
                        'text-muted-foreground hover:text-foreground hover:bg-white/5',
                        'transition-all duration-200'
                    )}
                >
                    <div className="p-1.5 rounded-lg">
                        {isExpanded ? (
                            <ChevronLeft className="w-5 h-5" />
                        ) : (
                            <ChevronRight className="w-5 h-5" />
                        )}
                    </div>
                    <motion.span
                        variants={sidebarItemText}
                        className="font-medium whitespace-nowrap"
                    >
                        Collapse
                    </motion.span>
                </button>
            </div>
        </motion.aside>
    );
}
