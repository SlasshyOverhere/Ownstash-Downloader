// Native OS Integration module
// - Windows Taskbar Progress
// - Native Notifications with actions

use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
use std::ptr;

#[cfg(target_os = "windows")]
use windows::{
    core::Interface,
    Win32::{
        Foundation::HWND,
        UI::Shell::{ITaskbarList3, TaskbarList, TBPFLAG, TBPF_ERROR, TBPF_INDETERMINATE, TBPF_NOPROGRESS, TBPF_NORMAL, TBPF_PAUSED},
    },
};

// Global taskbar instance for Windows
#[cfg(target_os = "windows")]
lazy_static::lazy_static! {
    static ref TASKBAR_LIST: std::sync::Mutex<Option<TaskbarInstance>> = std::sync::Mutex::new(None);
}

#[cfg(target_os = "windows")]
struct TaskbarInstance {
    taskbar: ITaskbarList3,
}

#[cfg(target_os = "windows")]
unsafe impl Send for TaskbarInstance {}
#[cfg(target_os = "windows")]
unsafe impl Sync for TaskbarInstance {}

/// Initialize the native integration module
pub fn init(app_handle: &AppHandle) {
    #[cfg(target_os = "windows")]
    init_taskbar_windows();

    println!("[NativeIntegration] Initialized");
}

#[cfg(target_os = "windows")]
fn init_taskbar_windows() {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};

    std::thread::spawn(|| {
        unsafe {
            // Initialize COM
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

            // Create TaskbarList instance
            if let Ok(taskbar) = CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_INPROC_SERVER) {
                let mut guard = TASKBAR_LIST.lock().unwrap();
                *guard = Some(TaskbarInstance { taskbar });
                println!("[NativeIntegration] Windows taskbar initialized");
            }
        }
    });
}

/// Set taskbar progress state and value
#[cfg(target_os = "windows")]
pub fn set_taskbar_progress(hwnd: isize, progress: f64, state: TaskbarState) {
    let guard = TASKBAR_LIST.lock().unwrap();
    if let Some(instance) = &*guard {
        unsafe {
            let handle = HWND(hwnd as *mut std::ffi::c_void);
            
            // Set state
            let tbp_flag = match state {
                TaskbarState::NoProgress => TBPF_NOPROGRESS,
                TaskbarState::Indeterminate => TBPF_INDETERMINATE,
                TaskbarState::Normal => TBPF_NORMAL,
                TaskbarState::Error => TBPF_ERROR,
                TaskbarState::Paused => TBPF_PAUSED,
            };
            
            let _ = instance.taskbar.SetProgressState(handle, tbp_flag);
            
            // Set value (0-100%)
            if matches!(state, TaskbarState::Normal | TaskbarState::Paused) {
                let completed = (progress * 100.0) as u64;
                let _ = instance.taskbar.SetProgressValue(handle, completed, 100);
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn set_taskbar_progress(_hwnd: isize, _progress: f64, _state: TaskbarState) {
    // No-op on non-Windows platforms
}

#[derive(Debug, Clone, Copy)]
pub enum TaskbarState {
    NoProgress,
    Indeterminate,
    Normal,
    Error,
    Paused,
}

/// Update taskbar progress from download event
#[tauri::command]
pub fn update_taskbar_progress(
    app_handle: AppHandle,
    progress: f64,
    state: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app_handle.get_webview_window("main") {
            if let Ok(hwnd) = window.hwnd() {
                let taskbar_state = match state.as_str() {
                    "downloading" => TaskbarState::Normal,
                    "paused" => TaskbarState::Paused,
                    "error" | "failed" => TaskbarState::Error,
                    "indeterminate" => TaskbarState::Indeterminate,
                    _ => TaskbarState::NoProgress,
                };
                
                set_taskbar_progress(hwnd.0 as isize, progress / 100.0, taskbar_state);
            }
        }
    }
    Ok(())
}

/// Clear taskbar progress
#[tauri::command]
pub fn clear_taskbar_progress(app_handle: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app_handle.get_webview_window("main") {
            if let Ok(hwnd) = window.hwnd() {
                set_taskbar_progress(hwnd.0 as isize, 0.0, TaskbarState::NoProgress);
            }
        }
    }
    Ok(())
}

// ============ Native Notifications ============

/// Send a native notification
#[tauri::command]
pub async fn send_notification(
    app_handle: AppHandle,
    title: String,
    body: String,
    notification_type: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    let notification = app_handle.notification()
        .builder()
        .title(&title)
        .body(&body);

    // Add icon based on type
    // Note: Custom actions require additional platform-specific setup
    
    notification.show()
        .map_err(|e| format!("Failed to send notification: {}", e))?;

    Ok(())
}

/// Send download complete notification with action
#[tauri::command]
pub async fn notify_download_complete(
    app_handle: AppHandle,
    title: String,
    file_path: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    let notification = app_handle.notification()
        .builder()
        .title("Download Complete")
        .body(&format!("{} has finished downloading", title));

    notification.show()
        .map_err(|e| format!("Failed to send notification: {}", e))?;

    // Emit event to frontend for handling click actions
    let _ = app_handle.emit("notification-click", serde_json::json!({
        "type": "download_complete",
        "title": title,
        "file_path": file_path,
    }));

    Ok(())
}

/// Send download failed notification
#[tauri::command]
pub async fn notify_download_failed(
    app_handle: AppHandle,
    title: String,
    error: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    let notification = app_handle.notification()
        .builder()
        .title("Download Failed")
        .body(&format!("{}: {}", title, error));

    notification.show()
        .map_err(|e| format!("Failed to send notification: {}", e))?;

    Ok(())
}

/// Check if notifications are enabled
#[tauri::command]
pub async fn check_notification_permission(
    app_handle: AppHandle,
) -> Result<bool, String> {
    use tauri_plugin_notification::NotificationExt;

    let permission = app_handle.notification()
        .permission_state()
        .map_err(|e| format!("Failed to check permission: {}", e))?;

    Ok(matches!(permission, tauri_plugin_notification::PermissionState::Granted))
}

/// Request notification permission
#[tauri::command]
pub async fn request_notification_permission(
    app_handle: AppHandle,
) -> Result<bool, String> {
    use tauri_plugin_notification::NotificationExt;

    let permission = app_handle.notification()
        .request_permission()
        .map_err(|e| format!("Failed to request permission: {}", e))?;

    Ok(matches!(permission, tauri_plugin_notification::PermissionState::Granted))
}
