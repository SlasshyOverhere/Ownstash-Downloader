// Secure storage module for encrypted settings (e.g., OAuth tokens)
// Uses AES-256-GCM with a machine-bound key

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use rand::RngCore;
use tauri::{AppHandle, Manager, State};
use crate::commands::AppState;
use std::fs;
use uuid::Uuid;

const NONCE_SIZE: usize = 12;
const KEY_SIZE: usize = 32;
const APP_SECRET_SIZE: usize = 32;
const SECURE_STORAGE_SALT_FILE: &str = "ss_salt.bin";
const APP_SECRET_FILE: &str = "app_secret.bin";
const INSTALL_UUID_FILE: &str = "install_uuid.bin";

/// Get or create the per-installation app secret (32 random bytes persisted to disk).
/// This replaces the previous compile-time constant, ensuring each installation
/// has a unique secret that isn't extractable from the binary alone.
fn get_or_create_app_secret(app_data_dir: &std::path::Path) -> Result<[u8; APP_SECRET_SIZE], String> {
    let secret_path = app_data_dir.join(APP_SECRET_FILE);
    if secret_path.exists() {
        let data = fs::read(&secret_path)
            .map_err(|e| format!("Failed to read app secret: {}", e))?;
        if data.len() == APP_SECRET_SIZE {
            let mut secret = [0u8; APP_SECRET_SIZE];
            secret.copy_from_slice(&data);
            return Ok(secret);
        }
    }
    // Generate a new random secret
    let mut secret = [0u8; APP_SECRET_SIZE];
    rand::thread_rng().fill_bytes(&mut secret);
    fs::create_dir_all(app_data_dir).ok();
    fs::write(&secret_path, &secret)
        .map_err(|e| format!("Failed to save app secret: {}", e))?;
    Ok(secret)
}

/// Helper to convert bytes to hex string
fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Helper to convert hex string to bytes
fn from_hex(hex: &str) -> Result<Vec<u8>, String> {
    if hex.len() % 2 != 0 {
        return Err("Invalid hex string length".to_string());
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&hex[i..i + 2], 16)
                .map_err(|e| format!("Invalid hex character: {}", e))
        })
        .collect()
}

/// Get or create a persistent per-install UUID used as fallback machine entropy.
fn get_or_create_install_uuid(app_data_dir: &std::path::Path) -> Result<String, String> {
    let uuid_path = app_data_dir.join(INSTALL_UUID_FILE);
    if uuid_path.exists() {
        if let Ok(s) = fs::read_to_string(&uuid_path) {
            if !s.trim().is_empty() {
                return Ok(s.trim().to_string());
            }
        }
    }
    let new_uuid = Uuid::new_v4().to_string();
    fs::create_dir_all(app_data_dir).ok();
    fs::write(&uuid_path, &new_uuid)
        .map_err(|e| format!("Failed to save install UUID: {}", e))?;
    Ok(new_uuid)
}

/// Get a machine-specific identifier with multiple entropy sources.
/// Combines environment variables (COMPUTERNAME, USERNAME, PROCESSOR_IDENTIFIER)
/// with additional Windows-specific identifiers and a persisted random UUID
/// to resist prediction.
fn get_machine_id(app_data_dir: &std::path::Path) -> Vec<u8> {
    let mut id = Vec::new();

    // Primary: standard environment variables
    if let Ok(val) = std::env::var("COMPUTERNAME") {
        id.extend_from_slice(b"CN:");
        id.extend_from_slice(val.as_bytes());
    }
    if let Ok(val) = std::env::var("USERNAME") {
        id.extend_from_slice(b"UN:");
        id.extend_from_slice(val.as_bytes());
    }
    if let Ok(val) = std::env::var("PROCESSOR_IDENTIFIER") {
        id.extend_from_slice(b"PI:");
        id.extend_from_slice(val.as_bytes());
    }

    // Additional Windows-specific entropy sources
    if let Ok(val) = std::env::var("USERDOMAIN") {
        id.extend_from_slice(b"UD:");
        id.extend_from_slice(val.as_bytes());
    }
    if let Ok(val) = std::env::var("LOGONSERVER") {
        id.extend_from_slice(b"LS:");
        id.extend_from_slice(val.as_bytes());
    }
    if let Ok(val) = std::env::var("SystemDrive") {
        id.extend_from_slice(b"SD:");
        id.extend_from_slice(val.as_bytes());
    }

    // Persisted random UUID as fallback — never use a static constant
    match get_or_create_install_uuid(app_data_dir) {
        Ok(uuid) => {
            id.extend_from_slice(b"UUID:");
            id.extend_from_slice(uuid.as_bytes());
        }
        Err(e) => {
            eprintln!("[SecureStorage] Failed to load install UUID: {}", e);
        }
    }

    id
}

/// Get the machine-specific key
fn get_system_key(app_handle: &AppHandle) -> Result<[u8; KEY_SIZE], String> {
    let app_data_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Per-installation random secret (replaces hardcoded constant)
    let app_secret = get_or_create_app_secret(&app_data_dir)?;
    let machine_id = get_machine_id(&app_data_dir);

    // Persistent Salt (local to this installation)
    let salt_path = app_data_dir.join(SECURE_STORAGE_SALT_FILE);

    let salt = if salt_path.exists() {
        fs::read(&salt_path).map_err(|e| format!("Failed to read salt: {}", e))?
    } else {
        let mut new_salt = vec![0u8; 32];
        rand::thread_rng().fill_bytes(&mut new_salt);
        fs::create_dir_all(&app_data_dir).ok();
        fs::write(&salt_path, &new_salt).map_err(|e| format!("Failed to save salt: {}", e))?;
        new_salt
    };

    // Derive key using Argon2 — input = per-install secret + machine ID
    let mut key = [0u8; KEY_SIZE];
    let mut input = Vec::new();
    input.extend_from_slice(&app_secret);
    input.extend_from_slice(&machine_id);

    Argon2::default()
        .hash_password_into(&input, &salt, &mut key)
        .map_err(|e| format!("Failed to derive system key: {}", e))?;

    Ok(key)
}

#[tauri::command]
pub async fn secure_save_setting(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let system_key = get_system_key(&app_handle)?;
    let cipher = Aes256Gcm::new_from_slice(&system_key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    // Generate random nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt
    let ciphertext = cipher.encrypt(nonce, value.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // Combine nonce + ciphertext
    let mut combined = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    // Encode as hex for database storage
    let encoded = to_hex(&combined);

    // Save to database
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.save_setting(&key, &encoded).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn secure_get_setting(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let encoded = db.get_setting(&key).map_err(|e| e.to_string())?;
    drop(db);

    let hex_str = match encoded {
        Some(s) => s,
        None => return Ok(None),
    };

    // Decode hex
    let combined = from_hex(&hex_str)?;

    if combined.len() < NONCE_SIZE {
        return Err("Stored data is corrupted".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_SIZE);
    let nonce = Nonce::from_slice(nonce_bytes);

    let system_key = get_system_key(&app_handle)?;
    let cipher = Aes256Gcm::new_from_slice(&system_key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    // Decrypt
    let plaintext = cipher.decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed - possibly the database was moved from another machine or corrupted".to_string())?;

    let value = String::from_utf8(plaintext)
        .map_err(|e| format!("Invalid UTF-8 in decrypted data: {}", e))?;

    Ok(Some(value))
}

#[tauri::command]
pub async fn secure_delete_setting(
    state: State<'_, AppState>,
    key: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_setting(&key).map_err(|e| e.to_string())
}
