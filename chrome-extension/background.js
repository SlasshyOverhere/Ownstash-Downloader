/**
 * Slasshy OmniDownloader - Background Service Worker
 * Handles extension lifecycle and context menu actions
 */

// ============================================
// Storage Keys
// ============================================
const STORAGE_KEYS = {
    ENABLED_SITES: 'slasshy_enabled_sites',
    SETTINGS: 'slasshy_settings'
};

// ============================================
// Installation Handler
// ============================================
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // First time installation
        console.log('Slasshy OmniDownloader extension installed!');

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
        console.log('Slasshy OmniDownloader extension updated!');
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
            id: 'slasshy-download-page',
            title: 'Download with Slasshy',
            contexts: ['page', 'frame']
        });

        // Download link
        chrome.contextMenus.create({
            id: 'slasshy-download-link',
            title: 'Download link with Slasshy',
            contexts: ['link']
        });

        // Download media (video/audio)
        chrome.contextMenus.create({
            id: 'slasshy-download-media',
            title: 'Download media with Slasshy',
            contexts: ['video', 'audio']
        });

        // Separator
        chrome.contextMenus.create({
            id: 'slasshy-separator',
            type: 'separator',
            contexts: ['page', 'link', 'video', 'audio']
        });

        // Toggle site
        chrome.contextMenus.create({
            id: 'slasshy-toggle-site',
            title: 'Toggle this site in Slasshy',
            contexts: ['page']
        });
    });
}

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    let url = '';

    switch (info.menuItemId) {
        case 'slasshy-download-page':
            url = info.pageUrl || tab.url;
            break;

        case 'slasshy-download-link':
            url = info.linkUrl;
            break;

        case 'slasshy-download-media':
            url = info.srcUrl || info.pageUrl;
            break;

        case 'slasshy-toggle-site':
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
    console.log('[Slasshy Background] Sending URL:', url);

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
                showNotification('Sent to Slasshy', 'The URL has been sent to Slasshy OmniDownloader');
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
        console.error('[Slasshy Background] HTTP failed, trying deep link:', e);

        // App not running - try to launch it using deep link
        return await launchAppWithDeepLink(url);
    }
}

// Launch app using deep link protocol (slasshy://)
async function launchAppWithDeepLink(url) {
    try {
        // Construct deep link URL
        const encodedUrl = encodeURIComponent(url);
        const deepLinkUrl = `slasshy://download?url=${encodedUrl}`;

        console.log('[Slasshy Background] Opening deep link:', deepLinkUrl);

        // Try to open the deep link - this will launch the app if installed
        // Create a new tab with the deep link, then close it
        const tab = await chrome.tabs.create({ url: deepLinkUrl, active: false });

        // Close the tab after a short delay (the app should have received the message)
        setTimeout(() => {
            chrome.tabs.remove(tab.id).catch(() => { });
        }, 1000);

        showNotification('Launching Slasshy', 'Opening the app to download...');

        return { success: true, launched: true };
    } catch (e) {
        console.error('[Slasshy Background] Deep link failed:', e);
        showNotification('App Not Installed', 'Please install Slasshy OmniDownloader');
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
            console.log('[Slasshy Background] Received sendToApp message:', message.url);
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
                    console.log('[Slasshy Background] Response:', data);
                    if (data.success) {
                        sendResponse({ success: true });
                    } else {
                        sendResponse({ success: false, error: data.message || 'Unknown error' });
                    }
                } else {
                    sendResponse({ success: false, error: 'App error: ' + response.status });
                }
            } catch (e) {
                console.error('[Slasshy Background] Error:', e);
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
// Native Messaging (Optional - for advanced integration)
// ============================================
// This can be used for more advanced communication with the desktop app
// Requires native host manifest to be installed

const NATIVE_HOST_NAME = 'com.slasshy.omnidownloader';

async function sendNativeMessage(message) {
    try {
        return await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message);
    } catch (e) {
        console.log('Native messaging not available:', e.message);
        return null;
    }
}
