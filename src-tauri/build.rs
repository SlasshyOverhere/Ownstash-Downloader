use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::process::Command;

/// Expected SHA-256 hashes for bundled binaries (uppercase hex).
/// Update these after bumping binary versions.
/// To get a hash: sha256sum <file> or (Get-FileHash <file>).Hash
const EXPECTED_HASHES: &[(&str, &str)] = &[
    // Windows
    ("yt-dlp.exe", "3DB811B366B2DA47337D2FCFDFE5BBD9A258DAD3F350C54974F005DF115A1545"),
    ("spotdl.exe", "55286C6DCCF6ADC973E0888A34E69DB1A45CCE67D2FAB231FEB785605F499BFC"),
    ("ffmpeg.exe", "66133BEE2A30C585FCC205E06A6477E305DEE7C1672C28893086734D34C92319"),
    ("ffprobe.exe", "D23C959F7885EFE529FFE22E3EBB49E5D8D89839FD22BF798F03C85AD07C0778"),
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
