//! Host Reputation Memory System
//! 
//! Maintains a lightweight local database of host-specific behavior to optimize
//! download strategies. This is "The Moat" that gives Slasshy its edge over
//! basic downloaders.
//!
//! Key features:
//! - Tracks stable connection counts for each domain
//! - Remembers favored protocols (HTTP/1.1, HTTP/2, HTTP/3)
//! - Stores health scores for intelligent preflight decisions

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use chrono::Utc;

/// Host reputation record stored in the database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostReputation {
    /// Domain name (e.g., "fastcdn.com")
    pub domain: String,
    /// Maximum stable concurrent connections before throttling
    pub max_stable_conns: u8,
    /// Favored protocol: "http1", "http2", or "http3"
    pub favored_protocol: String,
    /// Health score from 0-100 based on recent download performance
    pub health_score: u8,
    /// Whether range requests are supported
    pub supports_range: bool,
    /// Average speed in KB/s from recent downloads
    pub avg_speed_kbps: u32,
    /// Total successful downloads from this host
    pub success_count: u32,
    /// Total failed downloads from this host
    pub failure_count: u32,
    /// Timestamp of last update (Unix timestamp)
    pub last_updated: i64,
}

impl Default for HostReputation {
    fn default() -> Self {
        Self {
            domain: String::new(),
            max_stable_conns: 4, // Safe default
            favored_protocol: "http1".to_string(),
            health_score: 50, // Neutral starting point
            supports_range: true, // Assume supported until proven otherwise
            avg_speed_kbps: 0,
            success_count: 0,
            failure_count: 0,
            last_updated: Utc::now().timestamp(),
        }
    }
}

/// Host Reputation Manager handles all database operations for host reputation
pub struct HostReputationManager {
    conn: Arc<Mutex<Connection>>,
}

impl HostReputationManager {
    /// Create a new HostReputationManager with the given database connection
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    /// Initialize the host_reputation table if it doesn't exist
    pub fn initialize_table(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        
        conn.execute(
            "CREATE TABLE IF NOT EXISTS host_reputation (
                domain TEXT PRIMARY KEY,
                max_stable_conns INTEGER NOT NULL DEFAULT 4,
                favored_protocol TEXT NOT NULL DEFAULT 'http1',
                health_score INTEGER NOT NULL DEFAULT 50,
                supports_range INTEGER NOT NULL DEFAULT 1,
                avg_speed_kbps INTEGER NOT NULL DEFAULT 0,
                success_count INTEGER NOT NULL DEFAULT 0,
                failure_count INTEGER NOT NULL DEFAULT 0,
                last_updated INTEGER NOT NULL
            )",
            [],
        ).map_err(|e| format!("Failed to create table: {}", e))?;

        // Create index for faster domain lookups
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_host_reputation_domain ON host_reputation(domain)",
            [],
        ).map_err(|e| format!("Failed to create index: {}", e))?;

        Ok(())
    }

    /// Get reputation for a specific domain. Returns default if not found.
    pub fn get_reputation(&self, domain: &str) -> Result<HostReputation, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        
        let result: Result<HostReputation, _> = conn.query_row(
            "SELECT domain, max_stable_conns, favored_protocol, health_score, 
                    supports_range, avg_speed_kbps, success_count, failure_count, last_updated
             FROM host_reputation WHERE domain = ?1",
            params![domain],
            |row| {
                Ok(HostReputation {
                    domain: row.get(0)?,
                    max_stable_conns: row.get(1)?,
                    favored_protocol: row.get(2)?,
                    health_score: row.get(3)?,
                    supports_range: row.get::<_, i32>(4)? != 0,
                    avg_speed_kbps: row.get(5)?,
                    success_count: row.get(6)?,
                    failure_count: row.get(7)?,
                    last_updated: row.get(8)?,
                })
            },
        );

        match result {
            Ok(rep) => Ok(rep),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                // Return default reputation for unknown hosts
                let mut default = HostReputation::default();
                default.domain = domain.to_string();
                Ok(default)
            },
            Err(e) => Err(format!("Database error: {}", e)),
        }
    }

    /// Update or insert host reputation
    pub fn upsert_reputation(&self, reputation: &HostReputation) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        
        conn.execute(
            "INSERT INTO host_reputation 
             (domain, max_stable_conns, favored_protocol, health_score, 
              supports_range, avg_speed_kbps, success_count, failure_count, last_updated)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(domain) DO UPDATE SET
                max_stable_conns = excluded.max_stable_conns,
                favored_protocol = excluded.favored_protocol,
                health_score = excluded.health_score,
                supports_range = excluded.supports_range,
                avg_speed_kbps = excluded.avg_speed_kbps,
                success_count = excluded.success_count,
                failure_count = excluded.failure_count,
                last_updated = excluded.last_updated",
            params![
                reputation.domain,
                reputation.max_stable_conns,
                reputation.favored_protocol,
                reputation.health_score,
                reputation.supports_range as i32,
                reputation.avg_speed_kbps,
                reputation.success_count,
                reputation.failure_count,
                reputation.last_updated,
            ],
        ).map_err(|e| format!("Failed to upsert reputation: {}", e))?;

        Ok(())
    }

    /// Record a successful download and update host stats
    pub fn record_success(&self, domain: &str, speed_kbps: u32, connections_used: u8) -> Result<(), String> {
        let mut reputation = self.get_reputation(domain)?;
        
        reputation.success_count += 1;
        reputation.last_updated = Utc::now().timestamp();
        
        // Update average speed with exponential moving average (90% old, 10% new)
        if reputation.avg_speed_kbps == 0 {
            reputation.avg_speed_kbps = speed_kbps;
        } else {
            reputation.avg_speed_kbps = (reputation.avg_speed_kbps * 9 + speed_kbps) / 10;
        }
        
        // Improve health score (capped at 100)
        reputation.health_score = (reputation.health_score.saturating_add(5)).min(100);
        
        // Update max stable connections if we used more and it worked
        if connections_used > reputation.max_stable_conns {
            reputation.max_stable_conns = connections_used;
        }
        
        self.upsert_reputation(&reputation)
    }

    /// Record a failed download and update host stats
    pub fn record_failure(&self, domain: &str, was_throttled: bool, was_range_error: bool) -> Result<(), String> {
        let mut reputation = self.get_reputation(domain)?;
        
        reputation.failure_count += 1;
        reputation.last_updated = Utc::now().timestamp();
        
        // Decrease health score more aggressively for failures
        reputation.health_score = reputation.health_score.saturating_sub(10);
        
        if was_throttled {
            // Reduce max stable connections when throttling is detected
            reputation.max_stable_conns = reputation.max_stable_conns.saturating_sub(2).max(1);
        }
        
        if was_range_error {
            // Mark as not supporting range requests
            reputation.supports_range = false;
        }
        
        self.upsert_reputation(&reputation)
    }

    /// Record that throttling was detected and collapsed connections
    pub fn record_connection_collapse(&self, domain: &str, collapsed_to: u8) -> Result<(), String> {
        let mut reputation = self.get_reputation(domain)?;
        
        // Update max stable connections to the collapsed value
        if collapsed_to < reputation.max_stable_conns {
            reputation.max_stable_conns = collapsed_to;
        }
        
        reputation.last_updated = Utc::now().timestamp();
        
        self.upsert_reputation(&reputation)
    }

    /// Get all host reputations (for debugging/diagnostics)
    pub fn get_all_reputations(&self) -> Result<Vec<HostReputation>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        
        let mut stmt = conn.prepare(
            "SELECT domain, max_stable_conns, favored_protocol, health_score,
                    supports_range, avg_speed_kbps, success_count, failure_count, last_updated
             FROM host_reputation ORDER BY last_updated DESC"
        ).map_err(|e| format!("Prepare error: {}", e))?;

        let reputations = stmt.query_map([], |row| {
            Ok(HostReputation {
                domain: row.get(0)?,
                max_stable_conns: row.get(1)?,
                favored_protocol: row.get(2)?,
                health_score: row.get(3)?,
                supports_range: row.get::<_, i32>(4)? != 0,
                avg_speed_kbps: row.get(5)?,
                success_count: row.get(6)?,
                failure_count: row.get(7)?,
                last_updated: row.get(8)?,
            })
        }).map_err(|e| format!("Query error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

        Ok(reputations)
    }

    /// Clean up old/stale reputation records (older than 30 days)
    pub fn cleanup_stale_records(&self) -> Result<u64, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        
        let thirty_days_ago = Utc::now().timestamp() - (30 * 24 * 60 * 60);
        
        let deleted = conn.execute(
            "DELETE FROM host_reputation WHERE last_updated < ?1 AND success_count < 5",
            params![thirty_days_ago],
        ).map_err(|e| format!("Delete error: {}", e))?;

        Ok(deleted as u64)
    }
}

/// Extract domain from a URL
pub fn extract_domain(url: &str) -> Option<String> {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_extract_domain() {
        assert_eq!(
            extract_domain("https://www.youtube.com/watch?v=abc123"),
            Some("www.youtube.com".to_string())
        );
        assert_eq!(
            extract_domain("https://fastcdn.example.com/file.zip"),
            Some("fastcdn.example.com".to_string())
        );
        assert_eq!(extract_domain("invalid-url"), None);
    }
    
    #[test]
    fn test_default_reputation() {
        let rep = HostReputation::default();
        assert_eq!(rep.max_stable_conns, 4);
        assert_eq!(rep.health_score, 50);
        assert!(rep.supports_range);
    }
}
