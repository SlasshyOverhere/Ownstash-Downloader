//! Download Router Module
//!
//! The "Brain" of the download system - handles initial routing decisions
//! and preflight checks to determine the optimal download strategy.
//!
//! Decision flow:
//! 1. Heuristics - Match against known media domains vs static files
//! 2. Probes - Check for Range request support with timeout
//! 3. Historical Memory - Consult Host Reputation Table
//! 4. Final Routing - Select SNDE or Media Engine

use crate::health_metrics::DownloadEngine;
use crate::host_reputation::{HostReputationManager, HostReputation, extract_domain};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use url::Url;

/// Known media platform domains that should use Media Engine (yt-dlp)
const MEDIA_DOMAINS: &[&str] = &[
    // Video platforms
    "youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com",
    "vimeo.com", "player.vimeo.com",
    "dailymotion.com", "www.dailymotion.com",
    "twitch.tv", "www.twitch.tv", "clips.twitch.tv",
    "facebook.com", "www.facebook.com", "fb.watch",
    "instagram.com", "www.instagram.com",
    "twitter.com", "www.twitter.com", "x.com", "www.x.com",
    "tiktok.com", "www.tiktok.com", "vm.tiktok.com",
    "reddit.com", "www.reddit.com", "v.redd.it",
    "bilibili.com", "www.bilibili.com",
    "nicovideo.jp", "www.nicovideo.jp",
    // Music platforms
    "soundcloud.com", "www.soundcloud.com",
    "bandcamp.com",
    "mixcloud.com", "www.mixcloud.com",
    // News/Media
    "cnn.com", "www.cnn.com",
    "bbc.co.uk", "www.bbc.co.uk", "bbc.com",
    // Generic video hosts
    "streamable.com",
    "gfycat.com", "www.gfycat.com",
    "imgur.com", "i.imgur.com",
];

/// File extensions that indicate static files suitable for SNDE
const STATIC_EXTENSIONS: &[&str] = &[
    // Archives
    "zip", "rar", "7z", "tar", "gz", "bz2", "xz",
    // Executables & Installers  
    "exe", "msi", "dmg", "pkg", "deb", "rpm", "appimage",
    // ISO Images
    "iso", "img",
    // Documents
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    // Direct media files (when URL points directly to file)
    "mp4", "mkv", "avi", "mov", "webm", "flv",
    "mp3", "flac", "wav", "ogg", "m4a", "aac",
    // Software
    "apk", "ipa",
];

/// Result of preflight probe
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeResult {
    /// Whether the server responded successfully
    pub success: bool,
    /// Whether Range requests are supported
    pub supports_range: bool,
    /// Content-Length if available
    pub content_length: Option<u64>,
    /// Content-Type header
    pub content_type: Option<String>,
    /// Detected protocol (http1, http2, http3)
    pub protocol: String,
    /// Response time in milliseconds
    pub response_time_ms: u64,
    /// Server header if available
    pub server: Option<String>,
    /// Error message if probe failed
    pub error: Option<String>,
}

impl Default for ProbeResult {
    fn default() -> Self {
        Self {
            success: false,
            supports_range: false,
            content_length: None,
            content_type: None,
            protocol: "unknown".to_string(),
            response_time_ms: 0,
            server: None,
            error: None,
        }
    }
}

/// Routing decision with full context
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingDecision {
    /// Selected download engine
    pub engine: DownloadEngine,
    /// Recommended number of concurrent connections
    pub recommended_connections: u8,
    /// Reason for this decision (for debugging/UI)
    pub reason: String,
    /// Whether to force HTTP/1.1
    pub force_http1: bool,
    /// File size if known
    pub file_size: Option<u64>,
    /// Host reputation data
    pub host_reputation: Option<HostReputation>,
    /// Probe results
    pub probe_result: Option<ProbeResult>,
    /// Badge text for UI display
    pub badge: String,
}

/// Download Router - makes intelligent routing decisions
pub struct DownloadRouter {
    client: Client,
    probe_timeout: Duration,
}

impl DownloadRouter {
    /// Create a new router with default settings
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        Self {
            client,
            probe_timeout: Duration::from_secs(2),
        }
    }

    /// Create router with custom timeout
    pub fn with_timeout(probe_timeout: Duration) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        Self {
            client,
            probe_timeout,
        }
    }

    /// Check if URL matches a known media platform
    pub fn is_media_domain(&self, url: &str) -> bool {
        if let Some(domain) = extract_domain(url) {
            let domain_lower = domain.to_lowercase();
            
            // Check exact match first
            if MEDIA_DOMAINS.contains(&domain_lower.as_str()) {
                return true;
            }
            
            // Check if any media domain is a suffix (handles subdomains)
            for &media_domain in MEDIA_DOMAINS {
                if domain_lower.ends_with(media_domain) || 
                   domain_lower.ends_with(&format!(".{}", media_domain)) {
                    return true;
                }
            }
        }
        false
    }

    /// Check if URL points to a static file based on extension
    pub fn is_static_file(&self, url: &str) -> bool {
        if let Ok(parsed) = Url::parse(url) {
            let path = parsed.path().to_lowercase();
            
            // Check if path ends with a known static extension
            for ext in STATIC_EXTENSIONS {
                if path.ends_with(&format!(".{}", ext)) {
                    return true;
                }
            }
        }
        false
    }

    /// Perform a Range request probe to check server capabilities
    pub async fn probe_url(&self, url: &str) -> ProbeResult {
        let start = std::time::Instant::now();
        
        let result = tokio::time::timeout(
            self.probe_timeout,
            self.client
                .get(url)
                .header("Range", "bytes=0-0")
                .send()
        ).await;

        let response_time_ms = start.elapsed().as_millis() as u64;

        match result {
            Ok(Ok(response)) => {
                let status = response.status();
                let headers = response.headers();

                // Check for Range support - 206 Partial Content or Accept-Ranges header
                let supports_range = status.as_u16() == 206 || 
                    headers.get("accept-ranges")
                        .map(|v| v.to_str().unwrap_or("") == "bytes")
                        .unwrap_or(false);

                // Get Content-Length (check Content-Range for 206, or Content-Length for 200)
                let content_length = if status.as_u16() == 206 {
                    // Parse Content-Range: bytes 0-0/total
                    headers.get("content-range")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|s| {
                            if let Some(slash_pos) = s.rfind('/') {
                                s[slash_pos + 1..].parse::<u64>().ok()
                            } else {
                                None
                            }
                        })
                } else {
                    headers.get("content-length")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|s| s.parse::<u64>().ok())
                };

                let content_type = headers.get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());

                let server = headers.get("server")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());

                // Detect HTTP version
                let protocol = match response.version() {
                    reqwest::Version::HTTP_09 => "http0.9".to_string(),
                    reqwest::Version::HTTP_10 => "http1.0".to_string(),
                    reqwest::Version::HTTP_11 => "http1.1".to_string(),
                    reqwest::Version::HTTP_2 => "http2".to_string(),
                    reqwest::Version::HTTP_3 => "http3".to_string(),
                    _ => "http1.1".to_string(),
                };

                ProbeResult {
                    success: status.is_success() || status.as_u16() == 206,
                    supports_range,
                    content_length,
                    content_type,
                    protocol,
                    response_time_ms,
                    server,
                    error: None,
                }
            }
            Ok(Err(e)) => ProbeResult {
                success: false,
                response_time_ms,
                error: Some(format!("Request failed: {}", e)),
                ..Default::default()
            },
            Err(_) => ProbeResult {
                success: false,
                response_time_ms,
                error: Some("Probe timed out".to_string()),
                ..Default::default()
            },
        }
    }

    /// Make a routing decision for the given URL
    pub async fn route(
        &self,
        url: &str,
        reputation_manager: Option<&HostReputationManager>,
    ) -> RoutingDecision {
        // Step 1: Check heuristics first (fastest)
        let is_media = self.is_media_domain(url);
        let is_static = self.is_static_file(url);

        // Media domains always go to Media Engine
        if is_media {
            return RoutingDecision {
                engine: DownloadEngine::MediaEngine,
                recommended_connections: 1,
                reason: "Media platform detected - using yt-dlp for best compatibility".to_string(),
                force_http1: false,
                file_size: None,
                host_reputation: None,
                probe_result: None,
                badge: "MEDIA ENGINE".to_string(),
            };
        }

        // Step 2: Get host reputation if available
        let domain = extract_domain(url);
        let host_reputation = match (&domain, reputation_manager) {
            (Some(d), Some(rm)) => rm.get_reputation(d).ok(),
            _ => None,
        };

        // Step 3: Perform probe
        let probe_result = self.probe_url(url).await;

        // Step 4: Make decision based on all data
        if !probe_result.success {
            // Probe failed - fall back to Media Engine for safety
            return RoutingDecision {
                engine: DownloadEngine::MediaEngine,
                recommended_connections: 1,
                reason: format!(
                    "Probe failed ({}), using Media Engine as fallback",
                    probe_result.error.as_deref().unwrap_or("unknown error")
                ),
                force_http1: false,
                file_size: None,
                host_reputation,
                probe_result: Some(probe_result),
                badge: "MEDIA ENGINE".to_string(),
            };
        }

        // Probe succeeded
        if probe_result.supports_range {
            // Server supports Range - use SNDE
            let recommended_connections = if let Some(ref rep) = host_reputation {
                // Use historical data
                rep.max_stable_conns
            } else {
                // Default based on file size
                match probe_result.content_length {
                    Some(size) if size > 100_000_000 => 8, // >100MB: 8 connections
                    Some(size) if size > 10_000_000 => 6,  // >10MB: 6 connections
                    Some(size) if size > 1_000_000 => 4,   // >1MB: 4 connections
                    _ => 2, // Small files: 2 connections
                }
            };

            // Check if we should use SNDE Safe mode based on reputation
            let (engine, badge) = if let Some(ref rep) = host_reputation {
                if rep.health_score < 30 || rep.max_stable_conns <= 1 {
                    (DownloadEngine::SNDESafe, "SNDE SAFE".to_string())
                } else {
                    (DownloadEngine::SNDE, "SNDE ACCELERATED".to_string())
                }
            } else {
                (DownloadEngine::SNDE, "SNDE ACCELERATED".to_string())
            };

            RoutingDecision {
                engine,
                recommended_connections,
                reason: format!(
                    "Range requests supported, {} conn recommended (history: {})",
                    recommended_connections,
                    if host_reputation.is_some() { "known host" } else { "new host" }
                ),
                force_http1: engine == DownloadEngine::SNDE, // Force HTTP/1.1 for parallel SNDE
                file_size: probe_result.content_length,
                host_reputation,
                probe_result: Some(probe_result),
                badge,
            }
        } else if is_static {
            // Static file but no Range support - still try SNDE single connection
            RoutingDecision {
                engine: DownloadEngine::SNDESafe,
                recommended_connections: 1,
                reason: "Static file detected but no Range support - using safe single connection".to_string(),
                force_http1: false,
                file_size: probe_result.content_length,
                host_reputation,
                probe_result: Some(probe_result),
                badge: "SNDE SAFE".to_string(),
            }
        } else {
            // Unknown file type, no Range support - use Media Engine
            RoutingDecision {
                engine: DownloadEngine::MediaEngine,
                recommended_connections: 1,
                reason: "No Range support and not a static file - Media Engine for safety".to_string(),
                force_http1: false,
                file_size: probe_result.content_length,
                host_reputation,
                probe_result: Some(probe_result),
                badge: "MEDIA ENGINE".to_string(),
            }
        }
    }
}

impl Default for DownloadRouter {
    fn default() -> Self {
        Self::new()
    }
}

/// Global router instance
lazy_static::lazy_static! {
    pub static ref DOWNLOAD_ROUTER: DownloadRouter = DownloadRouter::new();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_media_domain_detection() {
        let router = DownloadRouter::new();
        
        assert!(router.is_media_domain("https://www.youtube.com/watch?v=abc"));
        assert!(router.is_media_domain("https://youtu.be/abc"));
        assert!(router.is_media_domain("https://vimeo.com/12345"));
        assert!(router.is_media_domain("https://www.twitch.tv/streamer"));
        
        assert!(!router.is_media_domain("https://example.com/file.zip"));
        assert!(!router.is_media_domain("https://cdn.example.com/video.mp4"));
    }

    #[test]
    fn test_static_file_detection() {
        let router = DownloadRouter::new();
        
        assert!(router.is_static_file("https://example.com/file.zip"));
        assert!(router.is_static_file("https://cdn.example.com/app.exe"));
        assert!(router.is_static_file("https://mirror.example.com/linux.iso"));
        
        assert!(!router.is_static_file("https://youtube.com/watch?v=abc"));
        assert!(!router.is_static_file("https://example.com/page"));
    }
}
