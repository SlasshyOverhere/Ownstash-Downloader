// Vault module for PIN-protected encrypted storage
// Uses AES-256-GCM for file encryption and Argon2 for PIN hashing
// Supports both single files and folder uploads (compressed to ZIP then encrypted)

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;
use zip::{ZipArchive, ZipWriter, write::FileOptions, CompressionMethod};

const VAULT_DIR_NAME: &str = "vault";
const VAULT_CONFIG_FILE: &str = "vault_config.json";
pub const ENCRYPTED_EXTENSION: &str = ".slasshy";
const LEGACY_EXTENSION: &str = ".vault"; // For backward compatibility
const NONCE_SIZE: usize = 12;
const KEY_SIZE: usize = 32;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VaultConfig {
    pub pin_hash: String,
    pub salt: String,
    pub created_at: i64,
    pub last_accessed: Option<i64>,
}

/// Entry within a folder archive - represents a file or directory inside a vault folder
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VaultFolderEntry {
    pub name: String,           // File/folder name
    pub path: String,           // Relative path within the folder
    pub size_bytes: u64,        // Size in bytes (0 for directories)
    pub file_type: String,      // "video", "audio", "image", "file", "directory"
    pub is_directory: bool,     // True if this is a directory
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VaultFile {
    pub id: String,
    pub original_name: String,
    pub encrypted_name: String,
    pub size_bytes: u64,
    pub added_at: i64,
    pub file_type: String, // "video", "audio", "file", "folder"
    pub thumbnail: Option<String>,
    // Folder-specific fields
    #[serde(default)]
    pub is_folder: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_entries: Option<Vec<VaultFolderEntry>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VaultStatus {
    pub is_setup: bool,
    pub is_unlocked: bool,
    pub file_count: usize,
    pub total_size_bytes: u64,
}

// Global state for vault session
lazy_static::lazy_static! {
    static ref VAULT_SESSION: std::sync::Mutex<Option<VaultSession>> = std::sync::Mutex::new(None);
}

struct VaultSession {
    key: [u8; KEY_SIZE],
    unlocked_at: i64,
}

/// Helper to get the vault key without holding the MutexGuard across await points
/// Made public for vault_download module
pub fn get_vault_key() -> Result<[u8; KEY_SIZE], String> {
    let session = VAULT_SESSION.lock().unwrap();
    match &*session {
        Some(s) => Ok(s.key),
        None => Err("Vault is locked. Unlock it first.".to_string()),
    }
}

fn get_vault_dir(app_handle: &AppHandle) -> PathBuf {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");
    app_data_dir.join(VAULT_DIR_NAME)
}

fn get_vault_config_path(app_handle: &AppHandle) -> PathBuf {
    get_vault_dir(app_handle).join(VAULT_CONFIG_FILE)
}

fn get_vault_files_dir(app_handle: &AppHandle) -> PathBuf {
    get_vault_dir(app_handle).join("files")
}

// NOTE: Local index.json is NO LONGER USED
// The vault index is now stored ONLY in Google Drive (encrypted with PIN)
// This eliminates the security weakness of having file names visible locally
// fn get_vault_index_path is kept for migration purposes only
#[allow(dead_code)]
fn get_vault_index_path(app_handle: &AppHandle) -> PathBuf {
    get_vault_dir(app_handle).join("index.json")
}

fn derive_key_from_pin(pin: &str, salt: &[u8]) -> [u8; KEY_SIZE] {
    use argon2::Argon2;
    let mut key = [0u8; KEY_SIZE];
    Argon2::default()
        .hash_password_into(pin.as_bytes(), salt, &mut key)
        .expect("Failed to derive key from PIN");
    key
}

fn load_vault_config(app_handle: &AppHandle) -> Option<VaultConfig> {
    let config_path = get_vault_config_path(app_handle);
    if !config_path.exists() {
        return None;
    }

    let content = fs::read_to_string(&config_path).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_vault_config(app_handle: &AppHandle, config: &VaultConfig) -> Result<(), String> {
    let config_path = get_vault_config_path(app_handle);
    fs::create_dir_all(config_path.parent().unwrap())
        .map_err(|e| format!("Failed to create vault directory: {}", e))?;

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

// ============ CLOUD-ONLY INDEX ============
// The vault index is now stored ONLY in Google Drive (encrypted with user's PIN)
// These legacy functions are kept for migration but marked as deprecated

/// DEPRECATED: Load vault index from local file
/// The index is now managed by the frontend via encrypted Google Drive
#[allow(dead_code)]
fn load_vault_index_legacy(app_handle: &AppHandle) -> Vec<VaultFile> {
    let index_path = get_vault_index_path(app_handle);
    println!("[Vault] LEGACY load_vault_index from: {:?}", index_path);
    
    if !index_path.exists() {
        return Vec::new();
    }

    let content = match fs::read_to_string(&index_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    serde_json::from_str::<Vec<VaultFile>>(&content).unwrap_or_default()
}

/// Count encrypted files in vault directory (for status without index)
/// Supports both .slasshy (new) and .vault (legacy) extensions
fn count_vault_files(app_handle: &AppHandle) -> (usize, u64) {
    let files_dir = get_vault_files_dir(app_handle);
    if !files_dir.exists() {
        return (0, 0);
    }

    let mut count = 0;
    let mut total_size: u64 = 0;

    if let Ok(entries) = fs::read_dir(&files_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            // Accept both new .slasshy and legacy .vault extensions
            if path.extension().map_or(false, |ext| ext == "slasshy" || ext == "vault") {
                count += 1;
                if let Ok(meta) = fs::metadata(&path) {
                    total_size += meta.len();
                }
            }
        }
    }

    (count, total_size)
}

/// Delete local index.json if it exists (for security migration)
fn delete_local_index(app_handle: &AppHandle) {
    let index_path = get_vault_index_path(app_handle);
    if index_path.exists() {
        println!("[Vault] Deleting local index.json for security");
        let _ = fs::remove_file(&index_path);
    }
}

fn encrypt_file(key: &[u8; KEY_SIZE], input_path: &PathBuf, output_path: &PathBuf) -> Result<(), String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    // Use chunked encryption for large files
    // Each chunk gets its own nonce derived from base nonce + chunk index
    const CHUNK_SIZE: usize = 1024 * 1024; // 1MB chunks
    const VAULT_MAGIC: &[u8; 4] = b"SLV2"; // Magic header for new format
    
    // Generate random base nonce
    let mut base_nonce = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut base_nonce);

    let mut input_file = File::open(input_path)
        .map_err(|e| format!("Failed to open input file: {}", e))?;
    
    let file_size = input_file.metadata()
        .map_err(|e| format!("Failed to get file metadata: {}", e))?.len();
    
    let mut output_file = File::create(output_path)
        .map_err(|e| format!("Failed to create output file: {}", e))?;
    
    // Write header: [MAGIC (4 bytes)][base_nonce (12 bytes)][file_size (8 bytes)]
    output_file.write_all(VAULT_MAGIC)
        .map_err(|e| format!("Failed to write magic header: {}", e))?;
    output_file.write_all(&base_nonce)
        .map_err(|e| format!("Failed to write nonce: {}", e))?;
    output_file.write_all(&file_size.to_le_bytes())
        .map_err(|e| format!("Failed to write file size: {}", e))?;
    
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut chunk_index: u64 = 0;
    
    loop {
        let bytes_read = input_file.read(&mut buffer)
            .map_err(|e| format!("Failed to read input file: {}", e))?;
        
        if bytes_read == 0 {
            break;
        }
        
        // Derive chunk-specific nonce from base nonce and chunk index
        let mut chunk_nonce = base_nonce;
        let index_bytes = chunk_index.to_le_bytes();
        for i in 0..8 {
            chunk_nonce[i] ^= index_bytes[i];
        }
        let nonce = Nonce::from_slice(&chunk_nonce);
        
        // Encrypt this chunk
        let plaintext = &buffer[..bytes_read];
        let ciphertext = cipher.encrypt(nonce, plaintext)
            .map_err(|e| format!("Encryption failed at chunk {}: {}", chunk_index, e))?;
        
        // Write encrypted chunk size (for decryption) and ciphertext
        let chunk_len = ciphertext.len() as u32;
        output_file.write_all(&chunk_len.to_le_bytes())
            .map_err(|e| format!("Failed to write chunk size: {}", e))?;
        output_file.write_all(&ciphertext)
            .map_err(|e| format!("Failed to write ciphertext: {}", e))?;
        
        chunk_index += 1;
    }

    Ok(())
}

fn decrypt_file(key: &[u8; KEY_SIZE], input_path: &PathBuf, output_path: &PathBuf) -> Result<(), String> {
    const VAULT_MAGIC: &[u8; 4] = b"SLV2";
    
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    let mut input_file = File::open(input_path)
        .map_err(|e| format!("Failed to open encrypted file: {}", e))?;
    
    // Read first 4 bytes to check for magic header
    let mut magic_check = [0u8; 4];
    input_file.read_exact(&mut magic_check)
        .map_err(|e| format!("Failed to read file header: {}", e))?;
    
    // Check if this is the new streaming format (SLV2) or legacy format
    if &magic_check == VAULT_MAGIC {
        // New streaming format: [MAGIC][base_nonce][file_size][chunks...]
        let mut base_nonce = [0u8; NONCE_SIZE];
        input_file.read_exact(&mut base_nonce)
            .map_err(|e| format!("Failed to read nonce: {}", e))?;
        
        let mut file_size_bytes = [0u8; 8];
        input_file.read_exact(&mut file_size_bytes)
            .map_err(|e| format!("Failed to read file size: {}", e))?;
        let expected_size = u64::from_le_bytes(file_size_bytes);
        
        let mut output_file = File::create(output_path)
            .map_err(|e| format!("Failed to create output file: {}", e))?;
        
        let mut chunk_index: u64 = 0;
        let mut total_written: u64 = 0;
        
        loop {
            // Read chunk size
            let mut chunk_size_bytes = [0u8; 4];
            match input_file.read_exact(&mut chunk_size_bytes) {
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                    break;
                }
                Err(e) => {
                    return Err(format!("Failed to read chunk size: {}", e));
                }
            }
            let chunk_size = u32::from_le_bytes(chunk_size_bytes) as usize;
            
            if chunk_size == 0 {
                break;
            }
            
            // Read encrypted chunk
            let mut ciphertext = vec![0u8; chunk_size];
            input_file.read_exact(&mut ciphertext)
                .map_err(|e| format!("Failed to read encrypted chunk {}: {}", chunk_index, e))?;
            
            // Derive chunk-specific nonce from base nonce and chunk index
            let mut chunk_nonce = base_nonce;
            let index_bytes = chunk_index.to_le_bytes();
            for i in 0..8 {
                chunk_nonce[i] ^= index_bytes[i];
            }
            let nonce = Nonce::from_slice(&chunk_nonce);
            
            // Decrypt this chunk
            let plaintext = cipher.decrypt(nonce, ciphertext.as_ref())
                .map_err(|_| format!("Decryption failed at chunk {} - invalid PIN or corrupted file", chunk_index))?;
            
            output_file.write_all(&plaintext)
                .map_err(|e| format!("Failed to write decrypted chunk: {}", e))?;
            
            total_written += plaintext.len() as u64;
            chunk_index += 1;
        }
        
        // Verify we got the expected amount of data
        if total_written != expected_size {
            return Err(format!(
                "File size mismatch: expected {} bytes, got {} bytes",
                expected_size, total_written
            ));
        }
    } else {
        // Legacy format: [nonce (12 bytes)][ciphertext]
        // The first 4 bytes we read are part of the 12-byte nonce
        let mut nonce_bytes = [0u8; NONCE_SIZE];
        nonce_bytes[0..4].copy_from_slice(&magic_check);
        input_file.read_exact(&mut nonce_bytes[4..])
            .map_err(|e| format!("Failed to read legacy nonce: {}", e))?;
        let nonce = Nonce::from_slice(&nonce_bytes);
        
        // Read entire ciphertext (legacy single-chunk format)
        let mut ciphertext = Vec::new();
        input_file.read_to_end(&mut ciphertext)
            .map_err(|e| format!("Failed to read legacy ciphertext: {}", e))?;
        
        // Decrypt in one go
        let plaintext = cipher.decrypt(nonce, ciphertext.as_ref())
            .map_err(|_| "Decryption failed - invalid PIN or corrupted file".to_string())?;
        
        // Write output file
        let mut output_file = File::create(output_path)
            .map_err(|e| format!("Failed to create output file: {}", e))?;
        output_file.write_all(&plaintext)
            .map_err(|e| format!("Failed to write decrypted file: {}", e))?;
    }

    Ok(())
}

// ============ Tauri Commands ============

/// Check if vault is set up
/// NOTE: file_count and total_size_bytes are now estimated from .vault files on disk
/// The actual file metadata is stored in encrypted Google Drive index
#[tauri::command]
pub fn vault_get_status(app_handle: AppHandle) -> VaultStatus {
    let config = load_vault_config(&app_handle);
    let is_setup = config.is_some();
    
    let session = VAULT_SESSION.lock().unwrap();
    let is_unlocked = session.is_some();
    drop(session);

    // Count files from disk (encrypted size, not original)
    let (file_count, total_size_bytes) = if is_setup {
        count_vault_files(&app_handle)
    } else {
        (0, 0)
    };

    // Delete any legacy local index for security
    if is_setup {
        delete_local_index(&app_handle);
    }

    VaultStatus {
        is_setup,
        is_unlocked,
        file_count,
        total_size_bytes,
    }
}

/// Set up the vault with a new PIN
#[tauri::command]
pub fn vault_setup(app_handle: AppHandle, pin: String) -> Result<(), String> {
    if pin.len() < 4 {
        return Err("PIN must be at least 4 digits".to_string());
    }

    // Check if already set up
    if load_vault_config(&app_handle).is_some() {
        return Err("Vault is already set up. Reset it first to change PIN.".to_string());
    }

    // Generate salt and hash PIN
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let pin_hash = argon2
        .hash_password(pin.as_bytes(), &salt)
        .map_err(|e| format!("Failed to hash PIN: {}", e))?
        .to_string();

    let config = VaultConfig {
        pin_hash,
        salt: salt.to_string(),
        created_at: chrono::Utc::now().timestamp(),
        last_accessed: None,
    };

    // Create vault directories
    let files_dir = get_vault_files_dir(&app_handle);
    fs::create_dir_all(&files_dir)
        .map_err(|e| format!("Failed to create vault files directory: {}", e))?;

    // Save config
    save_vault_config(&app_handle, &config)?;

    // NOTE: We no longer create local index.json
    // The vault index is managed by the frontend via encrypted Google Drive

    // Unlock the vault immediately after setup
    let salt_bytes = salt.as_str().as_bytes();
    let key = derive_key_from_pin(&pin, salt_bytes);
    
    let mut session = VAULT_SESSION.lock().unwrap();
    *session = Some(VaultSession {
        key,
        unlocked_at: chrono::Utc::now().timestamp(),
    });

    Ok(())
}

/// Unlock the vault with PIN
#[tauri::command]
pub fn vault_unlock(app_handle: AppHandle, pin: String) -> Result<(), String> {
    let config = load_vault_config(&app_handle)
        .ok_or("Vault is not set up")?;

    // Verify PIN
    let parsed_hash = PasswordHash::new(&config.pin_hash)
        .map_err(|e| format!("Invalid stored hash: {}", e))?;
    
    Argon2::default()
        .verify_password(pin.as_bytes(), &parsed_hash)
        .map_err(|_| "Invalid PIN".to_string())?;

    // Derive encryption key from PIN
    let key = derive_key_from_pin(&pin, config.salt.as_bytes());

    // Store session
    let mut session = VAULT_SESSION.lock().unwrap();
    *session = Some(VaultSession {
        key,
        unlocked_at: chrono::Utc::now().timestamp(),
    });

    // Update last accessed
    let mut updated_config = config.clone();
    updated_config.last_accessed = Some(chrono::Utc::now().timestamp());
    save_vault_config(&app_handle, &updated_config)?;

    Ok(())
}

/// Lock the vault
#[tauri::command]
pub fn vault_lock() -> Result<(), String> {
    let mut session = VAULT_SESSION.lock().unwrap();
    *session = None;
    Ok(())
}

/// Add a file to the vault (encrypts and moves it)
#[tauri::command]
pub async fn vault_add_file(
    app_handle: AppHandle,
    source_path: String,
    original_name: String,
    file_type: String,
    thumbnail: Option<String>,
    delete_original: bool,
) -> Result<VaultFile, String> {
    // Get the encryption key (this doesn't hold the lock across await points)
    let key = get_vault_key()?;

    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err("Source file does not exist".to_string());
    }

    let file_size = fs::metadata(&source)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?
        .len();

    // Generate unique encrypted filename
    let file_id = uuid::Uuid::new_v4().to_string();
    let encrypted_name = format!("{}{}", file_id, ENCRYPTED_EXTENSION);
    let dest_path = get_vault_files_dir(&app_handle).join(&encrypted_name);

    // Encrypt file in background thread to avoid blocking UI
    let source_clone = source.clone();
    let dest_clone = dest_path.clone();
    let key_copy = key; // Copy the key for the closure
    tokio::task::spawn_blocking(move || {
        encrypt_file(&key_copy, &source_clone, &dest_clone)
    })
    .await
    .map_err(|e| format!("Encryption task failed: {}", e))?
    .map_err(|e| format!("Encryption failed: {}", e))?;

    // Create vault file entry
    let vault_file = VaultFile {
        id: file_id,
        original_name,
        encrypted_name,
        size_bytes: file_size,
        added_at: chrono::Utc::now().timestamp(),
        file_type,
        thumbnail,
        is_folder: false,
        folder_entries: None,
    };

    // NOTE: We no longer save to local index.json
    // The frontend will add this file to the encrypted Google Drive index
    println!("[Vault] File encrypted successfully: {}", vault_file.id);

    // Optionally delete original
    if delete_original {
        let _ = fs::remove_file(&source);
    }

    Ok(vault_file)
}

/// List all files in the vault
/// NOTE: This now returns an empty list - file metadata is managed by frontend via Google Drive
/// This function is kept for API compatibility
#[tauri::command]
pub fn vault_list_files(app_handle: AppHandle) -> Result<Vec<VaultFile>, String> {
    println!("[Vault] vault_list_files called (cloud-only mode)");
    
    let session = VAULT_SESSION.lock().unwrap();
    if session.is_none() {
        println!("[Vault] ERROR: Vault is locked");
        return Err("Vault is locked. Unlock it first.".to_string());
    }
    drop(session);

    // Return empty - the frontend manages the index via encrypted Google Drive
    // This prevents any file metadata from being stored locally
    println!("[Vault] Returning empty list (index is cloud-only)");
    Ok(Vec::new())
}

/// Export/decrypt a file from the vault to a destination
/// NOTE: encrypted_name and original_name are now passed from frontend (cloud index)
#[tauri::command]
pub async fn vault_export_file(
    app_handle: AppHandle,
    file_id: String,
    encrypted_name: String,
    original_name: String,
    destination_path: String,
) -> Result<String, String> {
    // Get the decryption key
    let key = get_vault_key()?;

    let encrypted_path = get_vault_files_dir(&app_handle).join(&encrypted_name);
    let dest_path = PathBuf::from(&destination_path).join(&original_name);

    if !encrypted_path.exists() {
        return Err(format!("Encrypted file not found: {}", file_id));
    }

    // Decrypt in background thread to avoid blocking UI
    let enc_clone = encrypted_path.clone();
    let dest_clone = dest_path.clone();
    let key_copy = key;
    tokio::task::spawn_blocking(move || {
        decrypt_file(&key_copy, &enc_clone, &dest_clone)
    })
    .await
    .map_err(|e| format!("Decryption task failed: {}", e))?
    .map_err(|e| format!("Decryption failed: {}", e))?;

    Ok(dest_path.to_string_lossy().to_string())
}

/// Get a temporary decrypted path for playback (auto-deleted later)
/// NOTE: encrypted_name and original_name are now passed from frontend (cloud index)
#[tauri::command]
pub async fn vault_get_temp_playback_path(
    app_handle: AppHandle,
    file_id: String,
    encrypted_name: String,
    original_name: String,
) -> Result<String, String> {
    // Get the decryption key
    let key = get_vault_key()?;

    let encrypted_path = get_vault_files_dir(&app_handle).join(&encrypted_name);
    
    if !encrypted_path.exists() {
        return Err(format!("Encrypted file not found: {}", file_id));
    }
    
    // Create temp directory inside vault (more secure than system temp)
    let temp_dir = get_vault_dir(&app_handle).join("temp");
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;
    
    let temp_path = temp_dir.join(&original_name);

    // Decrypt in background thread to avoid blocking UI
    let enc_clone = encrypted_path.clone();
    let temp_clone = temp_path.clone();
    let key_copy = key;
    tokio::task::spawn_blocking(move || {
        decrypt_file(&key_copy, &enc_clone, &temp_clone)
    })
    .await
    .map_err(|e| format!("Decryption task failed: {}", e))?
    .map_err(|e| format!("Decryption failed: {}", e))?;

    Ok(temp_path.to_string_lossy().to_string())
}

/// Clean up temporary files
#[tauri::command]
pub fn vault_cleanup_temp(app_handle: AppHandle) -> Result<(), String> {
    let temp_dir = get_vault_dir(&app_handle).join("temp");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to cleanup temp: {}", e))?;
    }
    Ok(())
}

/// Delete a file from the vault by its encrypted filename
/// NOTE: The frontend now passes the encrypted_name directly since it manages the index
/// Supports both .slasshy (new) and .vault (legacy) extensions
#[tauri::command]
pub fn vault_delete_file(app_handle: AppHandle, file_id: String) -> Result<(), String> {
    let session = VAULT_SESSION.lock().unwrap();
    if session.is_none() {
        return Err("Vault is locked. Unlock it first.".to_string());
    }
    drop(session);

    let files_dir = get_vault_files_dir(&app_handle);
    
    // Try both new .slasshy and legacy .vault extensions
    let new_name = format!("{}.slasshy", file_id);
    let legacy_name = format!("{}.vault", file_id);
    
    let new_path = files_dir.join(&new_name);
    let legacy_path = files_dir.join(&legacy_name);

    // Delete whichever exists
    if new_path.exists() {
        fs::remove_file(&new_path)
            .map_err(|e| format!("Failed to delete file: {}", e))?;
        println!("[Vault] Deleted encrypted file: {}", new_name);
    } else if legacy_path.exists() {
        fs::remove_file(&legacy_path)
            .map_err(|e| format!("Failed to delete file: {}", e))?;
        println!("[Vault] Deleted legacy encrypted file: {}", legacy_name);
    } else {
        println!("[Vault] Warning: Encrypted file not found: {} or {}", new_name, legacy_name);
    }

    // NOTE: We no longer update local index - frontend manages via Google Drive
    Ok(())
}

/// Change vault PIN
#[tauri::command]
pub fn vault_change_pin(
    app_handle: AppHandle,
    current_pin: String,
    new_pin: String,
) -> Result<(), String> {
    if new_pin.len() < 4 {
        return Err("New PIN must be at least 4 digits".to_string());
    }

    let config = load_vault_config(&app_handle)
        .ok_or("Vault is not set up")?;

    // Verify current PIN
    let parsed_hash = PasswordHash::new(&config.pin_hash)
        .map_err(|e| format!("Invalid stored hash: {}", e))?;
    
    Argon2::default()
        .verify_password(current_pin.as_bytes(), &parsed_hash)
        .map_err(|_| "Current PIN is incorrect".to_string())?;

    // Scan vault directory for .slasshy and .vault files (no local index)
    let files_dir = get_vault_files_dir(&app_handle);
    let mut vault_files: Vec<String> = Vec::new();
    
    if files_dir.exists() {
        if let Ok(entries) = fs::read_dir(&files_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                // Accept both new .slasshy and legacy .vault extensions
                if path.extension().map_or(false, |ext| ext == "slasshy" || ext == "vault") {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        vault_files.push(name.to_string());
                    }
                }
            }
        }
    }

    let current_key = derive_key_from_pin(&current_pin, config.salt.as_bytes());

    // Generate new salt and hash
    let new_salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let new_pin_hash = argon2
        .hash_password(new_pin.as_bytes(), &new_salt)
        .map_err(|e| format!("Failed to hash new PIN: {}", e))?
        .to_string();

    let new_key = derive_key_from_pin(&new_pin, new_salt.as_str().as_bytes());

    // Re-encrypt all files with new key
    let temp_dir = get_vault_dir(&app_handle).join("reencrypt_temp");
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;

    for encrypted_name in &vault_files {
        let encrypted_path = files_dir.join(encrypted_name);
        let file_id = encrypted_name.trim_end_matches(".vault");
        let temp_decrypted = temp_dir.join(file_id);
        let temp_reencrypted = temp_dir.join(format!("{}_new", file_id));

        // Decrypt with old key
        decrypt_file(&current_key, &encrypted_path, &temp_decrypted)?;
        
        // Re-encrypt with new key
        encrypt_file(&new_key, &temp_decrypted, &temp_reencrypted)?;

        // Replace original encrypted file
        fs::rename(&temp_reencrypted, &encrypted_path)
            .map_err(|e| format!("Failed to replace encrypted file: {}", e))?;

        // Clean up temp decrypted
        let _ = fs::remove_file(&temp_decrypted);
    }

    // Clean up temp directory
    let _ = fs::remove_dir_all(&temp_dir);

    // Update config with new hash
    let new_config = VaultConfig {
        pin_hash: new_pin_hash,
        salt: new_salt.to_string(),
        created_at: config.created_at,
        last_accessed: Some(chrono::Utc::now().timestamp()),
    };
    save_vault_config(&app_handle, &new_config)?;

    // Update session with new key
    let mut session = VAULT_SESSION.lock().unwrap();
    *session = Some(VaultSession {
        key: new_key,
        unlocked_at: chrono::Utc::now().timestamp(),
    });

    Ok(())
}

/// Reset vault (DANGEROUS - deletes all encrypted files)
#[tauri::command]
pub fn vault_reset(app_handle: AppHandle, pin: String) -> Result<(), String> {
    let config = load_vault_config(&app_handle)
        .ok_or("Vault is not set up")?;

    // Verify PIN
    let parsed_hash = PasswordHash::new(&config.pin_hash)
        .map_err(|e| format!("Invalid stored hash: {}", e))?;
    
    Argon2::default()
        .verify_password(pin.as_bytes(), &parsed_hash)
        .map_err(|_| "Invalid PIN".to_string())?;

    // Lock vault
    let mut session = VAULT_SESSION.lock().unwrap();
    *session = None;
    drop(session);

    // Delete entire vault directory
    let vault_dir = get_vault_dir(&app_handle);
    if vault_dir.exists() {
        fs::remove_dir_all(&vault_dir)
            .map_err(|e| format!("Failed to reset vault: {}", e))?;
    }

    Ok(())
}

/// Export the local vault configuration (hash and salt) for cloud sync
#[tauri::command]
pub fn vault_get_config(app_handle: AppHandle) -> Result<VaultConfig, String> {
    load_vault_config(&app_handle).ok_or("Vault is not set up".to_string())
}

/// Import a vault configuration from the cloud
#[tauri::command]
pub fn vault_import_config(app_handle: AppHandle, config: VaultConfig) -> Result<(), String> {
    save_vault_config(&app_handle, &config)
}

/// Wipe the local vault configuration without deleting files
#[tauri::command]
pub fn vault_wipe_local_config(app_handle: AppHandle) -> Result<(), String> {
    let config_path = get_vault_config_path(&app_handle);
    if config_path.exists() {
        std::fs::remove_file(config_path).map_err(|e| e.to_string())?;
    }
    let mut session = VAULT_SESSION.lock().unwrap();
    *session = None;
    Ok(())
}

// ============ Cloud Sync Commands ============

/// Check if an encrypted file exists locally
/// Supports both .slasshy (new) and .vault (legacy) extensions
#[tauri::command]
pub fn vault_check_local_file(app_handle: AppHandle, encrypted_name: String) -> bool {
    let files_dir = get_vault_files_dir(&app_handle);
    let file_path = files_dir.join(&encrypted_name);
    
    if file_path.exists() {
        return true;
    }
    
    // Also check for alternate extension
    let alt_path = if encrypted_name.ends_with(".slasshy") {
        files_dir.join(encrypted_name.replace(".slasshy", ".vault"))
    } else if encrypted_name.ends_with(".vault") {
        files_dir.join(encrypted_name.replace(".vault", ".slasshy"))
    } else {
        return false;
    };
    
    alt_path.exists()
}

/// Get encrypted file content as base64 for cloud upload
/// This reads the raw encrypted file (not decrypted)
#[tauri::command]
pub async fn vault_get_file_base64(
    app_handle: AppHandle,
    encrypted_name: String,
) -> Result<String, String> {
    let files_dir = get_vault_files_dir(&app_handle);
    let mut file_path = files_dir.join(&encrypted_name);
    
    // Check if file exists, try alternate extension if not
    if !file_path.exists() {
        let alt_path = if encrypted_name.ends_with(".slasshy") {
            files_dir.join(encrypted_name.replace(".slasshy", ".vault"))
        } else if encrypted_name.ends_with(".vault") {
            files_dir.join(encrypted_name.replace(".vault", ".slasshy"))
        } else {
            return Err(format!("File not found: {}", encrypted_name));
        };
        
        if alt_path.exists() {
            file_path = alt_path;
        } else {
            return Err(format!("File not found: {}", encrypted_name));
        }
    }
    
    // Read file in background thread to avoid blocking
    let path_clone = file_path.clone();
    let content = tokio::task::spawn_blocking(move || {
        fs::read(&path_clone)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to read file: {}", e))?;
    
    // Encode to base64
    use base64::{Engine, engine::general_purpose::STANDARD};
    Ok(STANDARD.encode(&content))
}

/// Save base64 content as encrypted file (for cloud download)
/// This writes the raw encrypted file (already encrypted by the original device)
#[tauri::command]
pub async fn vault_save_file_base64(
    app_handle: AppHandle,
    encrypted_name: String,
    base64_content: String,
) -> Result<(), String> {
    let files_dir = get_vault_files_dir(&app_handle);
    
    // Ensure directory exists
    fs::create_dir_all(&files_dir)
        .map_err(|e| format!("Failed to create vault directory: {}", e))?;
    
    let file_path = files_dir.join(&encrypted_name);
    
    // Decode base64 in background thread
    let content = tokio::task::spawn_blocking(move || {
        use base64::{Engine, engine::general_purpose::STANDARD};
        STANDARD.decode(&base64_content)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to decode base64: {}", e))?;
    
    // Write file
    let path_clone = file_path.clone();
    tokio::task::spawn_blocking(move || {
        fs::write(&path_clone, &content)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to write file: {}", e))?;
    
    println!("[Vault] Saved cloud file: {}", encrypted_name);
    Ok(())
}

/// Rename an encrypted file (for migration from .vault to .slasshy)
#[tauri::command]
pub fn vault_rename_file(
    app_handle: AppHandle,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    let files_dir = get_vault_files_dir(&app_handle);
    let old_path = files_dir.join(&old_name);
    let new_path = files_dir.join(&new_name);
    
    if !old_path.exists() {
        return Err(format!("File not found: {}", old_name));
    }
    
    if new_path.exists() {
        return Err(format!("Destination already exists: {}", new_name));
    }
    
    fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to rename file: {}", e))?;
    
    println!("[Vault] Renamed {} -> {}", old_name, new_name);
    Ok(())
}

/// Get the vault files directory path
#[tauri::command]
pub fn vault_get_files_dir_path(app_handle: AppHandle) -> String {
    get_vault_files_dir(&app_handle).to_string_lossy().to_string()
}

/// Get file size of an encrypted file
#[tauri::command]
pub fn vault_get_file_size(app_handle: AppHandle, encrypted_name: String) -> Result<u64, String> {
    let files_dir = get_vault_files_dir(&app_handle);
    let mut file_path = files_dir.join(&encrypted_name);
    
    // Check if file exists, try alternate extension if not
    if !file_path.exists() {
        let alt_path = if encrypted_name.ends_with(".slasshy") {
            files_dir.join(encrypted_name.replace(".slasshy", ".vault"))
        } else if encrypted_name.ends_with(".vault") {
            files_dir.join(encrypted_name.replace(".vault", ".slasshy"))
        } else {
            return Err(format!("File not found: {}", encrypted_name));
        };
        
        if alt_path.exists() {
            file_path = alt_path;
        } else {
            return Err(format!("File not found: {}", encrypted_name));
        }
    }
    
    let metadata = fs::metadata(&file_path)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;
    
    Ok(metadata.len())
}

// ============ FOLDER UPLOAD COMMANDS ============

/// Helper function to detect file type from extension
fn detect_file_type(extension: &str) -> String {
    let ext = extension.to_lowercase();
    match ext.as_str() {
        // Video formats
        "mp4" | "webm" | "mkv" | "avi" | "mov" | "wmv" | "flv" | "m4v" | "3gp" => "video".to_string(),
        // Audio formats
        "mp3" | "m4a" | "flac" | "wav" | "opus" | "ogg" | "aac" | "wma" => "audio".to_string(),
        // Image formats
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "ico" | "tiff" => "image".to_string(),
        // Default to file
        _ => "file".to_string(),
    }
}

/// Add a folder to the vault (compresses to ZIP, then encrypts)
/// Creates a single encrypted .slasshy file containing the entire folder
#[tauri::command]
pub async fn vault_add_folder(
    app_handle: AppHandle,
    folder_path: String,
    folder_name: String,
    delete_original: bool,
) -> Result<VaultFile, String> {
    println!("[Vault] Adding folder: {} from path: {}", folder_name, folder_path);
    
    // Get the encryption key
    let key = get_vault_key()?;
    
    let source_dir = PathBuf::from(&folder_path);
    if !source_dir.exists() || !source_dir.is_dir() {
        return Err("Source folder does not exist or is not a directory".to_string());
    }
    
    // Collect folder entries and calculate total size
    let mut folder_entries: Vec<VaultFolderEntry> = Vec::new();
    let mut total_original_size: u64 = 0;
    
    for entry in WalkDir::new(&source_dir)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        let relative_path = path.strip_prefix(&source_dir)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        
        if relative_path.is_empty() {
            continue; // Skip the root directory itself
        }
        
        let is_dir = path.is_dir();
        let size = if is_dir { 0 } else { 
            path.metadata().map(|m| m.len()).unwrap_or(0)
        };
        total_original_size += size;
        
        let file_name = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        
        let file_type = if is_dir {
            "directory".to_string()
        } else {
            let ext = path.extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();
            detect_file_type(&ext)
        };
        
        folder_entries.push(VaultFolderEntry {
            name: file_name,
            path: relative_path.replace("\\", "/"), // Normalize to forward slashes
            size_bytes: size,
            file_type,
            is_directory: is_dir,
        });
    }
    
    println!("[Vault] Folder has {} entries, total size: {} bytes", folder_entries.len(), total_original_size);
    
    // Generate unique encrypted filename
    let file_id = uuid::Uuid::new_v4().to_string();
    let encrypted_name = format!("{}{}", file_id, ENCRYPTED_EXTENSION);
    let dest_path = get_vault_files_dir(&app_handle).join(&encrypted_name);
    
    // Create temp ZIP file path
    let temp_dir = get_vault_dir(&app_handle).join("temp");
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;
    let temp_zip_path = temp_dir.join(format!("{}.zip", file_id));
    
    // Clone values for background task
    let source_clone = source_dir.clone();
    let temp_zip_clone = temp_zip_path.clone();
    let entries_clone = folder_entries.clone();
    
    // Compress folder to ZIP in background thread
    let zip_result = tokio::task::spawn_blocking(move || {
        let zip_file = File::create(&temp_zip_clone)
            .map_err(|e| format!("Failed to create ZIP file: {}", e))?;
        let mut zip_writer = ZipWriter::new(zip_file);
        
        let options = FileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o755);
        
        for entry in &entries_clone {
            let full_path = source_clone.join(&entry.path);
            
            if entry.is_directory {
                // Add directory entry
                zip_writer.add_directory(&entry.path, options.clone())
                    .map_err(|e| format!("Failed to add directory to ZIP: {}", e))?;
            } else {
                // Add file entry
                zip_writer.start_file(&entry.path, options.clone())
                    .map_err(|e| format!("Failed to start file in ZIP: {}", e))?;
                
                let mut file = File::open(&full_path)
                    .map_err(|e| format!("Failed to open file for ZIP: {}", e))?;
                let mut buffer = Vec::new();
                file.read_to_end(&mut buffer)
                    .map_err(|e| format!("Failed to read file for ZIP: {}", e))?;
                zip_writer.write_all(&buffer)
                    .map_err(|e| format!("Failed to write to ZIP: {}", e))?;
            }
        }
        
        zip_writer.finish()
            .map_err(|e| format!("Failed to finalize ZIP: {}", e))?;
        
        // Get ZIP file size
        let zip_size = fs::metadata(&temp_zip_clone)
            .map(|m| m.len())
            .unwrap_or(0);
        
        Ok::<u64, String>(zip_size)
    })
    .await
    .map_err(|e| format!("ZIP task failed: {}", e))??;
    
    println!("[Vault] ZIP created, size: {} bytes", zip_result);
    
    // Encrypt the ZIP file
    let temp_zip_for_encrypt = temp_zip_path.clone();
    let dest_for_encrypt = dest_path.clone();
    let key_copy = key;
    
    tokio::task::spawn_blocking(move || {
        encrypt_file(&key_copy, &temp_zip_for_encrypt, &dest_for_encrypt)
    })
    .await
    .map_err(|e| format!("Encryption task failed: {}", e))?
    .map_err(|e| format!("Encryption failed: {}", e))?;
    
    // Get encrypted file size
    let encrypted_size = fs::metadata(&dest_path)
        .map(|m| m.len())
        .unwrap_or(0);
    
    // Clean up temp ZIP
    let _ = fs::remove_file(&temp_zip_path);
    
    // Create vault file entry
    let vault_file = VaultFile {
        id: file_id,
        original_name: folder_name,
        encrypted_name,
        size_bytes: total_original_size, // Store original uncompressed size
        added_at: chrono::Utc::now().timestamp(),
        file_type: "folder".to_string(),
        thumbnail: None,
        is_folder: true,
        folder_entries: Some(folder_entries),
    };
    
    println!("[Vault] Folder encrypted successfully: {} (encrypted size: {} bytes)", vault_file.id, encrypted_size);
    
    // Optionally delete original folder
    if delete_original {
        let _ = fs::remove_dir_all(&source_dir);
        println!("[Vault] Deleted original folder");
    }
    
    Ok(vault_file)
}

/// Extract a specific file from an encrypted folder archive
/// Returns the path to a temporary decrypted file for playback/viewing
#[tauri::command]
pub async fn vault_extract_folder_file(
    app_handle: AppHandle,
    file_id: String,
    encrypted_name: String,
    file_path_in_folder: String,
) -> Result<String, String> {
    println!("[Vault] Extracting file '{}' from folder {}", file_path_in_folder, file_id);
    
    // Get the decryption key
    let key = get_vault_key()?;
    
    let encrypted_path = get_vault_files_dir(&app_handle).join(&encrypted_name);
    if !encrypted_path.exists() {
        // Try alternate extension
        let alt_name = if encrypted_name.ends_with(".slasshy") {
            encrypted_name.replace(".slasshy", ".vault")
        } else {
            encrypted_name.replace(".vault", ".slasshy")
        };
        let alt_path = get_vault_files_dir(&app_handle).join(&alt_name);
        if !alt_path.exists() {
            return Err(format!("Encrypted folder not found: {}", file_id));
        }
    }
    
    // Create temp directory for extraction
    let temp_dir = get_vault_dir(&app_handle).join("temp");
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;
    
    // Temp path for decrypted ZIP
    let temp_zip_path = temp_dir.join(format!("{}_extracted.zip", file_id));
    
    // Get the file name from the path
    let file_name = PathBuf::from(&file_path_in_folder)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "extracted_file".to_string());
    
    // Final temp path for the extracted file
    let temp_file_path = temp_dir.join(&file_name);
    
    // Clone for background task
    let encrypted_clone = encrypted_path.clone();
    let temp_zip_clone = temp_zip_path.clone();
    let temp_file_clone = temp_file_path.clone();
    let file_path_clone = file_path_in_folder.clone();
    let key_copy = key;
    
    // Decrypt and extract in background
    tokio::task::spawn_blocking(move || {
        // 1. Decrypt the encrypted file to get the ZIP
        decrypt_file(&key_copy, &encrypted_clone, &temp_zip_clone)?;
        
        // 2. Open the ZIP and extract the specific file
        let zip_file = File::open(&temp_zip_clone)
            .map_err(|e| format!("Failed to open decrypted ZIP: {}", e))?;
        let mut archive = ZipArchive::new(zip_file)
            .map_err(|e| format!("Failed to read ZIP archive: {}", e))?;
        
        // Normalize path separators
        let normalized_path = file_path_clone.replace("\\", "/");
        
        // Find the file in the archive
        let mut found_file = archive.by_name(&normalized_path)
            .map_err(|e| format!("File not found in archive: {} ({})", normalized_path, e))?;
        
        // Extract to temp file
        let mut output_file = File::create(&temp_file_clone)
            .map_err(|e| format!("Failed to create output file: {}", e))?;
        std::io::copy(&mut found_file, &mut output_file)
            .map_err(|e| format!("Failed to extract file: {}", e))?;
        
        // Clean up the decrypted ZIP (we only need the extracted file)
        let _ = fs::remove_file(&temp_zip_clone);
        
        Ok::<String, String>(temp_file_clone.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("Extraction task failed: {}", e))?
}

/// List the contents of an encrypted folder
/// This is a fallback if folder_entries weren't stored in the index
#[tauri::command]
pub async fn vault_list_folder_contents(
    app_handle: AppHandle,
    file_id: String,
    encrypted_name: String,
) -> Result<Vec<VaultFolderEntry>, String> {
    println!("[Vault] Listing folder contents for: {}", file_id);
    
    // Get the decryption key
    let key = get_vault_key()?;
    
    let encrypted_path = get_vault_files_dir(&app_handle).join(&encrypted_name);
    if !encrypted_path.exists() {
        // Try alternate extension
        let alt_name = if encrypted_name.ends_with(".slasshy") {
            encrypted_name.replace(".slasshy", ".vault")
        } else {
            encrypted_name.replace(".vault", ".slasshy")
        };
        let alt_path = get_vault_files_dir(&app_handle).join(&alt_name);
        if !alt_path.exists() {
            return Err(format!("Encrypted folder not found: {}", file_id));
        }
    }
    
    // Create temp directory
    let temp_dir = get_vault_dir(&app_handle).join("temp");
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;
    
    let temp_zip_path = temp_dir.join(format!("{}_list.zip", file_id));
    
    // Clone for background task
    let encrypted_clone = encrypted_path.clone();
    let temp_zip_clone = temp_zip_path.clone();
    let key_copy = key;
    
    tokio::task::spawn_blocking(move || {
        // Decrypt to get the ZIP
        decrypt_file(&key_copy, &encrypted_clone, &temp_zip_clone)?;
        
        // Read ZIP contents
        let zip_file = File::open(&temp_zip_clone)
            .map_err(|e| format!("Failed to open decrypted ZIP: {}", e))?;
        let mut archive = ZipArchive::new(zip_file)
            .map_err(|e| format!("Failed to read ZIP archive: {}", e))?;
        
        let mut entries: Vec<VaultFolderEntry> = Vec::new();
        
        for i in 0..archive.len() {
            let file = archive.by_index(i)
                .map_err(|e| format!("Failed to read ZIP entry: {}", e))?;
            
            let path = file.name().to_string();
            let is_dir = file.is_dir();
            let size = file.size();
            
            let name = PathBuf::from(&path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            
            // Skip empty names (root entries)
            if name.is_empty() {
                continue;
            }
            
            let file_type = if is_dir {
                "directory".to_string()
            } else {
                let ext = PathBuf::from(&path)
                    .extension()
                    .map(|e| e.to_string_lossy().to_string())
                    .unwrap_or_default();
                detect_file_type(&ext)
            };
            
            entries.push(VaultFolderEntry {
                name,
                path: path.replace("\\", "/"),
                size_bytes: size,
                file_type,
                is_directory: is_dir,
            });
        }
        
        // Clean up temp ZIP
        let _ = fs::remove_file(&temp_zip_clone);
        
        Ok::<Vec<VaultFolderEntry>, String>(entries)
    })
    .await
    .map_err(|e| format!("List task failed: {}", e))?
}
