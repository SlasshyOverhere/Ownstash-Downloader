## 2024-05-19 - Arbitrary Code Execution via External Player Path
**Vulnerability:** The Tauri command `open_with_external_player` accepts a user-provided executable path (`player_path`) from the frontend and passes it directly to `std::process::Command::new(&player).spawn()`. While it checks `if !player_file.exists()`, this check validates against the current working directory, and absolute paths to arbitrary executables (like `cmd.exe` or `/bin/sh`) will still pass and execute.
**Learning:** Checking if a path exists does not prevent it from pointing to an arbitrary system executable or shell.
**Prevention:** Resolve custom player executable paths from the trusted backend database (e.g. `state.db.lock().unwrap().get_setting("external_player_path")`) rather than trusting frontend input.
