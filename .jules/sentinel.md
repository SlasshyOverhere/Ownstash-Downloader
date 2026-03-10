## 2024-05-21 - [Command Injection via External Player Path]
**Vulnerability:** The Tauri command `open_with_external_player` allowed the frontend to specify any executable path (`player_path`) to be spawned via `std::process::Command::new()`. This could lead to Arbitrary Code Execution if a malicious path is passed.
**Learning:** External user or frontend input that gets passed directly as an executable to `Command::new()` must always be strictly validated, preferably using an allowlist approach, rather than just checking if the file exists.
**Prevention:** Implemented an allowlist checking the filename of the executable (e.g., `vlc`, `mpv`, `wmplayer.exe`) against known media players to restrict arbitrary execution.
