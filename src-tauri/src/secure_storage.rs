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

const NONCE_SIZE: usize = 12;
const KEY_SIZE: usize = 32;
const SECURE_STORAGE_SALT_FILE: &str = "ss_salt.bin";
const APP_SECRET: &[u8] = b"slasshy_secure_token_vault_2025_v1";

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

/// Get a machine-specific identifier
fn get_machine_id() -> Vec<u8> {
    let mut id = Vec::new();

    // On Windows, use USERNAME and COMPUTERNAME environment variables
    // These are usually enough to bind the data to the current machine and session
    if let Ok(val) = std::env::var("COMPUTERNAME") {
        id.extend_from_slice(val.as_bytes());
    }
    if let Ok(val) = std::env::var("USERNAME") {
        id.extend_from_slice(val.as_bytes());
    }
    if let Ok(val) = std::env::var("PROCESSOR_IDENTIFIER") {
        id.extend_from_slice(val.as_bytes());
    }

    // If all fail, return a fallback
    if id.is_empty() {
        id.extend_from_slice(b"fallback_machine_id");
    }

    id
}

/// Get the machine-specific key
fn get_system_key(app_handle: &AppHandle) -> Result<[u8; KEY_SIZE], String> {
    let machine_id = get_machine_id();

    // Persistent Salt (local to this installation)
    let app_data_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let salt_path = app_data_dir.join(SECURE_STORAGE_SALT_FILE);
    
    let salt = if salt_path.exists() {
        fs::read(&salt_path).map_err(|e| format!("Failed to read salt: {}", e))?
    } else {
        let mut new_salt = vec![0u8; 16];
        rand::thread_rng().fill_bytes(&mut new_salt);
        fs::create_dir_all(&app_data_dir).ok();
        fs::write(&salt_path, &new_salt).map_err(|e| format!("Failed to save salt: {}", e))?;
        new_salt
    };

    // Derive key using Argon2
    let mut key = [0u8; KEY_SIZE];
    let mut input = Vec::new();
    input.extend_from_slice(APP_SECRET);
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
