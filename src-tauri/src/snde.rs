//! SNDE - Ownstash Native Download Engine
//!
//! A high-performance parallel download engine designed to maximize bandwidth utilization
//! for static files (archives, executables, ISOs, direct media files).
//!
//! Key Features:
//! - Multi-connection parallel downloading with dynamic connection management
//! - Forced HTTP/1.1 for guaranteed TCP-level parallelism
//! - Safe range management (no mid-stream splitting)
//! - Automatic throttling detection and connection collapse
//! - Integration with Host Reputation for optimal starting configuration

use crate::download_router::RoutingDecision;
use crate::health_metrics::{
    ConnectionHealth, DownloadEngine, DownloadHealth, DownloadPhase, 
    HEALTH_REGISTRY, WatchdogAction,
};
use crate::host_reputation::extract_domain;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT_RANGES, CONTENT_LENGTH, RANGE, USER_AGENT};
use reqwest::{Client, Response, Version};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::SeekFrom;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::sync::{mpsc, Mutex, RwLock, Semaphore};

/// Maximum number of concurrent connections per download
const MAX_CONNECTIONS: u8 = 16;

/// Minimum chunk size (1MB) - don't split below this
const MIN_CHUNK_SIZE: u64 = 1024 * 1024;

/// Default chunk size for work distribution (8MB)
const DEFAULT_CHUNK_SIZE: u64 = 8 * 1024 * 1024;

/// Buffer size for reading response body (256KB)
const BUFFER_SIZE: usize = 256 * 1024;

/// Stall detection timeout (10 seconds with no progress)
const STALL_TIMEOUT_SECS: u64 = 10;

/// Throttling detection - if speed drops below this % of peak, consider throttled
const THROTTLE_THRESHOLD_PERCENT: f64 = 0.3;

/// SNDE Download Progress event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SNDEProgress {
    pub id: String,
    pub progress: f64,
    pub speed: String,
    pub eta: String,
    pub status: String,
    pub downloaded_bytes: i64,
    pub total_bytes: i64,
    pub active_connections: u8,
    pub engine_badge: String,
}

/// A byte range work unit
#[derive(Debug, Clone)]
struct ChunkWork {
    /// Start byte (inclusive)
    start: u64,
    /// End byte (inclusive)
    end: u64,
    /// Whether this chunk is currently being processed
    in_progress: bool,
    /// Whether this chunk is complete
    completed: bool,
    /// Retry count for this chunk
    retries: u8,
}

/// Statistics for a single connection
#[derive(Debug)]
struct ConnectionStats {
    bytes_downloaded: AtomicU64,
    error_count: AtomicU64,
    is_stalled: AtomicBool,
}

impl Default for ConnectionStats {
    fn default() -> Self {
        Self {
            bytes_downloaded: AtomicU64::new(0),
            error_count: AtomicU64::new(0),
            is_stalled: AtomicBool::new(false),
        }
    }
}

/// SNDE Download Request
#[derive(Debug, Clone)]
pub struct SNDERequest {
    pub id: String,
    pub url: String,
    pub output_path: PathBuf,
    pub routing_decision: RoutingDecision,
}

/// SNDE Download Result
#[derive(Debug)]
pub struct SNDEResult {
    pub success: bool,
    pub error: Option<String>,
    pub bytes_downloaded: u64,
    pub duration_secs: f64,
    pub avg_speed_kbps: u32,
}

/// The SNDE Download Engine
pub struct SNDEEngine {
    /// HTTP client configured for parallel downloads
    client: Client,
    /// HTTP/1.1 only client for forced parallelism
    http1_client: Client,
}

impl SNDEEngine {
    /// Create a new SNDE engine
    pub fn new() -> Self {
        // Standard client with HTTP/2 support
        let client = Client::builder()
            .timeout(Duration::from_secs(300))
            .connect_timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(MAX_CONNECTIONS as usize)
            .build()
            .unwrap_or_default();

        // HTTP/1.1 only client for guaranteed parallel TCP connections
        let http1_client = Client::builder()
            .timeout(Duration::from_secs(300))
            .connect_timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(MAX_CONNECTIONS as usize)
            .http1_only()  // Force HTTP/1.1
            .build()
            .unwrap_or_default();

        Self { client, http1_client }
    }

    /// Get the appropriate client based on routing decision
    fn get_client(&self, force_http1: bool) -> &Client {
        if force_http1 {
            &self.http1_client
        } else {
            &self.client
        }
    }

    /// Perform the parallel download
    pub async fn download(
        &self,
        request: SNDERequest,
        app_handle: AppHandle,
        cancel_rx: mpsc::Receiver<()>,
    ) -> SNDEResult {
        let start_time = Instant::now();
        let id = request.id.clone();
        
        println!("[SNDE] Starting download: {} -> {:?}", request.url, request.output_path);
        
        // Update health registry
        HEALTH_REGISTRY.set_phase(&id, DownloadPhase::Preflight);

        // Determine file size and verify range support
        let probe_result = match self.probe_file(&request).await {
            Ok(r) => r,
            Err(e) => {
                return SNDEResult {
                    success: false,
                    error: Some(e),
                    bytes_downloaded: 0,
                    duration_secs: start_time.elapsed().as_secs_f64(),
                    avg_speed_kbps: 0,
                };
            }
        };

        let total_size = probe_result.0;
        let supports_range = probe_result.1;
        let probed_filename = probe_result.2;

        // Determine the actual output path
        // If we got a filename from the server and the current path looks like a directory or generic name
        let actual_output_path = if let Some(ref server_filename) = probed_filename {
            let current_filename = request.output_path.file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            
            // Use server filename if current one looks like a generic name or "download"
            if current_filename == "download" || 
               current_filename.starts_with("download_") ||
               current_filename.is_empty() ||
               request.output_path.is_dir() {
                if let Some(parent) = request.output_path.parent() {
                    parent.join(server_filename)
                } else {
                    PathBuf::from(server_filename)
                }
            } else {
                request.output_path.clone()
            }
        } else {
            request.output_path.clone()
        };

        println!("[SNDE] File size: {} bytes, Range support: {}", total_size, supports_range);
        println!("[SNDE] Output path: {:?}", actual_output_path);

        // If no range support, fall back to single connection
        let num_connections = if supports_range {
            request.routing_decision.recommended_connections.min(MAX_CONNECTIONS)
        } else {
            1
        };

        println!("[SNDE] Using {} connections", num_connections);

        // Update health registry with file info
        HEALTH_REGISTRY.set_phase(&id, DownloadPhase::Allocating);

        // Pre-allocate the file
        if let Err(e) = self.preallocate_file(&actual_output_path, total_size).await {
            return SNDEResult {
                success: false,
                error: Some(format!("Failed to allocate file: {}", e)),
                bytes_downloaded: 0,
                duration_secs: start_time.elapsed().as_secs_f64(),
                avg_speed_kbps: 0,
            };
        }

        HEALTH_REGISTRY.set_phase(&id, DownloadPhase::Downloading);

        // Create work chunks
        let chunks = self.create_chunks(total_size, num_connections);
        let chunks = Arc::new(Mutex::new(chunks));

        // Shared state
        let total_downloaded = Arc::new(AtomicU64::new(0));
        let is_cancelled = Arc::new(AtomicBool::new(false));
        let connection_stats: Arc<Vec<ConnectionStats>> = Arc::new(
            (0..num_connections).map(|_| ConnectionStats::default()).collect()
        );

        // Progress reporting task
        let progress_handle = {
            let id = id.clone();
            let app = app_handle.clone();
            let total_downloaded = Arc::clone(&total_downloaded);
            let is_cancelled = Arc::clone(&is_cancelled);
            let badge = request.routing_decision.badge.clone();
            
            tokio::spawn(async move {
                let mut last_bytes = 0u64;
                let mut last_time = Instant::now();
                
                while !is_cancelled.load(Ordering::Relaxed) {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    
                    let current_bytes = total_downloaded.load(Ordering::Relaxed);
                    let elapsed = last_time.elapsed().as_secs_f64();
                    
                    if elapsed > 0.0 {
                        let speed_bps = ((current_bytes - last_bytes) as f64 / elapsed) as u64;
                        let progress = (current_bytes as f64 / total_size as f64) * 100.0;
                        let remaining_bytes = total_size.saturating_sub(current_bytes);
                        let eta_secs = if speed_bps > 0 {
                            remaining_bytes / speed_bps
                        } else {
                            0
                        };

                        let speed_str = format_speed(speed_bps);
                        let eta_str = format_eta(eta_secs);

                        let _ = app.emit("download-progress", SNDEProgress {
                            id: id.clone(),
                            progress,
                            speed: speed_str,
                            eta: eta_str,
                            status: "downloading".to_string(),
                            downloaded_bytes: current_bytes as i64,
                            total_bytes: total_size as i64,
                            active_connections: num_connections,
                            engine_badge: badge.clone(),
                        });

                        // Update health metrics
                        HEALTH_REGISTRY.update_progress(&id, current_bytes, speed_bps);

                        last_bytes = current_bytes;
                        last_time = Instant::now();
                    }
                }
            })
        };

        // Cancellation listener
        let cancel_handle = {
            let is_cancelled = Arc::clone(&is_cancelled);
            let mut cancel_rx = cancel_rx;
            
            tokio::spawn(async move {
                let _ = cancel_rx.recv().await;
                is_cancelled.store(true, Ordering::Relaxed);
            })
        };

        // Spawn download workers
        let mut worker_handles = Vec::new();
        let file = Arc::new(Mutex::new(
            OpenOptions::new()
                .write(true)
                .open(&actual_output_path)
                .await
                .expect("Failed to open output file")
        ));

        let client = if request.routing_decision.force_http1 {
            self.http1_client.clone()
        } else {
            self.client.clone()
        };

        for conn_id in 0..num_connections {
            let client = client.clone();
            let url = request.url.clone();
            let chunks = Arc::clone(&chunks);
            let file = Arc::clone(&file);
            let total_downloaded = Arc::clone(&total_downloaded);
            let is_cancelled = Arc::clone(&is_cancelled);
            let connection_stats = Arc::clone(&connection_stats);
            let id = id.clone();

            let handle = tokio::spawn(async move {
                Self::worker_loop(
                    conn_id,
                    client,
                    url,
                    chunks,
                    file,
                    total_downloaded,
                    is_cancelled,
                    connection_stats,
                    id,
                ).await
            });

            worker_handles.push(handle);
        }

        // Wait for all workers to complete
        let mut all_success = true;
        for handle in worker_handles {
            match handle.await {
                Ok(result) => {
                    if !result {
                        all_success = false;
                    }
                }
                Err(e) => {
                    println!("[SNDE] Worker panicked: {:?}", e);
                    all_success = false;
                }
            }
        }

        // Stop progress reporting
        is_cancelled.store(true, Ordering::Relaxed);
        
        // Give progress task time to notice the cancellation flag
        tokio::time::sleep(Duration::from_millis(300)).await;
        
        // Abort the cancel handle - it's waiting for a message that won't come on success
        cancel_handle.abort();
        
        // Wait for progress task to finish (it checks is_cancelled and will exit)
        let _ = progress_handle.await;

        let duration = start_time.elapsed().as_secs_f64();
        let final_bytes = total_downloaded.load(Ordering::Relaxed);
        let avg_speed_kbps = if duration > 0.0 {
            ((final_bytes as f64 / 1024.0) / duration) as u32
        } else {
            0
        };

        // Update health registry
        if all_success && final_bytes == total_size {
            HEALTH_REGISTRY.set_phase(&id, DownloadPhase::Completed);
        } else {
            HEALTH_REGISTRY.set_phase(&id, DownloadPhase::Failed);
        }

        // Emit final progress
        let _ = app_handle.emit("download-progress", SNDEProgress {
            id: id.clone(),
            progress: if all_success { 100.0 } else { (final_bytes as f64 / total_size as f64) * 100.0 },
            speed: String::new(),
            eta: String::new(),
            status: if all_success { "completed".to_string() } else { "failed".to_string() },
            downloaded_bytes: final_bytes as i64,
            total_bytes: total_size as i64,
            active_connections: 0,
            engine_badge: request.routing_decision.badge.clone(),
        });

        println!("[SNDE] Download finished: success={}, bytes={}/{}, duration={:.1}s, speed={} KB/s", 
            all_success && final_bytes == total_size, final_bytes, total_size, duration, avg_speed_kbps);

        SNDEResult {
            success: all_success && final_bytes == total_size,
            error: if all_success { None } else { Some("Download incomplete".to_string()) },
            bytes_downloaded: final_bytes,
            duration_secs: duration,
            avg_speed_kbps,
        }
    }

    /// Probe the file to get size, range support, and filename
    async fn probe_file(&self, request: &SNDERequest) -> Result<(u64, bool, Option<String>), String> {
        let response = self.client
            .head(&request.url)
            .header(USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .send()
            .await
            .map_err(|e| format!("HEAD request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("HEAD request returned {}", response.status()));
        }

        let headers = response.headers();
        
        // Get content length
        let content_length = headers
            .get(CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .ok_or_else(|| "No Content-Length header".to_string())?;

        // Check for range support
        let supports_range = headers
            .get(ACCEPT_RANGES)
            .map(|v| v.to_str().unwrap_or("") == "bytes")
            .unwrap_or(false);

        // Try to extract filename from Content-Disposition header
        let filename = headers
            .get("content-disposition")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| {
                // Parse Content-Disposition: attachment; filename="something.zip"
                // or Content-Disposition: attachment; filename*=UTF-8''something.zip
                let extracted = if let Some(pos) = s.find("filename=") {
                    let rest = &s[pos + 9..];
                    rest.trim_start_matches('"')
                        .split('"').next()
                        .or_else(|| rest.split(';').next())
                        .map(|s| s.trim().to_string())
                } else if let Some(pos) = s.find("filename*=") {
                    let rest = &s[pos + 10..];
                    // Handle UTF-8 encoded filenames like: UTF-8''filename.ext
                    rest.split("''").nth(1)
                        .map(|s| urlencoding::decode(s).unwrap_or_else(|_| s.into()).to_string())
                } else {
                    None
                };

                // 🛡️ Sentinel: Prevent path traversal by extracting only the file name
                extracted.map(|name| {
                    std::path::Path::new(&name)
                        .file_name()
                        .map(|f| f.to_string_lossy().into_owned())
                        .unwrap_or_else(|| "download".to_string())
                })
            });

        println!("[SNDE] Probe result: size={}, range={}, filename={:?}", content_length, supports_range, filename);

        Ok((content_length, supports_range, filename))
    }

    /// Pre-allocate the output file (Windows-optimized)
    async fn preallocate_file(&self, path: &PathBuf, size: u64) -> Result<(), String> {
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        let file = File::create(path)
            .await
            .map_err(|e| format!("Failed to create file: {}", e))?;

        // Tiered pre-allocation based on file size
        if size < 8 * 1024 * 1024 * 1024 {
            // < 8GB: Immediate full pre-allocation
            file.set_len(size)
                .await
                .map_err(|e| format!("Failed to pre-allocate: {}", e))?;
        } else if size < 32 * 1024 * 1024 * 1024 {
            // 8-32GB: Chunked pre-allocation (allocate first 4GB now)
            file.set_len(4 * 1024 * 1024 * 1024)
                .await
                .map_err(|e| format!("Failed to pre-allocate: {}", e))?;
        } else {
            // > 32GB: Lazy growth - just create the file
            // Will extend as needed during download
        }

        Ok(())
    }

    /// Create work chunks for parallel download
    fn create_chunks(&self, total_size: u64, num_connections: u8) -> Vec<ChunkWork> {
        let chunk_size = (total_size / num_connections as u64).max(MIN_CHUNK_SIZE);
        let mut chunks = Vec::new();
        let mut start = 0u64;

        while start < total_size {
            let end = (start + chunk_size - 1).min(total_size - 1);
            chunks.push(ChunkWork {
                start,
                end,
                in_progress: false,
                completed: false,
                retries: 0,
            });
            start = end + 1;
        }

        chunks
    }

    /// Worker loop - claims and downloads chunks
    async fn worker_loop(
        conn_id: u8,
        client: Client,
        url: String,
        chunks: Arc<Mutex<Vec<ChunkWork>>>,
        file: Arc<Mutex<File>>,
        total_downloaded: Arc<AtomicU64>,
        is_cancelled: Arc<AtomicBool>,
        _connection_stats: Arc<Vec<ConnectionStats>>,
        _download_id: String,
    ) -> bool {
        loop {
            if is_cancelled.load(Ordering::Relaxed) {
                return true;
            }

            // Try to claim a chunk
            let chunk_opt = {
                let mut chunks_guard = chunks.lock().await;
                let mut found = None;
                for (idx, c) in chunks_guard.iter_mut().enumerate() {
                    if !c.completed && !c.in_progress && c.retries < 5 {
                        c.in_progress = true;
                        found = Some((c.start, c.end, idx));
                        break;
                    }
                }
                found
            };

            let (start, end, chunk_idx) = match chunk_opt {
                Some(c) => c,
                None => {
                    // Check if all done
                    let chunks_guard = chunks.lock().await;
                    let all_complete = chunks_guard.iter().all(|c| c.completed);
                    if all_complete {
                        return true;
                    }
                    // Wait and retry
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
            };

            println!("[SNDE] Worker {} downloading bytes {}-{}", conn_id, start, end);

            // Download this chunk
            let result = Self::download_chunk(
                &client,
                &url,
                start,
                end,
                Arc::clone(&file),
                Arc::clone(&total_downloaded),
                Arc::clone(&is_cancelled),
            ).await;

            // Update chunk status
            {
                let mut chunks_guard = chunks.lock().await;
                if let Some(chunk) = chunks_guard.get_mut(chunk_idx) {
                    chunk.in_progress = false;
                    if result {
                        chunk.completed = true;
                        println!("[SNDE] Worker {} completed chunk {}-{}", conn_id, start, end);
                    } else {
                        chunk.retries += 1;
                        println!("[SNDE] Worker {} failed chunk {}-{}, retry {}", conn_id, start, end, chunk.retries);
                    }
                }
            }
        }
    }

    /// Download a single chunk
    async fn download_chunk(
        client: &Client,
        url: &str,
        start: u64,
        end: u64,
        file: Arc<Mutex<File>>,
        total_downloaded: Arc<AtomicU64>,
        is_cancelled: Arc<AtomicBool>,
    ) -> bool {
        let range_header = format!("bytes={}-{}", start, end);
        
        let response = match client
            .get(url)
            .header(RANGE, &range_header)
            .header(USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                println!("[SNDE] Request failed: {}", e);
                return false;
            }
        };

        if !response.status().is_success() && response.status().as_u16() != 206 {
            println!("[SNDE] Bad status: {}", response.status());
            return false;
        }

        let mut stream = response.bytes_stream();
        let mut position = start;
        let mut _buffer: Vec<u8> = Vec::with_capacity(BUFFER_SIZE);

        use futures_util::StreamExt;

        while let Some(chunk_result) = stream.next().await {
            if is_cancelled.load(Ordering::Relaxed) {
                return false;
            }

            match chunk_result {
                Ok(bytes) => {
                    let bytes: bytes::Bytes = bytes;
                    let len = bytes.len();
                    
                    // Write to file at correct position
                    {
                        let mut file_guard = file.lock().await;
                        if let Err(e) = file_guard.seek(SeekFrom::Start(position)).await {
                            println!("[SNDE] Seek failed: {}", e);
                            return false;
                        }
                        if let Err(e) = file_guard.write_all(&bytes).await {
                            println!("[SNDE] Write failed: {}", e);
                            return false;
                        }
                    }

                    position += len as u64;
                    total_downloaded.fetch_add(len as u64, Ordering::Relaxed);
                }
                Err(e) => {
                    println!("[SNDE] Stream error: {}", e);
                    return false;
                }
            }
        }

        true
    }
}

impl Default for SNDEEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Global SNDE engine instance
lazy_static::lazy_static! {
    pub static ref SNDE_ENGINE: SNDEEngine = SNDEEngine::new();
}

/// Format bytes per second to human readable speed
fn format_speed(bps: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bps >= GB {
        format!("{:.2} GB/s", bps as f64 / GB as f64)
    } else if bps >= MB {
        format!("{:.2} MB/s", bps as f64 / MB as f64)
    } else if bps >= KB {
        format!("{:.2} KB/s", bps as f64 / KB as f64)
    } else {
        format!("{} B/s", bps)
    }
}

/// Format seconds to human readable ETA
fn format_eta(seconds: u64) -> String {
    if seconds >= 3600 {
        let hours = seconds / 3600;
        let mins = (seconds % 3600) / 60;
        format!("{}h {}m", hours, mins)
    } else if seconds >= 60 {
        let mins = seconds / 60;
        let secs = seconds % 60;
        format!("{}m {}s", mins, secs)
    } else {
        format!("{}s", seconds)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_speed() {
        assert_eq!(format_speed(500), "500 B/s");
        assert_eq!(format_speed(1500), "1.46 KB/s");
        assert_eq!(format_speed(1_500_000), "1.43 MB/s");
        assert_eq!(format_speed(1_500_000_000), "1.40 GB/s");
    }

    #[test]
    fn test_format_eta() {
        assert_eq!(format_eta(30), "30s");
        assert_eq!(format_eta(90), "1m 30s");
        assert_eq!(format_eta(3700), "1h 1m");
    }
}
