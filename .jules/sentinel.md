## 2024-05-20 - Arbitrary Code Execution via Tauri command `open_with_external_player`
**Vulnerability:** The Tauri command `open_with_external_player` accepted a user-provided `player_path` string from the frontend, directly passing it to `std::process::Command::new` without validation.
**Learning:** This is an Arbitrary Code Execution (ACE) vulnerability, allowing the frontend to execute any binary on the system. Simple path checks are insufficient for user-provided paths.
**Prevention:** Executable paths must be securely retrieved from a trusted source, such as the backend configuration (e.g. `state.db.lock().unwrap().get_setting()`). Alternatively, use Tauri's scoped `shell` plugin or strictly validate executable signatures.
