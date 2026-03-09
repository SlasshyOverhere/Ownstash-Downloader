## 2025-02-28 - Path Traversal in File Explorer Command
**Vulnerability:** The `open_folder` command allowed users to specify a `file_name` to highlight when opening a folder in the file explorer. This user-provided name was directly joined with the base path, allowing for path traversal by using components like `../../../etc/passwd`.
**Learning:** Functions that interact directly with the local filesystem, even ones simply aimed at opening the default system file explorer, are vectors for path traversal if user-supplied paths are merged unchecked.
**Prevention:** Always extract only the final file component using `std::path::Path::new(&name).file_name()` before combining user-provided filenames with base directories.
