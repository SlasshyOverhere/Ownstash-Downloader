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
// Play a file with the default system application
#[tauri::command]
pub async fn play_file(path: String, title: String) -> Result<(), String> {
    let base_path = std::path::Path::new(&path);
    
    if !base_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    
    // Collect all media files in the directory
    let media_extensions = ["mp4", "mkv", "webm", "avi", "mov", "mp3", "m4a", "flac", "wav", "ogg", "opus"];
    let mut candidates: Vec<(std::path::PathBuf, std::time::SystemTime, i32)> = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(base_path) {
        // Sanitize the title for matching
        let sanitized_title = title.chars()
            .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_')
            .collect::<String>()
            .to_lowercase();
        
        let title_words: Vec<&str> = sanitized_title.split_whitespace().collect();
        
        for entry in entries.flatten() {
            let path = entry.path();
            
            // Check if it's a media file
            let ext = path.extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();
            
            if !media_extensions.contains(&ext.as_str()) {
                continue;
            }
            
            let modified = entry.metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                let stem_lower = stem.to_lowercase();
                
                // Score based on how well it matches
                let mut score = 0;
                
                // Exact match
                if stem_lower == sanitized_title {
                    score = 100;
                }
                // Starts with the title
                else if stem_lower.starts_with(&sanitized_title) {
                    score = 80;
                }
                // Title starts with the stem
                else if sanitized_title.starts_with(&stem_lower) {
                    score = 70;
                }
                // Contains the title
                else if stem_lower.contains(&sanitized_title) {
                    score = 60;
                }
                // Title contains the stem
                else if sanitized_title.contains(&stem_lower) {
                    score = 50;
                }
                // Word-based matching
                else {
                    let matching_words = title_words.iter()
                        .filter(|w| w.len() > 2 && stem_lower.contains(*w))
                        .count();
                    if matching_words >= 2 || (matching_words == 1 && title_words.len() == 1) {
                        score = 30 + matching_words as i32 * 5;
                    }
                }
                
                if score > 0 {
                    candidates.push((path, modified, score));
                }
            }
        }
    }
    
    // Sort by score (descending), then by modification time (most recent first)
    candidates.sort_by(|a, b| {
        b.2.cmp(&a.2).then_with(|| b.1.cmp(&a.1))
    });
    
    // Try to play the best match
    if let Some((best_match, _, _)) = candidates.first() {
        println!("[PlayFile] Found match: {:?} for title: {}", best_match, title);
        return open_file_with_default_app(best_match);
    }
    
    // If no match by title, try to find the most recently modified media file
    if let Ok(entries) = std::fs::read_dir(base_path) {
        let mut recent_files: Vec<(std::path::PathBuf, std::time::SystemTime)> = entries
            .flatten()
            .filter_map(|e| {
                let path = e.path();
                let ext = path.extension()
                    .and_then(|ext| ext.to_str())
                    .map(|e| e.to_lowercase())
                    .unwrap_or_default();
                
                if media_extensions.contains(&ext.as_str()) {
                    e.metadata().and_then(|m| m.modified()).ok()
                        .map(|t| (path, t))
                } else {
                    None
                }
            })
            .collect();
        
        recent_files.sort_by(|a, b| b.1.cmp(&a.1));
        
        if let Some((most_recent, _)) = recent_files.first() {
            println!("[PlayFile] No title match, playing most recent: {:?}", most_recent);
            return open_file_with_default_app(most_recent);
        }
    }
    
    Err(format!("Could not find media file for: {}", title))
}

/// Find a media file and return its path for in-app playback
#[tauri::command]
pub async fn find_media_file(path: String, title: String) -> Result<MediaFileInfo, String> {
    let base_path = std::path::Path::new(&path);
    
    if !base_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    
    let media_extensions = ["mp4", "mkv", "webm", "avi", "mov", "mp3", "m4a", "flac", "wav", "ogg", "opus"];
    let audio_extensions = ["mp3", "m4a", "flac", "wav", "ogg", "opus"];
    let mut candidates: Vec<(std::path::PathBuf, std::time::SystemTime, i32, bool)> = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(base_path) {
        let sanitized_title = title.chars()
            .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_')
            .collect::<String>()
            .to_lowercase();
        
        let title_words: Vec<&str> = sanitized_title.split_whitespace().collect();
        
        for entry in entries.flatten() {
            let file_path = entry.path();
            
            let ext = file_path.extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();
            
            if !media_extensions.contains(&ext.as_str()) {
                continue;
            }
            
            let is_audio = audio_extensions.contains(&ext.as_str());
            let modified = entry.metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            
            if let Some(stem) = file_path.file_stem().and_then(|s| s.to_str()) {
                let stem_lower = stem.to_lowercase();
                let mut score = 0;
                
                if stem_lower == sanitized_title {
                    score = 100;
                } else if stem_lower.starts_with(&sanitized_title) {
                    score = 80;
                } else if sanitized_title.starts_with(&stem_lower) {
                    score = 70;
                } else if stem_lower.contains(&sanitized_title) {
                    score = 60;
                } else if sanitized_title.contains(&stem_lower) {
                    score = 50;
                } else {
                    let matching_words = title_words.iter()
                        .filter(|w| w.len() > 2 && stem_lower.contains(*w))
                        .count();
                    if matching_words >= 2 || (matching_words == 1 && title_words.len() == 1) {
                        score = 30 + matching_words as i32 * 5;
                    }
                }
                
                if score > 0 {
                    candidates.push((file_path, modified, score, is_audio));
                }
            }
        }
    }
    
    candidates.sort_by(|a, b| {
        b.2.cmp(&a.2).then_with(|| b.1.cmp(&a.1))
    });
    
    if let Some((best_match, _, _, is_audio)) = candidates.first() {
        println!("[FindMediaFile] Found: {:?} (audio: {})", best_match, is_audio);
        return Ok(MediaFileInfo {
            file_path: best_match.to_string_lossy().to_string(),
            is_audio: *is_audio,
        });
    }
    
    // Fallback to most recent
    if let Ok(entries) = std::fs::read_dir(base_path) {
        let mut recent: Vec<(std::path::PathBuf, std::time::SystemTime, bool)> = entries
            .flatten()
            .filter_map(|e| {
                let file_path = e.path();
                let ext = file_path.extension()
                    .and_then(|ext| ext.to_str())
                    .map(|e| e.to_lowercase())
                    .unwrap_or_default();
                
                if media_extensions.contains(&ext.as_str()) {
                    let is_audio = audio_extensions.contains(&ext.as_str());
                    e.metadata().and_then(|m| m.modified()).ok()
                        .map(|t| (file_path, t, is_audio))
                } else {
                    None
                }
            })
            .collect();
        
        recent.sort_by(|a, b| b.1.cmp(&a.1));
        
        if let Some((most_recent, _, is_audio)) = recent.first() {
            println!("[FindMediaFile] Fallback to most recent: {:?}", most_recent);
            return Ok(MediaFileInfo {
                file_path: most_recent.to_string_lossy().to_string(),
                is_audio: *is_audio,
            });
        }
    }
    
    Err(format!("Could not find media file for: {}", title))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MediaFileInfo {
    pub file_path: String,
    pub is_audio: bool,
}

fn open_file_with_default_app(path: &std::path::Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("File does not exist: {}", path.display()));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    Ok(())
}

/// Transcode a media file to MP4 for web playback
/// Returns the path to the transcoded file
#[tauri::command]
pub async fn transcode_for_playback(app_handle: AppHandle, input_path: String) -> Result<TranscodeResult, String> {
    use std::path::PathBuf;
    use tokio::process::Command as TokioCommand;
    
    let input = PathBuf::from(&input_path);
    if !input.exists() {
        return Err(format!("Input file does not exist: {}", input_path));
    }
    
    // Check if format is already supported
    let extension = input.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    
    let web_supported = ["mp4", "webm", "ogg", "mov"];
    if web_supported.contains(&extension.as_str()) {
        // Already supported, return original path
        return Ok(TranscodeResult {
            output_path: input_path,
            was_transcoded: false,
        });
    }
    
    // Find FFmpeg
    let ffmpeg_path = find_ffmpeg(&app_handle)
        .ok_or_else(|| "FFmpeg not found. Cannot transcode.".to_string())?;
    
    // Create cache directory for transcoded files
    let cache_dir = app_handle.path().app_cache_dir()
        .map_err(|e| format!("Failed to get cache dir: {}", e))?
        .join("transcoded");
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cache dir: {}", e))?;
    
    // Generate output filename with hash to enable caching
    let file_stem = input.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let file_hash = format!("{:x}", md5::compute(&input_path));
    let output_path = cache_dir.join(format!("{}_{}.mp4", file_stem, &file_hash[..8]));
    
    // Check if already transcoded
    if output_path.exists() {
        println!("[Transcode] Using cached transcoded file: {:?}", output_path);
        return Ok(TranscodeResult {
            output_path: output_path.to_string_lossy().to_string(),
            was_transcoded: true,
        });
    }
    
    println!("[Transcode] Starting transcoding: {:?} -> {:?}", input, output_path);
    
    // Run FFmpeg transcoding
    // Use fast settings for quick playback
    let mut cmd = TokioCommand::new(&ffmpeg_path);
    cmd.args([
        "-y",                           // Overwrite output
        "-i", &input_path,              // Input file
        "-c:v", "libx264",              // Video codec
        "-preset", "ultrafast",         // Fast encoding (lower quality, but quick)
        "-crf", "23",                   // Quality (lower = better, 23 is default)
        "-c:a", "aac",                  // Audio codec
        "-b:a", "128k",                 // Audio bitrate
        "-movflags", "+faststart",      // Enable streaming
        &output_path.to_string_lossy(), // Output file
    ]);
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    
    let output = cmd.output().await
        .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg transcoding failed: {}", stderr));
    }
    
    println!("[Transcode] Transcoding completed: {:?}", output_path);
    
    Ok(TranscodeResult {
        output_path: output_path.to_string_lossy().to_string(),
        was_transcoded: true,
    })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TranscodeResult {
    pub output_path: String,
    pub was_transcoded: bool,
}

fn find_ffmpeg(app_handle: &AppHandle) -> Option<String> {
    use tauri::Manager;
    
    // Try resource dir first
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let paths = if cfg!(windows) {
            vec![
                resource_dir.join("binaries").join("ffmpeg.exe"),
                resource_dir.join("binaries/ffmpeg.exe"),
                resource_dir.join("ffmpeg.exe"),
            ]
        } else {
            vec![
                resource_dir.join("binaries").join("ffmpeg"),
                resource_dir.join("binaries/ffmpeg"),
                resource_dir.join("ffmpeg"),
            ]
        };
        
        for path in paths {
            if path.exists() {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }
    
    // Try system PATH
    let binary_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    if which::which(binary_name).is_ok() {
        return Some(binary_name.to_string());
    }
    
    None
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
