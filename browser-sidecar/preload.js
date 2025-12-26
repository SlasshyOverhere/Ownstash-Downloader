/**
 * Slasshy Secure Browser - Preload Script
 * 
 * This script runs in the renderer process before web content loads.
 * It exposes a limited, secure API to the renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, secure API to the renderer
contextBridge.exposeInMainWorld('slasshyBrowser', {
    // Get browser information
    getInfo: () => ({
        name: 'Slasshy Secure Browser',
        version: '1.0.0',
        isSecureMode: true
    }),

    // Notify when a download is initiated (for UI feedback)
    onDownloadProgress: (callback) => {
        ipcRenderer.on('download-progress', (event, data) => {
            callback(data);
        });
    },

    // Request to clear browsing data
    clearBrowsingData: () => {
        ipcRenderer.send('clear-browsing-data');
    }
});

console.log('[Slasshy Secure Browser] Preload script loaded');
