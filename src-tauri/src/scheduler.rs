//! Global Download Scheduler
//!
//! Manages download queue, bandwidth arbitration, and priority allocation.
//! Prevents multiple concurrent downloads from starving each other's TCP windows.
//!
//! Key Features:
//! - Download queue management with priority support
//! - Bandwidth allocation based on download priority
//! - Rate limiting to prevent network saturation
//! - Concurrent download limits

use crate::health_metrics::{DownloadEngine, DownloadPhase, HEALTH_REGISTRY};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Mutex, RwLock, Semaphore};

/// Maximum concurrent downloads allowed
const MAX_CONCURRENT_DOWNLOADS: usize = 3;

/// Maximum concurrent SNDE downloads (more resource intensive)
const MAX_CONCURRENT_SNDE: usize = 2;

/// Priority levels for downloads
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum DownloadPriority {
    /// Background downloads (e.g., batch queue)
    Low = 0,
    /// Normal priority
    Normal = 1,
    /// User-initiated, active in UI
    High = 2,
    /// Critical/urgent downloads
    Critical = 3,
}

impl Default for DownloadPriority {
    fn default() -> Self {
        Self::Normal
    }
}

/// A queued download item
#[derive(Debug, Clone)]
pub struct QueuedDownload {
    pub id: String,
    pub url: String,
    pub priority: DownloadPriority,
    pub engine: DownloadEngine,
    pub queued_at: Instant,
    pub started_at: Option<Instant>,
    pub estimated_size: Option<u64>,
}

/// Download scheduler state
#[derive(Debug)]
struct SchedulerState {
    /// Pending downloads in priority order
    queue: VecDeque<QueuedDownload>,
    /// Currently active downloads
    active: HashMap<String, QueuedDownload>,
    /// Completed download IDs (for history)
    completed: Vec<String>,
    /// Paused downloads
    paused: HashMap<String, QueuedDownload>,
}

impl Default for SchedulerState {
    fn default() -> Self {
        Self {
            queue: VecDeque::new(),
            active: HashMap::new(),
            completed: Vec::new(),
            paused: HashMap::new(),
        }
    }
}

/// Scheduler event for communication
#[derive(Debug, Clone)]
pub enum SchedulerEvent {
    /// A download slot is available
    SlotAvailable,
    /// Download completed
    DownloadCompleted(String),
    /// Download failed
    DownloadFailed(String, String),
    /// Priority changed
    PriorityChanged(String, DownloadPriority),
    /// Shutdown
    Shutdown,
}

/// Bandwidth allocation result
#[derive(Debug, Clone)]
pub struct BandwidthAllocation {
    /// Percentage of total bandwidth (0-100)
    pub bandwidth_percent: u8,
    /// Recommended concurrent connections
    pub max_connections: u8,
    /// Whether this download is currently throttled
    pub is_throttled: bool,
}

/// The Global Download Scheduler
pub struct GlobalScheduler {
    state: Arc<RwLock<SchedulerState>>,
    /// Semaphore for total concurrent downloads
    download_semaphore: Arc<Semaphore>,
    /// Semaphore for SNDE downloads specifically
    snde_semaphore: Arc<Semaphore>,
    /// Event channel sender
    event_tx: mpsc::Sender<SchedulerEvent>,
    /// Event channel receiver (for run loop)
    event_rx: Option<mpsc::Receiver<SchedulerEvent>>,
}

impl GlobalScheduler {
    /// Create a new scheduler
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel(100);
        
        Self {
            state: Arc::new(RwLock::new(SchedulerState::default())),
            download_semaphore: Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS)),
            snde_semaphore: Arc::new(Semaphore::new(MAX_CONCURRENT_SNDE)),
            event_tx: tx,
            event_rx: Some(rx),
        }
    }

    /// Get the event sender for external communication
    pub fn get_event_sender(&self) -> mpsc::Sender<SchedulerEvent> {
        self.event_tx.clone()
    }

    /// Enqueue a download
    pub async fn enqueue(
        &self,
        id: String,
        url: String,
        engine: DownloadEngine,
        priority: DownloadPriority,
        estimated_size: Option<u64>,
    ) {
        let download = QueuedDownload {
            id: id.clone(),
            url,
            priority,
            engine,
            queued_at: Instant::now(),
            started_at: None,
            estimated_size,
        };

        let mut state = self.state.write().await;
        
        // Insert in priority order
        let insert_pos = state.queue
            .iter()
            .position(|d| d.priority < priority)
            .unwrap_or(state.queue.len());
        
        state.queue.insert(insert_pos, download);
        
        println!("[Scheduler] Enqueued download {} with priority {:?}, queue size: {}", 
            id, priority, state.queue.len());
    }

    /// Try to start the next download if a slot is available
    pub async fn try_start_next(&self) -> Option<QueuedDownload> {
        // Check if we can acquire a download permit
        let permit = match self.download_semaphore.clone().try_acquire_owned() {
            Ok(p) => p,
            Err(_) => return None, // No slots available
        };

        let mut state = self.state.write().await;
        
        // Find the highest priority download that can start
        let next_idx = state.queue.iter().position(|d| {
            match d.engine {
                DownloadEngine::SNDE | DownloadEngine::SNDESafe => {
                    // Check SNDE semaphore
                    self.snde_semaphore.available_permits() > 0
                }
                DownloadEngine::MediaEngine => true,
            }
        });

        if let Some(idx) = next_idx {
            let mut download = state.queue.remove(idx).unwrap();
            download.started_at = Some(Instant::now());
            
            // Acquire SNDE permit if needed
            if matches!(download.engine, DownloadEngine::SNDE | DownloadEngine::SNDESafe) {
                let _ = self.snde_semaphore.clone().try_acquire_owned();
            }
            
            state.active.insert(download.id.clone(), download.clone());
            
            // Forget the permit since download is now active
            std::mem::forget(permit);
            
            println!("[Scheduler] Started download {}, active count: {}", 
                download.id, state.active.len());
            
            return Some(download);
        }

        None
    }

    /// Mark a download as completed
    pub async fn complete_download(&self, id: &str, success: bool) {
        let mut state = self.state.write().await;
        
        if let Some(download) = state.active.remove(id) {
            state.completed.push(id.to_string());
            
            // Release permits
            self.download_semaphore.add_permits(1);
            if matches!(download.engine, DownloadEngine::SNDE | DownloadEngine::SNDESafe) {
                self.snde_semaphore.add_permits(1);
            }
            
            println!("[Scheduler] Completed download {} (success: {}), active count: {}", 
                id, success, state.active.len());
        }

        // Notify that a slot is available
        let _ = self.event_tx.send(SchedulerEvent::SlotAvailable).await;
    }

    /// Pause a download
    pub async fn pause_download(&self, id: &str) -> bool {
        let mut state = self.state.write().await;
        
        if let Some(download) = state.active.remove(id) {
            state.paused.insert(id.to_string(), download.clone());
            
            // Release permits
            self.download_semaphore.add_permits(1);
            if matches!(download.engine, DownloadEngine::SNDE | DownloadEngine::SNDESafe) {
                self.snde_semaphore.add_permits(1);
            }
            
            return true;
        }
        
        // Also check queue
        if let Some(idx) = state.queue.iter().position(|d| d.id == id) {
            let download = state.queue.remove(idx).unwrap();
            state.paused.insert(id.to_string(), download);
            return true;
        }
        
        false
    }

    /// Resume a paused download
    pub async fn resume_download(&self, id: &str) -> bool {
        let mut state = self.state.write().await;
        
        if let Some(download) = state.paused.remove(id) {
            // Re-queue with original priority
            let insert_pos = state.queue
                .iter()
                .position(|d| d.priority < download.priority)
                .unwrap_or(state.queue.len());
            
            state.queue.insert(insert_pos, download);
            return true;
        }
        
        false
    }

    /// Update download priority
    pub async fn set_priority(&self, id: &str, priority: DownloadPriority) {
        let mut state = self.state.write().await;
        
        // Check active downloads
        if let Some(download) = state.active.get_mut(id) {
            download.priority = priority;
            return;
        }
        
        // Check queue - need to remove and reinsert for correct ordering
        if let Some(idx) = state.queue.iter().position(|d| d.id == id) {
            let mut download = state.queue.remove(idx).unwrap();
            download.priority = priority;
            
            let insert_pos = state.queue
                .iter()
                .position(|d| d.priority < priority)
                .unwrap_or(state.queue.len());
            
            state.queue.insert(insert_pos, download);
        }
    }

    /// Get bandwidth allocation for a download based on priority
    pub async fn get_bandwidth_allocation(&self, id: &str) -> BandwidthAllocation {
        let state = self.state.read().await;
        
        let download = state.active.get(id);
        let total_active = state.active.len().max(1);
        
        match download {
            Some(d) => {
                // Allocate based on priority
                let base_percent = 100 / total_active as u8;
                let priority_bonus = match d.priority {
                    DownloadPriority::Low => 0,
                    DownloadPriority::Normal => 0,
                    DownloadPriority::High => 10,
                    DownloadPriority::Critical => 25,
                };
                
                let bandwidth_percent = (base_percent + priority_bonus).min(100);
                
                // Scale connections based on bandwidth
                let max_connections = match bandwidth_percent {
                    0..=25 => 2,
                    26..=50 => 4,
                    51..=75 => 6,
                    _ => 8,
                };
                
                BandwidthAllocation {
                    bandwidth_percent,
                    max_connections,
                    is_throttled: false,
                }
            }
            None => BandwidthAllocation {
                bandwidth_percent: 0,
                max_connections: 1,
                is_throttled: true,
            }
        }
    }

    /// Get queue status
    pub async fn get_status(&self) -> SchedulerStatus {
        let state = self.state.read().await;
        
        SchedulerStatus {
            queue_length: state.queue.len(),
            active_count: state.active.len(),
            paused_count: state.paused.len(),
            completed_count: state.completed.len(),
            available_slots: self.download_semaphore.available_permits(),
        }
    }

    /// Cancel a download (remove from any state)
    pub async fn cancel_download(&self, id: &str) -> bool {
        let mut state = self.state.write().await;
        
        // Check all states
        if state.active.remove(id).is_some() {
            self.download_semaphore.add_permits(1);
            return true;
        }
        
        if let Some(idx) = state.queue.iter().position(|d| d.id == id) {
            state.queue.remove(idx);
            return true;
        }
        
        if state.paused.remove(id).is_some() {
            return true;
        }
        
        false
    }
}

impl Default for GlobalScheduler {
    fn default() -> Self {
        Self::new()
    }
}

/// Scheduler status snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerStatus {
    pub queue_length: usize,
    pub active_count: usize,
    pub paused_count: usize,
    pub completed_count: usize,
    pub available_slots: usize,
}

/// Global scheduler instance
lazy_static::lazy_static! {
    pub static ref GLOBAL_SCHEDULER: GlobalScheduler = GlobalScheduler::new();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_priority_ordering() {
        let scheduler = GlobalScheduler::new();
        
        scheduler.enqueue(
            "low".to_string(),
            "http://example.com/low".to_string(),
            DownloadEngine::MediaEngine,
            DownloadPriority::Low,
            None,
        ).await;
        
        scheduler.enqueue(
            "high".to_string(),
            "http://example.com/high".to_string(),
            DownloadEngine::MediaEngine,
            DownloadPriority::High,
            None,
        ).await;
        
        scheduler.enqueue(
            "normal".to_string(),
            "http://example.com/normal".to_string(),
            DownloadEngine::MediaEngine,
            DownloadPriority::Normal,
            None,
        ).await;
        
        // High priority should come first
        let next = scheduler.try_start_next().await.unwrap();
        assert_eq!(next.id, "high");
    }
}
