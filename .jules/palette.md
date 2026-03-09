## 2024-03-24 - Tauri Dialogs for Destructive Actions
**Learning:** In Tauri applications, using the native web `window.confirm()` creates a jarring, unstyled, and blocking modal that breaks the carefully crafted UI. It's a UX anti-pattern for desktop apps.
**Action:** Always use the native OS-level dialog via `@tauri-apps/plugin-dialog` (`import { confirm } from '@tauri-apps/plugin-dialog'`) when confirming destructive actions like clearing history or deleting data.
