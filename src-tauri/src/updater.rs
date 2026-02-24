// Auto-update functionality for Ownstash Downloader
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub date: Option<String>,
    pub body: Option<String>,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
    pub status: String,
}

/// Check for available updates
#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateInfo, String> {
    let updater = app.updater().map_err(|e| format!("Failed to get updater: {}", e))?;
    
    // Get current version from Cargo.toml
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    
    match updater.check().await {
        Ok(Some(update)) => {
            Ok(UpdateInfo {
                version: update.version.clone(),
                current_version,
                date: update.date.map(|d| d.to_string()),
                body: update.body.clone(),
                available: true,
            })
        }
        Ok(None) => {
            Ok(UpdateInfo {
                version: current_version.clone(),
                current_version,
                date: None,
                body: None,
                available: false,
            })
        }
        Err(e) => {
            let message = e.to_string();

            // Treat missing release feed as "no update" instead of hard failure.
            if message.contains("404") || message.to_lowercase().contains("not found") {
                return Ok(UpdateInfo {
                    version: current_version.clone(),
                    current_version,
                    date: None,
                    body: None,
                    available: false,
                });
            }

            Err(format!("Failed to check for updates: {}", message))
        }
    }
}

/// Download and install update
#[tauri::command]
pub async fn download_and_install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| format!("Failed to get updater: {}", e))?;
    
    let update = updater.check().await
        .map_err(|e| format!("Failed to check for updates: {}", e))?
        .ok_or_else(|| "No update available".to_string())?;
    
    // Download the update
    let mut downloaded = 0;
    let bytes = update.download(
        |chunk_length, content_length| {
            downloaded += chunk_length;
            let total = content_length.unwrap_or(0);
            println!("Downloaded {} of {} bytes", downloaded, total);
        },
        || {
            println!("Download complete, starting install...");
        }
    ).await.map_err(|e| format!("Failed to download update: {}", e))?;
    
    // Install the update
    update.install(bytes).map_err(|e| format!("Failed to install update: {}", e))?;
    
    Ok(())
}

/// Get current app version
#[tauri::command]
pub async fn get_current_version() -> Result<String, String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}
