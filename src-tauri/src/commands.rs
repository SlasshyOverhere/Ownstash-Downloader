use crate::database::{Database, Download, SearchHistory, Setting};
use tauri::{AppHandle, Manager, State};
use std::sync::Mutex;
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub struct AppState {
    pub db: Mutex<Database>,
}

// Utility command to open a folder in the system file explorer and optionally highlight a file
#[tauri::command]
pub async fn open_folder(path: String, file_name: Option<String>) -> Result<(), String> {
    let base_path = std::path::Path::new(&path);
    
    if !base_path.exists() {
        return Err(format!("Path does not exist: {}", base_path.display()));
    }

    // Determine the actual path to use
    let actual_path = if let Some(ref name) = file_name {
        // If file_name is provided, construct full path
        let file_path = base_path.join(name);
        if file_path.exists() {
            file_path
        } else {
            // Try to find a similar file (matching by title prefix)
            if let Ok(entries) = std::fs::read_dir(base_path) {
                let file_stem = std::path::Path::new(name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(name);
                
                for entry in entries.flatten() {
                    if let Some(entry_stem) = entry.path().file_stem().and_then(|s| s.to_str()) {
                        if entry_stem.starts_with(file_stem) {
                            return open_path_in_explorer(&entry.path());
                        }
                    }
                }
            }
            base_path.to_path_buf()
        }
    } else {
        base_path.to_path_buf()
    };

    open_path_in_explorer(&actual_path)
}

fn open_path_in_explorer(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if path.is_file() {
            // Use raw_arg to bypass Rust's argument escaping
            // explorer.exe /select,<path> needs the comma directly attached
            let path_str = path.to_string_lossy().replace("/", "\\");
            let full_arg = format!("/select,{}", path_str);
            Command::new("explorer.exe")
                .raw_arg(&full_arg)
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        } else {
            // If it's a directory, just open it
            Command::new("explorer")
                .arg(path)
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        if path.is_file() {
            // On macOS, use -R to reveal the file in Finder
            Command::new("open")
                .arg("-R")
                .arg(path)
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        } else {
            Command::new("open")
                .arg(path)
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux doesn't have a standard way to select files
        // So we open the parent directory if it's a file
        let target = if path.is_file() {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

// Download commands
#[tauri::command]
pub async fn add_download(
    state: State<'_, AppState>,
    download: Download,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.add_download(&download).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_downloads(state: State<'_, AppState>) -> Result<Vec<Download>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_downloads().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_download_status(
    state: State<'_, AppState>,
    id: String,
    status: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_download_status(&id, &status).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_download(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_downloads(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.clear_downloads().map_err(|e| e.to_string())
}

// Search history commands
#[tauri::command]
pub async fn add_search(
    state: State<'_, AppState>,
    query: String,
    title: Option<String>,
    thumbnail: Option<String>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.add_search(&query, title.as_deref(), thumbnail.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_search_history(
    state: State<'_, AppState>,
    limit: i64,
) -> Result<Vec<SearchHistory>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_search_history(limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_search_history(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.clear_search_history().map_err(|e| e.to_string())
}

// Settings commands
#[tauri::command]
pub async fn save_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.save_setting(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_setting(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_all_settings(state: State<'_, AppState>) -> Result<Vec<Setting>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_setting(state: State<'_, AppState>, key: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_setting(&key).map_err(|e| e.to_string())
}
