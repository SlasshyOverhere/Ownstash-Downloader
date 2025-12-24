use std::path::Path;

fn main() {
    // Check if binaries exist
    let binaries_dir = Path::new("binaries");
    
    if binaries_dir.exists() {
        let required_binaries = if cfg!(windows) {
            vec!["yt-dlp.exe", "ffmpeg.exe", "ffprobe.exe"]
        } else if cfg!(target_os = "macos") {
            vec!["yt-dlp_macos", "ffmpeg", "ffprobe"]
        } else {
            vec!["yt-dlp", "ffmpeg", "ffprobe"]
        };
        
        for binary in &required_binaries {
            let binary_path = binaries_dir.join(binary);
            if !binary_path.exists() {
                println!("cargo:warning=Binary not found: {}. Run 'download-binaries.ps1' to download required binaries.", binary);
            }
        }
    } else {
        println!("cargo:warning=Binaries directory not found. Run 'download-binaries.ps1' to download required binaries.");
    }
    
    tauri_build::build()
}
