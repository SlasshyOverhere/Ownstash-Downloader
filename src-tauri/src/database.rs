use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DatabaseError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

pub type DbResult<T> = std::result::Result<T, DatabaseError>;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Download {
    pub id: String,
    pub title: String,
    pub url: String,
    pub format: String,
    pub path: String,
    pub timestamp: i64,
    pub status: String,
    pub size_bytes: Option<i64>,
    pub platform: Option<String>,
    pub thumbnail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchHistory {
    pub id: String,
    pub query: String,
    pub timestamp: i64,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Setting {
    pub key: String,
    pub value: String,
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(app_data_dir: PathBuf) -> DbResult<Self> {
        // Ensure the directory exists
        std::fs::create_dir_all(&app_data_dir)?;
        
        let db_path = app_data_dir.join("db.sqlite");
        let conn = Connection::open(&db_path)?;
        
        let db = Self { conn };
        db.initialize_tables()?;
        
        Ok(db)
    }

    fn initialize_tables(&self) -> DbResult<()> {
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS downloads (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                format TEXT NOT NULL,
                path TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                status TEXT NOT NULL,
                size_bytes INTEGER,
                platform TEXT,
                thumbnail TEXT
            )",
            [],
        )?;

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS search_history (
                id TEXT PRIMARY KEY,
                query TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                title TEXT,
                thumbnail TEXT
            )",
            [],
        )?;

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        // Create indexes for faster queries
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_downloads_timestamp ON downloads(timestamp DESC)",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_search_history_timestamp ON search_history(timestamp DESC)",
            [],
        )?;

        // Migration: Add thumbnail column to downloads if it doesn't exist
        let _ = self.conn.execute("ALTER TABLE downloads ADD COLUMN thumbnail TEXT", []);
        
        // Migration: Add title and thumbnail columns to search_history if they don't exist
        let _ = self.conn.execute("ALTER TABLE search_history ADD COLUMN title TEXT", []);
        let _ = self.conn.execute("ALTER TABLE search_history ADD COLUMN thumbnail TEXT", []);

        Ok(())
    }

    // Download operations
    pub fn add_download(&self, download: &Download) -> DbResult<()> {
        self.conn.execute(
            "INSERT INTO downloads (id, title, url, format, path, timestamp, status, size_bytes, platform, thumbnail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                download.id,
                download.title,
                download.url,
                download.format,
                download.path,
                download.timestamp,
                download.status,
                download.size_bytes,
                download.platform,
                download.thumbnail,
            ],
        )?;
        Ok(())
    }

    pub fn get_downloads(&self) -> DbResult<Vec<Download>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, url, format, path, timestamp, status, size_bytes, platform, thumbnail
             FROM downloads ORDER BY timestamp DESC"
        )?;

        let downloads = stmt.query_map([], |row| {
            Ok(Download {
                id: row.get(0)?,
                title: row.get(1)?,
                url: row.get(2)?,
                format: row.get(3)?,
                path: row.get(4)?,
                timestamp: row.get(5)?,
                status: row.get(6)?,
                size_bytes: row.get(7)?,
                platform: row.get(8)?,
                thumbnail: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

        Ok(downloads)
    }

    pub fn update_download_status(&self, id: &str, status: &str) -> DbResult<()> {
        self.conn.execute(
            "UPDATE downloads SET status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        Ok(())
    }

    pub fn delete_download(&self, id: &str) -> DbResult<()> {
        self.conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn clear_downloads(&self) -> DbResult<()> {
        self.conn.execute("DELETE FROM downloads", [])?;
        Ok(())
    }

    // Search history operations
    pub fn add_search(&self, query: &str, title: Option<&str>, thumbnail: Option<&str>) -> DbResult<()> {
        let id = Uuid::new_v4().to_string();
        let timestamp = Utc::now().timestamp();

        self.conn.execute(
            "INSERT INTO search_history (id, query, timestamp, title, thumbnail) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, query, timestamp, title, thumbnail],
        )?;
        Ok(())
    }

    pub fn get_search_history(&self, limit: i64) -> DbResult<Vec<SearchHistory>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, query, timestamp, title, thumbnail FROM search_history 
             ORDER BY timestamp DESC LIMIT ?1"
        )?;

        let history = stmt.query_map(params![limit], |row| {
            Ok(SearchHistory {
                id: row.get(0)?,
                query: row.get(1)?,
                timestamp: row.get(2)?,
                title: row.get(3)?,
                thumbnail: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

        Ok(history)
    }

    pub fn clear_search_history(&self) -> DbResult<()> {
        self.conn.execute("DELETE FROM search_history", [])?;
        Ok(())
    }

    // Settings operations
    pub fn save_setting(&self, key: &str, value: &str) -> DbResult<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> DbResult<Option<String>> {
        let result = self.conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        );

        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn get_all_settings(&self) -> DbResult<Vec<Setting>> {
        let mut stmt = self.conn.prepare("SELECT key, value FROM settings")?;

        let settings = stmt.query_map([], |row| {
            Ok(Setting {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

        Ok(settings)
    }

    pub fn delete_setting(&self, key: &str) -> DbResult<()> {
        self.conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }
}
