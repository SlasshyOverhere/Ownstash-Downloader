# Sentinel Journal

## 2024-05-18 - [Fix Command Injection and ACE in External Process Execution]
**Vulnerability:** Two critical vulnerabilities were found in `src-tauri/src/commands.rs`:
1. **Command Injection (`open_folder`)**: The command constructed the `explorer.exe` arguments for Windows using `.raw_arg()` with unsanitized frontend paths, bypassing standard argument escaping.
2. **Arbitrary Code Execution (`open_with_external_player`)**: The command accepted `player_path` directly from the frontend and passed it to `Command::new()`, allowing execution of arbitrary binaries.
**Learning:**
1. Using `.raw_arg()` in Rust's `std::process::Command` when handling user-provided strings is dangerous as it circumvents the built-in quote/escape mechanisms. While Windows `explorer.exe /select` relies on `.raw_arg()` due to its non-standard parsing behavior, the input must be sanitized (e.g. stripping quotes) to prevent command injection.
2. Tauri backend commands must never trust executable paths from the frontend. Executable paths must always be resolved securely from backend configuration/state.
**Prevention:**
1. Sanitize user inputs rigorously when using `.raw_arg()` is unavoidable, or prefer `.arg()` which handles quoting properly for standard executables.
2. Fetch sensitive settings (like external executable paths) securely via backend state (`state.db.lock().get_setting()`) rather than taking them as command arguments from the frontend.