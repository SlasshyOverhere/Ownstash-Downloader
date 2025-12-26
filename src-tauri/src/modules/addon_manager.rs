use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use std::io::{self, Cursor, BufRead, BufReader};
use zip::ZipArchive;
use std::process::{Command, Stdio};
use serde::{Deserialize, Serialize};
use base64::{Engine as _, engine::general_purpose};
use crate::vault;

pub struct AddonManager;

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginStatus {
    Installed,
    NotInstalled,
    Installing,
    Error,
}

#[derive(Serialize)]
pub enum AddonStatus {
    Installed,
    NotInstalled,
    UpdateAvailable,
}

#[derive(Deserialize)]
struct BrowserMessage {
    #[serde(rename = "type")]
    msg_type: String,
    filename: Option<String>,
    #[serde(rename = "fileType")]
    file_type: Option<String>,
    data: Option<String>,
    #[serde(rename = "streamId")]
    stream_id: Option<String>,
}

impl AddonManager {
    pub fn get_addons_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data directory: {}", e))?;
        let addons_dir = app_data_dir.join("addons");
        
        if !addons_dir.exists() {
            fs::create_dir_all(&addons_dir)
                .map_err(|e| format!("Failed to create addons directory: {}", e))?;
        }
        
        Ok(addons_dir)
    }

    pub fn get_browser_exe_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
        let addons_dir = Self::get_addons_dir(app_handle)?;
        Ok(addons_dir.join("browser-addon").join("browser-addon.exe"))
    }

    pub fn is_browser_installed(app_handle: &AppHandle) -> bool {
        match Self::get_browser_exe_path(app_handle) {
            Ok(path) => path.exists(),
            Err(_) => false,
        }
    }

    pub async fn install_browser_addon(app_handle: &AppHandle, url: String) -> Result<(), String> {
        let addons_dir = Self::get_addons_dir(app_handle)?;
        let target_dir = addons_dir.join("browser-addon");

        if target_dir.exists() {
            fs::remove_dir_all(&target_dir)
                .map_err(|e| format!("Failed to clean existing addon dir: {}", e))?;
        }
        fs::create_dir_all(&target_dir)
            .map_err(|e| format!("Failed to create target addon dir: {}", e))?;

        // Download ZIP
        let response = reqwest::get(url)
            .await
            .map_err(|e| format!("Failed to download addon: {}", e))?;
        
        let bytes = response.bytes()
            .await
            .map_err(|e| format!("Failed to read addon data: {}", e))?;

        // Extract ZIP
        let reader = Cursor::new(bytes);
        let mut archive = ZipArchive::new(reader)
            .map_err(|e| format!("Failed to open zip archive: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| format!("Failed to read file from zip: {}", e))?;
            
            let outpath = match file.enclosed_name() {
                Some(path) => target_dir.join(path),
                None => continue,
            };

            if (*file.name()).ends_with('/') {
                fs::create_dir_all(&outpath).map_err(|e| format!("Failed to create dir: {}", e))?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(p).map_err(|e| format!("Failed to create parent dir: {}", e))?;
                    }
                }
                let mut outfile = fs::File::create(&outpath)
                    .map_err(|e| format!("Failed to create output file: {}", e))?;
                io::copy(&mut file, &mut outfile)
                    .map_err(|e| format!("Failed to extract file: {}", e))?;
            }
        }

        // Sanity check
        let exe_path = target_dir.join("browser-addon.exe");
        if !exe_path.exists() {
            return Err("Installation failed: browser-addon.exe not found in extracted files".to_string());
        }

        Ok(())
    }
}

// Tauri Commands
#[tauri::command]
pub async fn plugin_install_browser(app_handle: AppHandle, url: String) -> Result<(), String> {
    AddonManager::install_browser_addon(&app_handle, url).await
}

#[tauri::command]
pub fn plugin_check_status(app_handle: AppHandle) -> Result<AddonStatus, String> {
    if AddonManager::is_browser_installed(&app_handle) {
        Ok(AddonStatus::Installed)
    } else {
        Ok(AddonStatus::NotInstalled)
    }
}

#[tauri::command]
pub async fn plugin_launch_browser(app_handle: AppHandle) -> Result<(), String> {
    let exe_path = AddonManager::get_browser_exe_path(&app_handle)?;
    
    if !exe_path.exists() {
        return Err("Browser addon not installed".to_string());
    }

    let mut child = Command::new(exe_path)
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch browser addon: {}", e))?;

    let stdout = child.stdout.take().unwrap();
    let app_handle_clone = app_handle.clone();

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
                if let Ok(msg) = serde_json::from_str::<BrowserMessage>(&l) {
                    match msg.msg_type.as_str() {
                        "download-start" => {
                            if let (Some(sid), Some(name), Some(ftype)) = (msg.stream_id, msg.filename, msg.file_type) {
                                let _ = vault::vault_stream_start(&app_handle_clone, sid, name, ftype);
                            }
                        }
                        "chunk" => {
                            if let (Some(sid), Some(data_b64)) = (msg.stream_id, msg.data) {
                                if let Ok(data) = general_purpose::STANDARD.decode(data_b64) {
                                    let _ = vault::vault_stream_chunk(&sid, &data);
                                }
                            }
                        }
                        "download-end" => {
                            if let Some(sid) = msg.stream_id {
                                let _ = vault::vault_stream_finish(&app_handle_clone, &sid);
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    Ok(())
}

// New plugin functions for the secure vault browser
#[tauri::command]
pub async fn plugin_check_status_new(app_handle: AppHandle) -> Result<PluginStatus, String> {
    if AddonManager::is_browser_installed(&app_handle) {
        Ok(PluginStatus::Installed)
    } else {
        Ok(PluginStatus::NotInstalled)
    }
}

#[tauri::command]
pub async fn plugin_install_new(app_handle: AppHandle) -> Result<(), String> {
    // For now, we'll use a placeholder URL for the browser addon
    // In a real implementation, this would be a secure download URL
    let download_url = "https://example.com/secure-browser-addon.zip"; // Placeholder URL
    AddonManager::install_browser_addon(&app_handle, download_url.to_string()).await
}

#[tauri::command]
pub async fn plugin_uninstall_new(app_handle: AppHandle) -> Result<(), String> {
    let addons_dir = AddonManager::get_addons_dir(&app_handle)?;
    let target_dir = addons_dir.join("browser-addon");

    if target_dir.exists() {
        fs::remove_dir_all(&target_dir)
            .map_err(|e| format!("Failed to remove addon directory: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn plugin_reinstall_new(app_handle: AppHandle) -> Result<(), String> {
    plugin_uninstall_new(app_handle.clone()).await?;
    plugin_install_new(app_handle).await
}
