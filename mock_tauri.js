// Mock window.__TAURI_INTERNALS__ and other Tauri APIs
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => {
    console.log('Tauri invoke called:', cmd, args);
    if (cmd === 'plugin:dialog|confirm') {
      return true; // Simulate user clicking "OK"
    }
    if (cmd === 'get_downloads') return [];
    if (cmd === 'get_search_history') return [];
    if (cmd === 'get_settings') return {};
    return null;
  }
};
window.__TAURI_IPC__ = window.__TAURI_INTERNALS__.invoke;
