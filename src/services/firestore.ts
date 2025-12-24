// Firestore Data Service - Syncs downloads, search history, and settings to cloud
import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    deleteDoc,
    query,
    orderBy,
    limit,
    writeBatch,
    onSnapshot,
    serverTimestamp,
    Unsubscribe
} from 'firebase/firestore';
import { db } from '@/config/firebase';

// Types matching the local database structure
export interface Download {
    id: string;
    title: string;
    url: string;
    format: string;
    path: string;
    timestamp: number;
    status: string;
    size_bytes?: number;
    platform?: string;
    thumbnail?: string;
}

export interface SearchHistory {
    id: string;
    query: string;
    timestamp: number;
    title?: string;
    thumbnail?: string;
}

export interface Setting {
    key: string;
    value: string;
}

// Firestore collection paths
const getCollectionPath = (userId: string, collectionName: string) =>
    `users/${userId}/${collectionName}`;

// Firestore Data Service
export const firestoreService = {
    // ==================== DOWNLOADS ====================

    // Add a download record
    async addDownload(userId: string, download: Download): Promise<void> {
        const downloadRef = doc(db, getCollectionPath(userId, 'downloads'), download.id);
        await setDoc(downloadRef, {
            ...download,
            syncedAt: serverTimestamp(),
        });
    },

    // Get all downloads for a user
    async getDownloads(userId: string): Promise<Download[]> {
        const downloadsRef = collection(db, getCollectionPath(userId, 'downloads'));
        const q = query(downloadsRef, orderBy('timestamp', 'desc'));
        const snapshot = await getDocs(q);

        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                title: data.title,
                url: data.url,
                format: data.format,
                path: data.path,
                timestamp: data.timestamp,
                status: data.status,
                size_bytes: data.size_bytes,
                platform: data.platform,
                thumbnail: data.thumbnail,
            } as Download;
        });
    },

    // Update download status
    async updateDownloadStatus(userId: string, id: string, status: string): Promise<void> {
        const downloadRef = doc(db, getCollectionPath(userId, 'downloads'), id);
        await setDoc(downloadRef, { status, syncedAt: serverTimestamp() }, { merge: true });
    },

    // Delete a download
    async deleteDownload(userId: string, id: string): Promise<void> {
        const downloadRef = doc(db, getCollectionPath(userId, 'downloads'), id);
        await deleteDoc(downloadRef);
    },

    // Clear all downloads
    async clearDownloads(userId: string): Promise<void> {
        const downloadsRef = collection(db, getCollectionPath(userId, 'downloads'));
        const snapshot = await getDocs(downloadsRef);

        const batch = writeBatch(db);
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
    },

    // Subscribe to downloads changes (real-time sync)
    subscribeToDownloads(userId: string, callback: (downloads: Download[]) => void): Unsubscribe {
        const downloadsRef = collection(db, getCollectionPath(userId, 'downloads'));
        const q = query(downloadsRef, orderBy('timestamp', 'desc'));

        return onSnapshot(q, (snapshot) => {
            const downloads = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    title: data.title,
                    url: data.url,
                    format: data.format,
                    path: data.path,
                    timestamp: data.timestamp,
                    status: data.status,
                    size_bytes: data.size_bytes,
                    platform: data.platform,
                    thumbnail: data.thumbnail,
                } as Download;
            });
            callback(downloads);
        });
    },

    // ==================== SEARCH HISTORY ====================

    // Add a search record
    async addSearch(userId: string, searchQuery: string, title?: string, thumbnail?: string): Promise<void> {
        const id = crypto.randomUUID();
        const searchRef = doc(db, getCollectionPath(userId, 'search_history'), id);
        await setDoc(searchRef, {
            id,
            query: searchQuery,
            timestamp: Date.now(),
            title,
            thumbnail,
            syncedAt: serverTimestamp(),
        });
    },

    // Get search history
    async getSearchHistory(userId: string, limitCount: number = 50): Promise<SearchHistory[]> {
        const searchRef = collection(db, getCollectionPath(userId, 'search_history'));
        const q = query(searchRef, orderBy('timestamp', 'desc'), limit(limitCount));
        const snapshot = await getDocs(q);

        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                query: data.query,
                timestamp: data.timestamp,
                title: data.title,
                thumbnail: data.thumbnail,
            } as SearchHistory;
        });
    },

    // Clear search history
    async clearSearchHistory(userId: string): Promise<void> {
        const searchRef = collection(db, getCollectionPath(userId, 'search_history'));
        const snapshot = await getDocs(searchRef);

        const batch = writeBatch(db);
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
    },

    // Subscribe to search history changes (real-time sync)
    subscribeToSearchHistory(userId: string, callback: (history: SearchHistory[]) => void, limitCount: number = 50): Unsubscribe {
        const searchRef = collection(db, getCollectionPath(userId, 'search_history'));
        const q = query(searchRef, orderBy('timestamp', 'desc'), limit(limitCount));

        return onSnapshot(q, (snapshot) => {
            const history = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    query: data.query,
                    timestamp: data.timestamp,
                    title: data.title,
                    thumbnail: data.thumbnail,
                } as SearchHistory;
            });
            callback(history);
        });
    },

    // ==================== SETTINGS ====================

    // Save a setting
    async saveSetting(userId: string, key: string, value: string): Promise<void> {
        const settingRef = doc(db, getCollectionPath(userId, 'settings'), key);
        await setDoc(settingRef, {
            key,
            value,
            syncedAt: serverTimestamp(),
        });
    },

    // Get a setting
    async getSetting(userId: string, key: string): Promise<string | null> {
        const settingRef = doc(db, getCollectionPath(userId, 'settings'), key);
        const snapshot = await getDoc(settingRef);

        if (snapshot.exists()) {
            return snapshot.data().value;
        }
        return null;
    },

    // Get all settings
    async getAllSettings(userId: string): Promise<Setting[]> {
        const settingsRef = collection(db, getCollectionPath(userId, 'settings'));
        const snapshot = await getDocs(settingsRef);

        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                key: doc.id,
                value: data.value,
            } as Setting;
        });
    },

    // Delete a setting
    async deleteSetting(userId: string, key: string): Promise<void> {
        const settingRef = doc(db, getCollectionPath(userId, 'settings'), key);
        await deleteDoc(settingRef);
    },

    // Subscribe to settings changes (real-time sync)
    subscribeToSettings(userId: string, callback: (settings: Setting[]) => void): Unsubscribe {
        const settingsRef = collection(db, getCollectionPath(userId, 'settings'));

        return onSnapshot(settingsRef, (snapshot) => {
            const settings = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    key: doc.id,
                    value: data.value,
                } as Setting;
            });
            callback(settings);
        });
    },

    // ==================== DATA MIGRATION ====================

    // Migrate local data to Firestore (call this after first login)
    async migrateLocalData(userId: string, localDownloads: Download[], localSearchHistory: SearchHistory[], localSettings: Setting[]): Promise<void> {
        const batch = writeBatch(db);

        // Migrate downloads
        for (const download of localDownloads) {
            const downloadRef = doc(db, getCollectionPath(userId, 'downloads'), download.id);
            batch.set(downloadRef, {
                ...download,
                syncedAt: serverTimestamp(),
            }, { merge: true });
        }

        // Migrate search history
        for (const search of localSearchHistory) {
            const searchRef = doc(db, getCollectionPath(userId, 'search_history'), search.id);
            batch.set(searchRef, {
                ...search,
                syncedAt: serverTimestamp(),
            }, { merge: true });
        }

        // Migrate settings
        for (const setting of localSettings) {
            const settingRef = doc(db, getCollectionPath(userId, 'settings'), setting.key);
            batch.set(settingRef, {
                ...setting,
                syncedAt: serverTimestamp(),
            }, { merge: true });
        }

        await batch.commit();
    },
};

export default firestoreService;
