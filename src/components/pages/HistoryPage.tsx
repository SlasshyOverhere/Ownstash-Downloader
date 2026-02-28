import { useState, useEffect, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import {
    Search,
    Trash2,
    Video,
    Music,
    FileDown,
    Calendar,
    Filter,
    Clock,
    Link,
    Loader2,
    ExternalLink,
    Copy,
    FolderOpen
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { staggerContainer, staggerItem, fadeInUp } from '@/lib/animations';
import { use3DTilt } from '@/hooks/use3DTilt';
import { toast } from 'sonner';
import api, { SearchHistory, Download as DownloadType, formatBytes } from '@/services/api';

type HistoryTab = 'downloads' | 'searches';

function formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    // Handle edge cases
    if (diff < 0 || isNaN(diff)) return 'Just now';

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
    if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) !== 1 ? 's' : ''} ago`;

    return new Date(timestamp).toLocaleDateString();
}

function formatFullDateTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}


const typeIcons = {
    video: Video,
    audio: Music,
    file: FileDown,
};

interface DownloadHistoryCardProps {
    item: DownloadType;
    onDelete: (id: string) => void;
    onOpenFolder: (path: string) => void;
}

const DownloadHistoryCard = memo(function DownloadHistoryCard({ item, onDelete, onOpenFolder }: DownloadHistoryCardProps) {
    const { ref, tiltStyle, handlers } = use3DTilt({ maxTilt: 5, scale: 1.01 });

    const getType = (): 'video' | 'audio' | 'file' => {
        const format = item.format?.toLowerCase() || '';
        if (format === 'mp3' || format.includes('audio')) return 'audio';
        return 'video';
    };

    const TypeIcon = typeIcons[getType()];

    return (
        <motion.div
            ref={ref}
            style={tiltStyle}
            {...handlers}
            variants={staggerItem}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -100 }}
            className="glass-hover rounded-2xl p-4 border-glow group"
        >
            <div className="flex items-center gap-4">
                {/* Thumbnail */}
                <div className="w-20 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0 overflow-hidden">
                    {item.thumbnail ? (
                        <img
                            src={item.thumbnail}
                            alt={item.title}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <TypeIcon className="w-7 h-7 text-primary" />
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{item.title}</h3>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="capitalize">{item.platform || 'Unknown'}</span>
                        <span>•</span>
                        {item.size_bytes && <span>{formatBytes(item.size_bytes)}</span>}
                        {item.format && (
                            <>
                                <span>•</span>
                                <span className="uppercase text-xs px-1.5 py-0.5 rounded bg-muted">
                                    {item.format}
                                </span>
                            </>
                        )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1 flex-wrap">
                        <Calendar className="w-3 h-3" />
                        <span>{formatTimeAgo(item.timestamp)}</span>
                        <span>•</span>
                        <span>{formatFullDateTime(item.timestamp)}</span>
                        <span>•</span>
                        <span className={cn(
                            'capitalize',
                            item.status === 'completed' && 'text-white',
                            item.status === 'failed' && 'text-white/50'
                        )}>
                            {item.status}
                        </span>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {item.path && (
                        <button
                            onClick={() => onOpenFolder(item.path)}
                            className="p-2 rounded-lg hover:bg-primary/20 text-primary transition-colors"
                            title="Open download folder"
                        >
                            <FolderOpen className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        onClick={() => {
                            navigator.clipboard.writeText(item.url);
                            toast.success('URL copied to clipboard');
                        }}
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                        title="Copy URL"
                    >
                        <Copy className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => onDelete(item.id)}
                        className="p-2 rounded-lg hover:bg-destructive/20 text-destructive transition-colors"
                        title="Delete from history"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </motion.div>
    );
});

interface SearchHistoryCardProps {
    item: SearchHistory;
    onSelect: (query: string) => void;
}

const SearchHistoryCard = memo(function SearchHistoryCard({ item, onSelect }: SearchHistoryCardProps) {
    const { ref, tiltStyle, handlers } = use3DTilt({ maxTilt: 5, scale: 1.01 });

    return (
        <motion.div
            ref={ref}
            style={tiltStyle}
            {...handlers}
            variants={staggerItem}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -100 }}
            className="glass-hover rounded-2xl p-4 border-glow group cursor-pointer"
            onClick={() => onSelect(item.query)}
        >
            <div className="flex items-center gap-4">
                {/* Thumbnail */}
                <div className="w-20 h-14 rounded-xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center shrink-0 overflow-hidden">
                    {item.thumbnail ? (
                        <img
                            src={item.thumbnail}
                            alt={item.title || 'Search result'}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <Link className="w-6 h-6 text-blue-400" />
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    {item.title && (
                        <h3 className="font-semibold truncate text-sm">{item.title}</h3>
                    )}
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{item.query}</p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                        <Clock className="w-3 h-3" />
                        <span>{formatTimeAgo(item.timestamp)}</span>
                        <span>•</span>
                        <span>{formatFullDateTime(item.timestamp)}</span>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(item.query);
                            toast.success('URL copied to clipboard');
                        }}
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                        title="Copy URL"
                    >
                        <Copy className="w-4 h-4" />
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            window.open(item.query, '_blank');
                        }}
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                        title="Open URL"
                    >
                        <ExternalLink className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </motion.div>
    );
});

export function HistoryPage() {
    const [activeTab, setActiveTab] = useState<HistoryTab>('downloads');
    const [searchQuery, setSearchQuery] = useState('');
    const [downloads, setDownloads] = useState<DownloadType[]>([]);
    const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'failed'>('all');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [dls, searches] = await Promise.all([
                api.getDownloads(),
                api.getSearchHistory(100),
            ]);
            setDownloads(dls);
            setSearchHistory(searches);
        } catch (err) {
            toast.error('Failed to load history');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteDownload = useCallback(async (id: string) => {
        try {
            await api.deleteDownload(id);
            setDownloads(prev => prev.filter(d => d.id !== id));
            toast.success('Removed from history');
        } catch (err) {
            toast.error('Failed to delete');
        }
    }, []);

    const handleClearDownloads = async () => {
        try {
            await api.clearDownloads();
            setDownloads([]);
            toast.success('Download history cleared');
        } catch (err) {
            toast.error('Failed to clear history');
        }
    };

    const handleClearSearchHistory = async () => {
        try {
            await api.clearSearchHistory();
            setSearchHistory([]);
            toast.success('Search history cleared');
        } catch (err) {
            toast.error('Failed to clear history');
        }
    };

    const handleSelectSearch = useCallback((query: string) => {
        // Copy to clipboard and show toast
        navigator.clipboard.writeText(query);
        toast.success('URL copied! Paste it on the Home page to download.');
    }, []);

    const handleOpenFolder = useCallback(async (path: string) => {
        try {
            await api.openFolder(path);
        } catch (err) {
            toast.error('Failed to open folder');
        }
    }, []);

    // Filter downloads
    const filteredDownloads = downloads.filter(item => {
        const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.platform?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.url.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = filterStatus === 'all' || item.status === filterStatus;
        return matchesSearch && matchesStatus;
    });

    // Filter search history
    const filteredSearches = searchHistory.filter(item =>
        item.query.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="max-w-4xl mx-auto space-y-6"
        >
            {/* Header */}
            <motion.div variants={fadeInUp} className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-display font-bold">History</h1>
                    <p className="text-muted-foreground">Browse your download and search history</p>
                </div>
                <button
                    onClick={activeTab === 'downloads' ? handleClearDownloads : handleClearSearchHistory}
                    className="px-4 py-2 rounded-xl glass-hover text-sm font-medium text-destructive flex items-center gap-2"
                >
                    <Trash2 className="w-4 h-4" />
                    Clear {activeTab === 'downloads' ? 'Downloads' : 'Searches'}
                </button>
            </motion.div>

            {/* Tabs */}
            <motion.div variants={fadeInUp} className="flex gap-2 p-1 rounded-xl bg-muted/30">
                <button
                    onClick={() => setActiveTab('downloads')}
                    className={cn(
                        'flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg transition-all',
                        activeTab === 'downloads'
                            ? 'bg-white text-black font-semibold'
                            : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                    )}
                >
                    <Video className="w-5 h-5" />
                    <span className="font-medium">Downloads</span>
                    <span className="text-xs opacity-70">({downloads.length})</span>
                </button>
                <button
                    onClick={() => setActiveTab('searches')}
                    className={cn(
                        'flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg transition-all',
                        activeTab === 'searches'
                            ? 'bg-white text-black font-semibold'
                            : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                    )}
                >
                    <Search className="w-5 h-5" />
                    <span className="font-medium">Search History</span>
                    <span className="text-xs opacity-70">({searchHistory.length})</span>
                </button>
            </motion.div>

            {/* Search and Filter */}
            <motion.div variants={fadeInUp} className="flex gap-3">
                {/* Search */}
                <div className="flex-1 relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={`Search ${activeTab}...`}
                        className="w-full h-12 pl-12 pr-4 rounded-xl glass bg-transparent border-none outline-none focus:ring-2 focus:ring-primary/50"
                    />
                </div>

                {/* Filter buttons (for downloads) */}
                {activeTab === 'downloads' && (
                    <div className="flex items-center gap-1 glass rounded-xl p-1">
                        {(['all', 'completed', 'failed'] as const).map((status) => (
                            <button
                                key={status}
                                onClick={() => setFilterStatus(status)}
                                className={cn(
                                    'px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all',
                                    filterStatus === status
                                        ? 'bg-white text-black'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                                )}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                )}
            </motion.div>

            {/* Loading state */}
            {isLoading && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            )}

            {/* Downloads List */}
            {!isLoading && activeTab === 'downloads' && (
                <motion.div variants={staggerContainer} className="space-y-3">
                    {filteredDownloads.map(item => (
                        <DownloadHistoryCard
                            key={item.id}
                            item={item}
                            onDelete={handleDeleteDownload}
                            onOpenFolder={handleOpenFolder}
                        />
                    ))}
                </motion.div>
            )}

            {/* Search History List */}
            {!isLoading && activeTab === 'searches' && (
                <motion.div variants={staggerContainer} className="space-y-3">
                    {filteredSearches.map(item => (
                        <SearchHistoryCard
                            key={item.id}
                            item={item}
                            onSelect={handleSelectSearch}
                        />
                    ))}
                </motion.div>
            )}

            {/* Empty states */}
            {!isLoading && activeTab === 'downloads' && filteredDownloads.length === 0 && (
                <motion.div
                    variants={fadeInUp}
                    className="flex flex-col items-center justify-center py-20 text-center"
                >
                    <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                        <Filter className="w-10 h-10 text-muted-foreground" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">
                        {downloads.length === 0 ? 'No downloads yet' : 'No results found'}
                    </h3>
                    <p className="text-muted-foreground max-w-sm">
                        {downloads.length === 0
                            ? 'Your completed downloads will appear here.'
                            : 'Try adjusting your search or filter.'}
                    </p>
                </motion.div>
            )}

            {!isLoading && activeTab === 'searches' && filteredSearches.length === 0 && (
                <motion.div
                    variants={fadeInUp}
                    className="flex flex-col items-center justify-center py-20 text-center"
                >
                    <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                        <Search className="w-10 h-10 text-muted-foreground" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">
                        {searchHistory.length === 0 ? 'No search history' : 'No results found'}
                    </h3>
                    <p className="text-muted-foreground max-w-sm">
                        {searchHistory.length === 0
                            ? 'URLs you search for will appear here.'
                            : 'Try a different search term.'}
                    </p>
                </motion.div>
            )}
        </motion.div>
    );
}
