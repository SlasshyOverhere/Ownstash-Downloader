use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

// Import the v2.0 download control system
use crate::download_router::{DownloadRouter, RoutingDecision, DOWNLOAD_ROUTER};
use crate::health_metrics::{DownloadEngine, DownloadPhase, HEALTH_REGISTRY};
use crate::snde::{SNDEEngine, SNDERequest, SNDE_ENGINE};

// Track active download processes for cancellation
lazy_static::lazy_static! {
    static ref ACTIVE_DOWNLOADS: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>> = 
        Arc::new(Mutex::new(HashMap::new()));
    static ref MEDIA_INFO_CACHE: Arc<Mutex<HashMap<String, (Instant, MediaInfo)>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadProgress {
    pub id: String,
    pub progress: f64,
    pub speed: String,
    pub eta: String,
    pub status: String,
    pub downloaded_bytes: Option<i64>,
    pub total_bytes: Option<i64>,
    pub filename: Option<String>,
    /// Engine badge for UI display: "SNDE ACCELERATED", "SNDE SAFE", or "MEDIA ENGINE"
    #[serde(default)]
    pub engine_badge: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadRequest {
    pub id: String,
    pub url: String,
    pub output_path: String,
    pub format: Option<String>,
    pub audio_only: bool,
    pub quality: Option<String>,
    pub embed_thumbnail: bool,
    pub embed_metadata: bool,
    pub download_subtitles: bool,
    pub audio_quality: String,
    pub audio_format: String,
    pub video_format: String,
    pub use_sponsorblock: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaInfo {
    pub title: String,
    pub duration: Option<i64>,
    pub thumbnail: Option<String>,
    pub formats: Vec<FormatInfo>,
    pub platform: String,
    pub uploader: Option<String>,
    pub description: Option<String>,
    pub view_count: Option<i64>,
    pub like_count: Option<i64>,
    pub upload_date: Option<String>,
    pub webpage_url: Option<String>,
    pub chapters: Option<Vec<Chapter>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Chapter {
    pub start_time: f64,
    pub end_time: f64,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FormatInfo {
    pub format_id: String,
    pub ext: String,
    pub resolution: Option<String>,
    pub height: Option<i64>,
    pub width: Option<i64>,
    pub filesize: Option<i64>,
    pub filesize_approx: Option<i64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub fps: Option<f64>,
    pub tbr: Option<f64>,
    pub format_note: Option<String>,
    pub quality_label: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct YtDlpInfo {
    pub version: String,
    pub path: String,
    pub is_embedded: bool,
    pub latest_version: Option<String>,
    pub update_available: bool,
}

#[derive(Debug, Deserialize)]
struct GithubLatestRelease {
    tag_name: String,
}

pub struct Downloader {
    yt_dlp_path: String,
    ffmpeg_path: Option<String>,
}

impl Downloader {
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
        // Try to find yt-dlp: first bundled, then PATH
        let yt_dlp_path = Self::find_yt_dlp(app_handle);
        let ffmpeg_path = Self::find_ffmpeg(app_handle);
        Self { yt_dlp_path, ffmpeg_path }
    }

    fn binaries_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to access app data directory: {}", e))?;
        Ok(app_data_dir.join("binaries"))
    }

    fn managed_yt_dlp_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
        let binary_name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
        Ok(Self::binaries_dir(app_handle)?.join(binary_name))
    }

    fn preferred_yt_dlp_asset_name() -> &'static str {
        #[cfg(all(target_os = "windows", target_arch = "x86"))]
        {
            "yt-dlp_x86.exe"
        }
        #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
        {
            "yt-dlp_arm64.exe"
        }
        #[cfg(all(target_os = "windows", not(any(target_arch = "x86", target_arch = "aarch64"))))]
        {
            "yt-dlp.exe"
        }
        #[cfg(target_os = "macos")]
        {
            "yt-dlp_macos"
        }
        #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
        {
            "yt-dlp_linux_aarch64"
        }
        #[cfg(all(target_os = "linux", not(target_arch = "aarch64")))]
        {
            "yt-dlp_linux"
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            "yt-dlp"
        }
    }

    async fn fetch_latest_yt_dlp_version() -> Result<String, String> {
        let client = reqwest::Client::builder()
            .user_agent("OwnstashDownloader/1.0")
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Failed to initialize HTTP client: {}", e))?;

        let release: GithubLatestRelease = client
            .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
            .send()
            .await
            .map_err(|e| format!("Failed to check latest yt-dlp version: {}", e))?
            .error_for_status()
            .map_err(|e| format!("Latest yt-dlp version request failed: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse yt-dlp release metadata: {}", e))?;

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
            .map_err(|e| format!("Failed to download binary: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "Failed to download binary (HTTP {})",
                response.status()
            ));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read downloaded binary: {}", e))?;

        let parent = target_path
            .parent()
            .ok_or_else(|| "Invalid binary destination path".to_string())?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to prepare binaries directory: {}", e))?;

        let temp_path = target_path.with_extension("download.tmp");
        tokio::fs::write(&temp_path, bytes)
            .await
            .map_err(|e| format!("Failed to write temporary binary: {}", e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&temp_path, std::fs::Permissions::from_mode(0o755))
                .await
                .map_err(|e| format!("Failed to set executable permissions: {}", e))?;
        }

        if target_path.exists() {
            tokio::fs::remove_file(target_path)
                .await
                .map_err(|e| format!("Failed to replace existing binary: {}", e))?;
        }

        tokio::fs::rename(&temp_path, target_path)
            .await
            .map_err(|e| format!("Failed to finalize binary update: {}", e))?;

        Ok(())
    }

    pub async fn update_yt_dlp(app_handle: &AppHandle) -> Result<YtDlpInfo, String> {
        let target_path = Self::managed_yt_dlp_path(app_handle)?;
        let asset_name = Self::preferred_yt_dlp_asset_name();
        let download_url = format!(
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/{}",
            asset_name
        );

        println!("[Downloader] Updating yt-dlp from: {}", download_url);
        println!("[Downloader] Target path: {:?}", target_path);

        Self::download_binary(&download_url, &target_path).await?;

        let downloader = Downloader::new(app_handle);
        downloader.check_yt_dlp(true).await
    }


    fn find_yt_dlp(app_handle: &AppHandle) -> String {
        // App-managed binaries have priority so in-app updates are used immediately
        if let Ok(managed_path) = Self::managed_yt_dlp_path(app_handle) {
            if managed_path.exists() {
                println!("[Downloader] Found managed yt-dlp in app data: {:?}", managed_path);
                return managed_path.to_string_lossy().to_string();
            }
        }

        // Try multiple possible locations for bundled yt-dlp
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            let possible_paths = if cfg!(windows) {
                vec![
                    resource_dir.join("binaries").join("yt-dlp.exe"),
                    resource_dir.join("binaries/yt-dlp.exe"),
                    resource_dir.join("yt-dlp.exe"),
                ]
            } else if cfg!(target_os = "macos") {
                vec![
                    resource_dir.join("binaries").join("yt-dlp_macos"),
                    resource_dir.join("binaries/yt-dlp_macos"),
                    resource_dir.join("yt-dlp_macos"),
                    resource_dir.join("binaries").join("yt-dlp"),
                    resource_dir.join("yt-dlp"),
                ]
            } else {
                vec![
                    resource_dir.join("binaries").join("yt-dlp"),
                    resource_dir.join("binaries/yt-dlp"),
                    resource_dir.join("yt-dlp"),
                ]
            };

            for path in &possible_paths {
                if path.exists() {
                    println!("[Downloader] Found yt-dlp at: {:?}", path);
                    return path.to_string_lossy().to_string();
                }
            }
            
            // Log all checked paths for debugging
            println!("[Downloader] yt-dlp not found in resource dir. Checked paths:");
            for path in &possible_paths {
                println!("  - {:?}", path);
            }
        }

        // Return empty string to indicate not found - DO NOT spawn terminal to check PATH
        println!("[Downloader] ERROR: yt-dlp not found! The app binaries may not be properly bundled.");
        String::new()
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
                    println!("[Downloader] Found ffmpeg at: {:?}", path);
                    return Some(path.to_string_lossy().to_string());
                }
            }
            
            // Log all checked paths for debugging
            println!("[Downloader] ffmpeg not found in resource dir. Checked paths:");
            for path in &possible_paths {
                println!("  - {:?}", path);
            }
        }

        // Try app data directory (for development or copied binaries)
        if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
            let binary_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
            let data_path = app_data_dir.join("binaries").join(binary_name);
            
            if data_path.exists() {
                println!("[Downloader] Found ffmpeg in app data: {:?}", data_path);
                return Some(data_path.to_string_lossy().to_string());
            }
        }

        // DO NOT spawn terminal to check system PATH - just return None
        println!("[Downloader] WARNING: FFmpeg not found! Video merging may not work.");
        None
    }



    pub async fn check_yt_dlp(&self, include_latest: bool) -> Result<YtDlpInfo, String> {
        if self.yt_dlp_path.is_empty() {
            return Err("yt-dlp not found. Use the updater in Settings to install it.".to_string());
        }

        let output = Self::create_hidden_command(&self.yt_dlp_path)
            .arg("--version")
            .output()
            .await
            .map_err(|e| format!("yt-dlp not found or not working: {}. Please ensure yt-dlp is installed.", e))?;

        if !output.status.success() {
            return Err("yt-dlp returned an error".to_string());
        }

        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let latest_version = if include_latest {
            match Self::fetch_latest_yt_dlp_version().await {
                Ok(version) => Some(version),
                Err(err) => {
                    println!("[Downloader] Failed to fetch latest yt-dlp version: {}", err);
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
        let is_embedded = self.yt_dlp_path.contains("binaries");

        Ok(YtDlpInfo {
            version,
            path: self.yt_dlp_path.clone(),
            is_embedded,
            latest_version,
            update_available,
        })
    }

    pub async fn get_media_info(&self, url: &str, check_sponsorblock: bool) -> Result<MediaInfo, String> {
        let cache_key = format!("{}::{}", url.trim(), check_sponsorblock);
        {
            let cache = MEDIA_INFO_CACHE.lock().unwrap();
            if let Some((cached_at, cached_info)) = cache.get(&cache_key) {
                if cached_at.elapsed() < Duration::from_secs(300) {
                    return Ok(cached_info.clone());
                }
            }
        }

        let is_youtube_url = url.contains("youtube.com") || url.contains("youtu.be");

        let mut args = vec![
            "--dump-single-json".to_string(),
            "--skip-download".to_string(),
            "--no-playlist".to_string(),
            "--no-warnings".to_string(),
            "--extractor-retries".to_string(),
            "1".to_string(),
            "--retries".to_string(),
            "2".to_string(),
            "--socket-timeout".to_string(),
            "15".to_string(),
        ];

        // Keep non-YouTube extraction lightweight, but avoid suppressing format checks
        // on YouTube so high-res (1440p/4K) variants are consistently discovered.
        if !is_youtube_url {
            args.push("--no-check-formats".to_string());
        }

        if check_sponsorblock {
            args.push("--sponsorblock-mark".to_string());
            args.push("all".to_string());
        }

        args.push(url.to_string());

        let output = Self::create_hidden_command(&self.yt_dlp_path)
            .args(&args)
            .output()
            .await
            .map_err(|e| format!("Failed to execute yt-dlp: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("yt-dlp error: {}", stderr));
        }

        let json: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Failed to parse yt-dlp output: {}", e))?;

        let formats = json["formats"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|f| {
                        let format_id = f["format_id"].as_str()?.to_string();
                        let ext = f["ext"].as_str().unwrap_or("unknown").to_string();
                        
                        Some(FormatInfo {
                            format_id,
                            ext,
                            resolution: f["resolution"].as_str().map(|s| s.to_string())
                                .or_else(|| {
                                    let height = f["height"].as_i64();
                                    let width = f["width"].as_i64();
                                    match (width, height) {
                                        (Some(w), Some(h)) => Some(format!("{}x{}", w, h)),
                                        _ => None
                                    }
                                }),
                            height: f["height"].as_i64(),
                            width: f["width"].as_i64(),
                            filesize: f["filesize"].as_i64(),
                            filesize_approx: f["filesize_approx"].as_i64(),
                            vcodec: f["vcodec"].as_str()
                                .filter(|&s| s != "none")
                                .map(|s| s.to_string()),
                            acodec: f["acodec"].as_str()
                                .filter(|&s| s != "none")
                                .map(|s| s.to_string()),
                            fps: f["fps"].as_f64(),
                            tbr: f["tbr"].as_f64(),
                            format_note: f["format_note"].as_str().map(|s| s.to_string()),
                            quality_label: f["format_note"].as_str().map(|s| s.to_string()),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let media_info = MediaInfo {
            title: json["title"].as_str().unwrap_or("Unknown").to_string(),
            duration: json["duration"].as_i64().or_else(|| json["duration"].as_f64().map(|f| f as i64)),
            thumbnail: json["thumbnail"].as_str().map(|s| s.to_string()),
            formats,
            platform: json["extractor"].as_str()
                .or(json["extractor_key"].as_str())
                .unwrap_or("unknown").to_string(),
            uploader: json["uploader"].as_str().map(|s| s.to_string()),
            description: json["description"].as_str().map(|s| s.to_string()),
            view_count: json["view_count"].as_i64(),
            like_count: json["like_count"].as_i64(),
            upload_date: json["upload_date"].as_str().map(|s| s.to_string()),
            webpage_url: json["webpage_url"].as_str().map(|s| s.to_string()),
            chapters: json["chapters"].as_array().map(|arr| {
                arr.iter().map(|c| Chapter {
                    start_time: c["start_time"].as_f64().unwrap_or(0.0),
                    end_time: c["end_time"].as_f64().unwrap_or(0.0),
                    title: c["title"].as_str().unwrap_or("").to_string(),
                }).collect()
            }),
        };

        {
            let mut cache = MEDIA_INFO_CACHE.lock().unwrap();
            cache.insert(cache_key, (Instant::now(), media_info.clone()));
            if cache.len() > 64 {
                cache.retain(|_, (timestamp, _)| timestamp.elapsed() < Duration::from_secs(300));
            }
        }

        Ok(media_info)
    }

    pub async fn start_download(
        &self,
        request: DownloadRequest,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
        
        // Store the cancellation sender
        {
            let mut downloads = ACTIVE_DOWNLOADS.lock().unwrap();
            downloads.insert(request.id.clone(), cancel_tx);
        }

        // === V2.0 DOWNLOAD CONTROL SYSTEM: Routing Decision ===
        // Perform preflight routing to determine optimal engine and settings
        let routing_decision = DOWNLOAD_ROUTER.route(&request.url, None).await;
        
        println!("[Downloader] Routing decision for {}: {:?}", request.url, routing_decision);
        println!("[Downloader] Selected engine: {} | Recommended connections: {} | Reason: {}",
            routing_decision.badge,
            routing_decision.recommended_connections,
            routing_decision.reason
        );

        // Register with health metrics for watchdog monitoring
        HEALTH_REGISTRY.register_download(
            &request.id,
            routing_decision.engine,
            routing_decision.file_size,
        );
        HEALTH_REGISTRY.set_phase(&request.id, DownloadPhase::Downloading);

        // Clone badge for async use
        let engine_badge = routing_decision.badge.clone();

        // Emit initial progress event WITH engine badge
        let _ = app_handle.emit("download-progress", DownloadProgress {
            id: request.id.clone(),
            progress: 0.0,
            speed: String::new(),
            eta: String::new(),
            status: "starting".to_string(),
            downloaded_bytes: None,
            total_bytes: routing_decision.file_size.map(|s| s as i64),
            filename: None,
            engine_badge: Some(engine_badge.clone()),
        });
        
        // === V2.0: Route to SNDE for static files ===
        // Use SNDE for static files that support range requests
        // Conditions: SNDE/SNDESafe engine selected, not audio_only, has file size
        let use_snde = matches!(routing_decision.engine, DownloadEngine::SNDE | DownloadEngine::SNDESafe)
            && !request.audio_only
            && routing_decision.file_size.is_some()
            && routing_decision.probe_result.as_ref().map(|p| p.supports_range).unwrap_or(false);

        if use_snde {
            println!("[Downloader] Using SNDE for parallel download");
            
            // Create SNDE request
            let output_path = std::path::PathBuf::from(&request.output_path);
            
            // Extract filename from URL or use a default
            let filename = url::Url::parse(&request.url)
                .ok()
                .and_then(|u| u.path_segments()?.last().map(|s| s.to_string()))
                .unwrap_or_else(|| format!("download_{}", request.id));
            
            let snde_request = SNDERequest {
                id: request.id.clone(),
                url: request.url.clone(),
                output_path: output_path.join(&filename),
                routing_decision: routing_decision.clone(),
            };

            // Convert oneshot cancel to mpsc for SNDE
            let (snde_cancel_tx, snde_cancel_rx) = tokio::sync::mpsc::channel::<()>(1);
            
            // Spawn a task to bridge the cancellation - consumes cancel_rx
            tokio::spawn(async move {
                let _ = cancel_rx.await;
                let _ = snde_cancel_tx.send(()).await;
            });

            // Run SNDE download
            let result = SNDE_ENGINE.download(
                snde_request,
                app_handle.clone(),
                snde_cancel_rx,
            ).await;

            // Cleanup
            {
                let mut downloads = ACTIVE_DOWNLOADS.lock().unwrap();
                downloads.remove(&request.id);
            }
            HEALTH_REGISTRY.unregister_download(&request.id);

            if result.success {
                println!("[Downloader] SNDE completed successfully: {} KB/s avg", result.avg_speed_kbps);
                return Ok(());
            } else {
                // SNDE failed - return error (don't fallback to yt-dlp for static files)
                return Err(result.error.unwrap_or_else(|| "SNDE download failed".to_string()));
            }
        }
        // === END SNDE ROUTING ===

        let mut args = vec![
            "--progress".to_string(),
            "--newline".to_string(),
            "--no-warnings".to_string(),
            "--progress-template".to_string(),
            "download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._downloaded_bytes_str)s|%(progress._total_bytes_str)s".to_string(),
        ];

        let concurrent_fragments = routing_decision.recommended_connections.clamp(2, 8);
        args.extend([
            "--concurrent-fragments".to_string(),
            concurrent_fragments.to_string(),
            "--retries".to_string(),
            "4".to_string(),
            "--fragment-retries".to_string(),
            "4".to_string(),
            "--socket-timeout".to_string(),
            "20".to_string(),
        ]);

        // Add ffmpeg location if available
        if let Some(ffmpeg) = &self.ffmpeg_path {
            // Get the directory containing ffmpeg, not the full path to the binary
            if let Some(ffmpeg_dir) = std::path::Path::new(ffmpeg).parent() {
                args.extend(["--ffmpeg-location".to_string(), ffmpeg_dir.to_string_lossy().to_string()]);
                println!("[Downloader] Using FFmpeg at: {}", ffmpeg_dir.display());
            } else {
                args.extend(["--ffmpeg-location".to_string(), ffmpeg.clone()]);
                println!("[Downloader] Using FFmpeg: {}", ffmpeg);
            }
        } else {
            println!("[Downloader] Warning: FFmpeg not found. Some downloads may fail.");
        }

        // Output template
        let output_template = format!("{}/%(title)s.%(ext)s", request.output_path);
        args.extend(["-o".to_string(), output_template]);

        // Quality/format selection
        if request.audio_only {
            args.extend([
                "-x".to_string(),
                "--audio-format".to_string(),
                request.audio_format.clone(),
                "--audio-quality".to_string(),
                request.audio_quality.clone(),
            ]);
        } else if let Some(format) = &request.format {
            if !format.is_empty() {
                args.extend(["-f".to_string(), format.clone()]);
            }
        } else if let Some(quality) = &request.quality {
            // Use simpler format strings that are more reliable
            let format_selector = match quality.as_str() {
                "best" | "4k" | "2160p" => "bestvideo+bestaudio/best",
                "1080p" => "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
                "720p" => "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
                "480p" => "bestvideo[height<=480]+bestaudio/best[height<=480]/best",
                "360p" => "bestvideo[height<=360]+bestaudio/best[height<=360]/best",
                _ => "bestvideo+bestaudio/best",
            };
            args.extend(["-f".to_string(), format_selector.to_string()]);
            // Use user-selected output format when merging
            args.extend(["--merge-output-format".to_string(), request.video_format.clone()]);
        }

        // Embed options
        if request.embed_thumbnail {
            args.push("--embed-thumbnail".to_string());
        }
        if request.embed_metadata {
            args.push("--embed-metadata".to_string());
        }
        // Subtitle options - embed subtitles into video
        // Only download manually uploaded subtitles (not auto-generated) to avoid issues
        if request.download_subtitles && !request.audio_only {
            args.push("--write-subs".to_string());
            // Note: We intentionally don't use --write-auto-subs as auto-generated 
            // subtitles can cause embedding issues and are often low quality
            args.push("--embed-subs".to_string());
            args.push("--sub-langs".to_string());
            args.push("en,en-US,en-GB".to_string()); // Try multiple English variants
        }

        // SponsorBlock
        if request.use_sponsorblock {
            args.push("--sponsorblock-remove".to_string());
            args.push("all".to_string());
        }

        // Add URL
        args.push(request.url.clone());

        let mut child = Self::create_hidden_command(&self.yt_dlp_path)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start download: {}", e))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        let id = request.id.clone();
        let app = app_handle.clone();
        let _yt_dlp_path = self.yt_dlp_path.clone();
        let output_path = request.output_path.clone();
        let should_cleanup_subs = request.download_subtitles && !request.audio_only;
        let engine_badge_for_spawn = engine_badge.clone(); // Capture for async

        tokio::spawn(async move {
            let engine_badge = engine_badge_for_spawn; // Move into spawn
            let mut last_progress = 0.0_f64;
            let mut last_emitted_progress = 0.0_f64;
            let mut smoothed_speed_bps: Option<f64> = None;
            let mut last_speed_label = String::new();
            let mut last_eta_label = String::new();
            let mut last_emit_at = Instant::now()
                .checked_sub(Duration::from_secs(1))
                .unwrap_or_else(Instant::now);
            let mut error_output = String::new();

            loop {
                tokio::select! {
                    _ = &mut cancel_rx => {
                        // Download cancelled
                        let _ = child.kill().await;
                        let _ = app.emit("download-progress", DownloadProgress {
                            id: id.clone(),
                            progress: last_progress,
                            speed: String::new(),
                            eta: String::new(),
                            status: "cancelled".to_string(),
                            downloaded_bytes: None,
                            total_bytes: None,
                            filename: None,
                            engine_badge: Some(engine_badge.clone()),
                        });
                        break;
                    }
                    result = stdout_reader.next_line() => {
                        match result {
                            Ok(Some(line)) => {
                                println!("[yt-dlp stdout] {}", line);
                                let _ = handle_download_output_line(
                                    &line,
                                    &app,
                                    &id,
                                    &engine_badge,
                                    &mut last_progress,
                                    &mut last_emitted_progress,
                                    &mut smoothed_speed_bps,
                                    &mut last_speed_label,
                                    &mut last_eta_label,
                                    &mut last_emit_at,
                                );
                            }
                            Ok(None) => break,
                            Err(_) => break,
                        }
                    }
                    result = stderr_reader.next_line() => {
                        match result {
                            Ok(Some(line)) => {
                                println!("[yt-dlp stderr] {}", line);
                                let handled = handle_download_output_line(
                                    &line,
                                    &app,
                                    &id,
                                    &engine_badge,
                                    &mut last_progress,
                                    &mut last_emitted_progress,
                                    &mut smoothed_speed_bps,
                                    &mut last_speed_label,
                                    &mut last_eta_label,
                                    &mut last_emit_at,
                                );

                                if !handled {
                                    error_output.push_str(&line);
                                    error_output.push('\n');
                                }
                            }
                            Ok(None) => {},
                            Err(_) => {},
                        }
                    }
                }
            }

            // Wait for the process to finish
            let status = child.wait().await;

            // Clean up active downloads
            {
                let mut downloads = ACTIVE_DOWNLOADS.lock().unwrap();
                downloads.remove(&id);
            }
            
            // V2.0: Unregister from health metrics
            HEALTH_REGISTRY.unregister_download(&id);

            // Emit final status
            let final_status = match status {
                Ok(exit_status) if exit_status.success() => "completed",
                _ => "failed",
            };

            // Clean up standalone subtitle files if subtitles were embedded
            if should_cleanup_subs && final_status == "completed" {
                // Delete .vtt, .srt, .ass, .sub files from the output directory
                if let Ok(entries) = std::fs::read_dir(&output_path) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if let Some(ext) = path.extension() {
                            let ext_lower = ext.to_string_lossy().to_lowercase();
                            if ext_lower == "vtt" || ext_lower == "srt" || ext_lower == "ass" || ext_lower == "sub" {
                                let _ = std::fs::remove_file(&path);
                                println!("[Downloader] Cleaned up subtitle file: {:?}", path);
                            }
                        }
                    }
                }
            }

            let _ = app.emit("download-progress", DownloadProgress {
                id: id.clone(),
                progress: if final_status == "completed" { 100.0 } else { last_progress },
                speed: String::new(),
                eta: String::new(),
                status: final_status.to_string(),
                downloaded_bytes: None,
                total_bytes: None,
                filename: None,
                engine_badge: Some(engine_badge.clone()),
            });
        });

        Ok(())
    }
}

fn handle_download_output_line(
    line: &str,
    app: &AppHandle,
    id: &str,
    engine_badge: &str,
    last_progress: &mut f64,
    last_emitted_progress: &mut f64,
    smoothed_speed_bps: &mut Option<f64>,
    last_speed_label: &mut String,
    last_eta_label: &mut String,
    last_emit_at: &mut Instant,
) -> bool {
    // Try to parse progress from various formats
    if let Some(progress) = parse_progress_template(line).or_else(|| parse_progress(line)) {
        let mut stabilized_progress = progress.progress.clamp(0.0, 100.0);
        if !stabilized_progress.is_finite() {
            stabilized_progress = *last_progress;
        }

        // Keep 100% reserved for final completion event.
        // yt-dlp can emit temporary 100% for intermediate streams (audio/video),
        // so never jump directly to 99 from normal progress lines.
        if stabilized_progress >= 100.0 {
            stabilized_progress = (*last_progress + 0.6).min(98.0);
        }

        // Keep progress monotonic, but allow a genuine phase reset when yt-dlp
        // moves from one stream to another (high -> very low).
        if stabilized_progress < *last_progress {
            let is_stream_phase_reset = *last_progress >= 85.0 && stabilized_progress <= 5.0;
            if !is_stream_phase_reset {
                stabilized_progress = *last_progress;
            }
        }

        *last_progress = stabilized_progress;

        if let Some(raw_speed_bps) = progress.speed_bps {
            *smoothed_speed_bps = Some(match *smoothed_speed_bps {
                Some(previous) => previous + (raw_speed_bps - previous) * 0.30,
                None => raw_speed_bps,
            });
        }

        let speed_label = smoothed_speed_bps
            .as_ref()
            .map(|speed| format_transfer_speed(*speed))
            .or_else(|| {
                if progress.speed.is_empty() {
                    None
                } else {
                    Some(progress.speed.clone())
                }
            })
            .unwrap_or_default();
        let eta_label = progress.eta;

        let should_emit = last_emit_at.elapsed() >= Duration::from_millis(180)
            || (stabilized_progress - *last_emitted_progress).abs() >= 0.5
            || speed_label != *last_speed_label
            || eta_label != *last_eta_label;

        if should_emit {
            let event = DownloadProgress {
                id: id.to_string(),
                progress: stabilized_progress,
                speed: speed_label.clone(),
                eta: eta_label.clone(),
                status: "downloading".to_string(),
                downloaded_bytes: None,
                total_bytes: None,
                filename: None,
                engine_badge: Some(engine_badge.to_string()),
            };
            let _ = app.emit("download-progress", event);
            *last_emit_at = Instant::now();
            *last_emitted_progress = stabilized_progress;
            *last_speed_label = speed_label;
            *last_eta_label = eta_label;
        }
        return true;
    }

    if is_post_processing_line(line) {
        // During merging/post-processing, show 99% progress
        // Only jump to near-complete when we've already reached late download phase.
        let merge_progress = if *last_progress >= 90.0 {
            99.0
        } else {
            *last_progress
        };
        *last_progress = merge_progress;
        let event = DownloadProgress {
            id: id.to_string(),
            progress: merge_progress,
            speed: "Merging...".to_string(),
            eta: "".to_string(),
            status: "downloading".to_string(),
            downloaded_bytes: None,
            total_bytes: None,
            filename: None,
            engine_badge: Some(engine_badge.to_string()),
        };
        let _ = app.emit("download-progress", event);
        *last_emit_at = Instant::now();
        *last_emitted_progress = merge_progress;
        *last_speed_label = "Merging...".to_string();
        last_eta_label.clear();
        return true;
    }

    false
}

fn is_post_processing_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("[merger]")
        || lower.contains("merging formats into")
        || lower.contains("[extractaudio]")
        || lower.contains("post-process")
        || lower.contains("[embedthumbnail]")
        || lower.contains("[embedsubtitles]")
        || lower.contains("[embedmetadata]")
}

#[derive(Debug, Clone)]
struct ParsedProgress {
    progress: f64,
    speed: String,
    speed_bps: Option<f64>,
    eta: String,
}

fn parse_progress_template(line: &str) -> Option<ParsedProgress> {
    // Parse our custom progress template: percent|speed|eta|downloaded|total
    // yt-dlp outputs like: "50.0%|10.5MiB/s|00:05|52.5MiB|105.0MiB"
    let parts: Vec<&str> = line.split('|').collect();
    if parts.len() < 3 {
        return None;
    }

    // Clean the percent string - remove spaces, %, and any other characters
    let percent_str = parts[0]
        .trim()
        .replace('%', "")
        .replace(' ', "")
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
        .collect::<String>();

    let progress_from_percent = percent_str.parse::<f64>().ok();
    let progress_from_bytes = if let (Some(downloaded), Some(total)) = (
        parts.get(3).and_then(|value| parse_size_to_bytes(value)),
        parts.get(4).and_then(|value| parse_size_to_bytes(value)),
    ) {
        if total > 0.0 {
            Some((downloaded / total) * 100.0)
        } else {
            None
        }
    } else {
        None
    };

    let progress = progress_from_bytes.or(progress_from_percent)?;

    let speed_raw = sanitize_metric(parts[1]);
    let speed_bps = parse_speed_to_bps(&speed_raw);
    let speed = if speed_raw.is_empty() {
        String::new()
    } else {
        speed_raw
    };
    let eta = sanitize_metric(parts[2]);

    // Log for debugging
    println!("[Progress] {}% | {} | {}", progress, speed, eta);

    Some(ParsedProgress {
        progress,
        speed,
        speed_bps,
        eta,
    })
}

fn parse_progress(line: &str) -> Option<ParsedProgress> {
    // Parse yt-dlp progress output like:
    // [download]  50.0% of 100.00MiB at 10.00MiB/s ETA 00:05
    if !line.contains("[download]") {
        return None;
    }

    let progress = line
        .split_whitespace()
        .find(|s| s.ends_with('%'))?
        .trim_end_matches('%')
        .parse::<f64>()
        .ok()?;

    let speed_raw = line
        .split("at ")
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .unwrap_or("")
        .to_string();

    let eta = line
        .split("ETA ")
        .nth(1)
        .unwrap_or("")
        .trim();

    let speed = sanitize_metric(&speed_raw);
    let speed_bps = parse_speed_to_bps(&speed);
    let eta = sanitize_metric(eta);

    // Log for debugging
    println!("[Progress Fallback] {}% | {} | {}", progress, speed, eta);

    Some(ParsedProgress {
        progress,
        speed,
        speed_bps,
        eta,
    })
}

fn sanitize_metric(value: &str) -> String {
    let cleaned = value
        .trim()
        .replace("N/A", "")
        .replace("n/a", "")
        .replace('~', "");
    cleaned.trim().to_string()
}

fn parse_speed_to_bps(value: &str) -> Option<f64> {
    let mut normalized = value.trim().to_string();
    if normalized.is_empty() {
        return None;
    }
    if let Some(stripped) = normalized.strip_suffix("/s") {
        normalized = stripped.to_string();
    }
    parse_size_to_bytes(&normalized)
}

fn parse_size_to_bytes(value: &str) -> Option<f64> {
    let compact = value
        .trim()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '~' && *c != ',')
        .collect::<String>();
    if compact.is_empty() {
        return None;
    }

    let split_index = compact
        .char_indices()
        .find(|(_, c)| !c.is_ascii_digit() && *c != '.')
        .map(|(idx, _)| idx)
        .unwrap_or(compact.len());

    if split_index == 0 {
        return None;
    }

    let number = compact[..split_index].parse::<f64>().ok()?;
    let unit = compact[split_index..].to_ascii_lowercase();

    let multiplier = match unit.as_str() {
        "" | "b" | "byte" | "bytes" => 1.0,
        "kb" => 1_000.0,
        "kib" => 1_024.0,
        "mb" => 1_000_000.0,
        "mib" => 1_048_576.0,
        "gb" => 1_000_000_000.0,
        "gib" => 1_073_741_824.0,
        "tb" => 1_000_000_000_000.0,
        "tib" => 1_099_511_627_776.0,
        _ => return None,
    };

    Some(number * multiplier)
}

fn format_transfer_speed(speed_bps: f64) -> String {
    if !speed_bps.is_finite() || speed_bps <= 0.0 {
        return String::new();
    }

    if speed_bps >= 1_073_741_824.0 {
        return format!("{:.2} GiB/s", speed_bps / 1_073_741_824.0);
    }
    if speed_bps >= 1_048_576.0 {
        return format!("{:.2} MiB/s", speed_bps / 1_048_576.0);
    }
    if speed_bps >= 1_024.0 {
        return format!("{:.1} KiB/s", speed_bps / 1_024.0);
    }

    format!("{:.0} B/s", speed_bps)
}

// Tauri commands for downloading
#[tauri::command]
pub async fn check_yt_dlp(app_handle: AppHandle, include_latest: Option<bool>) -> Result<YtDlpInfo, String> {
    let downloader = Downloader::new(&app_handle);
    downloader.check_yt_dlp(include_latest.unwrap_or(false)).await
}

#[tauri::command]
pub async fn update_yt_dlp(app_handle: AppHandle) -> Result<YtDlpInfo, String> {
    Downloader::update_yt_dlp(&app_handle).await
}

#[tauri::command]
pub async fn get_media_info(app_handle: AppHandle, url: String, enable_sponsorblock: Option<bool>) -> Result<MediaInfo, String> {
    let downloader = Downloader::new(&app_handle);
    downloader.get_media_info(&url, enable_sponsorblock.unwrap_or(false)).await
}

/// Probe a direct file URL to get size and filename without using yt-dlp
#[tauri::command]
pub async fn probe_direct_file(url: String) -> Result<DirectFileInfo, String> {
    use reqwest::header::{CONTENT_LENGTH, USER_AGENT};
    
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client.head(&url)
        .header(USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send()
        .await
        .map_err(|e| format!("HEAD request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("HEAD request returned status: {}", response.status()));
    }
    
    let headers = response.headers();
    
    // Get content length
    let file_size = headers
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    
    // Get content type
    let content_type = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    
    // Try to get filename from Content-Disposition
    let filename = headers
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            let extracted = if let Some(pos) = s.find("filename=") {
                let rest = &s[pos + 9..];
                rest.trim_start_matches('"')
                    .split('"').next()
                    .or_else(|| rest.split(';').next())
                    .map(|s| s.trim().to_string())
            } else if let Some(pos) = s.find("filename*=") {
                let rest = &s[pos + 10..];
                rest.split("''").nth(1)
                    .map(|s| urlencoding::decode(s).unwrap_or_else(|_| s.into()).to_string())
            } else {
                None
            };

            // Prevent path traversal by extracting only the final file component.
            extracted.map(|name| {
                std::path::Path::new(&name)
                    .file_name()
                    .map(|f| f.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "download".to_string())
            })
        });
    
    // Fallback to extract filename from URL path
    let filename = filename.or_else(|| {
        url::Url::parse(&url).ok()
            .and_then(|u| u.path_segments()?.last().map(|s| s.to_string()))
            .filter(|s| !s.is_empty() && s != "download")
    });
    
    // Determine if this is a supported media type
    let is_media = content_type.as_ref().map(|ct| {
        ct.starts_with("video/") || 
        ct.starts_with("audio/") || 
        ct.contains("octet-stream")
    }).unwrap_or(true);
    
    println!("[ProbeDirectFile] URL: {}", url);
    println!("[ProbeDirectFile] Size: {} bytes, Filename: {:?}, Type: {:?}", file_size, filename, content_type);
    
    Ok(DirectFileInfo {
        file_size,
        filename,
        content_type,
        is_media,
    })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DirectFileInfo {
    pub file_size: i64,
    pub filename: Option<String>,
    pub content_type: Option<String>,
    pub is_media: bool,
}

#[tauri::command]
pub async fn start_download(
    app_handle: AppHandle,
    request: DownloadRequest,
) -> Result<(), String> {
    let downloader = Downloader::new(&app_handle);
    downloader.start_download(request, app_handle).await
}

#[tauri::command]
pub async fn cancel_download(id: String) -> Result<(), String> {
    let sender = {
        let mut downloads = ACTIVE_DOWNLOADS.lock().unwrap();
        downloads.remove(&id)
    };

    if let Some(tx) = sender {
        let _ = tx.send(());
        Ok(())
    } else {
        Err("Download not found or already finished".to_string())
    }
}

#[tauri::command]
pub async fn get_supported_platforms() -> Result<Vec<String>, String> {
    // Return a list of popular supported platforms
    Ok(vec![
        "YouTube".to_string(),
        "Vimeo".to_string(),
        "Dailymotion".to_string(),
        "Facebook".to_string(),
        "Instagram".to_string(),
        "Twitter/X".to_string(),
        "TikTok".to_string(),
        "Twitch".to_string(),
        "SoundCloud".to_string(),
        "Spotify (with cookies)".to_string(),
        "Reddit".to_string(),
        "Bilibili".to_string(),
        "NicoNico".to_string(),
        "Bandcamp".to_string(),
        "Mixcloud".to_string(),
        "And 1000+ more...".to_string(),
    ])
}

#[tauri::command]
pub async fn get_default_download_path(app_handle: AppHandle) -> Result<String, String> {
    // Try to get user's Downloads folder
    if let Some(download_dir) = dirs::download_dir() {
        let ownstash_dir = download_dir.join("Ownstash Downloads");
        return Ok(ownstash_dir.to_string_lossy().to_string());
    }
    
    // Fallback to app data directory
    let app_data_dir = app_handle.path().app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("downloads").to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_download_folder_size(path: String) -> Result<i64, String> {
    use std::fs;
    use std::path::Path;
    
    fn calculate_dir_size(path: &Path) -> std::io::Result<u64> {
        let mut total_size = 0u64;
        
        if path.is_dir() {
            for entry in fs::read_dir(path)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    total_size += calculate_dir_size(&path)?;
                } else {
                    total_size += entry.metadata()?.len();
                }
            }
        } else if path.is_file() {
            total_size = fs::metadata(path)?.len();
        }
        
        Ok(total_size)
    }
    
    let path = Path::new(&path);
    if !path.exists() {
        return Ok(0);
    }
    
    calculate_dir_size(path)
        .map(|size| size as i64)
        .map_err(|e| format!("Failed to calculate folder size: {}", e))
}
