/**
 * Vault Cloud Service
 * 
 * Provides FULLY CLOUD-BASED vault management.
 * 
 * Security Model (Updated Dec 2025):
 * - Vault files (.vault) are stored locally, encrypted with AES-256-GCM
 * - Vault INDEX (file names, metadata) is stored ONLY in Google Drive, encrypted with user's PIN
 * - Vault CONFIG (PIN hash, salt) is stored ONLY in Google Drive
 * - NOTHING vault-related exists on local disk except encrypted .vault files
 * - Complete deniability: no evidence of vault existence on local machine
 * - Even Google cannot see the index (encrypted with PIN before upload)
 */

import {
    saveVaultIndexToGDrive,
    loadVaultIndexFromGDrive,
    isGDriveAvailable,
    VaultFileEntry,
    deleteVaultFromGDrive,
    saveVaultConfigToGDrive,
    loadVaultConfigFromGDrive,
    hasVaultConfigInGDrive,
    deleteVaultConfigFromGDrive,
    VaultConfig
} from './gdriveService';
import { api } from './api';

// In-memory cache of vault state (only exists while vault is unlocked)
let cachedVaultIndex: VaultFileEntry[] | null = null;
let cachedPin: string | null = null;
let cachedConfig: VaultConfig | null = null;

// ==================== VAULT STATUS ====================

/**
 * Check if vault is set up (config exists in cloud)
 */
export async function isVaultSetup(): Promise<boolean> {
    console.log('[VaultCloud] Checking if vault is set up in cloud...');
    const hasConfig = await hasVaultConfigInGDrive();
    console.log('[VaultCloud] hasVaultConfigInGDrive result:', hasConfig);
    return hasConfig;
}

/**
 * Get vault status from cloud
 */
export async function getVaultCloudStatus(): Promise<{
    isSetup: boolean;
    isUnlocked: boolean;
    config: VaultConfig | null;
}> {
    // If vault is unlocked, use cached config to avoid network call
    if (cachedConfig !== null) {
        return {
            isSetup: true,
            isUnlocked: cachedPin !== null,
            config: cachedConfig
        };
    }

    // Otherwise, fetch from cloud
    const config = await loadVaultConfigFromGDrive();
    return {
        isSetup: config !== null,
        isUnlocked: cachedPin !== null,
        config
    };
}

// ==================== VAULT SETUP ====================

/**
 * Set up the vault with a new PIN
 * Creates the vault config (PIN hash) in Google Drive
 * The actual PIN hashing is done by calling the Rust backend
 */
export async function setupVaultCloud(pin: string): Promise<void> {
    if (!isGDriveAvailable()) {
        throw new Error('Google Drive is required for vault. Please sign in first.');
    }

    if (pin.length < 4) {
        throw new Error('PIN must be at least 4 digits');
    }

    // Check if already set up
    if (await hasVaultConfigInGDrive()) {
        throw new Error('Vault is already set up. Reset it first to change PIN.');
    }

    // We need to hash the PIN with Argon2
    // Since Argon2 isn't available in browser, we'll use PBKDF2 with high iterations
    // This provides strong security while being browser-compatible
    const salt = generateSalt();
    const pinHash = await hashPinWithPBKDF2(pin, salt);

    const config: VaultConfig = {
        pin_hash: pinHash,
        salt: salt,
        created_at: Math.floor(Date.now() / 1000),
        last_accessed: null
    };

    // Save config to Google Drive
    await saveVaultConfigToGDrive(config);

    // CRITICAL: Also set up the Rust backend vault session
    // This creates the local vault directory and unlocks the encryption key in memory
    try {
        // Check if local vault already exists
        const localStatus = await api.vaultGetStatus();
        console.log('[VaultCloud] Local vault status during setup:', localStatus);

        if (localStatus.is_setup) {
            await api.vaultUnlock(pin);
            console.log('[VaultCloud] Rust backend vault unlocked (was already set up)');
        } else {
            await api.vaultSetup(pin);
            console.log('[VaultCloud] Rust backend vault setup complete');
        }

        // Capture the Rust config to sync to cloud
        const rustConfig = await api.vaultGetConfig();
        config.rust_pin_hash = rustConfig.pin_hash;
        config.rust_salt = rustConfig.salt;

        // Re-save config to Google Drive with Rust details
        await saveVaultConfigToGDrive(config);
        console.log('[VaultCloud] Vault config with Rust details synced to cloud');

        // Ephemeral Mode: Wipe local config immediately after session is established
        // This ensures no traces are left on disk
        await api.vaultWipeLocalConfig();
        console.log('[VaultCloud] Local config wiped for security (ephemeral mode)');
    } catch (backendErr: unknown) {
        const errMsg = backendErr instanceof Error ? backendErr.message : String(backendErr);
        console.warn('[VaultCloud] Backend vault setup encountered issues:', errMsg);
    }

    // Initialize empty vault index in cloud
    cachedPin = pin;
    cachedConfig = config;
    cachedVaultIndex = [];
    await saveVaultIndexToGDrive([], pin);

    console.log('[VaultCloud] Vault setup complete');
}

/**
 * Unlock the vault with PIN
 * Verifies PIN against cloud config and loads the encrypted index
 */
export async function unlockVaultCloud(pin: string): Promise<VaultFileEntry[]> {
    if (!isGDriveAvailable()) {
        throw new Error('Google Drive is required for vault. Please sign in first.');
    }

    // Load config from cloud
    const config = await loadVaultConfigFromGDrive();
    if (!config) {
        throw new Error('Vault is not set up. Please set up the vault first.');
    }

    // Verify PIN using PBKDF2
    const computedHash = await hashPinWithPBKDF2(pin, config.salt);
    if (computedHash !== config.pin_hash) {
        throw new Error('Invalid PIN');
    }

    // PIN is correct - unlock the vault
    cachedPin = pin;
    cachedConfig = config;

    // Update last accessed
    config.last_accessed = Math.floor(Date.now() / 1000);
    await saveVaultConfigToGDrive(config);

    // CRITICAL: Also unlock the Rust backend vault session
    // This sets up the encryption key in memory for file operations
    // 
    // The local backend might have:
    // 1. No vault set up (need to call vaultSetup)
    // 2. Vault set up with SAME PIN (call vaultUnlock)
    // 3. Vault set up with DIFFERENT PIN (complex - shouldn't happen if using same cloud PIN)
    try {
        // First check if local vault is set up
        const localStatus = await api.vaultGetStatus();
        console.log('[VaultCloud] Local vault status:', localStatus);

        if (localStatus.is_setup) {
            // Local vault exists, try to unlock it
            try {
                await api.vaultUnlock(pin);
                console.log('[VaultCloud] Rust backend vault unlocked');

                // MIGRATION: If successfully unlocked but cloud lacks rust details, sync them now
                if (!config.rust_pin_hash || !config.rust_salt) {
                    try {
                        const rustConfig = await api.vaultGetConfig();
                        config.rust_pin_hash = rustConfig.pin_hash;
                        config.rust_salt = rustConfig.salt;
                        await saveVaultConfigToGDrive(config);
                        console.log('[VaultCloud] Migrated local vault config to cloud');
                    } catch (e) {
                        console.warn('[VaultCloud] Could not migrate backend config to cloud:', e);
                    }
                }
            } catch (unlockErr: unknown) {
                const errMsg = unlockErr instanceof Error ? unlockErr.message : String(unlockErr);

                // If unlock fails with "Invalid PIN", we have a mismatch
                if (errMsg.includes('Invalid PIN')) {
                    if (config.rust_pin_hash && config.rust_salt) {
                        console.log('[VaultCloud] PIN mismatch locally, healing from cloud config...');
                        await api.vaultImportConfig({
                            pin_hash: config.rust_pin_hash,
                            salt: config.rust_salt,
                            created_at: config.created_at,
                            last_accessed: config.last_accessed
                        });
                        await api.vaultUnlock(pin);
                        console.log('[VaultCloud] Rust backend vault healed and unlocked');
                    } else if (localStatus.file_count === 0) {
                        // SAFE AUTO-HEALING: Local vault is empty and no cloud recovery data.
                        // Since there are no files, we can safely wipe and re-setup with the verified PIN.
                        console.log('[VaultCloud] PIN mismatch and local vault is empty. Re-setupping...');
                        await api.vaultWipeLocalConfig();
                        await api.vaultSetup(pin);

                        // Capture and sync the new config immediately
                        const rustConfig = await api.vaultGetConfig();
                        config.rust_pin_hash = rustConfig.pin_hash;
                        config.rust_salt = rustConfig.salt;
                        await saveVaultConfigToGDrive(config);

                        console.log('[VaultCloud] Rust backend vault re-initialized and synced');
                    } else {
                        // UNMATCHED AND NOT EMPTY: User has files locally but PIN is different from cloud.
                        // We cannot heal automatically without risking data loss.
                        console.error('[VaultCloud] Local vault PIN differs from cloud and has files!');
                        console.warn('[VaultCloud] Continuing in limited mode - file operations will fail');
                        // Don't throw here, let them see the index, but operations will trigger errors
                    }
                } else {
                    throw unlockErr;
                }
            }
        } else {
            // No local vault
            if (config.rust_pin_hash && config.rust_salt) {
                // Restore local config from cloud
                console.log('[VaultCloud] Initializing local vault from cloud configuration...');
                await api.vaultImportConfig({
                    pin_hash: config.rust_pin_hash,
                    salt: config.rust_salt,
                    created_at: config.created_at,
                    last_accessed: config.last_accessed
                });
                await api.vaultUnlock(pin);
            } else {
                // Fallback to fresh setup if no cloud config details (old vaults)
                await api.vaultSetup(pin);
            }
            console.log('[VaultCloud] Rust backend vault set up and unlocked');
        }

        // Ephemeral Mode: Wipe local config immediately after session is established
        await api.vaultWipeLocalConfig();
        console.log('[VaultCloud] Local config wiped for security (ephemeral mode)');
    } catch (backendErr: unknown) {
        const errMsg = backendErr instanceof Error ? backendErr.message : String(backendErr);
        console.error('[VaultCloud] Backend vault initialization failed:', errMsg);

        // If it's just a PIN mismatch with the backend, don't block access to the vault (since cloud PIN is verified)
        // This allows users to see their files even if the backend is currently out of sync
        if (errMsg.toLowerCase().includes('invalid pin')) {
            console.warn('[VaultCloud] Local backend rejects PIN, but Cloud PIN is valid. Allowing entry in limited mode.');
            // We don't throw, so execution continues to loading the index
        } else if (errMsg.toLowerCase().includes('already set up')) {
            // This can happen if is_setup check had a race condition
            console.warn('[VaultCloud] Backend reported "already set up", trying to unlock anyway...');
            try {
                await api.vaultUnlock(pin);
            } catch (unlockErr) {
                console.error('[VaultCloud] Follow-up unlock failed:', unlockErr);
            }
        } else {
            // For truly fatal errors (IO, binary missing, etc.), we must throw
            throw new Error(`Vault backend fatal error: ${errMsg}`);
        }
    }

    // Load the encrypted vault index
    try {
        const cloudIndex = await loadVaultIndexFromGDrive(pin);
        if (cloudIndex) {
            console.log(`[VaultCloud] Loaded ${cloudIndex.length} entries from encrypted cloud index`);
            cachedVaultIndex = cloudIndex;
            return cloudIndex;
        }
    } catch (e) {
        console.error('[VaultCloud] Failed to load cloud index:', e);
    }

    // If no index exists, start with empty
    console.log('[VaultCloud] No cloud index found, starting fresh');
    cachedVaultIndex = [];
    return [];
}

/**
 * Lock the vault (clear all cached data)
 */
export function lockVaultCloud(): void {
    clearVaultCloud();
    console.log('[VaultCloud] Vault locked');
}

// ==================== PIN MANAGEMENT ====================

/**
 * Change the vault PIN
 * Re-encrypts the vault index with the new PIN
 */
export async function changeVaultPin(currentPin: string, newPin: string): Promise<void> {
    if (!isGDriveAvailable()) {
        throw new Error('Google Drive is required');
    }

    if (newPin.length < 4) {
        throw new Error('New PIN must be at least 4 digits');
    }

    // Load and verify current config
    const config = await loadVaultConfigFromGDrive();
    if (!config) {
        throw new Error('Vault is not set up');
    }

    // Verify current PIN
    const currentHash = await hashPinWithPBKDF2(currentPin, config.salt);
    if (currentHash !== config.pin_hash) {
        throw new Error('Current PIN is incorrect');
    }

    // Load current index with current PIN
    const currentIndex = await loadVaultIndexFromGDrive(currentPin);

    // Generate new salt and hash for new PIN (JS side)
    const newSalt = generateSalt();
    const newHash = await hashPinWithPBKDF2(newPin, newSalt);

    // Update Rust backend PIN
    await api.vaultChangePin(currentPin, newPin);

    // Capture the new Rust config
    const rustConfig = await api.vaultGetConfig();

    // Update cloud config with both JS and Rust new PIN hashes
    const newConfig: VaultConfig = {
        pin_hash: newHash,
        salt: newSalt,
        rust_pin_hash: rustConfig.pin_hash,
        rust_salt: rustConfig.salt,
        created_at: config.created_at,
        last_accessed: Math.floor(Date.now() / 1000)
    };

    // Save new config to cloud
    await saveVaultConfigToGDrive(newConfig);

    // Re-encrypt index with new PIN
    if (currentIndex && currentIndex.length > 0) {
        await saveVaultIndexToGDrive(currentIndex, newPin);
    }

    // Update cache
    cachedPin = newPin;
    cachedConfig = newConfig;

    console.log('[VaultCloud] PIN changed and synced successfully across all layers');
}

/**
 * Reset the vault (delete everything from cloud)
 */
export async function resetVaultCloud(pin: string): Promise<void> {
    if (!isGDriveAvailable()) {
        throw new Error('Google Drive is required');
    }

    // Load and verify current config
    const config = await loadVaultConfigFromGDrive();
    if (!config) {
        throw new Error('Vault is not set up');
    }

    // Verify PIN
    const pinHash = await hashPinWithPBKDF2(pin, config.salt);
    if (pinHash !== config.pin_hash) {
        throw new Error('Invalid PIN');
    }

    // Delete everything from cloud
    await deleteVaultConfigFromGDrive();
    await deleteVaultFromGDrive();

    // Clear cache
    clearVaultCloud();

    console.log('[VaultCloud] Vault reset complete');
}

// ==================== VAULT INDEX MANAGEMENT ====================

/**
 * Initialize the vault cloud service (for backward compatibility)
 * Use unlockVaultCloud instead for new code
 */
export async function initVaultCloud(pin: string): Promise<VaultFileEntry[]> {
    return await unlockVaultCloud(pin);
}

/**
 * Get the current vault index (from memory cache)
 * Returns null if vault is not initialized
 */
export function getVaultIndex(): VaultFileEntry[] | null {
    return cachedVaultIndex;
}

/**
 * Add a file entry to the vault index
 * Automatically syncs to Google Drive
 */
export async function addToVaultIndex(entry: VaultFileEntry): Promise<void> {
    if (!cachedVaultIndex || !cachedPin) {
        throw new Error('Vault not initialized. Call unlockVaultCloud first.');
    }

    // Check for duplicates
    const existingIndex = cachedVaultIndex.findIndex(e => e.id === entry.id);
    if (existingIndex >= 0) {
        // Update existing entry
        cachedVaultIndex[existingIndex] = entry;
    } else {
        // Add new entry
        cachedVaultIndex.push(entry);
    }

    // Sync to cloud
    await syncToCloud();
}

/**
 * Remove a file entry from the vault index
 * Automatically syncs to Google Drive
 */
export async function removeFromVaultIndex(fileId: string): Promise<void> {
    if (!cachedVaultIndex || !cachedPin) {
        throw new Error('Vault not initialized. Call unlockVaultCloud first.');
    }

    cachedVaultIndex = cachedVaultIndex.filter(e => e.id !== fileId);

    // Sync to cloud
    await syncToCloud();
}

/**
 * Update the entire vault index
 * Automatically syncs to Google Drive
 */
export async function updateVaultIndex(entries: VaultFileEntry[]): Promise<void> {
    if (!cachedPin) {
        throw new Error('Vault not initialized. Call unlockVaultCloud first.');
    }

    cachedVaultIndex = entries;

    // Sync to cloud
    await syncToCloud();
}

/**
 * Force sync the current index to Google Drive
 */
export async function syncToCloud(): Promise<void> {
    if (!cachedVaultIndex || !cachedPin) {
        console.warn('[VaultCloud] Cannot sync - vault not initialized');
        return;
    }

    if (!isGDriveAvailable()) {
        console.warn('[VaultCloud] Google Drive not available - skipping sync');
        return;
    }

    try {
        await saveVaultIndexToGDrive(cachedVaultIndex, cachedPin);
        console.log(`[VaultCloud] Synced ${cachedVaultIndex.length} entries to encrypted cloud`);
    } catch (e) {
        console.error('[VaultCloud] Failed to sync to cloud:', e);
        throw e;
    }
}

/**
 * Clear the vault cloud cache (on lock or logout)
 */
export function clearVaultCloud(): void {
    cachedVaultIndex = null;
    cachedPin = null;
    cachedConfig = null;
    console.log('[VaultCloud] Cache cleared');
}

/**
 * Delete the vault index from Google Drive
 * Used when resetting the vault
 */
export async function deleteVaultCloud(): Promise<void> {
    clearVaultCloud();
    await deleteVaultFromGDrive();
    await deleteVaultConfigFromGDrive();
    console.log('[VaultCloud] Cloud vault deleted');
}

/**
 * Check if vault cloud is initialized (unlocked)
 */
export function isVaultCloudInitialized(): boolean {
    return cachedVaultIndex !== null && cachedPin !== null;
}

/**
 * Get the number of files in the vault (from cache)
 */
export function getVaultFileCount(): number {
    return cachedVaultIndex?.length ?? 0;
}

/**
 * Check if Google Drive is required for vault
 * Returns true - vault now requires Google Drive for ALL storage
 */
export function isCloudRequired(): boolean {
    return true;
}

// ==================== CRYPTO UTILITIES ====================

/**
 * Generate a random salt for password hashing
 */
function generateSalt(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash PIN using PBKDF2 (browser-compatible, secure)
 * Uses 100,000 iterations for brute-force resistance
 */
async function hashPinWithPBKDF2(pin: string, salt: string): Promise<string> {
    const encoder = new TextEncoder();
    const pinData = encoder.encode(pin);
    const saltData = encoder.encode(salt);

    // Import PIN as key material
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        pinData,
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );

    // Derive 256 bits using PBKDF2
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: saltData,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );

    // Convert to hex string
    const hashArray = Array.from(new Uint8Array(derivedBits));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
    // Status
    isVaultSetup,
    getVaultCloudStatus,
    // Setup & Auth
    setupVaultCloud,
    unlockVaultCloud,
    lockVaultCloud,
    // PIN Management
    changeVaultPin,
    resetVaultCloud,
    // Index Management
    initVaultCloud,
    getVaultIndex,
    addToVaultIndex,
    removeFromVaultIndex,
    updateVaultIndex,
    syncToCloud,
    clearVaultCloud,
    deleteVaultCloud,
    isVaultCloudInitialized,
    getVaultFileCount,
    isCloudRequired
};

