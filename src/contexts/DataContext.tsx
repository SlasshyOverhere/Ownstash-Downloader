// Data Sync Context - Provides cloud-synced data throughout the app
// Now uses Google Drive as personal database instead of Firestore
import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { gdriveService, isGDriveAvailable, clearGDriveAccessToken } from '@/services/gdriveService';
import { Download, SearchHistory, Setting } from '@/services/firestore';
import { api } from '@/services/api';

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

    // Storage info
    storageType: 'local' | 'gdrive';

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
    const [storageType, setStorageType] = useState<'local' | 'gdrive'>('local');

    // Subscribe to Google Drive updates when user is logged in with GDrive access
    useEffect(() => {
        if (!user) {
            // User not logged in - load from local database via Tauri
            setStorageType('local');
            loadLocalData();
            return;
        }

        // Check if Google Drive is available (user signed in with Google)
        if (!isGDriveAvailable()) {
            console.log('[DataContext] User logged in but no Google Drive access, using local storage');
            setStorageType('local');
            loadLocalData();
            return;
        }

        // User logged in with Google Drive access
        setStorageType('gdrive');
        setIsLoading(true);
        const unsubscribers: (() => void)[] = [];

        console.log('[DataContext] Setting up Google Drive subscriptions');

        // Subscribe to downloads
        unsubscribers.push(
            gdriveService.subscribeToDownloads(user.uid, (data) => {
                setDownloads(data);
                setIsLoading(false);
            })
        );

        // Subscribe to search history
        unsubscribers.push(
            gdriveService.subscribeToSearchHistory(user.uid, (data) => {
                setSearchHistory(data);
            })
        );

        // Subscribe to settings
        unsubscribers.push(
            gdriveService.subscribeToSettings(user.uid, (data) => {
                setSettings(data);
            })
        );

        return () => {
            console.log('[DataContext] Cleaning up subscriptions');
            unsubscribers.forEach(unsub => unsub());
        };
    }, [user]);

    // Clean up GDrive token on logout
    useEffect(() => {
        if (!user) {
            clearGDriveAccessToken();
        }
    }, [user]);

    // Load data from local Tauri database (fallback when not logged in or no GDrive access)
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

        // If user is logged in with GDrive, sync to Google Drive
        if (user && isGDriveAvailable()) {
            setIsSyncing(true);
            try {
                await gdriveService.addDownload(user.uid, download);
            } catch (error) {
                console.error('[DataContext] Failed to sync download to GDrive:', error);
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

        if (user && isGDriveAvailable()) {
            setIsSyncing(true);
            try {
                await gdriveService.updateDownloadStatus(user.uid, id, status);
            } catch (error) {
                console.error('[DataContext] Failed to sync status to GDrive:', error);
            } finally {
                setIsSyncing(false);
            }
        } else {
            setDownloads(prev => prev.map(d => d.id === id ? { ...d, status } : d));
        }
    }, [user]);

    const deleteDownload = useCallback(async (id: string) => {
        await api.deleteDownload(id);

        if (user && isGDriveAvailable()) {
            setIsSyncing(true);
            try {
                await gdriveService.deleteDownload(user.uid, id);
            } catch (error) {
                console.error('[DataContext] Failed to delete from GDrive:', error);
            } finally {
                setIsSyncing(false);
            }
        } else {
            setDownloads(prev => prev.filter(d => d.id !== id));
        }
    }, [user]);

    const clearDownloads = useCallback(async () => {
        await api.clearDownloads();

        if (user && isGDriveAvailable()) {
            setIsSyncing(true);
            try {
                await gdriveService.clearDownloads(user.uid);
            } catch (error) {
                console.error('[DataContext] Failed to clear downloads in GDrive:', error);
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

        if (user && isGDriveAvailable()) {
            setIsSyncing(true);
            try {
                await gdriveService.addSearch(user.uid, query, title, thumbnail);
            } catch (error) {
                console.error('[DataContext] Failed to sync search to GDrive:', error);
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

        if (user && isGDriveAvailable()) {
            setIsSyncing(true);
            try {
                await gdriveService.clearSearchHistory(user.uid);
            } catch (error) {
                console.error('[DataContext] Failed to clear search history in GDrive:', error);
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

        if (user && isGDriveAvailable()) {
            setIsSyncing(true);
            try {
                await gdriveService.saveSetting(user.uid, key, value);
            } catch (error) {
                console.error('[DataContext] Failed to sync setting to GDrive:', error);
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

        if (user && isGDriveAvailable()) {
            setIsSyncing(true);
            try {
                await gdriveService.deleteSetting(user.uid, key);
            } catch (error) {
                console.error('[DataContext] Failed to delete setting from GDrive:', error);
            } finally {
                setIsSyncing(false);
            }
        } else {
            setSettings(prev => prev.filter(s => s.key !== key));
        }
    }, [user]);

    // Migrate local data to Google Drive
    const migrateLocalData = useCallback(async () => {
        if (!user || !isGDriveAvailable()) {
            console.log('[DataContext] Cannot migrate: no user or no GDrive access');
            return;
        }

        setIsSyncing(true);
        try {
            // Get all local data
            const [localDownloads, localSearchHistory, localSettings] = await Promise.all([
                api.getDownloads(),
                api.getSearchHistory(1000), // Get all history for migration
                api.getAllSettings(),
            ]);

            // Migrate to Google Drive
            await gdriveService.migrateLocalData(
                user.uid,
                localDownloads,
                localSearchHistory,
                localSettings
            );

            console.log('[DataContext] Successfully migrated local data to Google Drive');
        } catch (error) {
            console.error('[DataContext] Failed to migrate local data:', error);
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
        storageType,
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
