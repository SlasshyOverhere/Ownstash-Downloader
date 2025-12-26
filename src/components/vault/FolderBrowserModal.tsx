/**
 * Folder Browser Modal Component
 * 
 * Displays the contents of an encrypted folder archive.
 * Allows users to browse folders, play media, and export files.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Folder,
    FolderOpen,
    X,
    Play,
    Download,
    ChevronRight,
    Home,
    FileVideo,
    FileAudio,
    Image as ImageIcon,
    File,
    Loader2,
    ArrowLeft,
    Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes, VaultFolderEntry, VaultFile } from '@/services/api';
import { toast } from 'sonner';

export interface FolderBrowserModalProps {
    isOpen: boolean;
    folder: VaultFile | null;
    onClose: () => void;
    onPlayFile: (filePath: string) => void;
    onExportFile: (filePath: string) => void;
    onViewImage: (filePath: string, fileName: string) => void;
}

// Get icon for file type
function FileIcon({ fileType, size = 5 }: { fileType: string; size?: number }) {
    const className = `w-${size} h-${size}`;
    switch (fileType) {
        case 'video':
            return <FileVideo className={cn(className, "text-blue-400")} />;
        case 'audio':
            return <FileAudio className={cn(className, "text-green-400")} />;
        case 'image':
            return <ImageIcon className={cn(className, "text-purple-400")} />;
        case 'directory':
            return <Folder className={cn(className, "text-yellow-400")} />;
        default:
            return <File className={cn(className, "text-gray-400")} />;
    }
}

// Breadcrumb component
function Breadcrumb({
    path,
    onNavigate
}: {
    path: string[];
    onNavigate: (index: number) => void;
}) {
    return (
        <div className="flex items-center gap-1 text-sm overflow-x-auto pb-1">
            <button
                onClick={() => onNavigate(-1)}
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 transition-colors shrink-0"
            >
                <Home className="w-4 h-4" />
            </button>
            {path.map((segment, index) => (
                <div key={index} className="flex items-center gap-1 shrink-0">
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    <button
                        onClick={() => onNavigate(index)}
                        className={cn(
                            "px-2 py-1 rounded transition-colors",
                            index === path.length - 1
                                ? "text-primary font-medium"
                                : "hover:bg-white/10"
                        )}
                    >
                        {segment}
                    </button>
                </div>
            ))}
        </div>
    );
}

export function FolderBrowserModal({
    isOpen,
    folder,
    onClose,
    onPlayFile,
    onExportFile,
    onViewImage
}: FolderBrowserModalProps) {
    const [currentPath, setCurrentPath] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<VaultFolderEntry | null>(null);

    // Reset path when folder changes
    useEffect(() => {
        if (isOpen && folder) {
            setCurrentPath([]);
            setSelectedFile(null);
        }
    }, [isOpen, folder]);

    // Early return only if folder is null (not for missing entries)
    if (!folder) return null;

    // Handle case where folder_entries might not be loaded yet
    const allEntries = folder.folder_entries || [];

    // Get current directory path as string (e.g., "subfolder1/subfolder2")
    const currentPathStr = currentPath.join('/');

    // Filter entries for current directory
    const currentEntries = allEntries.filter(entry => {
        const entryDir = entry.path.substring(0, entry.path.lastIndexOf('/'));
        const normalizedEntryDir = entryDir || '';
        return normalizedEntryDir === currentPathStr;
    }).sort((a, b) => {
        // Directories first, then files
        if (a.is_directory !== b.is_directory) {
            return a.is_directory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });

    // Navigate to directory
    const navigateToDir = (entry: VaultFolderEntry) => {
        if (entry.is_directory) {
            const pathParts = entry.path.split('/').filter(p => p);
            setCurrentPath(pathParts);
        }
    };

    // Navigate via breadcrumb
    const navigateBreadcrumb = (index: number) => {
        if (index < 0) {
            setCurrentPath([]);
        } else {
            setCurrentPath(currentPath.slice(0, index + 1));
        }
    };

    // Go back one level
    const goBack = () => {
        if (currentPath.length > 0) {
            setCurrentPath(currentPath.slice(0, -1));
        }
    };

    // Handle file action based on type
    const handleFileAction = async (entry: VaultFolderEntry) => {
        if (entry.is_directory) {
            navigateToDir(entry);
            return;
        }

        setIsLoading(true);
        setSelectedFile(entry);

        try {
            if (entry.file_type === 'video' || entry.file_type === 'audio') {
                onPlayFile(entry.path);
            } else if (entry.file_type === 'image') {
                onViewImage(entry.path, entry.name);
            } else {
                onExportFile(entry.path);
            }
        } catch (error) {
            console.error('[FolderBrowser] Action failed:', error);
            toast.error('Failed to process file');
        } finally {
            setIsLoading(false);
            setSelectedFile(null);
        }
    };

    // Get stats for current directory
    const stats = {
        folders: currentEntries.filter(e => e.is_directory).length,
        files: currentEntries.filter(e => !e.is_directory).length,
        totalSize: currentEntries
            .filter(e => !e.is_directory)
            .reduce((sum, e) => sum + e.size_bytes, 0)
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                        onClick={onClose}
                    />

                    {/* Modal Container - using flexbox for centering */}
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            transition={{ type: 'spring', duration: 0.4 }}
                            className="w-full max-w-[500px] max-h-[80vh] bg-card border border-white/10 rounded-2xl
                                       shadow-2xl overflow-hidden flex flex-col pointer-events-auto"
                        >
                            {/* Header */}
                            <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 px-4 sm:px-6 py-3 sm:py-4 border-b border-white/10">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                                            <FolderOpen className="w-5 h-5 text-yellow-400" />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="font-semibold text-base sm:text-lg truncate">{folder.original_name}</h3>
                                            <p className="text-sm text-muted-foreground">
                                                {allEntries.length} items • {formatBytes(folder.size_bytes)}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={onClose}
                                        className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            {/* Breadcrumb & Navigation */}
                            <div className="px-4 sm:px-6 py-2 sm:py-3 border-b border-white/5 flex items-center gap-2 sm:gap-3">
                                {currentPath.length > 0 && (
                                    <button
                                        onClick={goBack}
                                        className="p-2 rounded-lg hover:bg-white/10 transition-colors shrink-0"
                                    >
                                        <ArrowLeft className="w-4 h-4" />
                                    </button>
                                )}
                                <Breadcrumb
                                    path={currentPath}
                                    onNavigate={navigateBreadcrumb}
                                />
                            </div>

                            {/* Current directory stats */}
                            <div className="px-4 sm:px-6 py-2 bg-white/5 text-xs text-muted-foreground flex gap-3 sm:gap-4">
                                {stats.folders > 0 && (
                                    <span>{stats.folders} folder{stats.folders !== 1 ? 's' : ''}</span>
                                )}
                                {stats.files > 0 && (
                                    <span>{stats.files} file{stats.files !== 1 ? 's' : ''}</span>
                                )}
                                {stats.totalSize > 0 && (
                                    <span>{formatBytes(stats.totalSize)}</span>
                                )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 overflow-y-auto p-3 sm:p-4">
                                {currentEntries.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <Folder className="w-16 h-16 text-muted-foreground/30 mb-4" />
                                        <p className="text-muted-foreground">This folder is empty</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-2">
                                        {currentEntries.map((entry, index) => (
                                            <motion.div
                                                key={entry.path}
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: index * 0.02 }}
                                                className={cn(
                                                    "flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all",
                                                    "bg-white/5 border border-transparent",
                                                    "hover:bg-white/10 hover:border-white/10",
                                                    selectedFile?.path === entry.path && "opacity-50"
                                                )}
                                                onClick={() => handleFileAction(entry)}
                                            >
                                                {/* Icon */}
                                                <div className={cn(
                                                    "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                                                    entry.is_directory
                                                        ? "bg-yellow-500/20"
                                                        : entry.file_type === 'video'
                                                            ? "bg-blue-500/20"
                                                            : entry.file_type === 'audio'
                                                                ? "bg-green-500/20"
                                                                : entry.file_type === 'image'
                                                                    ? "bg-purple-500/20"
                                                                    : "bg-gray-500/20"
                                                )}>
                                                    <FileIcon fileType={entry.file_type} />
                                                </div>

                                                {/* Name & Info */}
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium truncate">{entry.name}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {entry.is_directory ? 'Folder' : (
                                                            <>
                                                                {formatBytes(entry.size_bytes)} • {entry.file_type}
                                                            </>
                                                        )}
                                                    </p>
                                                </div>

                                                {/* Action indicator */}
                                                <div className="shrink-0">
                                                    {selectedFile?.path === entry.path && isLoading ? (
                                                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                                                    ) : entry.is_directory ? (
                                                        <ChevronRight className="w-5 h-5 text-muted-foreground" />
                                                    ) : entry.file_type === 'video' || entry.file_type === 'audio' ? (
                                                        <Play className="w-5 h-5 text-primary" />
                                                    ) : entry.file_type === 'image' ? (
                                                        <Eye className="w-5 h-5 text-purple-400" />
                                                    ) : (
                                                        <Download className="w-5 h-5 text-muted-foreground" />
                                                    )}
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-white/10 flex items-center justify-between gap-2">
                                <p className="text-xs text-muted-foreground hidden sm:block">
                                    Click files to play/view • Click folders to browse
                                </p>
                                <button
                                    onClick={onClose}
                                    className={cn(
                                        "px-6 py-2 rounded-xl font-medium transition-all",
                                        "border border-white/10 hover:bg-white/5"
                                    )}
                                >
                                    Close
                                </button>
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
}

export default FolderBrowserModal;
