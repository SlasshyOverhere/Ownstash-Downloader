/**
 * Slasshy OmniDownloader - Content Script
 * Displays a floating download button on enabled sites
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
// State
// ============================================
let isEnabled = false;
let settings = { ...DEFAULT_SETTINGS };
let floatingButton = null;
let detectedMedia = null;
// Track current video vs full playlist for YouTube/YouTube Music
let currentTrackUrl = null;      // URL of currently playing single track
let fullCollectionUrl = null;    // URL of the full playlist/album

// ============================================
// Initialization
// ============================================
async function init() {
    const domain = getCurrentDomain();
    if (!domain) return;

    await loadSettings();
    await checkIfSiteEnabled(domain);

    if (isEnabled && settings.showFloatingButton) {
        createFloatingButton();
    }

    if (settings.autoDetectMedia) {
        detectMedia();
    }

    // Listen for messages from popup
    try {
        chrome.runtime.onMessage.addListener(handleMessage);
    } catch (e) {
        console.log('[Slasshy] Extension context invalid on init (reload needed)');
    }

    // Listen for fullscreen changes
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
}

function handleFullscreenChange() {
    const isFullscreen = document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement;

    if (floatingButton) {
        if (isFullscreen) {
            floatingButton.style.display = 'none';
        } else {
            floatingButton.style.display = 'block'; // Or whatever visual state it should have
            // Better to just remove the visible class or add a hidden class, 
            // but since we manipulate style.display in hideDropdownMenu, let's respect that.
            // Actually, the button uses class `slasshy-visible` for opacity/transform
            // setting display:none overrides everything which is what we want.
            // restoring to block is fine as it's a div.
        }
    }
}

function getCurrentDomain() {
    try {
        return window.location.hostname.replace(/^www\./, '');
    } catch (e) {
        return null;
    }
}

// ============================================
// Storage Functions
// ============================================
async function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEYS.SETTINGS, (result) => {
            settings = { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
            resolve();
        });
    });
}

async function checkIfSiteEnabled(domain) {
    return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEYS.ENABLED_SITES, (result) => {
            const sites = result[STORAGE_KEYS.ENABLED_SITES] || [];
            isEnabled = sites.some(site => site.domain === domain);
            resolve();
        });
    });
}

// ============================================
// Floating Button
// ============================================
const BUTTON_POSITION_KEY = 'slasshy_button_position';
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let buttonStartX = 0;
let buttonStartY = 0;
let clickPrevented = false;

function createFloatingButton() {
    if (floatingButton) return;

    // Create container
    floatingButton = document.createElement('div');
    floatingButton.id = 'slasshy-floating-btn';
    floatingButton.innerHTML = `
    <div class="slasshy-dropdown-menu" style="display: none;">
      <button class="slasshy-dropdown-item slasshy-dropdown-track" data-action="track">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="6" cy="18" r="3" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="18" cy="16" r="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Current Track Only</span>
      </button>
      <button class="slasshy-dropdown-item slasshy-dropdown-all" data-action="all">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15V6" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M18.5 18a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 12V3" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M9.5 15a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M3 9V0" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5.5 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Download All Tracks</span>
      </button>
    </div>
    <div class="slasshy-btn-inner">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="slasshy-download-icon">
        <path d="M12 5v14M19 12l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="slasshy-btn-text">Download</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="slasshy-dropdown-arrow" style="display: none; width: 12px; height: 12px; margin-left: 4px;">
        <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <div class="slasshy-btn-tooltip">Drag to move • Click to send</div>
  `;

    // Load saved position or use default
    loadButtonPosition();

    // Add drag handlers
    floatingButton.addEventListener('mousedown', handleDragStart);
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);

    // Touch support
    floatingButton.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    // Click handler for main button (prevent if dragged)
    const btnInner = floatingButton.querySelector('.slasshy-btn-inner');
    btnInner.addEventListener('click', (e) => {
        if (clickPrevented) {
            e.preventDefault();
            e.stopPropagation();
            clickPrevented = false;
            return;
        }

        console.log('[Slasshy] Button clicked. currentTrackUrl:', currentTrackUrl, 'fullCollectionUrl:', fullCollectionUrl);

        // Show dropdown if:
        // 1. We have both a track and a collection (playing a track from a playlist)
        // 2. OR we have just a collection URL but could offer to download first track vs all
        const showDropdown = currentTrackUrl && fullCollectionUrl && (currentTrackUrl !== fullCollectionUrl);

        if (showDropdown) {
            console.log('[Slasshy] Showing dropdown menu');
            toggleDropdownMenu();
        } else {
            console.log('[Slasshy] Direct download, no dropdown');
            // Just download what we have
            handleDownloadClick();
        }
    });

    // Dropdown item click handlers
    const dropdownItems = floatingButton.querySelectorAll('.slasshy-dropdown-item');
    dropdownItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.getAttribute('data-action');
            hideDropdownMenu();
            if (action === 'track') {
                handleDownloadClick(currentTrackUrl);
            } else if (action === 'all') {
                handleDownloadClick(fullCollectionUrl);
            }
        });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (floatingButton && !floatingButton.contains(e.target)) {
            hideDropdownMenu();
        }
    });

    // Append to page
    document.body.appendChild(floatingButton);

    // Add entrance animation
    requestAnimationFrame(() => {
        floatingButton.classList.add('slasshy-visible');
    });
}

// Show/hide dropdown menu for track vs collection choice
function toggleDropdownMenu() {
    const dropdown = floatingButton?.querySelector('.slasshy-dropdown-menu');
    if (dropdown) {
        const isVisible = dropdown.style.display !== 'none';
        dropdown.style.display = isVisible ? 'none' : 'block';
    }
}

function hideDropdownMenu() {
    const dropdown = floatingButton?.querySelector('.slasshy-dropdown-menu');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
}

// Update button appearance when on a collection page
function updateButtonForCollection() {
    if (!floatingButton) return;

    const domain = getCurrentDomain();
    const arrow = floatingButton.querySelector('.slasshy-dropdown-arrow');
    const textEl = floatingButton.querySelector('.slasshy-btn-text');
    const tooltip = floatingButton.querySelector('.slasshy-btn-tooltip');

    // Check if we should show dropdown (have both track and collection, and they're different)
    const hasDropdownChoice = currentTrackUrl && fullCollectionUrl && (currentTrackUrl !== fullCollectionUrl);

    // Reset theme classes
    floatingButton.classList.remove('slasshy-ytmusic');

    // Add platform-specific theme when on a collection page with choices (YouTube Music only)
    if (hasDropdownChoice) {
        if (domain.includes('music.youtube.com')) {
            floatingButton.classList.add('slasshy-ytmusic');
        }
    }

    // Show dropdown arrow if we have both track and collection URLs (and they're different)
    if (hasDropdownChoice) {
        if (arrow) arrow.style.display = 'inline';
        if (textEl) textEl.textContent = 'Track';
        if (tooltip) tooltip.textContent = 'Click for options • Drag to move';
        console.log('[Slasshy] Button updated: dropdown mode');
    } else if (fullCollectionUrl && !currentTrackUrl) {
        // Only have collection (e.g., viewing a playlist but not playing)
        if (arrow) arrow.style.display = 'none';
        if (textEl) textEl.textContent = 'Playlist';
        if (tooltip) tooltip.textContent = 'Downloads all tracks';
        console.log('[Slasshy] Button updated: playlist mode');
    } else {
        // Regular single track/video
        if (arrow) arrow.style.display = 'none';
        if (textEl) textEl.textContent = 'Download';
        if (tooltip) tooltip.textContent = 'Drag to move • Click to send';
        console.log('[Slasshy] Button updated: single item mode');
    }
}

function loadButtonPosition() {
    if (!floatingButton) return;

    const domain = getCurrentDomain();
    const storageKey = `${BUTTON_POSITION_KEY}_${domain}`;

    chrome.storage.local.get(storageKey, (result) => {
        const pos = result[storageKey];
        if (pos && pos.x !== undefined && pos.y !== undefined) {
            floatingButton.style.left = `${pos.x}px`;
            floatingButton.style.top = `${pos.y}px`;
            floatingButton.style.right = 'auto';
            floatingButton.style.bottom = 'auto';
        } else {
            // Default position: bottom-right
            floatingButton.style.right = '20px';
            floatingButton.style.bottom = '20px';
            floatingButton.style.left = 'auto';
            floatingButton.style.top = 'auto';
        }
    });
}

function saveButtonPosition(x, y) {
    const domain = getCurrentDomain();
    const storageKey = `${BUTTON_POSITION_KEY}_${domain}`;
    chrome.storage.local.set({ [storageKey]: { x, y } });
}

function handleDragStart(e) {
    if (e.target.closest('.slasshy-btn-inner')) {
        isDragging = true;
        clickPrevented = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        const rect = floatingButton.getBoundingClientRect();
        buttonStartX = rect.left;
        buttonStartY = rect.top;

        floatingButton.classList.add('slasshy-dragging');
        e.preventDefault();
    }
}

function handleDragMove(e) {
    if (!isDragging) return;

    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;

    // If moved more than 5px, consider it a drag (prevent click)
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        clickPrevented = true;
    }

    let newX = buttonStartX + deltaX;
    let newY = buttonStartY + deltaY;

    // Keep within viewport bounds
    const rect = floatingButton.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width;
    const maxY = window.innerHeight - rect.height;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    floatingButton.style.left = `${newX}px`;
    floatingButton.style.top = `${newY}px`;
    floatingButton.style.right = 'auto';
    floatingButton.style.bottom = 'auto';
}

function handleDragEnd(e) {
    if (!isDragging) return;

    isDragging = false;
    floatingButton.classList.remove('slasshy-dragging');

    // Save position if moved
    if (clickPrevented) {
        const rect = floatingButton.getBoundingClientRect();
        saveButtonPosition(rect.left, rect.top);
    }
}

// Touch handlers
function handleTouchStart(e) {
    if (e.target.closest('.slasshy-btn-inner') && e.touches.length === 1) {
        isDragging = true;
        clickPrevented = false;
        dragStartX = e.touches[0].clientX;
        dragStartY = e.touches[0].clientY;

        const rect = floatingButton.getBoundingClientRect();
        buttonStartX = rect.left;
        buttonStartY = rect.top;

        floatingButton.classList.add('slasshy-dragging');
    }
}

function handleTouchMove(e) {
    if (!isDragging) return;
    e.preventDefault();

    const deltaX = e.touches[0].clientX - dragStartX;
    const deltaY = e.touches[0].clientY - dragStartY;

    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        clickPrevented = true;
    }

    let newX = buttonStartX + deltaX;
    let newY = buttonStartY + deltaY;

    const rect = floatingButton.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width;
    const maxY = window.innerHeight - rect.height;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    floatingButton.style.left = `${newX}px`;
    floatingButton.style.top = `${newY}px`;
    floatingButton.style.right = 'auto';
    floatingButton.style.bottom = 'auto';
}

function handleTouchEnd(e) {
    if (!isDragging) return;

    isDragging = false;
    floatingButton.classList.remove('slasshy-dragging');

    if (clickPrevented) {
        const rect = floatingButton.getBoundingClientRect();
        saveButtonPosition(rect.left, rect.top);
    } else {
        // It was a tap, trigger download
        handleDownloadClick();
    }
}

function updateButtonPosition() {
    // No longer using preset positions, position is fully user-controlled
    loadButtonPosition();
}

function removeFloatingButton() {
    if (floatingButton) {
        // Remove event listeners
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);

        floatingButton.classList.remove('slasshy-visible');
        setTimeout(() => {
            if (floatingButton) {
                floatingButton.remove();
                floatingButton = null;
            }
        }, 200);
    }
}

// ============================================
// Download Handler
// ============================================

let feedbackTimeout = null;

async function handleDownloadClick(urlOverride = null) {
    // Use provided URL, or fall back to detected media, or current page
    const url = urlOverride || detectedMedia || window.location.href;

    // Show feedback (with auto-reset after 5 seconds as fallback)
    showFeedback('Sending...', 'info', 5000);

    // Check if runtime is valid BEFORE trying to send
    if (!isRuntimeValid()) {
        showFeedback('Please reload page', 'error', 3000);
        console.error('[Slasshy] Extension context is invalid. Page reload required.');
        return;
    }

    try {
        // Create a promise that times out after 5 seconds
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), 5000);
        });

        // Send via background script which has proper network permissions
        const response = await Promise.race([
            chrome.runtime.sendMessage({
                action: 'sendToApp',
                url: url
            }),
            timeoutPromise
        ]);

        console.log('[Slasshy Content] Response:', response);

        if (response && response.success) {
            showFeedback('Sent! ✓', 'success', 2000);
        } else {
            const errorMsg = response?.error || 'Failed';
            if (errorMsg.includes('not running')) {
                showFeedback('App not running', 'error', 2000);
            } else {
                showFeedback('Error', 'error', 2000);
            }
        }
    } catch (e) {
        // Extension error or timeout
        console.error('[Slasshy Content] Failed to send:', e);

        // Handle "Extension context invalidated" specifically
        if (e.message && e.message.includes('Extension context invalidated')) {
            showFeedback('Please reload page', 'error', 3000);
            return;
        }

        if (e.message === 'Timeout') {
            showFeedback('Timeout', 'error', 2000);
        } else {
            showFeedback('Error', 'error', 2000);
        }
    }
}

// Check if runtime is valid
function isRuntimeValid() {
    return !!chrome.runtime && !!chrome.runtime.id;
}

function showFeedback(message, type = 'info', duration = 2000) {
    // Update button text temporarily
    if (floatingButton) {
        const textEl = floatingButton.querySelector('.slasshy-btn-text');

        // Clear any existing timeout
        if (feedbackTimeout) {
            clearTimeout(feedbackTimeout);
            feedbackTimeout = null;
        }

        // Set the message
        textEl.textContent = message;

        // Remove previous states
        floatingButton.classList.remove('slasshy-success', 'slasshy-error');

        if (type === 'success') {
            floatingButton.classList.add('slasshy-success');
        } else if (type === 'error') {
            floatingButton.classList.add('slasshy-error');
        }

        // Reset to "Download" after duration
        feedbackTimeout = setTimeout(() => {
            textEl.textContent = 'Download';
            floatingButton.classList.remove('slasshy-success', 'slasshy-error');
            feedbackTimeout = null;
        }, duration);
    }
}

// ============================================
// Media Detection
// ============================================
function detectMedia() {
    const domain = getCurrentDomain();

    // Reset tracking state
    currentTrackUrl = null;
    fullCollectionUrl = null;

    // YouTube (regular)
    if (domain.includes('youtube.com') && !domain.includes('music.youtube.com')) {
        detectYouTubeMedia();
    }
    // YouTube Music - handle separately for playlist detection
    else if (domain.includes('music.youtube.com')) {
        detectYouTubeMusicMedia();
    }
    // Twitter/X
    else if (domain.includes('twitter.com') || domain.includes('x.com')) {
        detectTwitterMedia();
    }
    // TikTok
    else if (domain.includes('tiktok.com')) {
        detectTikTokMedia();
    }
    // Instagram
    else if (domain.includes('instagram.com')) {
        detectInstagramMedia();
    }
    // Vimeo
    else if (domain.includes('vimeo.com')) {
        detectVimeoMedia();
    }
    // SoundCloud
    else if (domain.includes('soundcloud.com')) {
        detectSoundCloudMedia();
    }
    // Default: use current URL
    else {
        detectedMedia = window.location.href;
    }

    // Update button label if we have playlist/collection detection
    updateButtonForCollection();
}

function detectYouTubeMedia() {
    const pageUrl = window.location.href;
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v');
    const playlistId = urlParams.get('list');

    // Check for Shorts first
    const shortsMatch = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (shortsMatch) {
        detectedMedia = `https://www.youtube.com/shorts/${shortsMatch[1]}`;
        currentTrackUrl = detectedMedia;
        return;
    }

    // If watching a video within a playlist
    if (videoId && playlistId) {
        // Currently watching a specific video
        currentTrackUrl = `https://www.youtube.com/watch?v=${videoId}`;
        fullCollectionUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
        // Default to single video (user can choose All from button)
        detectedMedia = currentTrackUrl;
    }
    // Just a video, no playlist
    else if (videoId) {
        detectedMedia = `https://www.youtube.com/watch?v=${videoId}`;
        currentTrackUrl = detectedMedia;
    }
    // Playlist page (not watching a specific video)
    else if (playlistId) {
        detectedMedia = `https://www.youtube.com/playlist?list=${playlistId}`;
        fullCollectionUrl = detectedMedia;
        currentTrackUrl = null;
    }
}

// YouTube Music detection
function detectYouTubeMusicMedia() {
    const pageUrl = window.location.href;

    // Check if this is YouTube Music
    if (!pageUrl.includes('music.youtube.com')) {
        return;
    }

    // Check if on a playlist page
    const isPlaylist = pageUrl.includes('/playlist?list=') ||
        pageUrl.includes('/browse/') ||
        pageUrl.includes('&list=');

    if (isPlaylist) {
        // Try to find currently playing track
        const currentTrack = findYouTubeMusicCurrentTrack();
        if (currentTrack) {
            detectedMedia = currentTrack;
            currentTrackUrl = currentTrack;
            fullCollectionUrl = pageUrl;
        } else {
            detectedMedia = pageUrl;
            currentTrackUrl = null;
            fullCollectionUrl = pageUrl;
        }
    } else {
        // Watching a single video/track
        detectedMedia = pageUrl;
        currentTrackUrl = pageUrl;
        fullCollectionUrl = null;
    }
}

// Helper: Find currently playing track on YouTube Music
function findYouTubeMusicCurrentTrack() {
    try {
        // Check for video ID in the watch URL
        const urlParams = new URLSearchParams(window.location.search);
        const videoId = urlParams.get('v');

        if (videoId) {
            // User is watching a specific track, return it without the playlist param
            return `https://music.youtube.com/watch?v=${videoId}`;
        }

        // Check the mini player for currently playing
        const nowPlayingTitle = document.querySelector('.ytmusic-player-bar .title');
        if (nowPlayingTitle) {
            const link = nowPlayingTitle.closest('a');
            if (link && link.href) {
                const linkUrl = new URL(link.href);
                const vid = linkUrl.searchParams.get('v');
                if (vid) {
                    return `https://music.youtube.com/watch?v=${vid}`;
                }
            }
        }

        return null;
    } catch (e) {
        console.error('[Slasshy] Error finding current YouTube Music track:', e);
        return null;
    }
}

function detectTwitterMedia() {
    // Check for status/tweet URL
    const statusMatch = window.location.pathname.match(/\/status\/(\d+)/);
    if (statusMatch) {
        detectedMedia = window.location.href;
    }
}

function detectTikTokMedia() {
    // Check for video URL
    const videoMatch = window.location.pathname.match(/\/video\/(\d+)/);
    if (videoMatch) {
        detectedMedia = window.location.href;
    }
}

function detectInstagramMedia() {
    // Check for post/reel URL
    const postMatch = window.location.pathname.match(/\/p\/([a-zA-Z0-9_-]+)/);
    const reelMatch = window.location.pathname.match(/\/reel\/([a-zA-Z0-9_-]+)/);
    if (postMatch || reelMatch) {
        detectedMedia = window.location.href;
    }
}

function detectVimeoMedia() {
    // Check for video ID in URL
    const videoMatch = window.location.pathname.match(/\/(\d+)/);
    if (videoMatch) {
        detectedMedia = window.location.href;
    }
}

function detectSoundCloudMedia() {
    // SoundCloud track URLs
    if (window.location.pathname.split('/').length >= 3) {
        detectedMedia = window.location.href;
    }
}

// ============================================
// Message Handler
// ============================================
function handleMessage(message, sender, sendResponse) {
    const domain = getCurrentDomain();

    switch (message.type) {
        case 'siteEnabled':
            if (message.domain === domain) {
                isEnabled = true;
                if (settings.showFloatingButton) {
                    createFloatingButton();
                }
            }
            break;

        case 'siteDisabled':
            if (message.domain === domain) {
                isEnabled = false;
                removeFloatingButton();
            }
            break;

        case 'allSitesCleared':
            isEnabled = false;
            removeFloatingButton();
            break;

        case 'settingsUpdated':
            settings = { ...DEFAULT_SETTINGS, ...message };
            if (isEnabled) {
                if (settings.showFloatingButton) {
                    if (!floatingButton) {
                        createFloatingButton();
                    } else {
                        updateButtonPosition();
                    }
                } else {
                    removeFloatingButton();
                }
            }
            break;

        case 'positionReset':
            // Reload button position (will use default since saved position was cleared)
            if (floatingButton) {
                floatingButton.style.right = '20px';
                floatingButton.style.bottom = '20px';
                floatingButton.style.left = 'auto';
                floatingButton.style.top = 'auto';
            }
            break;
    }

    return true;
}

// ============================================
// Initialize
// ============================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Also reinitialize on URL change (for SPAs)
let lastUrl = window.location.href;
new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        detectedMedia = null;
        currentTrackUrl = null;
        fullCollectionUrl = null;
        if (settings.autoDetectMedia) {
            detectMedia();
        }
    }
}).observe(document, { subtree: true, childList: true });
