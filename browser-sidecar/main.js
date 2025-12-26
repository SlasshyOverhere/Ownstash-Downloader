/**
 * Slasshy Secure Browser Engine - Main Process
 * 
 * This Electron sidecar provides:
 * 1. Custom Incognito Mode - Extensions persist, web content is ephemeral
 * 2. Secure Download Pipeline - Streams downloads via stdout as base64 chunks
 * 
 * @author Slasshy OmniDownloader Team
 */

const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    // The persistent partition for extensions - they survive restarts
    EXTENSION_PARTITION: 'persist:extensions',

    // Default URL to navigate to
    DEFAULT_URL: 'https://www.google.com',

    // Window dimensions
    WINDOW_WIDTH: 1400,
    WINDOW_HEIGHT: 900,

    // Protocol delimiters for stdout communication
    PROTOCOL: {
        DOWNLOAD_START: 'download-start',
        CHUNK: 'chunk',
        DOWNLOAD_END: 'download-end',
        ERROR: 'error',
        LOG: 'log'
    }
};

// ============================================================
// STDOUT PROTOCOL - Communication with Parent Process
// ============================================================

/**
 * Send a message to the parent process via stdout
 * All messages are JSON objects with a "type" field
 */
function sendToParent(type, payload = {}) {
    const message = JSON.stringify({
        type,
        timestamp: Date.now(),
        ...payload
    });

    // Write to stdout with a newline delimiter
    process.stdout.write(message + '\n');
}

/**
 * Log a message (visible to parent process)
 */
function log(level, message, data = {}) {
    sendToParent(CONFIG.PROTOCOL.LOG, {
        level,
        message,
        data
    });
}

// ============================================================
// CUSTOM INCOGNITO MODE IMPLEMENTATION
// ============================================================

/**
 * Get the session with the custom incognito partition
 * Extensions persist, web content is ephemeral
 */
function getSecureSession() {
    return session.fromPartition(CONFIG.EXTENSION_PARTITION);
}

/**
 * Clear all web content data while preserving extension data
 * This is the core of "Custom Incognito" mode
 */
async function clearWebContentData(ses) {
    log('info', 'Clearing web content data (preserving extensions)...');

    try {
        // 1. Get all cookies
        const cookies = await ses.cookies.get({});

        // 2. Filter and delete non-extension cookies
        let deletedCount = 0;
        for (const cookie of cookies) {
            // Keep cookies from chrome-extension:// domains
            if (cookie.domain && cookie.domain.includes('chrome-extension://')) {
                log('debug', 'Preserving extension cookie', { domain: cookie.domain });
                continue;
            }

            // Build the URL for the cookie
            const protocol = cookie.secure ? 'https://' : 'http://';
            const cookieUrl = `${protocol}${cookie.domain.replace(/^\./, '')}${cookie.path || '/'}`;

            try {
                await ses.cookies.remove(cookieUrl, cookie.name);
                deletedCount++;
            } catch (err) {
                log('warn', 'Failed to delete cookie', {
                    name: cookie.name,
                    domain: cookie.domain,
                    error: err.message
                });
            }
        }

        log('info', `Deleted ${deletedCount} web cookies`);

        // 3. Clear other storage types (cache, localStorage, etc.)
        await ses.clearStorageData({
            storages: [
                'appcache',
                'filesystem',
                'indexdb',
                'localstorage',
                'shadercache',
                'websql',
                'serviceworkers',
                'cachestorage'
            ],
            quotas: ['temporary', 'persistent', 'syncable']
        });

        log('info', 'Web content data cleared successfully');

    } catch (error) {
        log('error', 'Failed to clear web content data', { error: error.message });
    }
}

// ============================================================
// SECURE DOWNLOAD PIPELINE
// ============================================================

/**
 * Set up the download interceptor
 * This captures all downloads and streams them via stdout
 */
function setupDownloadInterceptor(ses) {
    ses.on('will-download', (event, item, webContents) => {
        // Prevent the default download behavior
        event.preventDefault();

        const filename = item.getFilename();
        const mimeType = item.getMimeType();
        const totalBytes = item.getTotalBytes();
        const downloadUrl = item.getURL();

        log('info', 'Download intercepted', { filename, mimeType, totalBytes, downloadUrl });

        // Send download start notification
        sendToParent(CONFIG.PROTOCOL.DOWNLOAD_START, {
            filename,
            mime: mimeType,
            size: totalBytes,
            url: downloadUrl
        });

        // Stream the file content
        streamDownload(downloadUrl, filename, mimeType);
    });

    log('info', 'Download interceptor configured');
}

/**
 * Stream a file download to stdout as base64 chunks
 */
function streamDownload(url, filename, mimeType) {
    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    };

    const request = httpModule.request(options, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            log('info', 'Following redirect', { to: response.headers.location });
            streamDownload(response.headers.location, filename, mimeType);
            return;
        }

        if (response.statusCode !== 200) {
            sendToParent(CONFIG.PROTOCOL.ERROR, {
                message: `HTTP Error: ${response.statusCode}`,
                filename
            });
            return;
        }

        let bytesReceived = 0;
        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);

        response.on('data', (chunk) => {
            bytesReceived += chunk.length;

            // Convert chunk to base64 and send
            const base64Data = chunk.toString('base64');
            sendToParent(CONFIG.PROTOCOL.CHUNK, {
                data: base64Data,
                bytesReceived,
                totalBytes,
                progress: totalBytes > 0 ? Math.round((bytesReceived / totalBytes) * 100) : -1
            });
        });

        response.on('end', () => {
            sendToParent(CONFIG.PROTOCOL.DOWNLOAD_END, {
                filename,
                totalBytes: bytesReceived,
                success: true
            });
            log('info', 'Download complete', { filename, bytesReceived });
        });

        response.on('error', (error) => {
            sendToParent(CONFIG.PROTOCOL.ERROR, {
                message: error.message,
                filename
            });
            log('error', 'Download stream error', { error: error.message });
        });
    });

    request.on('error', (error) => {
        sendToParent(CONFIG.PROTOCOL.ERROR, {
            message: error.message,
            filename
        });
        log('error', 'Download request error', { error: error.message });
    });

    request.end();
}

// ============================================================
// BROWSER WINDOW MANAGEMENT
// ============================================================

let mainWindow = null;

/**
 * Create the main browser window with Custom Incognito session
 */
function createWindow() {
    const ses = getSecureSession();

    // Set up the download interceptor
    setupDownloadInterceptor(ses);

    mainWindow = new BrowserWindow({
        width: CONFIG.WINDOW_WIDTH,
        height: CONFIG.WINDOW_HEIGHT,
        webPreferences: {
            partition: CONFIG.EXTENSION_PARTITION,
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: true,
            allowRunningInsecureContent: false
        },
        icon: path.join(__dirname, 'assets', 'icon.ico'),
        title: 'Slasshy Secure Browser'
    });

    // Load the default URL
    mainWindow.loadURL(CONFIG.DEFAULT_URL);

    // Handle window close - clear web data
    mainWindow.on('close', async (event) => {
        event.preventDefault();
        await clearWebContentData(ses);
        mainWindow.destroy();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    log('info', 'Browser window created', {
        partition: CONFIG.EXTENSION_PARTITION,
        url: CONFIG.DEFAULT_URL
    });
}

// ============================================================
// EXTENSION MANAGEMENT
// ============================================================

/**
 * Load Chrome extensions from the extensions directory
 */
async function loadExtensions() {
    const ses = getSecureSession();
    const extensionsPath = path.join(__dirname, 'extensions');

    try {
        const fs = require('fs');
        if (!fs.existsSync(extensionsPath)) {
            log('info', 'No extensions directory found, skipping extension loading');
            return;
        }

        const extensionDirs = fs.readdirSync(extensionsPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        for (const extDir of extensionDirs) {
            const extPath = path.join(extensionsPath, extDir);
            try {
                const extension = await ses.loadExtension(extPath);
                log('info', 'Extension loaded', { name: extension.name, id: extension.id });
            } catch (err) {
                log('error', 'Failed to load extension', { path: extPath, error: err.message });
            }
        }
    } catch (error) {
        log('error', 'Extension loading failed', { error: error.message });
    }
}

// ============================================================
// IPC HANDLERS - Communication from Renderer
// ============================================================

// Handle navigation requests from parent process via stdin
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
    try {
        const command = JSON.parse(data.trim());
        handleParentCommand(command);
    } catch (error) {
        log('error', 'Failed to parse parent command', { error: error.message, data });
    }
});

/**
 * Handle commands from the parent process
 */
function handleParentCommand(command) {
    switch (command.type) {
        case 'navigate':
            if (mainWindow && command.url) {
                mainWindow.loadURL(command.url);
                log('info', 'Navigation requested', { url: command.url });
            }
            break;

        case 'clear-data':
            clearWebContentData(getSecureSession());
            break;

        case 'quit':
            app.quit();
            break;

        case 'get-cookies':
            getSecureSession().cookies.get({}).then(cookies => {
                sendToParent('cookies', { cookies });
            });
            break;

        default:
            log('warn', 'Unknown command', { type: command.type });
    }
}

// ============================================================
// APP LIFECYCLE
// ============================================================

app.whenReady().then(async () => {
    log('info', 'Slasshy Secure Browser starting...');

    // Load extensions first
    await loadExtensions();

    // Create the browser window
    createWindow();

    // macOS specific: re-create window when dock icon clicked
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Handle before-quit to clear web data
app.on('before-quit', async (event) => {
    event.preventDefault();
    await clearWebContentData(getSecureSession());
    app.exit(0);
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    log('error', 'Uncaught exception', { error: error.message, stack: error.stack });
});

process.on('unhandledRejection', (reason, promise) => {
    log('error', 'Unhandled rejection', { reason: String(reason) });
});

log('info', 'Main process initialized');
