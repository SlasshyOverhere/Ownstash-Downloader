//! Health Metrics Registry
//!
//! Real-time monitoring of download health for the Runtime Strategy Manager (Watchdog).
//! This tracks per-download metrics to enable intelligent strategy adaptation.
//!
//! Key metrics tracked:
//! - Throughput per connection
//! - Error rates per segment
//! - Retry density
//! - Stall duration
//! - Server response codes

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Instant;
use chrono::Utc;

/// Individual connection health snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionHealth {
    /// Connection ID (0-based index)
    pub connection_id: u8,
    /// Current throughput in bytes per second
    pub throughput_bps: u64,
    /// Total bytes downloaded by this connection
    pub bytes_downloaded: u64,
    /// Number of errors encountered
    pub error_count: u32,
    /// Number of retries performed
    pub retry_count: u32,
    /// Last HTTP status code received
    pub last_status_code: u16,
    /// Whether this connection is currently stalled
    pub is_stalled: bool,
    /// Duration of current/last stall in milliseconds
    pub stall_duration_ms: u64,
}

impl Default for ConnectionHealth {
    fn default() -> Self {
        Self {
            connection_id: 0,
            throughput_bps: 0,
            bytes_downloaded: 0,
            error_count: 0,
            retry_count: 0,
            last_status_code: 0,
            is_stalled: false,
            stall_duration_ms: 0,
        }
    }
}

/// Aggregate download health metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadHealth {
    /// Unique download ID
    pub download_id: String,
    /// Current active engine (SNDE, SNDE_SAFE, MEDIA_ENGINE)
    pub engine: DownloadEngine,
    /// Start time (Unix timestamp)
    pub started_at: i64,
    /// Total file size in bytes (if known)
    pub total_bytes: Option<u64>,
    /// Total bytes downloaded so far
    pub downloaded_bytes: u64,
    /// Current number of active connections
    pub active_connections: u8,
    /// Max connections ever used for this download
    pub peak_connections: u8,
    /// Per-connection health metrics
    pub connection_health: Vec<ConnectionHealth>,
    /// Aggregate throughput (sum of all connections)
    pub total_throughput_bps: u64,
    /// Total errors across all connections
    pub total_errors: u32,
    /// Total retries across all connections  
    pub total_retries: u32,
    /// Whether throttling has been detected
    pub throttling_detected: bool,
    /// Number of times strategy collapsed
    pub collapse_count: u8,
    /// Whether "Safe Mode" is active
    pub safe_mode_active: bool,
    /// Current phase of download
    pub phase: DownloadPhase,
    /// Error messages for logging/debugging
    pub error_log: Vec<String>,
}

/// Download engine types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DownloadEngine {
    /// Slasshy Native Download Engine - full parallelism
    SNDE,
    /// SNDE in Safe Mode - reduced parallelism, HTTP/2 allowed
    SNDESafe,
    /// yt-dlp based Media Engine for streaming platforms
    MediaEngine,
}

impl std::fmt::Display for DownloadEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DownloadEngine::SNDE => write!(f, "SNDE ACCELERATED"),
            DownloadEngine::SNDESafe => write!(f, "SNDE SAFE"),
            DownloadEngine::MediaEngine => write!(f, "MEDIA ENGINE"),
        }
    }
}

/// Download phase for UI display
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DownloadPhase {
    /// Initial probing/routing decision
    Preflight,
    /// Waiting in queue
    Queued,
    /// Allocating disk space
    Allocating,
    /// Actively downloading
    Downloading,
    /// Merging segments (if applicable)
    Merging,
    /// Post-processing (conversion, etc)
    PostProcessing,
    /// Completed successfully
    Completed,
    /// Failed
    Failed,
    /// Paused by user
    Paused,
    /// Cancelled by user
    Cancelled,
}

impl Default for DownloadHealth {
    fn default() -> Self {
        Self {
            download_id: String::new(),
            engine: DownloadEngine::MediaEngine,
            started_at: Utc::now().timestamp(),
            total_bytes: None,
            downloaded_bytes: 0,
            active_connections: 0,
            peak_connections: 0,
            connection_health: Vec::new(),
            total_throughput_bps: 0,
            total_errors: 0,
            total_retries: 0,
            throttling_detected: false,
            collapse_count: 0,
            safe_mode_active: false,
            phase: DownloadPhase::Preflight,
            error_log: Vec::new(),
        }
    }
}

/// Throttling detection thresholds
#[derive(Debug, Clone)]
pub struct ThrottlingThresholds {
    /// Minimum throughput in bytes/sec before considering it throttled
    pub min_throughput_bps: u64,
    /// Error rate threshold (errors per minute)
    pub max_error_rate: f64,
    /// Maximum retries per segment before flagging
    pub max_retries_per_segment: u32,
    /// Maximum stall duration in ms before action
    pub max_stall_duration_ms: u64,
    /// HTTP status codes that indicate throttling
    pub throttle_status_codes: Vec<u16>,
}

impl Default for ThrottlingThresholds {
    fn default() -> Self {
        Self {
            min_throughput_bps: 10_000, // 10 KB/s minimum
            max_error_rate: 5.0, // 5 errors per minute
            max_retries_per_segment: 3,
            max_stall_duration_ms: 30_000, // 30 seconds
            throttle_status_codes: vec![429, 503, 509], // Too Many Requests, Service Unavailable, Bandwidth Exceeded
        }
    }
}

/// Watchdog action recommendations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchdogAction {
    /// No action needed, everything is healthy
    NoAction,
    /// Collapse connections to the specified count
    CollapseConnections(u8),
    /// Switch to Safe Mode (single connection, HTTP/2)
    EnableSafeMode,
    /// Recommend user intervention (switch to Media Engine)
    RecommendEngineSwitch,
    /// Download is in critical failure state
    CriticalFailure(String),
}

/// Health Metrics Registry - central store for all download health data
pub struct HealthMetricsRegistry {
    /// Map of download_id -> health metrics
    downloads: Arc<RwLock<HashMap<String, DownloadHealth>>>,
    /// Default throttling thresholds
    thresholds: ThrottlingThresholds,
    /// Track when downloads started for rate calculations
    start_times: Arc<RwLock<HashMap<String, Instant>>>,
}

impl HealthMetricsRegistry {
    /// Create a new registry with default thresholds
    pub fn new() -> Self {
        Self {
            downloads: Arc::new(RwLock::new(HashMap::new())),
            thresholds: ThrottlingThresholds::default(),
            start_times: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create a new registry with custom thresholds
    pub fn with_thresholds(thresholds: ThrottlingThresholds) -> Self {
        Self {
            downloads: Arc::new(RwLock::new(HashMap::new())),
            thresholds,
            start_times: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a new download for tracking
    pub fn register_download(&self, download_id: &str, engine: DownloadEngine, total_bytes: Option<u64>) {
        let health = DownloadHealth {
            download_id: download_id.to_string(),
            engine,
            total_bytes,
            started_at: Utc::now().timestamp(),
            ..Default::default()
        };

        if let Ok(mut downloads) = self.downloads.write() {
            downloads.insert(download_id.to_string(), health);
        }

        if let Ok(mut start_times) = self.start_times.write() {
            start_times.insert(download_id.to_string(), Instant::now());
        }
    }

    /// Unregister a download (on completion/cancellation)
    pub fn unregister_download(&self, download_id: &str) {
        if let Ok(mut downloads) = self.downloads.write() {
            downloads.remove(download_id);
        }
        if let Ok(mut start_times) = self.start_times.write() {
            start_times.remove(download_id);
        }
    }

    /// Update download phase
    pub fn set_phase(&self, download_id: &str, phase: DownloadPhase) {
        if let Ok(mut downloads) = self.downloads.write() {
            if let Some(health) = downloads.get_mut(download_id) {
                health.phase = phase;
            }
        }
    }

    /// Update bytes downloaded
    pub fn update_progress(&self, download_id: &str, downloaded_bytes: u64, throughput_bps: u64) {
        if let Ok(mut downloads) = self.downloads.write() {
            if let Some(health) = downloads.get_mut(download_id) {
                health.downloaded_bytes = downloaded_bytes;
                health.total_throughput_bps = throughput_bps;
            }
        }
    }

    /// Update connection-specific metrics
    pub fn update_connection(&self, download_id: &str, connection_health: ConnectionHealth) {
        if let Ok(mut downloads) = self.downloads.write() {
            if let Some(health) = downloads.get_mut(download_id) {
                let conn_id = connection_health.connection_id as usize;
                
                // Ensure we have enough slots
                while health.connection_health.len() <= conn_id {
                    health.connection_health.push(ConnectionHealth::default());
                }
                
                health.connection_health[conn_id] = connection_health;
                health.active_connections = health.connection_health.len() as u8;
                health.peak_connections = health.peak_connections.max(health.active_connections);
                
                // Recalculate aggregates
                health.total_throughput_bps = health.connection_health.iter()
                    .map(|c| c.throughput_bps)
                    .sum();
                health.total_errors = health.connection_health.iter()
                    .map(|c| c.error_count)
                    .sum();
                health.total_retries = health.connection_health.iter()
                    .map(|c| c.retry_count)
                    .sum();
            }
        }
    }

    /// Record an error
    pub fn record_error(&self, download_id: &str, error_message: &str, status_code: Option<u16>) {
        if let Ok(mut downloads) = self.downloads.write() {
            if let Some(health) = downloads.get_mut(download_id) {
                health.total_errors += 1;
                health.error_log.push(format!("[{}] {}", Utc::now().format("%H:%M:%S"), error_message));
                
                // Keep error log bounded to last 50 entries
                if health.error_log.len() > 50 {
                    health.error_log.remove(0);
                }
                
                // Check for throttling status codes
                if let Some(code) = status_code {
                    if self.thresholds.throttle_status_codes.contains(&code) {
                        health.throttling_detected = true;
                    }
                }
            }
        }
    }

    /// Record that connections were collapsed
    pub fn record_collapse(&self, download_id: &str, new_count: u8) {
        if let Ok(mut downloads) = self.downloads.write() {
            if let Some(health) = downloads.get_mut(download_id) {
                health.active_connections = new_count;
                health.collapse_count += 1;
                health.error_log.push(format!(
                    "[{}] Connections collapsed to {}",
                    Utc::now().format("%H:%M:%S"),
                    new_count
                ));
            }
        }
    }

    /// Set safe mode status
    pub fn set_safe_mode(&self, download_id: &str, enabled: bool) {
        if let Ok(mut downloads) = self.downloads.write() {
            if let Some(health) = downloads.get_mut(download_id) {
                health.safe_mode_active = enabled;
                if enabled {
                    health.engine = DownloadEngine::SNDESafe;
                }
            }
        }
    }

    /// Get health metrics for a download
    pub fn get_health(&self, download_id: &str) -> Option<DownloadHealth> {
        self.downloads.read().ok()?.get(download_id).cloned()
    }

    /// Get all active download health metrics
    pub fn get_all_health(&self) -> Vec<DownloadHealth> {
        self.downloads.read()
            .map(|d| d.values().cloned().collect())
            .unwrap_or_default()
    }

    /// Analyze health and recommend watchdog action
    pub fn analyze_and_recommend(&self, download_id: &str) -> WatchdogAction {
        let health = match self.get_health(download_id) {
            Some(h) => h,
            None => return WatchdogAction::NoAction,
        };

        // Calculate error rate
        let elapsed_seconds = self.start_times.read()
            .ok()
            .and_then(|st| st.get(download_id).map(|t| t.elapsed().as_secs_f64()))
            .unwrap_or(1.0);
        
        let error_rate_per_minute = (health.total_errors as f64 / elapsed_seconds) * 60.0;

        // Check for critical conditions
        if health.total_errors > 20 && health.downloaded_bytes < 1024 {
            return WatchdogAction::CriticalFailure("Too many errors with no progress".to_string());
        }

        // Check for throttling indicators
        let is_throttled = health.throttling_detected ||
            error_rate_per_minute > self.thresholds.max_error_rate ||
            health.total_throughput_bps < self.thresholds.min_throughput_bps;

        if is_throttled {
            // Already in safe mode but still throttled
            if health.safe_mode_active {
                return WatchdogAction::RecommendEngineSwitch;
            }

            // Try collapsing first
            if health.active_connections > 1 {
                let new_count = (health.active_connections / 2).max(1);
                return WatchdogAction::CollapseConnections(new_count);
            }

            // Already at 1 connection, switch to safe mode
            return WatchdogAction::EnableSafeMode;
        }

        // Check for stalls
        let any_stalled = health.connection_health.iter()
            .any(|c| c.is_stalled && c.stall_duration_ms > self.thresholds.max_stall_duration_ms);

        if any_stalled {
            if health.active_connections > 1 {
                return WatchdogAction::CollapseConnections(health.active_connections - 1);
            }
            return WatchdogAction::EnableSafeMode;
        }

        WatchdogAction::NoAction
    }
}

impl Default for HealthMetricsRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Global health metrics registry instance
lazy_static::lazy_static! {
    pub static ref HEALTH_REGISTRY: HealthMetricsRegistry = HealthMetricsRegistry::new();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_and_get_health() {
        let registry = HealthMetricsRegistry::new();
        registry.register_download("test-1", DownloadEngine::SNDE, Some(1000));
        
        let health = registry.get_health("test-1").unwrap();
        assert_eq!(health.download_id, "test-1");
        assert_eq!(health.engine, DownloadEngine::SNDE);
        assert_eq!(health.total_bytes, Some(1000));
    }

    #[test]
    fn test_throttling_detection() {
        let registry = HealthMetricsRegistry::new();
        registry.register_download("test-2", DownloadEngine::SNDE, None);
        
        // Record a 429 error (throttling)
        registry.record_error("test-2", "Rate limited", Some(429));
        
        let health = registry.get_health("test-2").unwrap();
        assert!(health.throttling_detected);
    }

    #[test]
    fn test_engine_display() {
        assert_eq!(format!("{}", DownloadEngine::SNDE), "SNDE ACCELERATED");
        assert_eq!(format!("{}", DownloadEngine::SNDESafe), "SNDE SAFE");
        assert_eq!(format!("{}", DownloadEngine::MediaEngine), "MEDIA ENGINE");
    }
}
