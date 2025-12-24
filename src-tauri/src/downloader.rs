use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

// Track active download processes for cancellation
lazy_static::lazy_static! {
    static ref ACTIVE_DOWNLOADS: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>> = 
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FormatInfo {
    pub format_id: String,
    pub ext: String,
    pub resolution: Option<String>,
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


    fn find_yt_dlp(app_handle: &AppHandle) -> String {
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

        // Try app data directory (for development or copied binaries)
        if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
            let binary_name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
            let data_path = app_data_dir.join("binaries").join(binary_name);
            
            if data_path.exists() {
                println!("[Downloader] Found yt-dlp in app data: {:?}", data_path);
                return data_path.to_string_lossy().to_string();
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



    pub async fn check_yt_dlp(&self) -> Result<YtDlpInfo, String> {
        let output = Self::create_hidden_command(&self.yt_dlp_path)
            .arg("--version")
            .output()
            .await
            .map_err(|e| format!("yt-dlp not found or not working: {}. Please ensure yt-dlp is installed.", e))?;

        if !output.status.success() {
            return Err("yt-dlp returned an error".to_string());
        }

        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let is_embedded = self.yt_dlp_path.contains("binaries");

        Ok(YtDlpInfo {
            version,
            path: self.yt_dlp_path.clone(),
            is_embedded,
        })
    }

    pub async fn get_media_info(&self, url: &str) -> Result<MediaInfo, String> {
        let output = Self::create_hidden_command(&self.yt_dlp_path)
            .args([
                "-j",
                "--no-playlist",
                "--no-warnings",
                url,
            ])
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

        Ok(MediaInfo {
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
        })
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

        let mut args = vec![
            "--progress".to_string(),
            "--newline".to_string(),
            "--no-warnings".to_string(),
            "--progress-template".to_string(),
            "download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._downloaded_bytes_str)s|%(progress._total_bytes_str)s".to_string(),
        ];

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

        tokio::spawn(async move {
            let mut last_progress = 0.0_f64;
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
                        });
                        break;
                    }
                    result = stdout_reader.next_line() => {
                        match result {
                            Ok(Some(line)) => {
                                println!("[yt-dlp stdout] {}", line);
                                
                                // Try to parse progress from various formats
                                if let Some(progress) = parse_progress_template(&line) {
                                    last_progress = progress.0;
                                    let event = DownloadProgress {
                                        id: id.clone(),
                                        progress: progress.0,
                                        speed: progress.1,
                                        eta: progress.2,
                                        status: "downloading".to_string(),
                                        downloaded_bytes: None,
                                        total_bytes: None,
                                        filename: None,
                                    };
                                    let _ = app.emit("download-progress", event);
                                } else if let Some(progress) = parse_progress(&line) {
                                    last_progress = progress.0;
                                    let event = DownloadProgress {
                                        id: id.clone(),
                                        progress: progress.0,
                                        speed: progress.1,
                                        eta: progress.2,
                                        status: "downloading".to_string(),
                                        downloaded_bytes: None,
                                        total_bytes: None,
                                        filename: None,
                                    };
                                    let _ = app.emit("download-progress", event);
                                } else if line.contains("[Merger]") || line.contains("[ExtractAudio]") || line.contains("[ffmpeg]") {
                                    // During merging/post-processing, show 99% progress
                                    let event = DownloadProgress {
                                        id: id.clone(),
                                        progress: 99.0,
                                        speed: "Merging...".to_string(),
                                        eta: "".to_string(),
                                        status: "downloading".to_string(),
                                        downloaded_bytes: None,
                                        total_bytes: None,
                                        filename: None,
                                    };
                                    let _ = app.emit("download-progress", event);
                                }
                            }
                            Ok(None) => break,
                            Err(_) => break,
                        }
                    }
                    result = stderr_reader.next_line() => {
                        match result {
                            Ok(Some(line)) => {
                                error_output.push_str(&line);
                                error_output.push('\n');
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
            });
        });

        Ok(())
    }
}

fn parse_progress_template(line: &str) -> Option<(f64, String, String)> {
    // Parse our custom progress template: percent|speed|eta|downloaded|total
    // yt-dlp outputs like: "50.0%|10.5MiB/s|00:05|52.5MiB|105.0MiB"
    let parts: Vec<&str> = line.split('|').collect();
    if parts.len() >= 3 {
        // Clean the percent string - remove spaces, %, and any other characters
        let percent_str = parts[0]
            .trim()
            .replace('%', "")
            .replace(' ', "")
            .chars()
            .filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
            .collect::<String>();
        
        let progress = percent_str.parse::<f64>().ok()?;
        
        // Clean speed and eta strings
        let speed = parts[1].trim().replace("N/A", "").to_string();
        let eta = parts[2].trim().replace("N/A", "").to_string();
        
        // Log for debugging
        println!("[Progress] {}% | {} | {}", progress, speed, eta);
        
        return Some((progress, speed, eta));
    }
    None
}

fn parse_progress(line: &str) -> Option<(f64, String, String)> {
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

    let speed = line
        .split("at ")
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .unwrap_or("")
        .to_string();

    let eta = line
        .split("ETA ")
        .nth(1)
        .unwrap_or("")
        .trim()
        .to_string();

    // Log for debugging
    println!("[Progress Fallback] {}% | {} | {}", progress, speed, eta);

    Some((progress, speed, eta))
}

// Tauri commands for downloading
#[tauri::command]
pub async fn check_yt_dlp(app_handle: AppHandle) -> Result<YtDlpInfo, String> {
    let downloader = Downloader::new(&app_handle);
    downloader.check_yt_dlp().await
}

#[tauri::command]
pub async fn get_media_info(app_handle: AppHandle, url: String) -> Result<MediaInfo, String> {
    let downloader = Downloader::new(&app_handle);
    downloader.get_media_info(&url).await
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
        let slasshy_dir = download_dir.join("Slasshy Downloads");
        return Ok(slasshy_dir.to_string_lossy().to_string());
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
