## 2024-04-05 - Native Dialogs for Micro-UX Confirmations
**Learning:** For simple destructive action confirmations in a Tauri app frontend, importing `@tauri-apps/plugin-dialog` introduces unnecessary overhead, risks breaking strict 50-line limitations for micro-UX changes, and requires rust backend plugin initialization.
**Action:** Use the native browser `window.confirm` for simple, synchronous confirmation dialogs when building micro-UX improvements in Tauri apps to minimize dependencies and keep changes lightweight.
