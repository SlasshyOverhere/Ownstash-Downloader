// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Structured logging via tracing:
//   RUST_LOG=trace / debug / info / warn / error
//   RUST_LOG=ownstash_downloader_lib=debug  — app-specific level
//   RUST_LOG=off                             — disable tracing (println! still works)
// Use tracing macros (info!, warn!, error!, debug!, trace!) in library code.
// Use the security_audit! macro below for security-relevant events.

/// Log a security-relevant event at WARN level with a `[SECURITY]` prefix.
/// Usage: security_audit!("vault_pin_failure", attempts = 3, "PIN verification failed")
#[macro_export]
macro_rules! security_audit {
    ($event:expr $(, $key:ident = $val:expr)* $(, $msg:expr)?) => {
        tracing::warn!(
            event = $event,
            category = "security_audit"
            $(, $key = $val)*
            $(, $msg)?
        )
    };
}

fn main() {
    // Initialize structured logging. Controlled via RUST_LOG env var.
    // Defaults to "warn" in release, "debug" in debug builds.
    let default_level = if cfg!(debug_assertions) { "debug" } else { "warn" };
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(default_level)),
        )
        .with_target(false)
        .with_timer(tracing_subscriber::fmt::time::uptime())
        .init();

    tracing::info!("Ownstash Downloader starting up");

    // Set the Windows AppUserModelID so the volume mixer, taskbar, and jump lists
    // show "Ownstash Downloader" instead of "WebView2".
    #[cfg(target_os = "windows")]
    {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
        let app_id: Vec<u16> = "com.ownstash.downloader\0".encode_utf16().collect();
        unsafe {
            let _ = SetCurrentProcessExplicitAppUserModelID(PCWSTR(app_id.as_ptr()));
        }
    }

    ownstash_downloader_lib::run()
}
