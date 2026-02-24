// Data Sync Context - Provides cloud-synced data throughout the app
// Uses Google Drive as personal database
import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { gdriveService, isGDriveAvailable } from '@/services/gdriveService';
import { api, Download, SearchHistory, Setting } from '@/services/api';

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

    // Full sync with Google Drive
    syncWithGDrive: () => Promise<{ success: boolean; message: string }>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

interface DataProviderProps {
    children: ReactNode;
}

export function DataProvider({ children }: DataProviderProps) {
    const { user, isGDriveReady, hasGDriveToken } = useAuth();

    const [downloads, setDownloads] = useState<Download[]>([]);
    const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
    const [settings, setSettings] = useState<Setting[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [storageType, setStorageType] = useState<'local' | 'gdrive'>('local');
    const [hasAutoSynced, setHasAutoSynced] = useState(false);

    // Subscribe to Google Drive updates when user is logged in with GDrive access
    useEffect(() => {
        // Wait for GDrive loading to complete before making any decisions
        if (!isGDriveReady) {
            console.log('[DataContext] Waiting for GDrive ready state...');
            return;
        }

        console.log('[DataContext] Ready check:', {
            hasUser: !!user,
            isGDriveReady,
            hasGDriveToken,
            isGDriveAvailable: isGDriveAvailable()
        });

        if (!user) {
            // User not logged in - load from local database via Tauri
            console.log('[DataContext] No user, using local storage');
            setStorageType('local');
            loadLocalData();
            return;
        }

        // Check if Google Drive is available - use both in-memory check AND the hasGDriveToken flag
        const gdriveAvailable = isGDriveAvailable() || hasGDriveToken;

        if (!gdriveAvailable) {
            console.log('[DataContext] User logged in but no Google Drive access, using local storage');
            setStorageType('local');
            loadLocalData();
            return;
        }

        // User logged in with Google Drive access
        console.log('[DataContext] ✓ Google Drive available, setting up subscriptions');
        setStorageType('gdrive');
        setIsLoading(true);
        const unsubscribers: (() => void)[] = [];

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
    }, [user, isGDriveReady, hasGDriveToken]);


    // Note: GDrive token cleanup is now handled in AuthContext.signOut()
    // Previously there was a useEffect here that cleared the token when user was null,
    // but this caused issues because user is null on startup before Firebase restores auth state

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

    // Full bidirectional sync with Google Drive
    const syncWithGDrive = useCallback(async (): Promise<{ success: boolean; message: string }> => {
        if (!user) {
            return { success: false, message: 'Please sign in to sync with Google Drive' };
        }

        if (!isGDriveAvailable()) {
            console.warn('[DataContext] Sync blocked: isGDriveAvailable() returned false', {
                hasUser: !!user,
                isGDriveReady,
                // Check internal gdriveService state if possible via public methods
                hasTokenInMemory: !!gdriveService.testConnection // Just a placeholder check
            });
            return { success: false, message: 'Google Drive access not available. Please sign in with Google.' };
        }

        setIsSyncing(true);
        try {
            console.log('[DataContext] Starting full sync with Google Drive...');

            // Step 1: Get all local data
            const [localDownloads, localSearchHistory, localSettings] = await Promise.all([
                api.getDownloads(),
                api.getSearchHistory(1000),
                api.getAllSettings(),
            ]);

            // Step 2: Get all data from Google Drive
            const [gdriveDownloads, gdriveSearchHistory, gdriveSettings] = await Promise.all([
                gdriveService.getDownloads(user.uid),
                gdriveService.getSearchHistory(user.uid, 1000),
                gdriveService.getAllSettings(user.uid),
            ]);

            // Step 3: Merge data (keeping unique items from both sources)
            // Downloads: merge by id
            const mergedDownloadsMap = new Map<string, Download>();
            [...localDownloads, ...gdriveDownloads].forEach(d => {
                const existing = mergedDownloadsMap.get(d.id);
                if (!existing || (d.timestamp && existing.timestamp && d.timestamp > existing.timestamp)) {
                    mergedDownloadsMap.set(d.id, d);
                }
            });
            const mergedDownloads = Array.from(mergedDownloadsMap.values()).sort((a, b) =>
                (b.timestamp || 0) - (a.timestamp || 0)
            );

            // Search History: merge by id
            const mergedHistoryMap = new Map<string, SearchHistory>();
            [...localSearchHistory, ...gdriveSearchHistory].forEach(h => {
                const existing = mergedHistoryMap.get(h.id);
                if (!existing || (h.timestamp && existing.timestamp && h.timestamp > existing.timestamp)) {
                    mergedHistoryMap.set(h.id, h);
                }
            });
            const mergedHistory = Array.from(mergedHistoryMap.values()).sort((a, b) =>
                (b.timestamp || 0) - (a.timestamp || 0)
            );

            // Settings: merge by key (prefer newest or use GDrive as source of truth)
            const mergedSettingsMap = new Map<string, Setting>();
            [...localSettings, ...gdriveSettings].forEach(s => {
                mergedSettingsMap.set(s.key, s);
            });
            const mergedSettings = Array.from(mergedSettingsMap.values());

            // Step 4: Save merged data to Google Drive
            await gdriveService.migrateLocalData(
                user.uid,
                mergedDownloads,
                mergedHistory,
                mergedSettings
            );

            // Step 5: Update local state
            setDownloads(mergedDownloads);
            setSearchHistory(mergedHistory);
            setSettings(mergedSettings);

            // Step 6: Also save merged data to local storage for offline access
            // Clear and re-add to ensure sync (this is a full sync)
            await api.clearDownloads();
            for (const download of mergedDownloads) {
                await api.addDownload(download);
            }
            await api.clearSearchHistory();
            for (const search of mergedHistory) {
                await api.addSearch(search.query, search.title, search.thumbnail);
            }
            for (const setting of mergedSettings) {
                await api.saveSetting(setting.key, setting.value);
            }

            console.log('[DataContext] Full sync completed successfully!');
            console.log(`[DataContext] Synced: ${mergedDownloads.length} downloads, ${mergedHistory.length} searches, ${mergedSettings.length} settings`);

            return {
                success: true,
                message: `Synced ${mergedDownloads.length} downloads, ${mergedHistory.length} searches, ${mergedSettings.length} settings`
            };
        } catch (error) {
            console.error('[DataContext] Sync failed:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Sync failed. Please try again.'
            };
        } finally {
            setIsSyncing(false);
        }
    }, [user]);

    // Automatic Sync on Boot
    useEffect(() => {
        const gdriveAvailable = isGDriveAvailable() || hasGDriveToken;
        if (user && isGDriveReady && gdriveAvailable && !hasAutoSynced && !isLoading) {
            console.log('[DataContext] Automated GDrive sync starting...');
            // Delay slightly to ensure subscriptions are active and stable
            const timer = setTimeout(() => {
                syncWithGDrive().then((result) => {
                    if (result.success) {
                        console.log('[DataContext] Automated GDrive sync completed');
                        setHasAutoSynced(true);
                    }
                }).catch(err => {
                    console.error('[DataContext] Automated sync failed:', err);
                });
            }, 3000); // 3 second delay for stability
            return () => clearTimeout(timer);
        }
    }, [user, isGDriveReady, hasGDriveToken, hasAutoSynced, isLoading, syncWithGDrive]);

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
        syncWithGDrive,
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
