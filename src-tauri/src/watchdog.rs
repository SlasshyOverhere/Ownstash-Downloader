//! Watchdog Module - Runtime Strategy Manager
//!
//! Continuously monitors download health and adapts strategy in real-time.
//! This is the "Runtime Strategy Manager" that handles:
//! - Automatic connection collapsing when throttling is detected
//! - Safe Mode toggling
//! - Health-based interventions
//!
//! Key principle: SNDE → SNDE Safe is automatic; SNDE → Media Engine is NEVER
//! automatic mid-flight (must be user-visible action after failure).

use crate::health_metrics::{
    DownloadHealth, DownloadPhase, WatchdogAction, HEALTH_REGISTRY,
};

#[allow(unused_imports)]
use crate::host_reputation::extract_domain;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::interval;

/// Watchdog event sent to frontend for UI updates
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchdogEvent {
    /// Download ID this event relates to
    pub download_id: String,
    /// Type of event
    pub event_type: WatchdogEventType,
    /// Human-readable message
    pub message: String,
    /// Current download health snapshot
    pub health: Option<DownloadHealth>,
    /// Suggested action for user (if any)
    pub user_action: Option<String>,
}

/// Types of watchdog events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WatchdogEventType {
    /// Normal health update
    HealthUpdate,
    /// Throttling detected
    ThrottlingDetected,
    /// Connections collapsed
    ConnectionsCollapsed,
    /// Safe mode activated
    SafeModeActivated,
    /// Engine switch recommended
    EngineSwitchRecommended,
    /// Critical failure
    CriticalFailure,
    /// Download recovered from bad state
    Recovered,
}

/// Watchdog configuration
#[derive(Debug, Clone)]
pub struct WatchdogConfig {
    /// How often to check health (in milliseconds)
    pub check_interval_ms: u64,
    /// Minimum throughput before considering download stalled (bytes/sec)
    pub min_throughput_bps: u64,
    /// Maximum consecutive errors before taking action
    pub max_consecutive_errors: u32,
    /// Time window for error rate calculation (seconds)
    pub error_window_seconds: u64,
    /// Whether to automatically collapse connections
    pub auto_collapse: bool,
    /// Whether to automatically enable safe mode
    pub auto_safe_mode: bool,
}

impl Default for WatchdogConfig {
    fn default() -> Self {
        Self {
            check_interval_ms: 1000, // Check every second
            min_throughput_bps: 10_000, // 10 KB/s
            max_consecutive_errors: 5,
            error_window_seconds: 60,
            auto_collapse: true,
            auto_safe_mode: true,
        }
    }
}

/// Watchdog command for controlling the monitor
#[derive(Debug, Clone)]
pub enum WatchdogCommand {
    /// Start monitoring a download
    StartMonitoring(String),
    /// Stop monitoring a download
    StopMonitoring(String),
    /// Force connection collapse for a download
    ForceCollapse(String, u8),
    /// Force safe mode for a download
    ForceSafeMode(String),
    /// Shutdown the watchdog
    Shutdown,
}

/// Callback type for connection collapse
pub type CollapseCallback = Box<dyn Fn(&str, u8) + Send + Sync>;

/// Callback type for safe mode
pub type SafeModeCallback = Box<dyn Fn(&str) + Send + Sync>;

/// The Watchdog - monitors and adapts download strategies in real-time
pub struct Watchdog {
    config: WatchdogConfig,
    /// Currently monitored downloads
    monitored_downloads: Arc<RwLock<HashMap<String, WatchdogState>>>,
    /// Channel for receiving commands
    command_rx: Option<mpsc::Receiver<WatchdogCommand>>,
    /// Channel for sending commands
    command_tx: mpsc::Sender<WatchdogCommand>,
}

/// Per-download watchdog state
#[derive(Debug, Clone)]
struct WatchdogState {
    download_id: String,
    last_check_bytes: u64,
    last_check_errors: u32,
    consecutive_stalls: u32,
    actions_taken: Vec<WatchdogAction>,
}

impl Watchdog {
    /// Create a new watchdog with default config
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel(100);
        Self {
            config: WatchdogConfig::default(),
            monitored_downloads: Arc::new(RwLock::new(HashMap::new())),
            command_rx: Some(rx),
            command_tx: tx,
        }
    }

    /// Create a watchdog with custom config
    pub fn with_config(config: WatchdogConfig) -> Self {
        let (tx, rx) = mpsc::channel(100);
        Self {
            config,
            monitored_downloads: Arc::new(RwLock::new(HashMap::new())),
            command_rx: Some(rx),
            command_tx: tx,
        }
    }

    /// Get a command sender for this watchdog
    pub fn get_command_sender(&self) -> mpsc::Sender<WatchdogCommand> {
        self.command_tx.clone()
    }

    /// Start monitoring a download
    pub fn start_monitoring(&self, download_id: &str) {
        if let Ok(mut downloads) = self.monitored_downloads.write() {
            downloads.insert(download_id.to_string(), WatchdogState {
                download_id: download_id.to_string(),
                last_check_bytes: 0,
                last_check_errors: 0,
                consecutive_stalls: 0,
                actions_taken: Vec::new(),
            });
        }
    }

    /// Stop monitoring a download
    pub fn stop_monitoring(&self, download_id: &str) {
        if let Ok(mut downloads) = self.monitored_downloads.write() {
            downloads.remove(download_id);
        }
    }

    /// Check health of a single download and return recommended action
    pub fn check_health(&self, download_id: &str) -> Option<WatchdogAction> {
        let health = HEALTH_REGISTRY.get_health(download_id)?;
        
        // Skip if not actively downloading
        if health.phase != DownloadPhase::Downloading {
            return None;
        }

        // Get/update state
        let mut state_update = None;
        if let Ok(mut downloads) = self.monitored_downloads.write() {
            if let Some(state) = downloads.get_mut(download_id) {
                // Calculate progress since last check
                let bytes_progress = health.downloaded_bytes.saturating_sub(state.last_check_bytes);
                let new_errors = health.total_errors.saturating_sub(state.last_check_errors);

                // Check for stalls (no progress)
                if bytes_progress == 0 && health.downloaded_bytes > 0 {
                    state.consecutive_stalls += 1;
                } else {
                    state.consecutive_stalls = 0;
                }

                // Update state
                state.last_check_bytes = health.downloaded_bytes;
                state.last_check_errors = health.total_errors;

                state_update = Some((state.consecutive_stalls, new_errors, state.actions_taken.clone()));
            }
        }

        let (consecutive_stalls, new_errors, actions_taken) = state_update?;

        // Determine action based on health
        let action = if consecutive_stalls >= 5 {
            // 5 consecutive checks with no progress
            if health.safe_mode_active {
                WatchdogAction::RecommendEngineSwitch
            } else if health.active_connections > 1 {
                WatchdogAction::CollapseConnections((health.active_connections / 2).max(1))
            } else {
                WatchdogAction::EnableSafeMode
            }
        } else if new_errors >= self.config.max_consecutive_errors {
            // Too many new errors
            if health.active_connections > 1 {
                WatchdogAction::CollapseConnections((health.active_connections / 2).max(1))
            } else if !health.safe_mode_active {
                WatchdogAction::EnableSafeMode
            } else {
                WatchdogAction::RecommendEngineSwitch
            }
        } else if health.throttling_detected && !health.safe_mode_active {
            // Throttling detected
            if health.active_connections > 2 {
                WatchdogAction::CollapseConnections(2)
            } else if health.active_connections > 1 {
                WatchdogAction::CollapseConnections(1)
            } else {
                WatchdogAction::EnableSafeMode
            }
        } else {
            WatchdogAction::NoAction
        };

        // Don't repeat the same action
        if action != WatchdogAction::NoAction && !actions_taken.contains(&action) {
            if let Ok(mut downloads) = self.monitored_downloads.write() {
                if let Some(state) = downloads.get_mut(download_id) {
                    state.actions_taken.push(action.clone());
                }
            }
            Some(action)
        } else {
            None
        }
    }

    /// Process a single check cycle for all monitored downloads
    pub fn check_all(&self) -> Vec<(String, WatchdogAction)> {
        let download_ids: Vec<String> = self.monitored_downloads.read()
            .map(|d| d.keys().cloned().collect())
            .unwrap_or_default();

        download_ids.iter()
            .filter_map(|id| {
                self.check_health(id).map(|action| (id.clone(), action))
            })
            .collect()
    }

    /// Run the watchdog loop (blocking, should be spawned as a task)
    pub async fn run(
        mut self,
        app_handle: AppHandle,
        mut collapse_callback: Option<CollapseCallback>,
        mut safe_mode_callback: Option<SafeModeCallback>,
    ) {
        let mut check_interval = interval(Duration::from_millis(self.config.check_interval_ms));
        let mut command_rx = self.command_rx.take().expect("Watchdog already running");

        loop {
            tokio::select! {
                // Handle incoming commands
                Some(cmd) = command_rx.recv() => {
                    match cmd {
                        WatchdogCommand::StartMonitoring(id) => {
                            self.start_monitoring(&id);
                        }
                        WatchdogCommand::StopMonitoring(id) => {
                            self.stop_monitoring(&id);
                        }
                        WatchdogCommand::ForceCollapse(id, count) => {
                            HEALTH_REGISTRY.record_collapse(&id, count);
                            if let Some(ref cb) = collapse_callback {
                                cb(&id, count);
                            }
                        }
                        WatchdogCommand::ForceSafeMode(id) => {
                            HEALTH_REGISTRY.set_safe_mode(&id, true);
                            if let Some(ref cb) = safe_mode_callback {
                                cb(&id);
                            }
                        }
                        WatchdogCommand::Shutdown => {
                            break;
                        }
                    }
                }
                
                // Periodic health checks
                _ = check_interval.tick() => {
                    let actions = self.check_all();
                    
                    for (download_id, action) in actions {
                        match action {
                            WatchdogAction::CollapseConnections(new_count) => {
                                HEALTH_REGISTRY.record_collapse(&download_id, new_count);
                                
                                // Emit event to frontend
                                let event = WatchdogEvent {
                                    download_id: download_id.clone(),
                                    event_type: WatchdogEventType::ConnectionsCollapsed,
                                    message: format!("Connections reduced to {} due to throttling", new_count),
                                    health: HEALTH_REGISTRY.get_health(&download_id),
                                    user_action: None,
                                };
                                let _ = app_handle.emit("watchdog-event", &event);
                                
                                // Call callback
                                if let Some(ref cb) = collapse_callback {
                                    cb(&download_id, new_count);
                                }
                            }
                            WatchdogAction::EnableSafeMode => {
                                HEALTH_REGISTRY.set_safe_mode(&download_id, true);
                                
                                let event = WatchdogEvent {
                                    download_id: download_id.clone(),
                                    event_type: WatchdogEventType::SafeModeActivated,
                                    message: "Safe Mode enabled - single connection with HTTP/2".to_string(),
                                    health: HEALTH_REGISTRY.get_health(&download_id),
                                    user_action: None,
                                };
                                let _ = app_handle.emit("watchdog-event", &event);
                                
                                if let Some(ref cb) = safe_mode_callback {
                                    cb(&download_id);
                                }
                            }
                            WatchdogAction::RecommendEngineSwitch => {
                                let event = WatchdogEvent {
                                    download_id: download_id.clone(),
                                    event_type: WatchdogEventType::EngineSwitchRecommended,
                                    message: "Download struggling - consider switching to Media Engine".to_string(),
                                    health: HEALTH_REGISTRY.get_health(&download_id),
                                    user_action: Some("Switch to Media Engine".to_string()),
                                };
                                let _ = app_handle.emit("watchdog-event", &event);
                            }
                            WatchdogAction::CriticalFailure(reason) => {
                                let event = WatchdogEvent {
                                    download_id: download_id.clone(),
                                    event_type: WatchdogEventType::CriticalFailure,
                                    message: format!("Download critically failed: {}", reason),
                                    health: HEALTH_REGISTRY.get_health(&download_id),
                                    user_action: Some("Retry with Media Engine".to_string()),
                                };
                                let _ = app_handle.emit("watchdog-event", &event);
                            }
                            WatchdogAction::NoAction => {}
                        }
                    }
                }
            }
        }
    }
}

impl Default for Watchdog {
    fn default() -> Self {
        Self::new()
    }
}

/// Create and emit a health update event
pub fn emit_health_update(app_handle: &AppHandle, download_id: &str) {
    if let Some(health) = HEALTH_REGISTRY.get_health(download_id) {
        let event = WatchdogEvent {
            download_id: download_id.to_string(),
            event_type: WatchdogEventType::HealthUpdate,
            message: format!(
                "{} @ {}/s ({} connections)",
                health.engine,
                format_bytes(health.total_throughput_bps),
                health.active_connections
            ),
            health: Some(health),
            user_action: None,
        };
        let _ = app_handle.emit("watchdog-event", &event);
    }
}

/// Format bytes to human-readable string
fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_bytes() {
        assert_eq!(format_bytes(500), "500 B");
        assert_eq!(format_bytes(1500), "1.46 KB");
        assert_eq!(format_bytes(1_500_000), "1.43 MB");
        assert_eq!(format_bytes(1_500_000_000), "1.40 GB");
    }

    #[test]
    fn test_watchdog_state() {
        let watchdog = Watchdog::new();
        watchdog.start_monitoring("test-1");
        
        {
            let downloads = watchdog.monitored_downloads.read().unwrap();
            assert!(downloads.contains_key("test-1"));
        }
        
        watchdog.stop_monitoring("test-1");
        
        {
            let downloads = watchdog.monitored_downloads.read().unwrap();
            assert!(!downloads.contains_key("test-1"));
        }
    }
}
