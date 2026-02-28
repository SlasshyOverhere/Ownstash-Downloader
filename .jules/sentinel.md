## 2025-02-28 - [Path Traversal in File Downloads]
**Vulnerability:** Filenames extracted from the HTTP `Content-Disposition` header in `SNDE` and `downloader` were used directly to construct file paths via `PathBuf::join()`.
**Learning:** A malicious server could return an absolute path (e.g., `/etc/passwd` or `C:\Windows\System32\hal.dll`) or a relative traversal (`../../../file`). `PathBuf::join()` replaces the existing path if the appended path is absolute, leading to arbitrary file overwrite.
**Prevention:** Always sanitize filenames received from external sources by extracting only the file component (e.g., using `std::path::Path::new(&name).file_name()`) before using them in file system operations.
