## 2024-05-24 - Arbitrary Code Execution via Frontend Supplied Executable Path
**Vulnerability:** The `open_with_external_player` command directly accepted an executable path (`player_path`) from the frontend and passed it to `Command::new()`. This allowed arbitrary code execution if a malicious frontend or compromised context supplied arbitrary paths.
**Learning:** Commands spawning external processes must never accept unvalidated executable paths from the frontend. Relying on simple allowlists is insufficient.
**Prevention:** Resolve user-preferred executable paths securely within the backend (e.g., using `state.db.lock().unwrap().get_setting()`) rather than taking them as arguments from the frontend.
