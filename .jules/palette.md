## 2024-03-27 - Add confirmation dialog for destructive actions
**Learning:** Destructive actions like clearing all history or downloads in a native desktop app should leverage the OS's native confirmation dialogs rather than blocking window.confirm, which can feel out of place or cause issues in Tauri.
**Action:** Use `@tauri-apps/plugin-dialog` to trigger native confirmation dialogs for destructive actions.
