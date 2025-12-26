// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod database;
mod download_router;
mod downloader;
mod extension_server;
mod health_metrics;
mod host_reputation;
mod scheduler;
mod snde;
mod spotify_downloader;
mod updater;
mod watchdog;
mod media_server;
mod vault;
mod vault_download;
mod native_integration;
mod secure_storage;

use commands::AppState;
use database::Database;
use std::sync::Mutex;
use tauri::{Emitter, Listener, Manager, WindowEvent};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        // Single instance plugin - prevents multiple app instances
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            println!("[SingleInstance] Received argv: {:?}", argv);
            
            // Focus the main window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            
            // Check if any argument is an OAuth callback URL
            for arg in argv.iter() {
                if arg.contains("slasshy://auth") || arg.contains("oauth") || arg.contains("callback") {
                    println!("[SingleInstance] Found OAuth callback: {}", arg);
                    // Emit the OAuth callback to the frontend
                    let _ = app.emit("oauth-deep-link", arg.clone());
                }
                // Also handle download deep links
                if let Some(download_url) = parse_deep_link(arg) {
                    let _ = app.emit("extension-download-request", &download_url);
                }
            }
        }))
        .setup(|app| {
            // Get app data directory
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            // Ensure binaries directory exists for yt-dlp
            let binaries_dir = app_data_dir.join("binaries");
            std::fs::create_dir_all(&binaries_dir).ok();

            // Initialize database
            let db = Database::new(app_data_dir)
                .expect("Failed to initialize database");

            // Store in app state
            app.manage(AppState { db: Mutex::new(db) });

            // Start the extension server for Chrome extension communication
            extension_server::start_extension_server(app.handle().clone());

            // Initialize native integration (taskbar progress, notifications)
            native_integration::init(app.handle());

            // Start the media server for video playback
            media_server::start_media_server(app.handle().clone());

            // Handle deep links from Chrome extension (for installed app)
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            // Listen for deep link events using the deep-link plugin
            let handle = app.handle().clone();
            app.listen("deep-link://new-url", move |event: tauri::Event| {
                // Get the payload as a string
                let payload = event.payload();
                println!("[DeepLink] Received event with payload: {}", payload);
                
                // Check for OAuth callback first
                if payload.contains("auth") || payload.contains("callback") || payload.contains("access_token") {
                    println!("[DeepLink] OAuth callback detected");
                    let _ = handle.emit("oauth-deep-link", payload);
                    
                    // Bring window to front
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    return;
                }
                
                // Parse the URL and extract the download URL
                if let Some(download_url) = parse_deep_link(payload) {
                    println!("[DeepLink] Parsed download URL: {}", download_url);
                    
                    // Bring window to front
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                        println!("[DeepLink] Window brought to front");
                    }
                    
                    // Emit to frontend
                    let _ = handle.emit("extension-download-request", &download_url);
                }
            });

            // === System Tray Setup ===
            let quit_i = MenuItem::with_id(app.handle(), "quit", "Quit", true, None::<&str>).unwrap();
            let show_i = MenuItem::with_id(app.handle(), "show", "Show", true, None::<&str>).unwrap();
            let hide_i = MenuItem::with_id(app.handle(), "hide", "Hide", true, None::<&str>).unwrap();
            let menu = Menu::with_items(app.handle(), &[&show_i, &hide_i, &quit_i]).unwrap();

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "hide" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app_state = window.state::<AppState>();
                let should_minimize = if let Ok(db) = app_state.db.lock() {
                    db.get_setting("minimize_to_tray")
                        .unwrap_or(Some("false".to_string())) // Default to false if error/missing
                        .unwrap_or("false".to_string()) == "true"
                } else {
                    false
                };

                if should_minimize {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Download commands
            commands::add_download,
            commands::get_downloads,
            commands::update_download_status,
            commands::delete_download,
            commands::clear_downloads,
            // Search history commands
            commands::add_search,
            commands::get_search_history,
            commands::clear_search_history,
            // Settings commands
            commands::save_setting,
            commands::get_setting,
            commands::get_all_settings,
            commands::delete_setting,
            // Utility commands
            commands::open_folder,
            commands::play_file,
            commands::open_with_external_player,
            // Use media_server's robust matching instead of commands' basic one
            media_server::find_best_media_match,
            media_server::get_media_stream_url,
            commands::transcode_for_playback,
            // Downloader commands
            downloader::check_yt_dlp,
            downloader::get_media_info,
            downloader::probe_direct_file,
            downloader::start_download,
            downloader::cancel_download,
            downloader::get_supported_platforms,
            downloader::get_default_download_path,
            downloader::get_download_folder_size,
            // SpotDL (Spotify) commands
            spotify_downloader::check_spotdl,
            spotify_downloader::get_spotify_info,
            spotify_downloader::start_spotify_download,
            spotify_downloader::cancel_spotify_download,
            // Updater commands
            updater::check_for_updates,
            updater::download_and_install_update,
            updater::get_current_version,
            // Vault commands
            vault::vault_get_status,
            vault::vault_setup,
            vault::vault_unlock,
            vault::vault_lock,
            vault::vault_add_file,
            vault::vault_list_files,
            vault::vault_export_file,
            vault::vault_get_temp_playback_path,
            vault::vault_cleanup_temp,
            vault::vault_delete_file,
            vault::vault_change_pin,
            vault::vault_reset,
            vault::vault_get_config,
            vault::vault_import_config,
            vault::vault_wipe_local_config,
            // Vault direct download commands
            vault_download::vault_direct_download,
            vault_download::vault_cancel_download,
            // Vault cloud sync commands
            vault::vault_check_local_file,
            vault::vault_get_file_base64,
            vault::vault_save_file_base64,
            vault::vault_rename_file,
            vault::vault_get_files_dir_path,
            vault::vault_get_file_size,
            // Vault folder commands
            vault::vault_add_folder,
            vault::vault_extract_folder_file,
            vault::vault_list_folder_contents,
            // Native integration commands
            native_integration::update_taskbar_progress,
            native_integration::clear_taskbar_progress,
            native_integration::send_notification,
            native_integration::notify_download_complete,
            native_integration::notify_download_failed,
            native_integration::check_notification_permission,
            native_integration::request_notification_permission,
            // Secure storage commands
            secure_storage::secure_save_setting,
            secure_storage::secure_get_setting,
            secure_storage::secure_delete_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Parse a deep link URL like slasshy://download?url=<encoded_url>
fn parse_deep_link(deep_link: &str) -> Option<String> {
    // Remove quotes if present
    let clean = deep_link.trim().trim_matches('"').trim_matches('[').trim_matches(']');
    
    // Parse as URL
    if let Ok(url) = url::Url::parse(clean) {
        // Check for download command
        if url.host_str() == Some("download") || url.path() == "/download" {
            // Get the url parameter
            for (key, value) in url.query_pairs() {
                if key == "url" {
                    // URL decode the value
                    if let Ok(decoded) = urlencoding::decode(&value) {
                        return Some(decoded.into_owned());
                    }
                    return Some(value.into_owned());
                }
            }
        }
    }
    
    None
}
