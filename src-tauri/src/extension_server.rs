// Extension Server Module
// Provides a local HTTP server for Chrome extension communication

use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};
use warp::Filter;

const EXTENSION_SERVER_PORT: u16 = 47152; // Random port for extension communication

/// Helper function to bring the main window to the front
fn bring_window_to_front(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        // Unminimize if minimized
        let _ = window.unminimize();
        // Show the window if hidden
        let _ = window.show();
        // Set focus to bring it to front
        let _ = window.set_focus();

        println!("[ExtensionServer] Window brought to front");
    } else {
        println!("[ExtensionServer] Could not find main window");
    }
}

/// Extract domain/host from a URL for safe logging (H9 fix)
fn redact_url(url: &str) -> String {
    match url::Url::parse(url) {
        Ok(parsed) => {
            let host = parsed.host_str().unwrap_or("<unknown>");
            format!("{}://{}", parsed.scheme(), host)
        }
        Err(_) => "<invalid-url>".to_string(),
    }
}

/// Validate a URL for download requests (M7 fix)
/// Only allows https:// URLs
fn validate_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "Invalid URL format".to_string())?;

    match parsed.scheme() {
        "https" => {}
        "http" => return Err("HTTP URLs are not allowed; use HTTPS".to_string()),
        scheme => return Err(format!("URL scheme '{}' is not allowed", scheme)),
    }

    if parsed.host().is_none() {
        return Err("URL must have a valid host".to_string());
    }

    Ok(())
}

/// Validate a filename for vault downloads (M7 fix)
/// Rejects path traversal patterns and invalid characters
fn validate_filename(filename: &str) -> Result<(), String> {
    if filename.is_empty() {
        return Err("Filename cannot be empty".to_string());
    }

    // Reject path traversal
    if filename.contains("..") {
        return Err("Filename must not contain '..'".to_string());
    }
    if filename.contains('/') || filename.contains('\\') {
        return Err("Filename must not contain path separators".to_string());
    }

    // Reject null bytes
    if filename.contains('\0') {
        return Err("Filename must not contain null bytes".to_string());
    }

    // Reject Windows reserved names
    let name_upper = filename.to_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let stem = name_upper.split('.').next().unwrap_or("");
    if reserved.contains(&stem) {
        return Err("Filename uses a reserved system name".to_string());
    }

    Ok(())
}

/// Generate a random hex-encoded token for extension authentication (H2 fix)
fn generate_session_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: [u8; 32] = rng.gen();
    bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>()
}

/// Starts a local HTTP server for the Chrome extension to communicate with
pub fn start_extension_server(app_handle: AppHandle) {
    let handle = Arc::new(app_handle);

    // Spawn a new thread with its own tokio runtime
    thread::spawn(move || {
        // Create a new tokio runtime for this thread
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");

        rt.block_on(async move {
            // Generate per-session authentication token (H2 fix)
            let session_token = Arc::new(generate_session_token());
            println!(
                "[ExtensionServer] Session token: {}",
                *session_token
            );
            println!(
                "[ExtensionServer] Starting on port {}",
                EXTENSION_SERVER_PORT
            );

            // Shared filter: validate x-extension-token header (H2 fix)
            let session_token_filter = {
                let token = session_token.clone();
                warp::header::header::<String>("x-extension-token")
                    .and_then(move |header_token: String| {
                        let expected = token.clone();
                        async move {
                            if header_token == *expected {
                                Ok(())
                            } else {
                                Err(warp::reject::custom(InvalidToken))
                            }
                        }
                    })
            };

            // Health check endpoint (no auth required)
            let health = warp::path("health")
                .and(warp::get())
                .map(|| {
                    warp::reply::json(&serde_json::json!({
                        "status": "ok",
                        "app": "ownstash-downloader"
                    }))
                });

            // Token endpoint - allows the extension to retrieve the session token (H2 fix)
            let token_for_endpoint = session_token.clone();
            let token_endpoint = warp::path("token")
                .and(warp::get())
                .map(move || {
                    warp::reply::json(&serde_json::json!({
                        "token": *token_for_endpoint
                    }))
                });

            // Download endpoint - receives URL from extension
            let handle_clone = handle.clone();
            let download = warp::path("download")
                .and(warp::post())
                .and(session_token_filter.clone())
                .and(warp::body::json())
                .map(move |body: serde_json::Value| {
                    if let Some(url) = body.get("url").and_then(|v| v.as_str()) {
                        // M7: Validate URL scheme
                        if let Err(e) = validate_url(url) {
                            return warp::reply::json(&serde_json::json!({
                                "success": false,
                                "message": format!("URL rejected: {}", e)
                            }));
                        }

                        // H9: Log only domain, not full URL
                        println!("[ExtensionServer] Received download request: {}", redact_url(url));

                        // Bring the window to front
                        bring_window_to_front(&handle_clone);

                        // Emit to frontend - this will trigger the download UI
                        let _ = handle_clone.emit("extension-download-request", url);

                        warp::reply::json(&serde_json::json!({
                            "success": true,
                            "message": "URL sent to app"
                        }))
                    } else {
                        warp::reply::json(&serde_json::json!({
                            "success": false,
                            "message": "No URL provided"
                        }))
                    }
                });

            // Vault download endpoint - receives intercepted downloads from extension
            let handle_clone3 = handle.clone();
            let vault_download = warp::path("vault-download")
                .and(warp::post())
                .and(session_token_filter.clone())
                .and(warp::body::json())
                .map(move |body: serde_json::Value| {
                    let url = body.get("url").and_then(|v| v.as_str()).unwrap_or("");
                    let filename = body.get("filename").and_then(|v| v.as_str()).unwrap_or("download");
                    let file_size = body.get("fileSize").and_then(|v| v.as_u64()).unwrap_or(0);
                    let source = body.get("source").and_then(|v| v.as_str()).unwrap_or("extension");

                    if url.is_empty() {
                        return warp::reply::json(&serde_json::json!({
                            "success": false,
                            "message": "No URL provided"
                        }));
                    }

                    // M7: Validate URL scheme
                    if let Err(e) = validate_url(url) {
                        return warp::reply::json(&serde_json::json!({
                            "success": false,
                            "message": format!("URL rejected: {}", e)
                        }));
                    }

                    // M7: Validate filename
                    if let Err(e) = validate_filename(filename) {
                        return warp::reply::json(&serde_json::json!({
                            "success": false,
                            "message": format!("Filename rejected: {}", e)
                        }));
                    }

                    // H9: Log only domain, not full URL
                    println!(
                        "[ExtensionServer] Vault download request: {} (filename: {}, size: {}, source: {})",
                        redact_url(url), filename, file_size, source
                    );

                    // Bring the window to front
                    bring_window_to_front(&handle_clone3);

                    // Emit vault download event to frontend
                    let _ = handle_clone3.emit("extension-vault-download-request", serde_json::json!({
                        "url": url,
                        "filename": filename,
                        "fileSize": file_size,
                        "source": source
                    }));

                    warp::reply::json(&serde_json::json!({
                        "success": true,
                        "message": "Download queued for vault"
                    }))
                });

            // Rejection handler for invalid token (H2 fix)
            let token_rejection = warp::recover(|rejection: warp::Rejection| async move {
                if rejection.find::<InvalidToken>().is_some() {
                    Ok(warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({
                            "success": false,
                            "message": "Invalid or missing extension token"
                        })),
                        warp::http::StatusCode::UNAUTHORIZED,
                    ))
                } else {
                    Err(rejection)
                }
            });

            // Combine routes
            let routes = health
                .or(token_endpoint)
                .or(download)
                .or(vault_download)
                .recover(token_rejection);

            // Start the server
            warp::serve(routes)
                .run(([127, 0, 0, 1], EXTENSION_SERVER_PORT))
                .await;
        });
    });
}

/// Custom rejection type for invalid authentication token
#[derive(Debug)]
struct InvalidToken;

impl warp::reject::Reject for InvalidToken {}
