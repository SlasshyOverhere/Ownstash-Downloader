/**
 * Cloud Sync Modal Component
 * 
 * Shows all files that haven't been uploaded to cloud yet.
 * User can select individual files or all, then upload selected.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cloud, Upload, X, Check, CheckSquare, Square, Loader2, FileVideo, FileAudio, File } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/services/api';

export interface PendingFile {
    id: string;
    original_name: string;
    encrypted_name: string;
    size_bytes: number;
    file_type: string;
}

export interface CloudSyncModalProps {
    isOpen: boolean;
    pendingFiles: PendingFile[];
    onClose: () => void;
    onUpload: (fileIds: string[]) => Promise<void>;
}

function FileIcon({ fileType }: { fileType: string }) {
    switch (fileType) {
        case 'video':
            return <FileVideo className="w-5 h-5 text-blue-400" />;
        case 'audio':
            return <FileAudio className="w-5 h-5 text-green-400" />;
        default:
            return <File className="w-5 h-5 text-gray-400" />;
    }
}

export function CloudSyncModal({
    isOpen,
    pendingFiles,
    onClose,
    onUpload
}: CloudSyncModalProps) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);

    // Reset selection when modal opens
    useEffect(() => {
        if (isOpen) {
            setSelectedIds(new Set());
            setUploadProgress(null);
        }
    }, [isOpen]);

    const allSelected = pendingFiles.length > 0 && selectedIds.size === pendingFiles.length;
    const someSelected = selectedIds.size > 0 && selectedIds.size < pendingFiles.length;

    const toggleFile = (fileId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(fileId)) {
                next.delete(fileId);
            } else {
                next.add(fileId);
            }
            return next;
        });
    };

    const toggleAll = () => {
        if (allSelected) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(pendingFiles.map(f => f.id)));
        }
    };

    const handleUpload = async () => {
        if (selectedIds.size === 0) return;

        setIsUploading(true);
        try {
            await onUpload(Array.from(selectedIds));
            onClose();
        } catch (error) {
            console.error('Upload failed:', error);
        } finally {
            setIsUploading(false);
            setUploadProgress(null);
        }
    };

    const totalSize = pendingFiles
        .filter(f => selectedIds.has(f.id))
        .reduce((sum, f) => sum + f.size_bytes, 0);

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
                        onClick={isUploading ? undefined : onClose}
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        transition={{ type: 'spring', duration: 0.5 }}
                        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                                   w-[520px] max-w-[90vw] max-h-[80vh] bg-card border border-white/10 rounded-2xl
                                   shadow-2xl overflow-hidden flex flex-col"
                    >
                        {/* Header */}
                        <div className="bg-gradient-to-r from-primary/20 to-accent/20 px-6 py-4 border-b border-white/10">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                                        <Cloud className="w-5 h-5 text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-lg">Upload to Cloud</h3>
                                        <p className="text-sm text-muted-foreground">
                                            {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''} pending upload
                                        </p>
                                    </div>
                                </div>
                                {!isUploading && (
                                    <button
                                        onClick={onClose}
                                        className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-hidden flex flex-col">
                            {pendingFiles.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center py-12 px-6">
                                    <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                                        <Check className="w-8 h-8 text-green-400" />
                                    </div>
                                    <p className="text-lg font-medium">All files synced!</p>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        All your vault files are backed up to cloud
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {/* Select All Header */}
                                    <div className="px-6 py-3 border-b border-white/5 flex items-center gap-3">
                                        <button
                                            onClick={toggleAll}
                                            disabled={isUploading}
                                            className="flex items-center gap-2 text-sm hover:text-primary transition-colors disabled:opacity-50"
                                        >
                                            {allSelected ? (
                                                <CheckSquare className="w-5 h-5 text-primary" />
                                            ) : someSelected ? (
                                                <div className="w-5 h-5 border-2 border-primary rounded flex items-center justify-center">
                                                    <div className="w-2 h-2 bg-primary rounded-sm" />
                                                </div>
                                            ) : (
                                                <Square className="w-5 h-5" />
                                            )}
                                            <span>{allSelected ? 'Deselect All' : 'Select All'}</span>
                                        </button>
                                        {selectedIds.size > 0 && (
                                            <span className="text-xs text-muted-foreground ml-auto">
                                                {selectedIds.size} selected • {formatBytes(totalSize)}
                                            </span>
                                        )}
                                    </div>

                                    {/* File List */}
                                    <div className="flex-1 overflow-y-auto px-4 py-2">
                                        {pendingFiles.map((file) => (
                                            <motion.div
                                                key={file.id}
                                                initial={{ opacity: 0, x: -10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                className={cn(
                                                    "flex items-center gap-3 p-3 rounded-xl mb-2 cursor-pointer transition-all",
                                                    selectedIds.has(file.id)
                                                        ? "bg-primary/10 border border-primary/30"
                                                        : "bg-white/5 border border-transparent hover:bg-white/10",
                                                    isUploading && "opacity-50 cursor-not-allowed"
                                                )}
                                                onClick={() => !isUploading && toggleFile(file.id)}
                                            >
                                                {/* Checkbox */}
                                                <div className="shrink-0">
                                                    {selectedIds.has(file.id) ? (
                                                        <CheckSquare className="w-5 h-5 text-primary" />
                                                    ) : (
                                                        <Square className="w-5 h-5 text-muted-foreground" />
                                                    )}
                                                </div>

                                                {/* File Icon */}
                                                <div className="shrink-0">
                                                    <FileIcon fileType={file.file_type} />
                                                </div>

                                                {/* File Info */}
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium truncate">
                                                        {file.original_name}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {formatBytes(file.size_bytes)} • {file.file_type}
                                                    </p>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Upload Progress */}
                        {isUploading && uploadProgress && (
                            <div className="px-6 py-3 border-t border-white/10 bg-primary/5">
                                <div className="flex items-center gap-3">
                                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">
                                            Uploading: {uploadProgress.fileName}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {uploadProgress.current} of {uploadProgress.total}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="px-6 py-4 border-t border-white/10 flex items-center gap-3">
                            <button
                                onClick={onClose}
                                disabled={isUploading}
                                className={cn(
                                    "flex-1 py-3 rounded-xl font-medium transition-all",
                                    "border border-white/10 hover:bg-white/5",
                                    "disabled:opacity-50 disabled:cursor-not-allowed"
                                )}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUpload}
                                disabled={selectedIds.size === 0 || isUploading}
                                className={cn(
                                    "flex-1 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2",
                                    "bg-gradient-to-r from-primary to-accent text-white",
                                    "disabled:opacity-50 disabled:cursor-not-allowed",
                                    !isUploading && "hover:opacity-90"
                                )}
                            >
                                {isUploading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Uploading...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="w-4 h-4" />
                                        Upload {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

export default CloudSyncModal;
