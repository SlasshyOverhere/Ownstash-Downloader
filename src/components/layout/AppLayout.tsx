import { ReactNode, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimatedSidebar } from './AnimatedSidebar';
import { pageTransition } from '@/lib/animations';
import type { PageType } from '@/App';

interface AppLayoutProps {
    children: ReactNode;
    currentPage: PageType;
    onPageChange: (page: PageType) => void;
}

function LoadingFallback() {
    return (
        <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
    );
}

export function AppLayout({ children, currentPage, onPageChange }: AppLayoutProps) {
    return (
        <div className="h-screen w-screen overflow-hidden flex bg-background">
            {/* Background layers */}
            <div className="fixed inset-0 pointer-events-none">
                {/* Base gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" />

                {/* Simple animated gradient orbs instead of Three.js */}
                <div className="absolute w-96 h-96 -left-48 -top-48 bg-white/5 rounded-full blur-3xl animate-pulse" />
                <div className="absolute w-96 h-96 -right-48 -bottom-48 bg-white/3 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
                <div className="absolute w-64 h-64 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/2 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
            </div>

            {/* Sidebar */}
            <AnimatedSidebar
                currentPage={currentPage}
                onPageChange={onPageChange}
            />

            {/* Main content area */}
            <main className="flex-1 relative overflow-hidden">
                <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={currentPage}
                            variants={pageTransition}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="min-h-full p-6"
                        >
                            <Suspense fallback={<LoadingFallback />}>
                                {children}
                            </Suspense>
                        </motion.div>
                    </AnimatePresence>
                </div>
            </main>
        </div>
    );
}
