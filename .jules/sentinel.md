## 2024-05-24 - Fix Arbitrary Code Execution in open_with_external_player
**Vulnerability:** The `open_with_external_player` Tauri command was taking a `player_path` argument directly from the frontend and executing it via `std::process::Command::new()`. This allowed a compromised frontend (e.g., via XSS) to execute arbitrary binaries on the host system.
**Learning:** Never trust frontend-provided executable paths in Tauri commands, as they can be vectors for Arbitrary Code Execution (ACE). Path validation or simple allowlists are often insufficient or easily bypassed.
**Prevention:** Resolve executable paths securely from backend configuration (e.g., `state.db.lock().unwrap().get_setting("external_player_path")`) rather than accepting them as arguments from the frontend.
