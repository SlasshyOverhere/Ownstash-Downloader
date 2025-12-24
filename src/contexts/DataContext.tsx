// Data Sync Context - Provides cloud-synced data throughout the app
import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { firestoreService, Download, SearchHistory, Setting } from '@/services/firestore';
import { api } from '@/services/api';
import { Unsubscribe } from 'firebase/firestore';

interface DataContextType {
    // Downloads
    downloads: Download[];
    addDownload: (download: Download) => Promise<void>;
    updateDownloadStatus: (id: string, status: string) => Promise<void>;
    deleteDownload: (id: string) => Promise<void>;
    clearDownloads: () => Promise<void>;

    // Search History
    searchHistory: SearchHistory[];
    addSearch: (query: string, title?: string, thumbnail?: string) => Promise<void>;
    clearSearchHistory: () => Promise<void>;

    // Settings
    settings: Setting[];
    saveSetting: (key: string, value: string) => Promise<void>;
    getSetting: (key: string) => string | null;
    deleteSetting: (key: string) => Promise<void>;

    // Loading states
    isLoading: boolean;
    isSyncing: boolean;

    // Migration
    migrateLocalData: () => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

interface DataProviderProps {
    children: ReactNode;
}

export function DataProvider({ children }: DataProviderProps) {
    const { user } = useAuth();

    const [downloads, setDownloads] = useState<Download[]>([]);
    const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
    const [settings, setSettings] = useState<Setting[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);

    // Subscribe to Firestore updates when user is logged in
    useEffect(() => {
        if (!user) {
            // User not logged in - load from local database via Tauri
            loadLocalData();
            return;
        }

        setIsLoading(true);
        const unsubscribers: Unsubscribe[] = [];

        // Subscribe to downloads
        unsubscribers.push(
            firestoreService.subscribeToDownloads(user.uid, (data) => {
                setDownloads(data);
                setIsLoading(false);
            })
        );

        // Subscribe to search history
        unsubscribers.push(
            firestoreService.subscribeToSearchHistory(user.uid, (data) => {
                setSearchHistory(data);
            })
        );

        // Subscribe to settings
        unsubscribers.push(
            firestoreService.subscribeToSettings(user.uid, (data) => {
                setSettings(data);
            })
        );

        return () => {
            unsubscribers.forEach(unsub => unsub());
        };
    }, [user]);

    // Load data from local Tauri database (fallback when not logged in)
    const loadLocalData = async () => {
        try {
            setIsLoading(true);
            const [localDownloads, localSearchHistory, localSettings] = await Promise.all([
                api.getDownloads(),
                api.getSearchHistory(50),
                api.getAllSettings(),
            ]);
            setDownloads(localDownloads);
            setSearchHistory(localSearchHistory);
            setSettings(localSettings);
        } catch (error) {
            console.error('Failed to load local data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Downloads methods
    const addDownload = useCallback(async (download: Download) => {
        // Always save to local database first
        await api.addDownload(download);

        // If user is logged in, sync to Firestore
        if (user) {
            setIsSyncing(true);
            try {
                await firestoreService.addDownload(user.uid, download);
            } finally {
                setIsSyncing(false);
            }
        } else {
            // Update local state
            setDownloads(prev => [download, ...prev]);
        }
    }, [user]);

    const updateDownloadStatus = useCallback(async (id: string, status: string) => {
        await api.updateDownloadStatus(id, status);

        if (user) {
            setIsSyncing(true);
            try {
                await firestoreService.updateDownloadStatus(user.uid, id, status);
            } finally {
                setIsSyncing(false);
            }
        } else {
            setDownloads(prev => prev.map(d => d.id === id ? { ...d, status } : d));
        }
    }, [user]);

    const deleteDownload = useCallback(async (id: string) => {
        await api.deleteDownload(id);

        if (user) {
            setIsSyncing(true);
            try {
                await firestoreService.deleteDownload(user.uid, id);
            } finally {
                setIsSyncing(false);
            }
        } else {
            setDownloads(prev => prev.filter(d => d.id !== id));
        }
    }, [user]);

    const clearDownloads = useCallback(async () => {
        await api.clearDownloads();

        if (user) {
            setIsSyncing(true);
            try {
                await firestoreService.clearDownloads(user.uid);
            } finally {
                setIsSyncing(false);
            }
        } else {
            setDownloads([]);
        }
    }, [user]);

    // Search History methods
    const addSearch = useCallback(async (query: string, title?: string, thumbnail?: string) => {
        await api.addSearch(query, title, thumbnail);

        if (user) {
            setIsSyncing(true);
            try {
                await firestoreService.addSearch(user.uid, query, title, thumbnail);
            } finally {
                setIsSyncing(false);
            }
        } else {
            const newSearch: SearchHistory = {
                id: crypto.randomUUID(),
                query,
                timestamp: Date.now(),
                title,
                thumbnail,
            };
            setSearchHistory(prev => [newSearch, ...prev].slice(0, 50));
        }
    }, [user]);

    const clearSearchHistory = useCallback(async () => {
        await api.clearSearchHistory();

        if (user) {
            setIsSyncing(true);
            try {
                await firestoreService.clearSearchHistory(user.uid);
            } finally {
                setIsSyncing(false);
            }
        } else {
            setSearchHistory([]);
        }
    }, [user]);

    // Settings methods
    const saveSetting = useCallback(async (key: string, value: string) => {
        await api.saveSetting(key, value);

        if (user) {
            setIsSyncing(true);
            try {
                await firestoreService.saveSetting(user.uid, key, value);
            } finally {
                setIsSyncing(false);
            }
        } else {
            setSettings(prev => {
                const existing = prev.findIndex(s => s.key === key);
                if (existing >= 0) {
                    const updated = [...prev];
                    updated[existing] = { key, value };
                    return updated;
                }
                return [...prev, { key, value }];
            });
        }
    }, [user]);

    const getSetting = useCallback((key: string): string | null => {
        const setting = settings.find(s => s.key === key);
        return setting?.value ?? null;
    }, [settings]);

    const deleteSetting = useCallback(async (key: string) => {
        await api.deleteSetting(key);

        if (user) {
            setIsSyncing(true);
            try {
                await firestoreService.deleteSetting(user.uid, key);
            } finally {
                setIsSyncing(false);
            }
        } else {
            setSettings(prev => prev.filter(s => s.key !== key));
        }
    }, [user]);

    // Migrate local data to cloud
    const migrateLocalData = useCallback(async () => {
        if (!user) return;

        setIsSyncing(true);
        try {
            // Get all local data
            const [localDownloads, localSearchHistory, localSettings] = await Promise.all([
                api.getDownloads(),
                api.getSearchHistory(1000), // Get all history for migration
                api.getAllSettings(),
            ]);

            // Migrate to Firestore
            await firestoreService.migrateLocalData(
                user.uid,
                localDownloads,
                localSearchHistory,
                localSettings
            );

            console.log('Successfully migrated local data to cloud');
        } catch (error) {
            console.error('Failed to migrate local data:', error);
            throw error;
        } finally {
            setIsSyncing(false);
        }
    }, [user]);

    const value: DataContextType = {
        downloads,
        addDownload,
        updateDownloadStatus,
        deleteDownload,
        clearDownloads,
        searchHistory,
        addSearch,
        clearSearchHistory,
        settings,
        saveSetting,
        getSetting,
        deleteSetting,
        isLoading,
        isSyncing,
        migrateLocalData,
    };

    return (
        <DataContext.Provider value={value}>
            {children}
        </DataContext.Provider>
    );
}

export function useData() {
    const context = useContext(DataContext);
    if (context === undefined) {
        throw new Error('useData must be used within a DataProvider');
    }
    return context;
}

export default DataContext;
