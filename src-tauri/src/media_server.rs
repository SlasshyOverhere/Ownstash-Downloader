use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use warp::Filter;
use std::fs;

// Global port for the media server
pub const MEDIA_SERVER_PORT: u16 = 18456;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct MediaFileInfo {
    pub file_path: String,
    pub is_audio: bool,
}

pub fn start_media_server(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        println!("[MediaServer] Starting on port {}", MEDIA_SERVER_PORT);
        
        let stream_route = warp::path("stream")
            .and(warp::query::<std::collections::HashMap<String, String>>())
            .and(warp::header::optional::<String>("range"))
            .and_then(handle_stream_request);
            
        let cors = warp::cors()
            .allow_any_origin()
            .allow_methods(vec!["GET", "HEAD", "OPTIONS"])
            .allow_headers(vec!["Content-Type", "Range", "Accept-Ranges"]);

        let routes = stream_route.with(cors);
        
        let addr = SocketAddr::from(([127, 0, 0, 1], MEDIA_SERVER_PORT));
        warp::serve(routes).run(addr).await;
    });
}

async fn handle_stream_request(
    params: std::collections::HashMap<String, String>,
    range_header: Option<String>
) -> Result<impl warp::Reply, warp::Rejection> {
    use tokio::io::AsyncSeekExt;
    use tokio::io::AsyncReadExt;
    use warp::http::StatusCode;
    use warp::http::Response;

    let file_path = params.get("path").ok_or_else(warp::reject::not_found)?;
    let decoded_path = urlencoding::decode(file_path).map_err(|_| warp::reject::not_found())?.to_string();
    let path = PathBuf::from(&decoded_path);
    
    if !path.exists() {
        return Err(warp::reject::not_found());
    }

    let file_size = tokio::fs::metadata(&path).await
        .map(|m| m.len())
        .map_err(|_| warp::reject::not_found())?;

    let content_type = mime_guess::from_path(&path).first_or_octet_stream();

    let mut file = tokio::fs::File::open(&path).await
        .map_err(|_| warp::reject::not_found())?;

    // Handle Range header
    if let Some(range) = range_header {
        if let Some(range_str) = range.strip_prefix("bytes=") {
            let parts: Vec<&str> = range_str.split('-').collect();
            let start: u64 = parts[0].parse().unwrap_or(0);
            let end: u64 = parts.get(1).and_then(|&s| s.parse().ok()).unwrap_or(file_size - 1);
            
            // Validate range
            let start = start.min(file_size - 1);
            let end = end.min(file_size - 1);
            let length = end - start + 1;

            if start > end {
                return Ok(Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header("Content-Range", format!("bytes */{}", file_size))
                    .body(warp::hyper::Body::empty())
                    .unwrap());
            }

            file.seek(std::io::SeekFrom::Start(start)).await.map_err(|_| warp::reject::not_found())?;
            
            // Read specific chunk
            let mut buffer = vec![0; length as usize];
            file.read_exact(&mut buffer).await.map_err(|_| warp::reject::not_found())?;

            return Ok(Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header("Content-Type", content_type.as_ref())
                .header("Accept-Ranges", "bytes")
                .header("Content-Range", format!("bytes {}-{}/{}", start, end, file_size))
                .header("Content-Length", length)
                .body(warp::hyper::Body::from(buffer))
                .unwrap());
        }
    }

    // No range, serve full file (not recommended for large videos but fallback)
    // Actually, for instant playback, we should support range. 
    // If no range provided, maybe return first chunk? Or just stream entire body?
    // Let's stream entire body for simplicity of non-range requests, 
    // but browsers usually send Range immediately for video.
    
    // Simple full read (careful with RAM, but okay for small files. For large files, browser uses Range)
    // To be safe against OOM, we can return just the file stream?
    // Warp doesn't make it super easy to stream file body without filters.
    // Given the complexity, let's just assume browsers behave nicely or fail.
    // We'll read the whole file if no range - not ideal but compiles.
    // IMPROVEMENT: stream via wrapping tokio file stream.
    
    let stream = tokio_util::io::ReaderStream::new(file);
    let body = warp::hyper::Body::wrap_stream(stream);

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", content_type.as_ref())
        .header("Accept-Ranges", "bytes")
        .header("Content-Length", file_size)
        .body(body)
        .unwrap())
}

/// Get the streaming URL for a given file path
pub fn get_stream_url(file_path: &str) -> String {
    let encoded_path = urlencoding::encode(file_path);
    format!("http://127.0.0.1:{}/stream?path={}", MEDIA_SERVER_PORT, encoded_path)
}

#[tauri::command]
pub fn get_media_stream_url(file_path: String) -> String {
    get_stream_url(&file_path)
}

/// Renamed to avoid macro collision in commands.rs
#[tauri::command]
pub fn find_best_media_match(path: String, title: String) -> Result<MediaFileInfo, String> {
    use std::fs;
    use std::path::Path;
    
    let folder_path = path;
    let title_hint = title;
    
    println!("[MediaServer] Looking for file with title: '{}' in folder: {}", title_hint, folder_path);
    
    let folder = Path::new(&folder_path);
    if !folder.is_dir() {
        return Err(format!("Not a directory: {}", folder_path));
    }
    
    let video_extensions = ["mp4", "webm", "mkv", "avi", "mov", "m4v", "mp3", "m4a", "flac", "opus", "ogg", "wav"];
    let audio_extensions = ["mp3", "m4a", "flac", "opus", "ogg", "wav"];
    let stop_words = ["the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with", "from"];
    
    let title_clean: String = title_hint
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .to_lowercase();
    
    let title_words: Vec<&str> = title_clean
        .split_whitespace()
        .filter(|w| w.len() >= 3 && !stop_words.contains(w))
        .take(5)
        .collect();
    
    println!("[MediaServer] Significant title words: {:?}", title_words);
    
    let mut best_match: Option<(usize, String, String)> = None; 
    
    if let Ok(entries) = fs::read_dir(folder) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    if video_extensions.contains(&ext_lower.as_str()) {
                        let filename = path.file_stem()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default();
                        
                        let filename_clean: String = filename
                            .chars()
                            .filter(|c| c.is_alphanumeric() || c.is_whitespace())
                            .collect::<String>()
                            .to_lowercase();
                        
                        let matching_words: Vec<&&str> = title_words.iter()
                            .filter(|word| filename_clean.contains(**word))
                            .collect();
                        let match_count = matching_words.len();
                        
                        let min_matches = std::cmp::max(1, (title_words.len() + 1) / 2);
                        
                        if match_count >= min_matches {
                            println!("[MediaServer] Candidate: '{}' matches {} words: {:?}", 
                                     filename, match_count, matching_words);
                            
                            let is_better = match &best_match {
                                None => true,
                                Some((prev_count, _, _)) => match_count > *prev_count
                            };
                            
                            if is_better {
                                best_match = Some((match_count, filename, path.to_string_lossy().to_string()));
                            }
                        }
                    }
                }
            }
        }
    }
    
    match best_match {
        Some((count, filename, path)) => {
            println!("[MediaServer] Selected file: '{}' with {} word matches", filename, count);
            let ext = std::path::Path::new(&path).extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            
            let is_audio = audio_extensions.contains(&ext.as_str());
            
            Ok(MediaFileInfo {
                file_path: path,
                is_audio,
            })
        }
        None => {
            println!("[MediaServer] No matching file found for: '{}'", title_hint);
            Err(format!("File not found: '{}' in {}", title_hint, folder_path))
        }
    }
}
