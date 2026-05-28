import { useState } from 'react';
import { LazyMotion, m, domAnimation } from 'framer-motion';
import {
    Home,
    Download,
    History,
    Settings,
    ChevronLeft,
    ChevronRight,
    LogOut,
    Cloud,
    Loader2,
    HardDrive
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
    { id: 'history' as const, label: 'History', icon: History },
];

export function AnimatedSidebar({ currentPage, onPageChange }: AnimatedSidebarProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const { user, signOut } = useAuth();
    const { isSyncing, storageType } = useData();
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
        <LazyMotion features={domAnimation}>
        <m.aside
            className="relative h-screen flex flex-col glass border-r border-white/5 overflow-hidden"
            variants={sidebarVariants}
            initial="expanded"
            animate={isExpanded ? 'expanded' : 'collapsed'}
            transition={{ type: 'tween', duration: 0.18, ease: 'easeOut' }}
        >
            {/* Logo */}
            <div className={cn(
                'flex items-center p-4 border-b border-white/5',
                isExpanded ? 'gap-3 justify-start' : 'justify-center'
            )}>
                <img
                    src="/logo.png"
                    alt="Ownstash logo"
                    className="size-10 rounded-xl object-contain shadow-elegant"
                />
                <m.div
                    variants={sidebarItemText}
                    className="overflow-hidden"
                >
                    <h1 className="font-display font-bold text-lg gradient-text whitespace-nowrap">
                        Ownstash
                    </h1>
                    <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                        Downloader
                    </p>
                </m.div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-3 space-y-2">
                {navItems.map((item) => {
                    const isActive = currentPage === item.id;
                    const Icon = item.icon;

                    return (
                        <button
                            type="button"
                            key={item.id}
                            onClick={() => onPageChange(item.id)}
                            className={cn(
                                'w-full flex items-center py-2.5 rounded-xl transition-colors',
                                'hover:bg-white/5 group relative overflow-hidden',
                                isExpanded ? 'gap-3 px-3 justify-start' : 'gap-0 px-0 justify-center',
                                isActive && 'bg-primary/10 border border-primary/20'
                            )}
                        >
                            {/* Active indicator glow */}
                            {isActive && (
                                <m.div
                                    layoutId="activeTab"
                                    className="absolute inset-0 bg-gradient-to-r from-primary/20 to-transparent rounded-xl"
                                    transition={{ type: 'tween', duration: 0.14, ease: 'easeOut' }}
                                />
                            )}

                            {/* Icon with glow effect */}
                            <div className={cn(
                                'relative z-10 p-1.5 rounded-lg transition-colors',
                                isActive ? 'text-primary text-glow-sm' : 'text-muted-foreground group-hover:text-foreground'
                            )}>
                                <Icon className="size-5" />
                            </div>

                            {/* Label */}
                            <m.span
                                variants={sidebarItemText}
                                className={cn(
                                    'relative z-10 font-medium whitespace-nowrap',
                                    isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
                                )}
                            >
                                {item.label}
                            </m.span>

                            {/* Hover highlight */}
                            <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 rounded-xl transition-colors" />
                        </button>
                    );
                })}
            </nav>

            {/* User Profile Section */}
            {user && (
                <div className="p-3 border-t border-white/5">
                    <div className="space-y-2">
                        {/* User Info */}
                        <div className={cn(
                            'flex items-center py-2',
                            isExpanded ? 'gap-3 px-3 justify-start' : 'gap-0 px-0 justify-center'
                        )}>
                            <UserAvatar
                                photoURL={user.photoURL}
                                displayName={user.displayName}
                                email={user.email}
                                size="sm"
                            />
                            <m.div
                                variants={sidebarItemText}
                                className="overflow-hidden flex-1 min-w-0"
                            >
                                <p className="text-sm font-medium text-foreground truncate">
                                    {user.displayName || 'User'}
                                </p>
                                <div className="flex items-center gap-1 text-[10px]">
                                    {isSyncing ? (
                                        <>
                                            <Loader2 className="size-3 text-white/60 animate-spin" />
                                            <span className="text-white/60">Syncing…</span>
                                        </>
                                    ) : storageType === 'gdrive' ? (
                                        <>
                                            <Cloud className="size-3 text-green-400" />
                                            <span className="text-green-400">Drive Synced</span>
                                        </>
                                    ) : (
                                        <>
                                            <HardDrive className="size-3 text-yellow-400" />
                                            <span className="text-yellow-400">Local Only</span>
                                        </>
                                    )}
                                </div>
                            </m.div>
                        </div>

                        {/* Sign Out Button */}
                        <button
                            type="button"
                            onClick={handleSignOut}
                            disabled={isSigningOut}
                            aria-label="Sign Out"
                            className={cn(
                                'w-full flex items-center py-2.5 rounded-xl',
                                'text-muted-foreground hover:text-red-400 hover:bg-red-500/10',
                                'transition-colors group',
                                isExpanded ? 'gap-3 px-3 justify-start' : 'gap-0 px-0 justify-center',
                                isSigningOut && 'opacity-50 cursor-not-allowed'
                            )}
                        >
                            <div className="p-1.5 rounded-lg">
                                {isSigningOut ? (
                                    <Loader2 className="size-5 animate-spin" />
                                ) : (
                                    <LogOut className="size-5" />
                                )}
                            </div>
                            <m.span
                                variants={sidebarItemText}
                                className="font-medium whitespace-nowrap"
                            >
                                Sign Out
                            </m.span>
                        </button>
                    </div>
                </div>
            )}

            {/* Bottom Settings Button */}
            <div className="p-3 border-t border-white/5">
                <button
                    type="button"
                    onClick={() => onPageChange('settings')}
                    aria-label="Settings"
                    className={cn(
                        'w-full flex items-center py-2.5 rounded-xl transition-colors',
                        'hover:bg-white/5 group relative overflow-hidden',
                        isExpanded ? 'gap-3 px-3 justify-start' : 'gap-0 px-0 justify-center',
                        currentPage === 'settings' && 'bg-primary/10 border border-primary/20'
                    )}
                >
                    <div className={cn(
                        'relative z-10 p-1.5 rounded-lg transition-colors',
                        currentPage === 'settings'
                            ? 'text-primary text-glow-sm'
                            : 'text-muted-foreground group-hover:text-foreground'
                    )}>
                        <Settings className="size-5" />
                    </div>
                    <m.span
                        variants={sidebarItemText}
                        className={cn(
                            'relative z-10 font-medium whitespace-nowrap',
                            currentPage === 'settings'
                                ? 'text-foreground'
                                : 'text-muted-foreground group-hover:text-foreground'
                        )}
                    >
                        Settings
                    </m.span>
                    <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 rounded-xl transition-colors" />
                </button>
            </div>

            {/* Collapse Toggle */}
            <div className="p-3 border-t border-white/5">
                <button
                    type="button"
                    onClick={() => setIsExpanded(!isExpanded)}
                    aria-label={isExpanded ? "Collapse Sidebar" : "Expand Sidebar"}
                    className={cn(
                        'w-full flex items-center py-2.5 rounded-xl',
                        'text-muted-foreground hover:text-foreground hover:bg-white/5',
                        'transition-colors',
                        isExpanded ? 'gap-3 px-3 justify-start' : 'gap-0 px-0 justify-center'
                    )}
                >
                    <div className="p-1.5 rounded-lg">
                        {isExpanded ? (
                            <ChevronLeft className="size-5" />
                        ) : (
                            <ChevronRight className="size-5" />
                        )}
                    </div>
                    <m.span
                        variants={sidebarItemText}
                        className="font-medium whitespace-nowrap"
                    >
                        Collapse
                    </m.span>
                </button>
            </div>
        </m.aside>
        </LazyMotion>
    );
}
