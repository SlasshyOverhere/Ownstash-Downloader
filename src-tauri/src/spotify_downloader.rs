use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command;

// Track active Spotify download processes for cancellation
lazy_static::lazy_static! {
    static ref ACTIVE_SPOTIFY_DOWNLOADS: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>> = 
        Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpotifyDownloadProgress {
    pub id: String,
    pub progress: f64,
    pub status: String,
    pub current_track: Option<String>,
    pub total_tracks: Option<i32>,
    pub completed_tracks: Option<i32>,
    pub speed: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpotifyDownloadRequest {
    pub id: String,
    pub url: String,
    pub output_path: String,
    pub audio_format: String,        // mp3, m4a, flac, opus, ogg, wav
    pub audio_quality: String,       // 128k, 192k, 320k
    pub embed_lyrics: bool,
    pub threads: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpotifyMediaInfo {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: Option<i64>,
    pub thumbnail: Option<String>,
    pub platform: String,
    pub track_count: Option<i32>,
    pub content_type: String,  // "track", "album", "playlist", "artist"
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpotDlInfo {
    pub version: String,
    pub path: String,
    pub is_available: bool,
    pub latest_version: Option<String>,
    pub update_available: bool,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize, Clone)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

pub struct SpotifyDownloader {
    spotdl_path: String,
    ffmpeg_path: Option<String>,
}

impl SpotifyDownloader {
    /// Creates a new Command that won't show a console window on Windows
    #[cfg(windows)]
    fn create_hidden_command(program: &str) -> Command {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new(program);
        // CREATE_NO_WINDOW = 0x08000000
        cmd.creation_flags(0x08000000);
        cmd
    }
    
    #[cfg(not(windows))]
    fn create_hidden_command(program: &str) -> Command {
        Command::new(program)
    }
    
    pub fn new(app_handle: &AppHandle) -> Self {
        let spotdl_path = Self::find_spotdl(app_handle);
        let ffmpeg_path = Self::find_ffmpeg(app_handle);
        Self { spotdl_path, ffmpeg_path }
    }

    fn binaries_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to access app data directory: {}", e))?;
        Ok(app_data_dir.join("binaries"))
    }

    fn managed_spotdl_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
        let binary_name = if cfg!(windows) { "spotdl.exe" } else { "spotdl" };
        Ok(Self::binaries_dir(app_handle)?.join(binary_name))
    }

    async fn download_binary(url: &str, target_path: &Path) -> Result<(), String> {
        let client = reqwest::Client::builder()
            .user_agent("OwnstashDownloader/1.0")
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .map_err(|e| format!("Failed to initialize HTTP client: {}", e))?;

        let response = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Failed to download SpotDL release: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "Failed to download SpotDL release (HTTP {})",
                response.status()
            ));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read SpotDL binary: {}", e))?;

        let parent = target_path
            .parent()
            .ok_or_else(|| "Invalid SpotDL destination path".to_string())?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to prepare binaries directory: {}", e))?;

        let temp_path = target_path.with_extension("download.tmp");
        tokio::fs::write(&temp_path, bytes)
            .await
            .map_err(|e| format!("Failed to write SpotDL binary: {}", e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&temp_path, std::fs::Permissions::from_mode(0o755))
                .await
                .map_err(|e| format!("Failed to set SpotDL executable permissions: {}", e))?;
        }

        if target_path.exists() {
            tokio::fs::remove_file(target_path)
                .await
                .map_err(|e| format!("Failed to replace existing SpotDL binary: {}", e))?;
        }

        tokio::fs::rename(&temp_path, target_path)
            .await
            .map_err(|e| format!("Failed to finalize SpotDL update: {}", e))?;

        Ok(())
    }

    fn pick_spotdl_asset(release: &GithubRelease) -> Option<GithubAsset> {
        #[cfg(target_os = "windows")]
        {
            return release
                .assets
                .iter()
                .find(|asset| {
                    let name = asset.name.to_ascii_lowercase();
                    name.contains("win") && name.ends_with(".exe")
                })
                .cloned()
                .or_else(|| {
                    release
                        .assets
                        .iter()
                        .find(|asset| asset.name.eq_ignore_ascii_case("spotdl.exe"))
                        .cloned()
                });
        }

        #[cfg(target_os = "macos")]
        {
            return release
                .assets
                .iter()
                .find(|asset| {
                    let name = asset.name.to_ascii_lowercase();
                    name.contains("darwin") || name.contains("mac")
                })
                .cloned()
                .or_else(|| {
                    release
                        .assets
                        .iter()
                        .find(|asset| asset.name.eq_ignore_ascii_case("spotdl"))
                        .cloned()
                });
        }

        #[cfg(target_os = "linux")]
        {
            return release
                .assets
                .iter()
                .find(|asset| asset.name.to_ascii_lowercase().contains("linux"))
                .cloned()
                .or_else(|| {
                    release
                        .assets
                        .iter()
                        .find(|asset| asset.name.eq_ignore_ascii_case("spotdl"))
                        .cloned()
                });
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            release.assets.first().cloned()
        }
    }

    async fn fetch_latest_spotdl_version() -> Result<String, String> {
        let client = reqwest::Client::builder()
            .user_agent("OwnstashDownloader/1.0")
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Failed to initialize HTTP client: {}", e))?;

        let release: GithubRelease = client
            .get("https://api.github.com/repos/spotDL/spotify-downloader/releases/latest")
            .send()
            .await
            .map_err(|e| format!("Failed to check latest SpotDL version: {}", e))?
            .error_for_status()
            .map_err(|e| format!("Latest SpotDL version request failed: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse SpotDL release metadata: {}", e))?;

        Ok(release.tag_name.trim().to_string())
    }

    fn normalize_version_token(version: &str) -> String {
        let cleaned = version.trim().trim_start_matches('v');

        for token in cleaned.split(|c: char| c.is_whitespace() || c == '(' || c == ')' || c == ',') {
            let token = token
                .trim()
                .trim_start_matches('v')
                .trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.');

            if token.contains('.') && token.chars().any(|c| c.is_ascii_digit()) {
                return token.to_string();
            }
        }

        cleaned.to_string()
    }

    fn parse_version_segments(version: &str) -> Option<Vec<u32>> {
        let normalized = Self::normalize_version_token(version);
        let mut segments = Vec::new();

        for part in normalized.split('.') {
            let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
            if digits.is_empty() {
                return None;
            }
            segments.push(digits.parse::<u32>().ok()?);
        }

        if segments.is_empty() {
            None
        } else {
            Some(segments)
        }
    }

    fn is_update_available(current_version: &str, latest_version: &str) -> bool {
        let current_segments = Self::parse_version_segments(current_version);
        let latest_segments = Self::parse_version_segments(latest_version);

        if let (Some(current), Some(latest)) = (current_segments, latest_segments) {
            let max_len = current.len().max(latest.len());
            for idx in 0..max_len {
                let current_value = *current.get(idx).unwrap_or(&0);
                let latest_value = *latest.get(idx).unwrap_or(&0);

                if latest_value > current_value {
                    return true;
                }
                if latest_value < current_value {
                    return false;
                }
            }
            return false;
        }

        Self::normalize_version_token(current_version)
            != Self::normalize_version_token(latest_version)
    }

    pub async fn update_spotdl(app_handle: &AppHandle) -> Result<SpotDlInfo, String> {
        let client = reqwest::Client::builder()
            .user_agent("OwnstashDownloader/1.0")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("Failed to initialize HTTP client: {}", e))?;

        let release: GithubRelease = client
            .get("https://api.github.com/repos/spotDL/spotify-downloader/releases/latest")
            .send()
            .await
            .map_err(|e| format!("Failed to fetch SpotDL release metadata: {}", e))?
            .error_for_status()
            .map_err(|e| format!("SpotDL release request failed: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse SpotDL release metadata: {}", e))?;

        let asset = Self::pick_spotdl_asset(&release).ok_or_else(|| {
            "No compatible SpotDL release asset was found for this platform".to_string()
        })?;

        let target_path = Self::managed_spotdl_path(app_handle)?;
        println!(
            "[SpotifyDownloader] Updating SpotDL {} using asset {}",
            release.tag_name, asset.name
        );
        println!(
            "[SpotifyDownloader] Download URL: {}",
            asset.browser_download_url
        );
        println!("[SpotifyDownloader] Target path: {:?}", target_path);

        Self::download_binary(&asset.browser_download_url, &target_path).await?;

        let downloader = SpotifyDownloader::new(app_handle);
        downloader.check_spotdl(true).await
    }

    fn find_spotdl(app_handle: &AppHandle) -> String {
        // App-managed binaries have priority so in-app updates are used immediately
        if let Ok(managed_path) = Self::managed_spotdl_path(app_handle) {
            if managed_path.exists() {
                println!("[SpotifyDownloader] Found managed spotdl in app data: {:?}", managed_path);
                return managed_path.to_string_lossy().to_string();
            }
        }

        // Try multiple possible locations for bundled spotdl
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            let possible_paths = if cfg!(windows) {
                vec![
                    resource_dir.join("binaries").join("spotdl.exe"),
                    resource_dir.join("binaries/spotdl.exe"),
                    resource_dir.join("spotdl.exe"),
                ]
            } else {
                vec![
                    resource_dir.join("binaries").join("spotdl"),
                    resource_dir.join("binaries/spotdl"),
                    resource_dir.join("spotdl"),
                ]
            };

            for path in &possible_paths {
                if path.exists() {
                    println!("[SpotifyDownloader] Found spotdl at: {:?}", path);
                    return path.to_string_lossy().to_string();
                }
            }
            
            println!("[SpotifyDownloader] spotdl not found in resource dir. Checked paths:");
            for path in &possible_paths {
                println!("  - {:?}", path);
            }
        }

        // Try system PATH - spotdl is typically installed via pip
        // We'll use just "spotdl" and let the system find it
        println!("[SpotifyDownloader] Trying system PATH for spotdl...");
        "spotdl".to_string()
    }

    fn find_ffmpeg(app_handle: &AppHandle) -> Option<String> {
        // Try multiple possible locations for bundled ffmpeg
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            let possible_paths = if cfg!(windows) {
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

            for path in &possible_paths {
                if path.exists() {
                    println!("[SpotifyDownloader] Found ffmpeg at: {:?}", path);
                    return Some(path.to_string_lossy().to_string());
                }
            }
        }

        if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
            let binary_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
            let data_path = app_data_dir.join("binaries").join(binary_name);
            
            if data_path.exists() {
                return Some(data_path.to_string_lossy().to_string());
            }
        }

        None
    }

    pub async fn check_spotdl(&self, include_latest: bool) -> Result<SpotDlInfo, String> {
        // Clean path - remove Windows extended path prefix
        let spotdl_path_clean = self.spotdl_path
            .replace("\\\\?\\", "")
            .replace("\\", "/");
        
        let output = Self::create_hidden_command(&spotdl_path_clean)
            .arg("--version")
            .output()
            .await
            .map_err(|e| format!("spotdl not found or not working: {}. Use Settings > SpotDL Engine > Update Engine.", e))?;

        if !output.status.success() {
            return Err("spotdl returned an error. Please ensure spotdl is installed correctly.".to_string());
        }

        let raw_version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let normalized_version = Self::normalize_version_token(&raw_version);
        let version = if normalized_version.is_empty() {
            raw_version
        } else {
            normalized_version
        };
        let latest_version = if include_latest {
            match Self::fetch_latest_spotdl_version().await {
                Ok(version) => Some(version),
                Err(err) => {
                    println!("[SpotifyDownloader] Failed to fetch latest SpotDL version: {}", err);
                    None
                }
            }
        } else {
            None
        };
        let update_available = latest_version
            .as_ref()
            .map(|latest| Self::is_update_available(&version, latest))
            .unwrap_or(false);

        Ok(SpotDlInfo {
            version,
            path: spotdl_path_clean,
            is_available: true,
            latest_version,
            update_available,
        })
    }

    /// Get info about a Spotify URL (track, album, playlist, or artist)
    pub async fn get_spotify_info(&self, url: &str) -> Result<SpotifyMediaInfo, String> {
        // Use spotdl to get metadata
        // spotdl save <url> --save-file temp.json gets the metadata
        let temp_file = std::env::temp_dir().join(format!("spotdl_info_{}.spotdl", std::process::id()));
        
        // Clean paths - remove Windows extended path prefix
        let spotdl_path_clean = self.spotdl_path
            .replace("\\\\?\\", "")
            .replace("\\", "/");
        
        let binaries_dir = std::path::Path::new(&spotdl_path_clean)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());
        
        // Add binaries directory to PATH
        let current_path = std::env::var("PATH").unwrap_or_default();
        let new_path = format!("{};{}", binaries_dir.replace("/", "\\"), current_path);
        
        let output = Self::create_hidden_command(&spotdl_path_clean)
            .args([
                "save",
                url,
                "--save-file",
                temp_file.to_str().unwrap(),
            ])
            .current_dir(&binaries_dir)
            .env("PATH", &new_path)
            .output()
            .await
            .map_err(|e| format!("Failed to execute spotdl: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Clean up temp file
            let _ = std::fs::remove_file(&temp_file);
            return Err(format!("spotdl error: {}", stderr));
        }

        // Parse the saved file to get track info
        let content = std::fs::read_to_string(&temp_file)
            .map_err(|e| format!("Failed to read spotdl output: {}", e))?;
        
        // Clean up temp file
        let _ = std::fs::remove_file(&temp_file);

        // Parse the JSON array from the save file
        let tracks: Vec<serde_json::Value> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse spotdl output: {}", e))?;

        if tracks.is_empty() {
            return Err("No tracks found for the given URL".to_string());
        }

        // Determine content type from URL
        let content_type = if url.contains("/track/") {
            "track"
        } else if url.contains("/album/") {
            "album"
        } else if url.contains("/playlist/") {
            "playlist"
        } else if url.contains("/artist/") {
            "artist"
        } else {
            "unknown"
        }.to_string();

        let track_count = tracks.len() as i32;
        
        // Get info from first track for display
        let first_track = &tracks[0];
        
        let title = if content_type == "track" {
            first_track["name"].as_str().unwrap_or("Unknown").to_string()
        } else if content_type == "album" {
            first_track["album_name"].as_str()
                .or(first_track["album"].as_str())
                .unwrap_or("Unknown Album").to_string()
        } else if content_type == "playlist" {
            first_track["list_name"].as_str()
                .unwrap_or("Spotify Playlist").to_string()
        } else {
            first_track["artist"].as_str()
                .or(first_track["artists"].as_array().and_then(|a| a.first()).and_then(|a| a.as_str()))
                .unwrap_or("Unknown Artist").to_string()
        };

        let artist = first_track["artist"].as_str()
            .or(first_track["artists"].as_array().and_then(|a| a.first()).and_then(|a| a.as_str()))
            .map(|s| s.to_string());

        let album = first_track["album_name"].as_str()
            .or(first_track["album"].as_str())
            .map(|s| s.to_string());

        let duration = first_track["duration"].as_i64()
            .or(first_track["duration_ms"].as_i64().map(|ms| ms / 1000));

        let thumbnail = first_track["cover_url"].as_str()
            .or(first_track["album_art"].as_str())
            .or(first_track["image_url"].as_str())
            .map(|s| s.to_string());

        Ok(SpotifyMediaInfo {
            title,
            artist,
            album,
            duration,
            thumbnail,
            platform: "Spotify".to_string(),
            track_count: Some(track_count),
            content_type,
            url: url.to_string(),
        })
    }

    pub async fn start_download(
        &self,
        request: SpotifyDownloadRequest,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
        
        // Store the cancellation sender
        {
            let mut downloads = ACTIVE_SPOTIFY_DOWNLOADS.lock().unwrap();
            downloads.insert(request.id.clone(), cancel_tx);
        }

        // Ensure output directory exists
        std::fs::create_dir_all(&request.output_path)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;

        // Get the binaries directory (where spotdl, yt-dlp, ffmpeg are located)
        let spotdl_path_clean = self.spotdl_path
            .replace("\\\\?\\", "")  // Remove Windows extended path prefix
            .replace("\\", "/");     // Normalize to forward slashes
        
        let binaries_dir = std::path::Path::new(&spotdl_path_clean)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());
        
        println!("[SpotDL] Binaries directory: {}", binaries_dir);

        // Emit initial progress
        let _ = app_handle.emit("spotify-download-progress", SpotifyDownloadProgress {
            id: request.id.clone(),
            progress: 0.0,
            status: "downloading".to_string(),
            current_track: Some("Finding YouTube URL...".to_string()),
            total_tracks: None,
            completed_tracks: Some(0),
            speed: "Searching...".to_string(),
        });

        // Step 1: Use SpotDL to get track metadata including YouTube URL
        let temp_file = std::env::temp_dir().join(format!("spotdl_download_{}.spotdl", request.id));
        
        // Clean paths and set PATH for SpotDL
        let current_path = std::env::var("PATH").unwrap_or_default();
        let new_path = format!("{};{}", binaries_dir.replace("/", "\\"), current_path);
        
        println!("[SpotDL] Getting track info for: {}", request.url);
        
        let save_output = Self::create_hidden_command(&spotdl_path_clean)
            .args([
                "save",
                &request.url,
                "--save-file",
                temp_file.to_str().unwrap(),
            ])
            .current_dir(&binaries_dir)
            .env("PATH", &new_path)
            .output()
            .await
            .map_err(|e| format!("Failed to get Spotify track info: {}", e))?;

        if !save_output.status.success() {
            let stderr = String::from_utf8_lossy(&save_output.stderr);
            let _ = std::fs::remove_file(&temp_file);
            return Err(format!("SpotDL error: {}", stderr));
        }

        // Parse the saved file to get YouTube URL
        let content = std::fs::read_to_string(&temp_file)
            .map_err(|e| format!("Failed to read spotdl output: {}", e))?;
        let _ = std::fs::remove_file(&temp_file);

        let tracks: Vec<serde_json::Value> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse spotdl output: {}", e))?;

        if tracks.is_empty() {
            return Err("No tracks found for the given Spotify URL".to_string());
        }

        let total_tracks = tracks.len();
        println!("[SpotDL] Found {} tracks to download", total_tracks);

        let _ = app_handle.emit("spotify-download-progress", SpotifyDownloadProgress {
            id: request.id.clone(),
            progress: 10.0,
            status: "downloading".to_string(),
            current_track: Some(format!("Found {} track(s)", total_tracks)),
            total_tracks: Some(total_tracks as i32),
            completed_tracks: Some(0),
            speed: "Starting download...".to_string(),
        });

        // Step 2: Download each track using yt-dlp
        let yt_dlp_path = binaries_dir.clone() + "/yt-dlp.exe";
        let ffmpeg_path = binaries_dir.clone() + "/ffmpeg.exe";
        let spotdl_for_url = spotdl_path_clean.clone();
        let binaries_for_spawn = binaries_dir.clone();
        let path_for_spawn = new_path.clone();
        
        println!("[SpotDL] Using yt-dlp at: {}", yt_dlp_path);

        let id = request.id.clone();
        let app = app_handle.clone();
        let output_path = request.output_path.clone();
        let audio_format = request.audio_format.clone();
        let concurrent_fragments = request.threads.unwrap_or(4).clamp(2, 8).to_string();

        tokio::spawn(async move {
            let mut completed = 0;
            let mut last_error: Option<String> = None;

            for (index, track) in tracks.iter().enumerate() {
                // Check for cancellation
                if cancel_rx.try_recv().is_ok() {
                    let _ = app.emit("spotify-download-progress", SpotifyDownloadProgress {
                        id: id.clone(),
                        progress: (completed as f64 / total_tracks as f64) * 100.0,
                        status: "cancelled".to_string(),
                        current_track: None,
                        total_tracks: Some(total_tracks as i32),
                        completed_tracks: Some(completed),
                        speed: String::new(),
                    });
                    return;
                }

                let track_name = track["name"].as_str().unwrap_or("Unknown").to_string();
                let artist = track["artist"].as_str()
                    .or(track["artists"].as_array().and_then(|a| a.first()).and_then(|a| a.as_str()))
                    .unwrap_or("Unknown");
                
                // Get the Spotify URL for this track
                let spotify_url = track["url"].as_str()
                    .or(track["song_id"].as_str().map(|id| {
                        // Construct URL from song ID if needed
                        format!("https://open.spotify.com/track/{}", id).leak() as &str
                    }))
                    .unwrap_or("");
                
                let display_name = format!("{} - {}", artist, track_name);
                println!("[SpotDL] Processing track {}/{}: {}", index + 1, total_tracks, display_name);

                let _ = app.emit("spotify-download-progress", SpotifyDownloadProgress {
                    id: id.clone(),
                    progress: 10.0 + (completed as f64 / total_tracks as f64) * 85.0,
                    status: "downloading".to_string(),
                    current_track: Some(format!("Finding YouTube URL for: {}", display_name)),
                    total_tracks: Some(total_tracks as i32),
                    completed_tracks: Some(completed),
                    speed: format!("Track {}/{}", index + 1, total_tracks),
                });

                // Use spotdl url command to get the YouTube URL
                let url_result = Command::new(&spotdl_for_url)
                    .args(["url", spotify_url])
                    .current_dir(&binaries_for_spawn)
                    .env("PATH", &path_for_spawn)
                    .output()
                    .await;

                let youtube_url = match url_result {
                    Ok(output) if output.status.success() => {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        // spotdl url outputs one YouTube URL per line
                        stdout.lines()
                            .find(|line| line.contains("youtube.com") || line.contains("youtu.be"))
                            .map(|s| s.trim().to_string())
                    }
                    Ok(output) => {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        println!("[SpotDL] Failed to get YouTube URL: {}", stderr);
                        None
                    }
                    Err(e) => {
                        println!("[SpotDL] Error getting YouTube URL: {}", e);
                        None
                    }
                };

                if let Some(yt_url) = youtube_url {
                    println!("[SpotDL] Found YouTube URL: {}", yt_url);
                    
                    let _ = app.emit("spotify-download-progress", SpotifyDownloadProgress {
                        id: id.clone(),
                        progress: 10.0 + (completed as f64 / total_tracks as f64) * 85.0,
                        status: "downloading".to_string(),
                        current_track: Some(format!("Downloading: {}", display_name)),
                        total_tracks: Some(total_tracks as i32),
                        completed_tracks: Some(completed),
                        speed: "Downloading from YouTube...".to_string(),
                    });

                    // Use yt-dlp to download the audio from YouTube
                    let safe_name = display_name
                        .replace("/", "-")
                        .replace("\\", "-")
                        .replace(":", "-")
                        .replace("*", "-")
                        .replace("?", "")
                        .replace("\"", "'")
                        .replace("<", "-")
                        .replace(">", "-")
                        .replace("|", "-");
                    let output_template = format!("{}/{}.%(ext)s", output_path.replace("\\", "/"), safe_name);
                    
                    let args = vec![
                        "-x",  // Extract audio
                        "--audio-format",
                        &audio_format,
                        "--audio-quality",
                        "0",  // Best quality
                        "--concurrent-fragments",
                        &concurrent_fragments,
                        "--retries",
                        "4",
                        "--fragment-retries",
                        "4",
                        "--socket-timeout",
                        "20",
                        "-o",
                        &output_template,
                        "--ffmpeg-location",
                        &ffmpeg_path,
                        "--no-playlist",
                        &yt_url,
                    ];

                    println!("[SpotDL] Running yt-dlp with args: {:?}", args);

                    let result = Command::new(&yt_dlp_path)
                        .args(&args)
                        .output()
                        .await;

                    match result {
                        Ok(output) if output.status.success() => {
                            completed += 1;
                            println!("[SpotDL] Successfully downloaded: {}", display_name);
                        }
                        Ok(output) => {
                            let stderr = String::from_utf8_lossy(&output.stderr);
                            let stdout = String::from_utf8_lossy(&output.stdout);
                            println!("[SpotDL] yt-dlp stdout: {}", stdout);
                            println!("[SpotDL] yt-dlp stderr: {}", stderr);
                            last_error = Some(format!("Failed to download {}", display_name));
                        }
                        Err(e) => {
                            println!("[SpotDL] Error running yt-dlp: {}", e);
                            last_error = Some(format!("Error: {}", e));
                        }
                    }
                } else {
                    println!("[SpotDL] No YouTube URL found for: {}", display_name);
                    last_error = Some(format!("No YouTube URL found for: {}", display_name));
                }

                let _ = app.emit("spotify-download-progress", SpotifyDownloadProgress {
                    id: id.clone(),
                    progress: 10.0 + ((completed + 1) as f64 / total_tracks as f64) * 85.0,
                    status: "downloading".to_string(),
                    current_track: Some(display_name),
                    total_tracks: Some(total_tracks as i32),
                    completed_tracks: Some(completed),
                    speed: "Downloading...".to_string(),
                });
            }

            // Clean up active downloads
            {
                let mut downloads = ACTIVE_SPOTIFY_DOWNLOADS.lock().unwrap();
                downloads.remove(&id);
            }

            // Emit final status
            let final_status = if completed > 0 { "completed" } else { "failed" };
            
            let _ = app.emit("spotify-download-progress", SpotifyDownloadProgress {
                id: id.clone(),
                progress: if completed > 0 { 100.0 } else { 0.0 },
                status: final_status.to_string(),
                current_track: if completed > 0 { 
                    Some(format!("Downloaded {} tracks", completed)) 
                } else { 
                    last_error 
                },
                total_tracks: Some(total_tracks as i32),
                completed_tracks: Some(completed),
                speed: String::new(),
            });
        });

        Ok(())
    }

}


// Tauri commands for Spotify downloading
#[tauri::command]
pub async fn check_spotdl(app_handle: AppHandle, include_latest: Option<bool>) -> Result<SpotDlInfo, String> {
    let downloader = SpotifyDownloader::new(&app_handle);
    downloader.check_spotdl(include_latest.unwrap_or(false)).await
}

#[tauri::command]
pub async fn update_spotdl(app_handle: AppHandle) -> Result<SpotDlInfo, String> {
    SpotifyDownloader::update_spotdl(&app_handle).await
}

#[tauri::command]
pub async fn get_spotify_info(app_handle: AppHandle, url: String) -> Result<SpotifyMediaInfo, String> {
    let downloader = SpotifyDownloader::new(&app_handle);
    downloader.get_spotify_info(&url).await
}

#[tauri::command]
pub async fn start_spotify_download(
    app_handle: AppHandle,
    request: SpotifyDownloadRequest,
) -> Result<(), String> {
    let downloader = SpotifyDownloader::new(&app_handle);
    downloader.start_download(request, app_handle).await
}

#[tauri::command]
pub async fn cancel_spotify_download(id: String) -> Result<(), String> {
    let sender = {
        let mut downloads = ACTIVE_SPOTIFY_DOWNLOADS.lock().unwrap();
        downloads.remove(&id)
    };

    if let Some(tx) = sender {
        let _ = tx.send(());
        Ok(())
    } else {
        Err("Spotify download not found or already finished".to_string())
    }
}

/// Check if a URL is a Spotify URL
pub fn is_spotify_url(url: &str) -> bool {
    url.contains("spotify.com") || url.contains("open.spotify.com")
}
