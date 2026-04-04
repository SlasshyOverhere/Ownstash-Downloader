## 2026-04-04 - Fix Arbitrary Code Execution in open_with_external_player
**Vulnerability:** The `open_with_external_player` command accepted an executable path (`player_path`) directly from the frontend via IPC and passed it into `std::process::Command::new()`. This allowed the frontend to execute arbitrary binaries.
**Learning:** Never trust executable paths provided by the frontend. Enforcing absolute paths or checking file existence does not prevent Arbitrary Code Execution (ACE), as attackers can specify absolute paths to system shells.
**Prevention:** Resolve executable paths securely from backend configuration (e.g., via `state.db.lock()?.get_setting()`), use Tauri's scoped shell plugin, or strictly validate signatures instead of accepting arbitrary binaries from IPC.
