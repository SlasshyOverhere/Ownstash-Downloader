use std::path::Path;
use std::process::Command;

fn main() {
    let binaries_dir = Path::new("binaries");

    let required_binaries = if cfg!(target_os = "windows") {
        vec!["yt-dlp.exe", "ffmpeg.exe", "ffprobe.exe"]
    } else if cfg!(target_os = "macos") {
        vec!["yt-dlp_macos", "ffmpeg", "ffprobe"]
    } else {
        vec!["yt-dlp", "ffmpeg", "ffprobe"]
    };

    let missing = !binaries_dir.exists()
        || required_binaries
            .iter()
            .any(|b| !binaries_dir.join(b).exists());

    if missing {
        println!("cargo:warning=Binaries missing — downloading automatically...");
        let script = if cfg!(target_os = "windows") {
            // Run the PowerShell download script
            let status = Command::new("powershell")
                .args([
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    "download-binaries.ps1",
                ])
                .status();
            match status {
                Ok(s) if s.success() => true,
                _ => {
                    println!("cargo:warning=Auto-download failed. Run 'download-binaries.ps1' manually.");
                    false
                }
            }
        } else {
            println!("cargo:warning=Auto-download not supported on this platform. Run the appropriate download script manually.");
            false
        };

        if script {
            println!("cargo:warning=Binaries downloaded successfully.");
        }
    }

    tauri_build::build()
}
