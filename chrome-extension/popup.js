/**
 * Slasshy OmniDownloader - Chrome Extension Popup Script
 * Manages enabled sites and sends download requests to the desktop app
 */

// ============================================
// Storage Keys
// ============================================
const STORAGE_KEYS = {
    ENABLED_SITES: 'slasshy_enabled_sites',
    SETTINGS: 'slasshy_settings'
};

// Default settings
const DEFAULT_SETTINGS = {
    showFloatingButton: true,
    buttonPosition: 'bottom-right',
    autoDetectMedia: true
};

// ============================================
// DOM Elements
// ============================================
const elements = {
    siteCard: document.getElementById('siteCard'),
    siteName: document.getElementById('siteName'),
    siteUrl: document.getElementById('siteUrl'),
    siteStatus: document.getElementById('siteStatus'),
    faviconImg: document.getElementById('faviconImg'),
    faviconFallback: document.getElementById('faviconFallback'),
    btnToggleSite: document.getElementById('btnToggleSite'),
    btnToggleText: document.getElementById('btnToggleText'),
    btnDownload: document.getElementById('btnDownload'),
    sitesList: document.getElementById('sitesList'),
    sitesEmpty: document.getElementById('sitesEmpty'),
    btnSettings: document.getElementById('btnSettings'),
    btnOpenApp: document.getElementById('btnOpenApp'),
    settingsPanel: document.getElementById('settingsPanel'),
    btnBackFromSettings: document.getElementById('btnBackFromSettings'),
    settingFloatingBtn: document.getElementById('settingFloatingBtn'),
    btnResetPosition: document.getElementById('btnResetPosition'),
    settingAutoDetect: document.getElementById('settingAutoDetect'),
    btnClearAllSites: document.getElementById('btnClearAllSites')
};

// ============================================
// State
// ============================================
let currentTab = null;
let currentDomain = null;
let enabledSites = [];
let settings = { ...DEFAULT_SETTINGS };

// ============================================
// Initialization
// ============================================
async function init() {
    await loadStoredData();
    await getCurrentTab();
    updateUI();
    setupEventListeners();
}

async function loadStoredData() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.ENABLED_SITES, STORAGE_KEYS.SETTINGS], (result) => {
            enabledSites = result[STORAGE_KEYS.ENABLED_SITES] || [];
            settings = { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
            resolve();
        });
    });
}

async function getCurrentTab() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                currentTab = tabs[0];
                try {
                    const url = new URL(currentTab.url);
                    currentDomain = url.hostname.replace(/^www\./, '');
                } catch (e) {
                    currentDomain = null;
                }
            }
            resolve();
        });
    });
}

// ============================================
// UI Updates
// ============================================
function updateUI() {
    updateCurrentSiteCard();
    updateSitesList();
    updateSettingsUI();
}

function updateCurrentSiteCard() {
    if (!currentTab || !currentDomain) {
        elements.siteName.textContent = 'No site detected';
        elements.siteUrl.textContent = 'Invalid page';
        elements.siteStatus.innerHTML = '<span class="status-badge status-disabled">N/A</span>';
        elements.btnToggleSite.disabled = true;
        elements.btnDownload.style.display = 'none';
        return;
    }

    // Update site info
    elements.siteName.textContent = getDomainDisplayName(currentDomain);
    elements.siteUrl.textContent = currentDomain;

    // Update favicon
    const faviconUrl = getFaviconUrl(currentTab.url);
    elements.faviconImg.src = faviconUrl;
    elements.faviconImg.onerror = () => {
        elements.faviconImg.style.display = 'none';
        elements.faviconFallback.textContent = currentDomain.charAt(0).toUpperCase();
        elements.faviconFallback.style.display = 'flex';
    };
    elements.faviconImg.onload = () => {
        elements.faviconImg.style.display = 'block';
        elements.faviconFallback.style.display = 'none';
    };

    // Check if site is enabled
    const isEnabled = isSiteEnabled(currentDomain);

    // Check if this is a blocked domain (like Spotify)
    const isBlocked = isBlockedDomain(currentDomain);

    if (isBlocked) {
        // Spotify and other blocked domains - show special message
        elements.siteStatus.innerHTML = '<span class="status-badge status-spotify">Use App</span>';
        elements.btnToggleText.textContent = 'Open in App Instead';
        elements.btnToggleSite.classList.remove('btn-remove');
        elements.btnToggleSite.classList.add('btn-primary');
        elements.btnDownload.style.display = 'inline-flex';
        elements.btnDownload.title = 'Send to Slasshy App';
    } else if (isEnabled) {
        elements.siteStatus.innerHTML = '<span class="status-badge status-enabled">Enabled</span>';
        elements.btnToggleText.textContent = 'Remove Site';
        elements.btnToggleSite.classList.add('btn-remove');
        elements.btnToggleSite.classList.remove('btn-primary');
        elements.btnDownload.style.display = 'inline-flex';
    } else {
        elements.siteStatus.innerHTML = '<span class="status-badge status-disabled">Disabled</span>';
        elements.btnToggleText.textContent = 'Add This Site';
        elements.btnToggleSite.classList.remove('btn-remove');
        elements.btnToggleSite.classList.add('btn-primary');
        elements.btnDownload.style.display = 'none';
    }

    elements.btnToggleSite.disabled = false;
}

function updateSitesList() {
    // Clear existing items (except the empty state)
    const existingItems = elements.sitesList.querySelectorAll('.site-item');
    existingItems.forEach(item => item.remove());

    if (enabledSites.length === 0) {
        elements.sitesEmpty.style.display = 'flex';
        return;
    }

    elements.sitesEmpty.style.display = 'none';

    // Add site items
    enabledSites.forEach((site) => {
        const siteItem = createSiteItem(site);
        elements.sitesList.appendChild(siteItem);
    });
}

function createSiteItem(site) {
    const item = document.createElement('div');
    item.className = 'site-item';
    item.dataset.domain = site.domain;

    item.innerHTML = `
    <div class="site-item-favicon">${site.domain.charAt(0).toUpperCase()}</div>
    <span class="site-item-name" title="${site.domain}">${getDomainDisplayName(site.domain)}</span>
    <button class="site-item-remove" title="Remove site">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  `;

    // Add remove handler
    const removeBtn = item.querySelector('.site-item-remove');
    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeSite(site.domain);
    });

    return item;
}

function updateSettingsUI() {
    elements.settingFloatingBtn.checked = settings.showFloatingButton;
    elements.settingAutoDetect.checked = settings.autoDetectMedia;
}

// ============================================
// Site Management
// ============================================
function isSiteEnabled(domain) {
    return enabledSites.some(site => site.domain === domain);
}

// Blocked domains - better handled via app directly
const BLOCKED_DOMAINS = [
    'open.spotify.com',
    'spotify.com',
];

function isBlockedDomain(domain) {
    return BLOCKED_DOMAINS.some(blocked =>
        domain === blocked || domain.endsWith('.' + blocked)
    );
}

async function addSite(domain) {
    if (isSiteEnabled(domain)) return;

    // Block Spotify - better handled via app directly
    if (isBlockedDomain(domain)) {
        showNotification('🎵 Spotify works better in the app! Paste your Spotify URL directly into Slasshy for the best experience.', 'info');
        return;
    }

    const newSite = {
        domain: domain,
        addedAt: Date.now(),
        faviconUrl: currentTab ? getFaviconUrl(currentTab.url) : null
    };

    enabledSites.push(newSite);
    await saveSites();
    updateUI();
    notifyContentScript('siteEnabled', { domain });
}

async function removeSite(domain) {
    enabledSites = enabledSites.filter(site => site.domain !== domain);
    await saveSites();
    updateUI();
    notifyContentScript('siteDisabled', { domain });
}

async function toggleCurrentSite() {
    if (!currentDomain) return;

    if (isSiteEnabled(currentDomain)) {
        await removeSite(currentDomain);
    } else {
        await addSite(currentDomain);
    }
}

async function clearAllSites() {
    if (confirm('Are you sure you want to remove all enabled sites?')) {
        enabledSites = [];
        await saveSites();
        updateUI();

        // Notify all tabs
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { type: 'allSitesCleared' }).catch(() => { });
            });
        });
    }
}

async function saveSites() {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.ENABLED_SITES]: enabledSites }, resolve);
    });
}

// ============================================
// Settings Management
// ============================================
async function updateSetting(key, value) {
    settings[key] = value;
    await saveSettings();
    notifyContentScript('settingsUpdated', settings);
}

async function saveSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings }, resolve);
    });
}

// ============================================
// Download Functionality
// ============================================

async function sendToApp() {
    if (!currentTab || !currentTab.url) {
        showNotification('No valid URL to download', 'error');
        return;
    }

    const url = currentTab.url;
    console.log('[Slasshy Popup] Sending URL via background:', url);

    // Send via background script which has better network permissions
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'sendToApp',
            url: url
        });

        console.log('[Slasshy Popup] Response from background:', response);

        if (response && response.success) {
            showNotification('Sent to Slasshy! ✓', 'success');
            // Close the popup after successful send
            setTimeout(() => window.close(), 800);
        } else {
            const errorMsg = response?.error || 'Failed to send';
            if (errorMsg.includes('not running') || errorMsg.includes('Failed to fetch')) {
                showNotification('Slasshy app is not running', 'error');
            } else {
                showNotification(errorMsg, 'error');
            }
        }
    } catch (e) {
        console.error('[Slasshy Popup] Error:', e);
        showNotification('Extension error: ' + e.message, 'error');
    }
}

function openApp() {
    // Send a message to check if app is running
    chrome.runtime.sendMessage({ action: 'checkApp' }, (response) => {
        if (response && response.running) {
            showNotification('Slasshy is running!', 'success');
        } else {
            showNotification('Slasshy app is not running. Please start it.', 'info');
        }
    });
}

// ============================================
// Helper Functions
// ============================================
function getDomainDisplayName(domain) {
    // Convert domain to display-friendly name
    const parts = domain.split('.');
    if (parts.length >= 2) {
        // Get the main part (e.g., "youtube" from "youtube.com")
        let name = parts[parts.length - 2];
        // Capitalize first letter
        return name.charAt(0).toUpperCase() + name.slice(1);
    }
    return domain;
}

function getFaviconUrl(url) {
    try {
        const urlObj = new URL(url);
        return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`;
    } catch (e) {
        return '';
    }
}

function notifyContentScript(type, data) {
    if (currentTab) {
        chrome.tabs.sendMessage(currentTab.id, { type, ...data }).catch(() => {
            // Content script might not be loaded, ignore error
        });
    }
}

function showNotification(message, type = 'info') {
    // Create a temporary notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
    position: fixed;
    bottom: 70px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 16px;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#6366f1'};
    color: white;
    font-size: 12px;
    font-weight: 500;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 1000;
    animation: fadeIn 0.2s ease-out;
  `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.2s';
        setTimeout(() => notification.remove(), 200);
    }, 2000);
}

// ============================================
// Event Listeners
// ============================================
function setupEventListeners() {
    // Toggle site button
    elements.btnToggleSite.addEventListener('click', toggleCurrentSite);

    // Download button
    elements.btnDownload.addEventListener('click', sendToApp);

    // Settings button
    elements.btnSettings.addEventListener('click', () => {
        elements.settingsPanel.classList.add('active');
    });

    // Back from settings
    elements.btnBackFromSettings.addEventListener('click', () => {
        elements.settingsPanel.classList.remove('active');
    });

    // Open app button
    elements.btnOpenApp.addEventListener('click', openApp);

    // Settings toggles
    elements.settingFloatingBtn.addEventListener('change', (e) => {
        updateSetting('showFloatingButton', e.target.checked);
    });

    // Reset button position
    elements.btnResetPosition.addEventListener('click', resetButtonPositions);

    elements.settingAutoDetect.addEventListener('change', (e) => {
        updateSetting('autoDetectMedia', e.target.checked);
    });

    // Clear all sites
    elements.btnClearAllSites.addEventListener('click', clearAllSites);
}

// Reset all button positions
async function resetButtonPositions() {
    // Get all stored items
    const items = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(items).filter(key => key.startsWith('slasshy_button_position_'));

    if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        showNotification('Button positions reset!', 'success');

        // Notify current tab to reload position
        if (currentTab) {
            chrome.tabs.sendMessage(currentTab.id, { type: 'positionReset' }).catch(() => { });
        }
    } else {
        showNotification('No saved positions to reset', 'info');
    }
}

// ============================================
// Initialize
// ============================================
document.addEventListener('DOMContentLoaded', init);
