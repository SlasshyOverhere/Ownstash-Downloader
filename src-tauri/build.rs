use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::process::Command;

/// Expected SHA-256 hashes for bundled binaries (uppercase hex).
/// Update these after bumping binary versions.
/// To get a hash: sha256sum <file> or (Get-FileHash <file>).Hash
const EXPECTED_HASHES: &[(&str, &str)] = &[
    // Windows
    ("yt-dlp.exe", "8065426BC01DAA47F6318E2C590D2A68D38AF26211148034BE74D91622CFCBD0"),
    ("spotdl.exe", "877682C405B8F4DA9383C37A65D64B65BA455D26CB4B34D017E1F73C859C38EA"),
    ("ffmpeg.exe", "EB784B999C8EF9370AE8515534857474328AC26EBBE8EDC8F2344A113A522AD2"),
    ("ffprobe.exe", "DED04BE812B220378D1906BA1D2E0FE56C3C4810DC8D3814447741DB8198CF66"),
    // macOS
    ("yt-dlp_macos", "PLACEHOLDER_YTDLP_MACOS_SHA256"),
    ("ffmpeg", "PLACEHOLDER_FFMPEG_MACOS_SHA256"),
    ("ffprobe", "PLACEHOLDER_FFPROBE_MACOS_SHA256"),
    // Linux
    // ("yt-dlp", "PLACEHOLDER_YTDLP_LINUX_SHA256"),
];

fn verify_binary_hashes(binaries_dir: &Path) -> bool {
    let mut all_ok = true;
    for (name, expected_hash) in EXPECTED_HASHES {
        let path = binaries_dir.join(name);
        if !path.exists() {
            continue; // Binary not present — download script handles it
        }
        if expected_hash.starts_with("PLACEHOLDER") {
            println!(
                "cargo:warning=No pinned hash for {} — skipping verification. Update build.rs with actual hash.",
                name
            );
            continue;
        }
        let data = match fs::read(&path) {
            Ok(d) => d,
            Err(e) => {
                println!("cargo:warning=Failed to read {}: {}", name, e);
                all_ok = false;
                continue;
            }
        };
        let mut hasher = Sha256::new();
        hasher.update(&data);
        let actual = format!("{:X}", hasher.finalize());
        if actual != *expected_hash {
            println!(
                "cargo:warning=SECURITY: Checksum mismatch for {}! Expected {}, got {}. Binary may be tampered.",
                name, expected_hash, actual
            );
            all_ok = false;
        }
    }
    all_ok
}

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

    // Verify checksums of all present binaries — halt build on mismatch
    if binaries_dir.exists() && !verify_binary_hashes(binaries_dir) {
        panic!("SECURITY: Binary checksum verification failed. Build aborted. See warnings above.");
    }

    tauri_build::build()
}
