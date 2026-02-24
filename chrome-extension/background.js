/**
 * Ownstash Downloader - Background Service Worker
 * Handles extension lifecycle and context menu actions
 */

// ============================================
// Storage Keys
// ============================================
const STORAGE_KEYS = {
    ENABLED_SITES: 'ownstash_enabled_sites',
    SETTINGS: 'ownstash_settings',
    VAULT_DOWNLOAD_ENABLED: 'ownstash_vault_download_enabled'
};

// ============================================
// Installation Handler
// ============================================
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // First time installation
        console.log('Ownstash Downloader extension installed!');

        // Initialize with popular sites pre-enabled (Spotify excluded - better handled via app directly)
        const defaultSites = [
            { domain: 'youtube.com', addedAt: Date.now() },
            { domain: 'music.youtube.com', addedAt: Date.now() },
            { domain: 'soundcloud.com', addedAt: Date.now() },
            { domain: 'vimeo.com', addedAt: Date.now() },
        ];

        chrome.storage.local.set({
            [STORAGE_KEYS.ENABLED_SITES]: defaultSites,
            [STORAGE_KEYS.SETTINGS]: {
                showFloatingButton: true,
                buttonPosition: 'bottom-right',
                autoDetectMedia: true
            }
        });

        // Create context menu
        createContextMenu();
    } else if (details.reason === 'update') {
        console.log('Ownstash Downloader extension updated!');
        createContextMenu();
    }
});

// ============================================
// Context Menu
// ============================================
function createContextMenu() {
    // Remove existing menus
    chrome.contextMenus.removeAll(() => {
        // Download current page
        chrome.contextMenus.create({
            id: 'ownstash-download-page',
            title: 'Download with Ownstash',
            contexts: ['page', 'frame']
        });

        // Download link
        chrome.contextMenus.create({
            id: 'ownstash-download-link',
            title: 'Download link with Ownstash',
            contexts: ['link']
        });

        // Download media (video/audio)
        chrome.contextMenus.create({
            id: 'ownstash-download-media',
            title: 'Download media with Ownstash',
            contexts: ['video', 'audio']
        });

        // Separator
        chrome.contextMenus.create({
            id: 'ownstash-separator',
            type: 'separator',
            contexts: ['page', 'link', 'video', 'audio']
        });

        // Toggle site
        chrome.contextMenus.create({
            id: 'ownstash-toggle-site',
            title: 'Toggle this site in Ownstash',
            contexts: ['page']
        });
    });
}

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    let url = '';

    switch (info.menuItemId) {
        case 'ownstash-download-page':
            url = info.pageUrl || tab.url;
            break;

        case 'ownstash-download-link':
            url = info.linkUrl;
            break;

        case 'ownstash-download-media':
            url = info.srcUrl || info.pageUrl;
            break;

        case 'ownstash-toggle-site':
            await toggleSite(tab.url);
            return;
    }

    if (url) {
        sendToApp(url);
    }
});

// ============================================
// Site Management
// ============================================
async function toggleSite(pageUrl) {
    try {
        const url = new URL(pageUrl);
        const domain = url.hostname.replace(/^www\./, '');

        const result = await chrome.storage.local.get(STORAGE_KEYS.ENABLED_SITES);
        let sites = result[STORAGE_KEYS.ENABLED_SITES] || [];

        const existingIndex = sites.findIndex(site => site.domain === domain);

        if (existingIndex >= 0) {
            // Remove site
            sites.splice(existingIndex, 1);
            showNotification('Site removed', `${domain} has been removed from enabled sites`);
        } else {
            // Add site
            sites.push({ domain, addedAt: Date.now() });
            showNotification('Site added', `${domain} is now enabled for downloads`);
        }

        await chrome.storage.local.set({ [STORAGE_KEYS.ENABLED_SITES]: sites });

        // Notify content script
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            chrome.tabs.sendMessage(tab.id, {
                type: existingIndex >= 0 ? 'siteDisabled' : 'siteEnabled',
                domain
            }).catch(() => { });
        }
    } catch (e) {
        console.error('Failed to toggle site:', e);
    }
}

// ============================================
// Download Handler
// ============================================
const EXTENSION_SERVER_URL = 'http://127.0.0.1:47152';

async function sendToApp(url) {
    console.log('[Ownstash Background] Sending URL:', url);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // Reduced timeout for faster fallback

        const response = await fetch(`${EXTENSION_SERVER_URL}/download`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url: url }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                showNotification('Sent to Ownstash', 'The URL has been sent to Ownstash Downloader');
                return { success: true };
            } else {
                showNotification('Error', 'Failed to send to app');
                return { success: false, error: 'Failed to send to app' };
            }
        } else {
            showNotification('Error', 'App returned error: ' + response.status);
            return { success: false, error: 'App returned error: ' + response.status };
        }
    } catch (e) {
        console.error('[Ownstash Background] HTTP failed, trying deep link:', e);

        // App not running - try to launch it using deep link
        return await launchAppWithDeepLink(url);
    }
}

// Launch app using deep link protocol (ownstash://)
async function launchAppWithDeepLink(url) {
    try {
        // Construct deep link URL
        const encodedUrl = encodeURIComponent(url);
        const deepLinkUrl = `ownstash://download?url=${encodedUrl}`;

        console.log('[Ownstash Background] Opening deep link:', deepLinkUrl);

        // Try to open the deep link - this will launch the app if installed
        // Create a new tab with the deep link, then close it
        const tab = await chrome.tabs.create({ url: deepLinkUrl, active: false });

        // Close the tab after a short delay (the app should have received the message)
        setTimeout(() => {
            chrome.tabs.remove(tab.id).catch(() => { });
        }, 1000);

        showNotification('Launching Ownstash', 'Opening the app to download...');

        return { success: true, launched: true };
    } catch (e) {
        console.error('[Ownstash Background] Deep link failed:', e);
        showNotification('App Not Installed', 'Please install Ownstash Downloader');
        return { success: false, error: 'Failed to launch app' };
    }
}

// ============================================
// Notifications
// ============================================
function showNotification(title, message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: title,
        message: message
    });
}

// ============================================
// Message Handler
// ============================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'sendToApp') {
        // Handle async sendToApp with proper response
        (async () => {
            console.log('[Ownstash Background] Received sendToApp message:', message.url);
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                const response = await fetch(`${EXTENSION_SERVER_URL}/download`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ url: message.url }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    const data = await response.json();
                    console.log('[Ownstash Background] Response:', data);
                    if (data.success) {
                        sendResponse({ success: true });
                    } else {
                        sendResponse({ success: false, error: data.message || 'Unknown error' });
                    }
                } else {
                    sendResponse({ success: false, error: 'App error: ' + response.status });
                }
            } catch (e) {
                console.error('[Ownstash Background] Error:', e);
                sendResponse({ success: false, error: 'App not running or connection failed' });
            }
        })();
        return true; // Keep channel open for async response
    }

    if (message.action === 'checkApp') {
        // Check if app is running
        (async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);

                const response = await fetch(`${EXTENSION_SERVER_URL}/health`, {
                    method: 'GET',
                    signal: controller.signal
                });

                clearTimeout(timeoutId);
                sendResponse({ running: response.ok });
            } catch (e) {
                sendResponse({ running: false });
            }
        })();
        return true; // Keep channel open for async response
    }

    return false;
});

// ============================================
// Badge Update
// ============================================
async function updateBadge(tabId, url) {
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname.replace(/^www\./, '');

        const result = await chrome.storage.local.get(STORAGE_KEYS.ENABLED_SITES);
        const sites = result[STORAGE_KEYS.ENABLED_SITES] || [];

        const isEnabled = sites.some(site => site.domain === domain);

        if (isEnabled) {
            chrome.action.setBadgeText({ text: '✓', tabId });
            chrome.action.setBadgeBackgroundColor({ color: '#10b981', tabId });
        } else {
            chrome.action.setBadgeText({ text: '', tabId });
        }
    } catch (e) {
        chrome.action.setBadgeText({ text: '', tabId });
    }
}

// Tab listeners for badge updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        updateBadge(tabId, tab.url);
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
        updateBadge(activeInfo.tabId, tab.url);
    }
});

// ============================================
// Vault Download Interception
// ============================================
let vaultDownloadEnabled = false;

// Load vault download state on startup
chrome.storage.local.get(STORAGE_KEYS.VAULT_DOWNLOAD_ENABLED, (result) => {
    vaultDownloadEnabled = result[STORAGE_KEYS.VAULT_DOWNLOAD_ENABLED] || false;
    updateVaultBadge();
    console.log('[Ownstash Background] Vault download mode:', vaultDownloadEnabled ? 'ENABLED' : 'DISABLED');
});

// Listen for storage changes (from popup toggle)
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_KEYS.VAULT_DOWNLOAD_ENABLED]) {
        vaultDownloadEnabled = changes[STORAGE_KEYS.VAULT_DOWNLOAD_ENABLED].newValue || false;
        updateVaultBadge();
        console.log('[Ownstash Background] Vault download mode changed:', vaultDownloadEnabled ? 'ENABLED' : 'DISABLED');
    }
});

// Update extension icon badge based on vault mode
function updateVaultBadge() {
    if (vaultDownloadEnabled) {
        // Show vault indicator - purple lock
        chrome.action.setBadgeText({ text: '🔒' });
        chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6' }); // Purple
    } else {
        // Clear badge when vault mode is off
        chrome.action.setBadgeText({ text: '' });
    }
}

// Download interception handler
chrome.downloads.onCreated.addListener(async (downloadItem) => {
    if (!vaultDownloadEnabled) {
        // Vault mode is off, let download proceed normally
        return;
    }

    console.log('[Ownstash Background] Intercepting download:', downloadItem);

    // Get the download URL
    const downloadUrl = downloadItem.finalUrl || downloadItem.url;

    // Cancel the browser download immediately
    try {
        await chrome.downloads.cancel(downloadItem.id);
        console.log('[Ownstash Background] Cancelled browser download:', downloadItem.id);
    } catch (e) {
        console.warn('[Ownstash Background] Could not cancel download:', e);
    }

    // Remove the cancelled download from Chrome's download history
    try {
        await chrome.downloads.erase({ id: downloadItem.id });
    } catch (e) {
        console.warn('[Ownstash Background] Could not erase download entry:', e);
    }

    // Try to get the best filename
    let filename = await getBestFilename(downloadItem, downloadUrl);

    console.log('[Ownstash Background] Final filename:', filename);

    // Send to Ownstash Vault
    await sendToVault(downloadUrl, filename, downloadItem.fileSize || downloadItem.totalBytes || 0);
});

// Get the best possible filename for a download
async function getBestFilename(downloadItem, url) {
    // 1. Try the suggested filename from download item (if not empty/default)
    if (downloadItem.filename && downloadItem.filename.trim() && !downloadItem.filename.endsWith('\\') && !downloadItem.filename.endsWith('/')) {
        const parts = downloadItem.filename.split(/[\/\\]/);
        const name = parts[parts.length - 1];
        if (name && name !== 'download' && name.length > 0) {
            console.log('[Ownstash Background] Using downloadItem.filename:', name);
            return name;
        }
    }

    // 2. Try Content-Disposition header via HEAD request
    try {
        const headResponse = await fetch(url, { method: 'HEAD' });
        const contentDisposition = headResponse.headers.get('content-disposition');
        if (contentDisposition) {
            // Parse filename from content-disposition
            const filenameMatch = contentDisposition.match(/filename[^;=\n]*=(?:(\\?['"])(.*?)\1|([^;\n]*))/i);
            if (filenameMatch) {
                const extractedName = (filenameMatch[2] || filenameMatch[3] || '').trim().replace(/^["']|["']$/g, '');
                if (extractedName && extractedName !== 'download') {
                    console.log('[Ownstash Background] Using Content-Disposition filename:', extractedName);
                    return decodeURIComponent(extractedName);
                }
            }
        }

        // Also check content-type to add extension if needed
        const contentType = headResponse.headers.get('content-type');
        if (contentType) {
            console.log('[Ownstash Background] Content-Type:', contentType);
        }
    } catch (e) {
        console.log('[Ownstash Background] HEAD request failed:', e);
    }

    // 3. Extract from URL
    return extractFilenameFromUrl(url);
}

// Extract filename from URL with improved handling for various services
function extractFilenameFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const params = urlObj.searchParams;

        // Handle Google Drive
        if (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')) {
            const fileId = params.get('id');
            if (fileId) {
                // Generate a meaningful name with timestamp
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
                return `gdrive_${fileId.substring(0, 8)}_${timestamp}`;
            }
        }

        // Handle Dropbox
        if (url.includes('dropbox.com')) {
            const dlParam = params.get('dl');
            const pathParts = pathname.split('/');
            const lastPart = pathParts[pathParts.length - 1];
            if (lastPart && lastPart !== 's' && !lastPart.match(/^[a-z0-9]+$/i)) {
                return decodeURIComponent(lastPart);
            }
        }

        // Handle OneDrive
        if (url.includes('onedrive.live.com') || url.includes('1drv.ms')) {
            const pathParts = pathname.split('/');
            const lastPart = pathParts[pathParts.length - 1];
            if (lastPart && lastPart.includes('.')) {
                return decodeURIComponent(lastPart);
            }
        }

        // Generic: get last path segment
        const parts = pathname.split('/').filter(p => p.length > 0);
        if (parts.length > 0) {
            const lastPart = parts[parts.length - 1];
            // Check if it looks like a filename (has extension)
            if (lastPart.includes('.') && !lastPart.startsWith('.')) {
                return decodeURIComponent(lastPart).substring(0, 150);
            }
        }

        // Fallback: generate a timestamp-based name
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const hostname = urlObj.hostname.replace(/^www\./, '').split('.')[0];
        return `${hostname}_download_${timestamp}`;
    } catch (e) {
        const timestamp = Date.now();
        return `download_${timestamp}`;
    }
}

// Send download to Vault via app
async function sendToVault(url, filename, fileSize) {
    console.log('[Ownstash Background] Sending to Vault:', { url, filename, fileSize });

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${EXTENSION_SERVER_URL}/vault-download`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: url,
                filename: filename,
                fileSize: fileSize,
                source: 'chrome_extension_intercept'
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                showNotification('🔒 Vault Download', `"${filename}" sent to Secure Vault`);
                return { success: true };
            } else {
                showNotification('Vault Error', data.message || 'Failed to send to vault');
                return { success: false, error: data.message };
            }
        } else {
            showNotification('Vault Error', 'App returned error: ' + response.status);
            return { success: false, error: 'App error: ' + response.status };
        }
    } catch (e) {
        console.error('[Ownstash Background] Vault download failed:', e);

        // Try deep link fallback with vault parameter
        return await launchAppWithVaultDeepLink(url, filename);
    }
}

// Launch app with vault-specific deep link
async function launchAppWithVaultDeepLink(url, filename) {
    try {
        const encodedUrl = encodeURIComponent(url);
        const encodedFilename = encodeURIComponent(filename);
        const deepLinkUrl = `ownstash://vault-download?url=${encodedUrl}&filename=${encodedFilename}`;

        console.log('[Ownstash Background] Opening vault deep link:', deepLinkUrl);

        const tab = await chrome.tabs.create({ url: deepLinkUrl, active: false });

        setTimeout(() => {
            chrome.tabs.remove(tab.id).catch(() => { });
        }, 1000);

        showNotification('🔒 Vault Download', 'Launching Ownstash to download to Vault...');

        return { success: true, launched: true };
    } catch (e) {
        console.error('[Ownstash Background] Vault deep link failed:', e);
        showNotification('App Not Running', 'Please start Ownstash Downloader');
        return { success: false, error: 'Failed to launch app' };
    }
}

// Add message handler for vault toggle
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggleVaultDownload') {
        vaultDownloadEnabled = message.enabled;
        chrome.storage.local.set({ [STORAGE_KEYS.VAULT_DOWNLOAD_ENABLED]: vaultDownloadEnabled });
        updateVaultBadge();
        sendResponse({ success: true, enabled: vaultDownloadEnabled });
        return true;
    }

    if (message.action === 'getVaultDownloadStatus') {
        sendResponse({ enabled: vaultDownloadEnabled });
        return true;
    }
});

// ============================================
// Native Messaging (Optional - for advanced integration)
// ============================================
// This can be used for more advanced communication with the desktop app
// Requires native host manifest to be installed

const NATIVE_HOST_NAME = 'com.ownstash.downloader';

async function sendNativeMessage(message) {
    try {
        return await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message);
    } catch (e) {
        console.log('Native messaging not available:', e.message);
        return null;
    }
}
