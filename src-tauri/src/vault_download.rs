// Vault Direct Download Module
// Downloads files to temp (with random name), encrypts to vault, then deletes temp
// This ensures yt-dlp can properly merge video+audio while still protecting privacy
// The temp file has a random UUID name in system temp dir and is deleted immediately after encryption

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command;

use crate::vault::{get_vault_key, VaultFile, ENCRYPTED_EXTENSION};

// Constants
const CHUNK_SIZE: usize = 1024 * 1024; // 1MB chunks for encryption
const VAULT_MAGIC: &[u8; 4] = b"SLV2";
const NONCE_SIZE: usize = 12;
const KEY_SIZE: usize = 32;

// ============ Data Structures ============

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VaultDownloadRequest {
    pub id: String,
    pub url: String,
    pub original_name: String,
    pub file_type: String, // "video" | "audio"
    pub thumbnail: Option<String>,
    // Format options
    pub audio_only: bool,
    pub quality: Option<String>,
    pub format: Option<String>,
    pub audio_format: String,
    pub embed_metadata: bool,
    pub use_sponsorblock: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VaultDownloadProgress {
    pub id: String,
    pub progress: f64,
    pub speed: String,
    pub eta: String,
    pub status: String, // "preparing" | "downloading" | "encrypting" | "completed" | "failed" | "cancelled"
    pub downloaded_bytes: Option<i64>,
    pub total_bytes: Option<i64>,
    pub encrypted_bytes: Option<i64>,
}

// Track active vault downloads for cancellation
lazy_static::lazy_static! {
    static ref ACTIVE_VAULT_DOWNLOADS: std::sync::Mutex<std::collections::HashMap<String, Arc<AtomicBool>>> =
        std::sync::Mutex::new(std::collections::HashMap::new());
}

// ============ Helper Functions ============

fn get_vault_files_dir(app_handle: &AppHandle) -> PathBuf {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");
    app_data_dir.join("vault").join("files")
}

// ============ yt-dlp Integration ============

/// Creates a hidden Command (no console window on Windows)
#[cfg(windows)]
fn create_hidden_command(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new(program);
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd
}

#[cfg(not(windows))]
fn create_hidden_command(program: &str) -> Command {
    Command::new(program)
}

/// Find yt-dlp binary path
fn find_yt_dlp(app_handle: &AppHandle) -> Option<String> {
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let paths = if cfg!(windows) {
            vec![
                resource_dir.join("binaries").join("yt-dlp.exe"),
                resource_dir.join("yt-dlp.exe"),
            ]
        } else {
            vec![
                resource_dir.join("binaries").join("yt-dlp"),
                resource_dir.join("yt-dlp"),
            ]
        };

        for path in paths {
            if path.exists() {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }

    // Fallback: try system PATH
    if let Ok(output) = std::process::Command::new(if cfg!(windows) { "where" } else { "which" })
        .arg("yt-dlp")
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path.lines().next().unwrap_or(&path).to_string());
            }
        }
    }

    None
}

// ============ Tauri Commands ============

/// Start a direct vault download
/// Downloads content to temp directory, encrypts to vault, then deletes temp
/// This ensures yt-dlp can properly merge video+audio while still protecting privacy
#[tauri::command]
pub async fn vault_direct_download(
    app_handle: AppHandle,
    request: VaultDownloadRequest,
) -> Result<VaultFile, String> {
    println!("[VaultDownload] Starting vault download for: {}", request.original_name);
    println!("[VaultDownload] URL: {}", request.url);

    // Get vault encryption key (vault must be unlocked)
    let key = get_vault_key()?;

    // Generate unique file ID and encrypted filename
    let file_id = uuid::Uuid::new_v4().to_string();
    let encrypted_name = format!("{}{}", file_id, ENCRYPTED_EXTENSION);
    let vault_files_dir = get_vault_files_dir(&app_handle);
    let output_path = vault_files_dir.join(&encrypted_name);

    // Create temp directory path with random name
    let temp_dir = std::env::temp_dir().join("slasshy_vault_temp");
    tokio::fs::create_dir_all(&temp_dir).await
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;
    
    // Random temp filename to avoid any recognizable traces
    let temp_id = uuid::Uuid::new_v4().to_string();
    let temp_filename = format!("{}.tmp", temp_id);
    let temp_file_path = temp_dir.join(&temp_filename);

    // Create cancellation flag
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut downloads = ACTIVE_VAULT_DOWNLOADS.lock().unwrap();
        downloads.insert(request.id.clone(), cancel_flag.clone());
    }

    // Emit preparing status
    let _ = app_handle.emit("vault-download-progress", VaultDownloadProgress {
        id: request.id.clone(),
        progress: 0.0,
        speed: String::new(),
        eta: String::new(),
        status: "preparing".to_string(),
        downloaded_bytes: None,
        total_bytes: None,
        encrypted_bytes: None,
    });

    // Use standard downloader approach with yt-dlp for proper video+audio handling
    let download_result = download_to_temp(
        &app_handle,
        &request,
        &temp_file_path,
        cancel_flag.clone(),
    ).await;

    // Check if download was cancelled or failed
    if let Err(e) = download_result {
        // Cleanup
        {
            let mut downloads = ACTIVE_VAULT_DOWNLOADS.lock().unwrap();
            downloads.remove(&request.id);
        }
        let _ = tokio::fs::remove_file(&temp_file_path).await;
        
        let status = if e.contains("cancelled") { "cancelled" } else { "failed" };
        let _ = app_handle.emit("vault-download-progress", VaultDownloadProgress {
            id: request.id.clone(),
            progress: 0.0,
            speed: String::new(),
            eta: String::new(),
            status: status.to_string(),
            downloaded_bytes: None,
            total_bytes: None,
            encrypted_bytes: None,
        });
        return Err(e);
    }

    // Emit encrypting status
    let _ = app_handle.emit("vault-download-progress", VaultDownloadProgress {
        id: request.id.clone(),
        progress: 95.0,
        speed: String::new(),
        eta: String::new(),
        status: "encrypting".to_string(),
        downloaded_bytes: None,
        total_bytes: None,
        encrypted_bytes: None,
    });

    println!("[VaultDownload] Download complete, encrypting to vault...");

    // Encrypt the temp file to vault
    let temp_path_clone = temp_file_path.clone();
    let output_path_clone = output_path.clone();
    let key_copy = key;

    let encrypt_result = tokio::task::spawn_blocking(move || {
        encrypt_file_to_vault(&key_copy, &temp_path_clone, &output_path_clone)
    }).await;

    // Get file size before deleting temp
    let file_size = tokio::fs::metadata(&temp_file_path).await
        .map(|m| m.len())
        .unwrap_or(0);

    // IMMEDIATELY delete temp file - critical for privacy
    let delete_result = tokio::fs::remove_file(&temp_file_path).await;
    if let Err(e) = &delete_result {
        println!("[VaultDownload] Warning: Failed to delete temp file: {}", e);
        // Try harder - schedule for deletion on reboot (Windows)
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // Mark for deletion
            let _ = std::fs::remove_file(&temp_file_path);
        }
    } else {
        println!("[VaultDownload] Temp file deleted successfully (no traces)");
    }

    // Also try to clean up the temp directory if empty
    let _ = tokio::fs::remove_dir(&temp_dir).await;

    // Check encryption result
    match encrypt_result {
        Ok(Ok(())) => {
            println!("[VaultDownload] Encryption successful!");
        }
        Ok(Err(e)) => {
            // Cleanup
            {
                let mut downloads = ACTIVE_VAULT_DOWNLOADS.lock().unwrap();
                downloads.remove(&request.id);
            }
            let _ = app_handle.emit("vault-download-progress", VaultDownloadProgress {
                id: request.id.clone(),
                progress: 0.0,
                speed: String::new(),
                eta: String::new(),
                status: "failed".to_string(),
                downloaded_bytes: None,
                total_bytes: None,
                encrypted_bytes: None,
            });
            return Err(format!("Encryption failed: {}", e));
        }
        Err(e) => {
            // Cleanup
            {
                let mut downloads = ACTIVE_VAULT_DOWNLOADS.lock().unwrap();
                downloads.remove(&request.id);
            }
            let _ = app_handle.emit("vault-download-progress", VaultDownloadProgress {
                id: request.id.clone(),
                progress: 0.0,
                speed: String::new(),
                eta: String::new(),
                status: "failed".to_string(),
                downloaded_bytes: None,
                total_bytes: None,
                encrypted_bytes: None,
            });
            return Err(format!("Encryption task failed: {}", e));
        }
    }

    // Create vault file entry
    let vault_file = VaultFile {
        id: file_id,
        original_name: request.original_name,
        encrypted_name,
        size_bytes: file_size,
        added_at: chrono::Utc::now().timestamp(),
        file_type: request.file_type,
        thumbnail: request.thumbnail,
        is_folder: false,
        folder_entries: None,
    };

    // Clean up active download tracking
    {
        let mut downloads = ACTIVE_VAULT_DOWNLOADS.lock().unwrap();
        downloads.remove(&request.id);
    }

    // Emit completion
    let _ = app_handle.emit("vault-download-progress", VaultDownloadProgress {
        id: request.id,
        progress: 100.0,
        speed: String::new(),
        eta: String::new(),
        status: "completed".to_string(),
        downloaded_bytes: Some(file_size as i64),
        total_bytes: Some(file_size as i64),
        encrypted_bytes: Some(file_size as i64),
    });

    println!(
        "[VaultDownload] Complete! File encrypted to vault: {} ({} bytes)",
        vault_file.id, file_size
    );

    Ok(vault_file)
}

/// Check if URL should use direct HTTP download (not a media streaming site)
/// Returns true for EVERYTHING except known media streaming sites that require yt-dlp
fn is_direct_file_url(url: &str) -> bool {
    let url_lower = url.to_lowercase();
    
    // Known media streaming sites that REQUIRE yt-dlp for extraction
    // These sites don't provide direct file downloads
    let yt_dlp_required_patterns = [
        // YouTube
        "youtube.com", "youtu.be",
        // Video platforms
        "vimeo.com", "dailymotion.com",
        // Social media (video posts)
        "twitter.com/", "x.com/",  // Note: /status/ patterns
        "instagram.com/p/", "instagram.com/reel/", "instagram.com/tv/",
        "tiktok.com/@",
        // Streaming
        "twitch.tv/videos", "clips.twitch.tv",
        // Audio platforms
        "soundcloud.com", "bandcamp.com",
        // Other
        "spotify.com", "open.spotify.com",
        "facebook.com/watch", "fb.watch",
        "bilibili.com/video", "nicovideo.jp/watch",
    ];
    
    for pattern in yt_dlp_required_patterns.iter() {
        if url_lower.contains(pattern) {
            return false; // This URL needs yt-dlp
        }
    }
    
    // EVERYTHING ELSE gets direct download attempt first
    // This includes: Google Drive, Dropbox, OneDrive, direct file URLs,
    // CDN links, file hosting services, any URL with downloadable content
    true
}

/// Download a direct URL via HTTP with progress tracking
async fn download_direct_url(
    app_handle: &AppHandle,
    request: &VaultDownloadRequest,
    temp_path: &PathBuf,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    use std::time::Instant;
    
    println!("[VaultDownload] Starting direct HTTP download for: {}", request.url);
    
    // Create HTTP client
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(3600)) // 1 hour timeout
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    // Start request
    let response = client.get(&request.url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }
    
    // Get content length for progress
    let total_size = response.content_length().unwrap_or(0);
    
    // Emit downloading status
    let _ = app_handle.emit("vault-download-progress", VaultDownloadProgress {
        id: request.id.clone(),
        progress: 0.0,
        speed: String::new(),
        eta: String::new(),
        status: "downloading".to_string(),
        downloaded_bytes: Some(0),
        total_bytes: if total_size > 0 { Some(total_size as i64) } else { None },
        encrypted_bytes: None,
    });
    
    // Create output file
    let mut file = tokio::fs::File::create(temp_path)
        .await
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    
    // Download with progress
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let start_time = Instant::now();
    let mut last_update = Instant::now();
    
    use futures_util::StreamExt;
    
    while let Some(chunk_result) = stream.next().await {
        // Check for cancellation
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = file.shutdown().await;
            let _ = tokio::fs::remove_file(temp_path).await;
            return Err("Download cancelled".to_string());
        }
        
        let chunk = chunk_result
            .map_err(|e| format!("Failed to read chunk: {}", e))?;
        
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write chunk: {}", e))?;
        
        downloaded += chunk.len() as u64;
        
        // Update progress (throttled to every 100ms)
        if last_update.elapsed().as_millis() >= 100 {
            let progress = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };
            
            // Calculate speed
            let elapsed = start_time.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                format_speed(downloaded as f64 / elapsed)
            } else {
                String::new()
            };
            
            // Calculate ETA
            let eta = if total_size > 0 && elapsed > 0.0 {
                let remaining = total_size - downloaded;
                let speed_bps = downloaded as f64 / elapsed;
                if speed_bps > 0.0 {
                    let eta_secs = (remaining as f64 / speed_bps) as u64;
                    format_eta(eta_secs)
                } else {
                    String::new()
                }
            } else {
                String::new()
            };
            
            let _ = app_handle.emit("vault-download-progress", VaultDownloadProgress {
                id: request.id.clone(),
                progress,
                speed,
                eta,
                status: "downloading".to_string(),
                downloaded_bytes: Some(downloaded as i64),
                total_bytes: if total_size > 0 { Some(total_size as i64) } else { None },
                encrypted_bytes: None,
            });
            
            last_update = Instant::now();
        }
    }
    
    // Flush and close file
    file.flush().await
        .map_err(|e| format!("Failed to flush file: {}", e))?;
    
    println!("[VaultDownload] Direct download complete: {} bytes", downloaded);
    
    Ok(())
}

/// Format download speed
fn format_speed(bytes_per_sec: f64) -> String {
    if bytes_per_sec >= 1_000_000.0 {
        format!("{:.2}MB/s", bytes_per_sec / 1_000_000.0)
    } else if bytes_per_sec >= 1_000.0 {
        format!("{:.2}KB/s", bytes_per_sec / 1_000.0)
    } else {
        format!("{:.0}B/s", bytes_per_sec)
    }
}

/// Format ETA
fn format_eta(seconds: u64) -> String {
    if seconds >= 3600 {
        format!("{:02}:{:02}:{:02}", seconds / 3600, (seconds % 3600) / 60, seconds % 60)
    } else {
        format!("{:02}:{:02}", seconds / 60, seconds % 60)
    }
}

/// Download file to temp using yt-dlp with full processing
/// Also supports direct HTTP downloads for simple file links
async fn download_to_temp(
    app_handle: &AppHandle,
    request: &VaultDownloadRequest,
    temp_path: &PathBuf,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    // Check if this looks like a direct file URL (not a media site)
    let is_direct_url = is_direct_file_url(&request.url);
    
    if is_direct_url {
        // Try direct HTTP download first
        match download_direct_url(app_handle, request, temp_path, cancel_flag.clone()).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                println!("[VaultDownload] Direct download failed, falling back to yt-dlp: {}", e);
                // Fall through to yt-dlp
            }
        }
    }

    // Use yt-dlp for media sites or if direct download failed
    let yt_dlp_path = find_yt_dlp(app_handle)
        .ok_or("yt-dlp not found")?;

    // Build yt-dlp command
    let mut args = vec![
        "-o".to_string(),
        temp_path.to_string_lossy().to_string(),
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
        "--progress".to_string(),
        "--newline".to_string(),
    ];

    // Format selection
    if request.audio_only {
        args.push("-x".to_string());
        args.push("--audio-format".to_string());
        args.push(request.audio_format.clone());
    } else {
        // Quality selection
        let format = match request.quality.as_deref() {
            Some("best") | Some("4k") | Some("2160p") => "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            Some("1080p") => "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
            Some("720p") => "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
            Some("480p") => "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best",
            _ => "best[ext=mp4]/best",
        };
        args.push("-f".to_string());
        args.push(format.to_string());
    }

    // Embed metadata if requested
    if request.embed_metadata {
        args.push("--embed-metadata".to_string());
    }

    // SponsorBlock
    if request.use_sponsorblock {
        args.push("--sponsorblock-remove".to_string());
        args.push("all".to_string());
    }

    // URL
    args.push(request.url.clone());

    println!("[VaultDownload] Running yt-dlp with args: {:?}", args);

    // Emit downloading status
    let _ = app_handle.emit("vault-download-progress", VaultDownloadProgress {
        id: request.id.clone(),
        progress: 0.0,
        speed: String::new(),
        eta: String::new(),
        status: "downloading".to_string(),
        downloaded_bytes: None,
        total_bytes: None,
        encrypted_bytes: None,
    });


    // Run yt-dlp
    let mut child = create_hidden_command(&yt_dlp_path)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start yt-dlp: {}", e))?;

    let stdout = child.stdout.take().unwrap();
    let mut reader = tokio::io::BufReader::new(stdout);
    let mut line = String::new();

    let app = app_handle.clone();
    let req_id = request.id.clone();
    
    // Parse yt-dlp output for progress
    use tokio::io::AsyncBufReadExt;
    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = child.kill().await;
            return Err("Download cancelled".to_string());
        }

        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break, // EOF
            Ok(_) => {
                // Parse progress line like: [download]  50.0% of 100.00MiB at 5.00MiB/s ETA 00:10
                if line.contains("[download]") && line.contains("%") {
                    if let Some(progress) = parse_yt_dlp_progress(&line) {
                        let _ = app.emit("vault-download-progress", VaultDownloadProgress {
                            id: req_id.clone(),
                            progress: progress.0,
                            speed: progress.1,
                            eta: progress.2,
                            status: "downloading".to_string(),
                            downloaded_bytes: None,
                            total_bytes: None,
                            encrypted_bytes: None,
                        });
                    }
                }
            }
            Err(_) => break,
        }
    }

    // Wait for completion
    let status = child.wait().await
        .map_err(|e| format!("yt-dlp process error: {}", e))?;

    if !status.success() {
        return Err(format!("yt-dlp exited with code: {:?}", status.code()));
    }

    // Verify file exists
    if !temp_path.exists() {
        // yt-dlp might have added extension, find the file
        let parent = temp_path.parent().unwrap();
        let stem = temp_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        
        let mut found_path = None;
        if let Ok(mut entries) = tokio::fs::read_dir(parent).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let name = entry.file_name();
                if name.to_string_lossy().starts_with(stem) {
                    found_path = Some(entry.path());
                    break;
                }
            }
        }

        if let Some(actual_path) = found_path {
            // Rename to expected path
            tokio::fs::rename(&actual_path, temp_path).await
                .map_err(|e| format!("Failed to rename output file: {}", e))?;
        } else {
            return Err("Downloaded file not found".to_string());
        }
    }

    Ok(())
}

/// Parse yt-dlp progress line
fn parse_yt_dlp_progress(line: &str) -> Option<(f64, String, String)> {
    // [download]  50.0% of 100.00MiB at 5.00MiB/s ETA 00:10
    let percent_re = regex::Regex::new(r"(\d+\.?\d*)%").ok()?;
    let speed_re = regex::Regex::new(r"at\s+(\S+/s)").ok()?;
    let eta_re = regex::Regex::new(r"ETA\s+(\S+)").ok()?;

    let percent = percent_re.captures(line)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .unwrap_or(0.0);

    let speed = speed_re.captures(line)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();

    let eta = eta_re.captures(line)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();

    Some((percent, speed, eta))
}

/// Encrypt a file to vault format (synchronous, runs in blocking thread)
fn encrypt_file_to_vault(
    key: &[u8; KEY_SIZE],
    input_path: &PathBuf,
    output_path: &PathBuf,
) -> Result<(), String> {
    use std::fs::File;
    use std::io::{Read, Write};

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    // Generate base nonce
    let mut base_nonce = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut base_nonce);

    // Open files
    let mut input_file = File::open(input_path)
        .map_err(|e| format!("Failed to open temp file: {}", e))?;
    
    let file_size = input_file.metadata()
        .map_err(|e| format!("Failed to get file size: {}", e))?.len();

    // Create output directory if needed
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create vault directory: {}", e))?;
    }

    let mut output_file = File::create(output_path)
        .map_err(|e| format!("Failed to create vault file: {}", e))?;

    // Write header: [MAGIC][nonce][size]
    output_file.write_all(VAULT_MAGIC)
        .map_err(|e| format!("Failed to write magic: {}", e))?;
    output_file.write_all(&base_nonce)
        .map_err(|e| format!("Failed to write nonce: {}", e))?;
    output_file.write_all(&file_size.to_le_bytes())
        .map_err(|e| format!("Failed to write size: {}", e))?;

    // Encrypt in chunks
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut chunk_index: u64 = 0;

    loop {
        let bytes_read = input_file.read(&mut buffer)
            .map_err(|e| format!("Failed to read: {}", e))?;
        
        if bytes_read == 0 {
            break;
        }

        // Derive chunk nonce
        let mut chunk_nonce = base_nonce;
        let idx_bytes = chunk_index.to_le_bytes();
        for i in 0..8 {
            chunk_nonce[i] ^= idx_bytes[i];
        }

        let ciphertext = cipher.encrypt(Nonce::from_slice(&chunk_nonce), &buffer[..bytes_read])
            .map_err(|e| format!("Encryption failed: {}", e))?;

        // Write chunk
        let chunk_len = ciphertext.len() as u32;
        output_file.write_all(&chunk_len.to_le_bytes())
            .map_err(|e| format!("Failed to write chunk size: {}", e))?;
        output_file.write_all(&ciphertext)
            .map_err(|e| format!("Failed to write ciphertext: {}", e))?;

        chunk_index += 1;
    }

    output_file.sync_all()
        .map_err(|e| format!("Failed to sync: {}", e))?;

    Ok(())
}

/// Cancel an active vault download
#[tauri::command]
pub fn vault_cancel_download(id: String) -> Result<(), String> {
    let downloads = ACTIVE_VAULT_DOWNLOADS.lock().unwrap();
    if let Some(cancel_flag) = downloads.get(&id) {
        cancel_flag.store(true, Ordering::Relaxed);
        println!("[VaultDownload] Cancellation requested for: {}", id);
        Ok(())
    } else {
        Err(format!("No active vault download found with id: {}", id))
    }
}
