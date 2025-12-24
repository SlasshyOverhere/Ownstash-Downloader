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

/// Starts a local HTTP server for the Chrome extension to communicate with
pub fn start_extension_server(app_handle: AppHandle) {
    let handle = Arc::new(app_handle);
    
    // Spawn a new thread with its own tokio runtime
    thread::spawn(move || {
        // Create a new tokio runtime for this thread
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        
        rt.block_on(async move {
            // CORS headers for Chrome extension
            let cors = warp::cors()
                .allow_any_origin()
                .allow_methods(vec!["GET", "POST", "OPTIONS"])
                .allow_headers(vec!["Content-Type"]);

            // Health check endpoint
            let health = warp::path("health")
                .and(warp::get())
                .map(|| {
                    warp::reply::json(&serde_json::json!({
                        "status": "ok",
                        "app": "slasshy-omnidownloader"
                    }))
                });

            // Download endpoint - receives URL from extension
            let handle_clone = handle.clone();
            let download = warp::path("download")
                .and(warp::post())
                .and(warp::body::json())
                .map(move |body: serde_json::Value| {
                    if let Some(url) = body.get("url").and_then(|v| v.as_str()) {
                        println!("[ExtensionServer] Received download request: {}", url);
                        
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

            // GET version for simple download (for browser URL bar testing)
            let handle_clone2 = handle.clone();
            let download_get = warp::path("download")
                .and(warp::get())
                .and(warp::query::<std::collections::HashMap<String, String>>())
                .map(move |params: std::collections::HashMap<String, String>| {
                    if let Some(url) = params.get("url") {
                        println!("[ExtensionServer] Received download request (GET): {}", url);
                        
                        // Bring the window to front
                        bring_window_to_front(&handle_clone2);
                        
                        // URL decode if needed
                        let decoded_url = urlencoding::decode(url).unwrap_or_else(|_| url.clone().into());
                        
                        // Emit to frontend
                        let _ = handle_clone2.emit("extension-download-request", decoded_url.as_ref());
                        
                        // Return HTML that auto-closes
                        warp::reply::html(r#"
                            <!DOCTYPE html>
                            <html>
                            <head>
                                <title>Slasshy</title>
                                <style>
                                    body {
                                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                        display: flex;
                                        align-items: center;
                                        justify-content: center;
                                        height: 100vh;
                                        margin: 0;
                                        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                                        color: white;
                                    }
                                    .container {
                                        text-align: center;
                                        padding: 40px;
                                    }
                                    .checkmark {
                                        font-size: 64px;
                                        margin-bottom: 20px;
                                    }
                                    h1 { font-size: 24px; margin: 0 0 10px 0; }
                                    p { color: #94a3b8; margin: 0; }
                                </style>
                            </head>
                            <body>
                                <div class="container">
                                    <div class="checkmark">✓</div>
                                    <h1>Sent to Slasshy!</h1>
                                    <p>You can close this tab.</p>
                                </div>
                                <script>setTimeout(() => window.close(), 1500);</script>
                            </body>
                            </html>
                        "#)
                    } else {
                        warp::reply::html(r#"
                            <!DOCTYPE html>
                            <html>
                            <head><title>Error</title></head>
                            <body>
                                <h1>No URL provided</h1>
                                <p>Use: ?url=YOUR_URL</p>
                            </body>
                            </html>
                        "#)
                    }
                });

            // Combine routes
            let routes = health
                .or(download)
                .or(download_get)
                .with(cors);

            println!("[ExtensionServer] Starting on port {}", EXTENSION_SERVER_PORT);
            
            // Start the server
            warp::serve(routes)
                .run(([127, 0, 0, 1], EXTENSION_SERVER_PORT))
                .await;
        });
    });
}
