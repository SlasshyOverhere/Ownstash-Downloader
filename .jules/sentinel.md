## 2024-03-15 - Prevent Path Traversal in Vault

**Vulnerability:** `sanitize_file_name` in `src-tauri/src/vault.rs` attempts to sanitize filenames to prevent path traversal. It uses `PathBuf::from(value).file_name()`. However, on Linux/macOS, a malicious path like `C:\test\..\passwd` is treated as a single literal filename `C:\test\..\passwd` because `\` is a valid filename character and not a path separator. If this filename is later used on Windows (e.g., synchronized via the cloud-only vault metadata) or if an attacker can manipulate the separators to bypass validation, it poses a path traversal risk.

**Learning:** `PathBuf::from(value).file_name()` depends on the host OS path separator. When dealing with untrusted input that might come from a different OS, it's safer to normalize separators first (`value.replace('\\', "/")`) to ensure consistent and safe extraction of the file name across all platforms.

**Prevention:** Before calling `PathBuf::from(&normalized_path).file_name()`, normalize path separators by replacing `\` with `/` to ensure that directory traversal attempts using either separator are correctly mitigated regardless of the host OS.
