## 2026-03-23 - Add confirmation dialog for destructive actions
**Learning:** Native OS confirmation dialogs using `@tauri-apps/plugin-dialog`'s `confirm` function are essential for potentially destructive operations like clearing histories, providing a critical friction point before irrecoverable actions.
**Action:** Always add native confirmation dialogs for destructive actions instead of executing them immediately on button click.
