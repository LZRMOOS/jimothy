use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Emitter, State};
use zeroize::Zeroize;

use crate::crypto::{self, VaultConfig};
use crate::notes::Note;
use crate::storage;
use crate::watcher::FileWatcher;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum VaultStatus {
    /// No vault configured, notes stored as plaintext
    Plaintext,
    /// Vault exists but is locked (key not in memory)
    Locked,
    /// Vault is unlocked (key held in memory)
    Unlocked,
}

pub struct AppState {
    pub notes_folder: Mutex<Option<PathBuf>>,
    pub notes: Mutex<Vec<Note>>,
    pub watcher: Mutex<Option<FileWatcher>>,
    pub vault_key: Mutex<Option<Vec<u8>>>,
    pub vault_status: Mutex<VaultStatus>,
    pub password_hash: Mutex<Option<[u8; 32]>>,
    pub protection_key: Mutex<Option<Vec<u8>>>,
    pub protection_hash: Mutex<Option<[u8; 32]>>,
    /// The ID of the note currently being edited in the frontend.
    pub active_note_id: Mutex<Option<String>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            notes_folder: Mutex::new(None),
            notes: Mutex::new(Vec::new()),
            watcher: Mutex::new(None),
            vault_key: Mutex::new(None),
            vault_status: Mutex::new(VaultStatus::Plaintext),
            password_hash: Mutex::new(None),
            protection_key: Mutex::new(None),
            protection_hash: Mutex::new(None),
            active_note_id: Mutex::new(None),
        }
    }

    pub fn folder(&self) -> Result<PathBuf, String> {
        self.notes_folder
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "No notes folder set".to_string())
    }
}

fn config_path(folder: &Path, filename: &str) -> PathBuf {
    folder.join(".scratch").join(filename)
}

fn load_config(folder: &Path, filename: &str) -> Option<VaultConfig> {
    let path = config_path(folder, filename);
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_config(folder: &Path, filename: &str, config: &VaultConfig) -> Result<(), String> {
    let scratch_dir = folder.join(".scratch");
    fs::create_dir_all(&scratch_dir)
        .map_err(|e| format!("Failed to create .scratch dir: {}", e))?;
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    let dest = config_path(folder, filename);
    let temp = scratch_dir.join(format!(".tmp-{}", filename));
    fs::write(&temp, &json)
        .map_err(|e| format!("Failed to write config temp file: {}", e))?;
    fs::rename(&temp, &dest).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("Failed to rename config file: {}", e)
    })?;
    Ok(())
}

fn load_vault_config(folder: &Path) -> Option<VaultConfig> {
    load_config(folder, "vault.json")
}

fn save_vault_config(folder: &Path, config: &VaultConfig) -> Result<(), String> {
    save_config(folder, "vault.json", config)
}

fn load_protection_config(folder: &Path) -> Option<VaultConfig> {
    load_config(folder, "protection.json")
}

fn save_protection_config(folder: &Path, config: &VaultConfig) -> Result<(), String> {
    save_config(folder, "protection.json", config)
}

fn verify_and_derive(password: &str, config: &VaultConfig) -> Result<Vec<u8>, String> {
    let key = crypto::derive_key(password, &config.kdf)?;
    if !crypto::verify_key(&key, &config.verification_record)? {
        return Err("Invalid password".to_string());
    }
    Ok(key)
}

fn store_hash(mutex: &Mutex<Option<[u8; 32]>>, password: &str) {
    let hash: [u8; 32] = Sha256::digest(password.as_bytes()).into();
    *mutex.lock().unwrap() = Some(hash);
}

#[derive(serde::Serialize)]
pub struct NoteDto {
    pub id: String,
    pub title: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
    pub encrypted: bool,
    pub codex: Option<String>,
    pub archived: bool,
}

impl From<&Note> for NoteDto {
    fn from(note: &Note) -> Self {
        NoteDto {
            id: note.id.clone(),
            title: note.title.clone(),
            body: note.body.clone(),
            created_at: note.created_at.to_rfc3339(),
            updated_at: note.updated_at.to_rfc3339(),
            encrypted: note.encrypted,
            codex: note.codex.clone(),
            archived: note.archived,
        }
    }
}

#[tauri::command]
pub fn set_notes_folder(
    path: String,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let folder = PathBuf::from(&path);
    storage::validate_folder(&folder)?;
    storage::ensure_quicknotes_dirs(&folder)?;

    // Clean up orphaned temp files from previous sessions
    storage::cleanup_temp_files(&folder);

    // Detect vault status
    if load_vault_config(&folder).is_some() {
        // Vault exists but is locked until password is provided
        *state.vault_status.lock().unwrap() = VaultStatus::Locked;
        *state.vault_key.lock().unwrap() = None;
        *state.notes.lock().unwrap() = Vec::new();
    } else {
        *state.vault_status.lock().unwrap() = VaultStatus::Plaintext;
        let (mut notes, dropbox_conflicts) = storage::load_notes_deduped(&folder);
        // Also load protected note stubs (title visible, body encrypted)
        let protected_stubs = storage::load_protected_note_stubs(&folder);
        for stub in protected_stubs {
            if !notes.iter().any(|n| n.id == stub.id) {
                notes.push(stub);
            }
        }
        notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        *state.notes.lock().unwrap() = notes;
        if !dropbox_conflicts.is_empty() {
            let _ = app_handle.emit("dropbox-conflict", ());
        }
    }

    *state.notes_folder.lock().unwrap() = Some(folder.clone());

    if let Ok(watcher) = FileWatcher::new(folder, app_handle) {
        *state.watcher.lock().unwrap() = Some(watcher);
    }

    Ok(())
}

#[tauri::command]
pub fn get_notes_folder(state: State<'_, AppState>) -> Option<String> {
    state
        .notes_folder
        .lock()
        .unwrap()
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_notes(state: State<'_, AppState>) -> Vec<NoteDto> {
    state
        .notes
        .lock()
        .unwrap()
        .iter()
        .map(NoteDto::from)
        .collect()
}

#[tauri::command]
pub fn create_note(title: String, codex: Option<String>, state: State<'_, AppState>) -> Result<NoteDto, String> {
    let folder = state.folder()?;

    let vault_status = state.vault_status.lock().unwrap().clone();

    let mut note = Note::new(title);
    note.codex = codex;

    let path = match vault_status {
        VaultStatus::Unlocked => {
            let key = state.vault_key.lock().unwrap();
            let key = key.as_ref().ok_or("Vault key not available")?;
            note.encrypted = true;
            storage::write_note_encrypted(&folder, &note, key)?
        }
        VaultStatus::Locked => {
            return Err("Vault is locked. Unlock before creating notes.".to_string());
        }
        VaultStatus::Plaintext => storage::write_note_atomic(&folder, &note)?,
    };

    note.file_path = path.to_string_lossy().to_string();

    let dto = NoteDto::from(&note);
    state.notes.lock().unwrap().insert(0, note);
    Ok(dto)
}

#[tauri::command]
pub fn save_note(
    id: String,
    title: String,
    body: String,
    codex: Option<String>,
    state: State<'_, AppState>,
) -> Result<NoteDto, String> {
    let folder = state.folder()?;

    let vault_status = state.vault_status.lock().unwrap().clone();

    let mut notes = state.notes.lock().unwrap();
    let note = notes
        .iter_mut()
        .find(|n| n.id == id)
        .ok_or("Note not found")?;

    let old_path = PathBuf::from(&note.file_path);

    note.title = title;
    note.body = body;
    note.codex = codex;
    note.updated_at = Utc::now();

    let new_path = match vault_status {
        VaultStatus::Unlocked => {
            let key = state.vault_key.lock().unwrap();
            let key = key.as_ref().ok_or("Vault key not available")?;
            note.encrypted = true;
            storage::write_note_encrypted(&folder, note, key)?
        }
        VaultStatus::Locked => {
            return Err("Vault is locked. Unlock before saving.".to_string());
        }
        VaultStatus::Plaintext => storage::write_note_atomic(&folder, note)?,
    };

    if old_path != new_path && old_path.exists() {
        let _ = std::fs::remove_file(&old_path);
    }

    note.file_path = new_path.to_string_lossy().to_string();

    Ok(NoteDto::from(&*note))
}

#[tauri::command]
pub fn set_note_archived(id: String, archived: bool, state: State<'_, AppState>) -> Result<NoteDto, String> {
    let folder = state.folder()?;
    let vault_status = state.vault_status.lock().unwrap().clone();

    let mut notes = state.notes.lock().unwrap();
    let note = notes
        .iter_mut()
        .find(|n| n.id == id)
        .ok_or("Note not found")?;

    note.archived = archived;

    match vault_status {
        VaultStatus::Unlocked => {
            let key = state.vault_key.lock().unwrap();
            let key = key.as_ref().ok_or("Vault key not available")?;
            storage::write_note_encrypted(&folder, note, key)?;
        }
        VaultStatus::Locked => {
            return Err("Vault is locked. Unlock before saving.".to_string());
        }
        VaultStatus::Plaintext => { storage::write_note_atomic(&folder, note)?; }
    };

    Ok(NoteDto::from(&*note))
}

#[tauri::command]
pub fn delete_note(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?;

    let mut notes = state.notes.lock().unwrap();
    let idx = notes
        .iter()
        .position(|n| n.id == id)
        .ok_or("Note not found")?;

    let note = &notes[idx];
    storage::delete_note_file(&folder, note)?;
    notes.remove(idx);

    Ok(())
}

#[tauri::command]
pub fn reload_notes(state: State<'_, AppState>, app_handle: AppHandle) -> Result<Vec<NoteDto>, String> {
    let folder = state.notes_folder.lock().unwrap().clone();
    if let Some(folder) = folder {
        storage::check_folder_available(&folder).map_err(|e| {
            let _ = app_handle.emit("folder-unavailable", ());
            e
        })?;

        let vault_status = state.vault_status.lock().unwrap().clone();
        match vault_status {
            VaultStatus::Locked => {
                Ok(Vec::new())
            }
            VaultStatus::Unlocked => {
                let key = state.vault_key.lock().unwrap().clone();
                if let Some(key) = key {
                    let notes = storage::load_encrypted_notes_from_folder(&folder, &key);
                    let dtos: Vec<NoteDto> = notes.iter().map(NoteDto::from).collect();
                    *state.notes.lock().unwrap() = notes;
                    Ok(dtos)
                } else {
                    Ok(Vec::new())
                }
            }
            VaultStatus::Plaintext => {
                let (mut notes, dropbox_conflicts) = storage::load_notes_deduped(&folder);
                if !dropbox_conflicts.is_empty() {
                    let _ = app_handle.emit("dropbox-conflict", ());
                }
                let protected_stubs = storage::load_protected_note_stubs(&folder);
                for stub in protected_stubs {
                    if !notes.iter().any(|n| n.id == stub.id) {
                        notes.push(stub);
                    }
                }
                notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
                let dtos: Vec<NoteDto> = notes.iter().map(NoteDto::from).collect();
                *state.notes.lock().unwrap() = notes;
                Ok(dtos)
            }
        }
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub fn get_default_notes_path() -> String {
    if let Some(home) = dirs::home_dir() {
        let dropbox_path = home.join("Library/CloudStorage/Dropbox/Notes");
        if dropbox_path.exists() {
            return dropbox_path.to_string_lossy().to_string();
        }
        let dropbox_legacy = home.join("Dropbox/Notes");
        if dropbox_legacy.exists() {
            return dropbox_legacy.to_string_lossy().to_string();
        }
        home.join("Jimothy").to_string_lossy().to_string()
    } else {
        "Jimothy".to_string()
    }
}

#[tauri::command]
pub fn get_app_settings() -> Result<String, String> {
    let config_dir = dirs::config_dir().ok_or("Cannot find config directory")?;
    let settings_path = config_dir.join("jimothy").join("settings.json");
    if settings_path.exists() {
        std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings: {}", e))
    } else {
        Ok("{}".to_string())
    }
}

#[tauri::command]
pub fn save_app_settings(settings_json: String) -> Result<(), String> {
    let config_dir = dirs::config_dir().ok_or("Cannot find config directory")?;
    let settings_dir = config_dir.join("jimothy");
    std::fs::create_dir_all(&settings_dir)
        .map_err(|e| format!("Failed to create settings dir: {}", e))?;
    let settings_path = settings_dir.join("settings.json");
    let temp_path = settings_dir.join("settings.json.tmp");
    fs::write(&temp_path, &settings_json)
        .map_err(|e| format!("Failed to write settings: {}", e))?;
    fs::rename(&temp_path, &settings_path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("Failed to rename settings file: {}", e)
    })?;
    Ok(())
}

#[tauri::command]
#[allow(dead_code)]
pub fn get_preferences(state: State<'_, AppState>) -> Result<String, String> {
    let folder = state.folder()?;
    let prefs_path = folder.join(".scratch").join("preferences.json");
    if prefs_path.exists() {
        fs::read_to_string(&prefs_path)
            .map_err(|e| format!("Failed to read preferences: {}", e))
    } else {
        Ok("{}".to_string())
    }
}

#[tauri::command]
#[allow(dead_code)]
pub fn save_preferences(prefs_json: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?;
    let scratch_dir = folder.join(".scratch");
    fs::create_dir_all(&scratch_dir)
        .map_err(|e| format!("Failed to create .scratch dir: {}", e))?;
    let dest = scratch_dir.join("preferences.json");
    let temp = scratch_dir.join(".tmp-preferences.json");
    fs::write(&temp, &prefs_json)
        .map_err(|e| format!("Failed to write preferences: {}", e))?;
    fs::rename(&temp, &dest).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("Failed to rename preferences file: {}", e)
    })?;
    Ok(())
}

#[tauri::command]
pub fn setup_vault(password: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?;

    // Check if vault already exists
    if load_vault_config(&folder).is_some() {
        return Err("Vault already exists. Use change_vault_password to update.".to_string());
    }

    // Create vault config and derive key
    let (config, key) = crypto::create_vault_config(&password)?;

    // Encrypt all existing plaintext notes
    let notes = storage::load_notes_from_folder(&folder);
    let mut encrypted_notes = Vec::new();

    for mut note in notes {
        note.encrypted = true;
        let path = storage::write_note_encrypted(&folder, &note, &key)?;
        // Remove old plaintext file
        if !note.file_path.is_empty() {
            let old_path = PathBuf::from(&note.file_path);
            if old_path.exists() {
                let _ = fs::remove_file(&old_path);
            }
        }
        note.file_path = path.to_string_lossy().to_string();
        encrypted_notes.push(note);
    }

    // Save vault config
    save_vault_config(&folder, &config)?;

    // Update state
    store_hash(&state.password_hash, &password);
    *state.vault_key.lock().unwrap() = Some(key);
    *state.vault_status.lock().unwrap() = VaultStatus::Unlocked;
    *state.notes.lock().unwrap() = encrypted_notes;

    Ok(())
}

#[tauri::command]
pub fn unlock_vault(password: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?;

    let config = load_vault_config(&folder).ok_or("No vault configured")?;
    let key = verify_and_derive(&password, &config)?;

    // Load and decrypt all notes
    let notes = storage::load_encrypted_notes_from_folder(&folder, &key);

    store_hash(&state.password_hash, &password);

    // Update state
    *state.vault_key.lock().unwrap() = Some(key);
    *state.vault_status.lock().unwrap() = VaultStatus::Unlocked;
    *state.notes.lock().unwrap() = notes;

    Ok(())
}

#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>) -> Result<(), String> {
    let status = state.vault_status.lock().unwrap().clone();
    if status == VaultStatus::Plaintext {
        return Err("No vault to lock".to_string());
    }

    // Zeroize and clear all sensitive material from memory
    if let Some(ref mut key) = *state.vault_key.lock().unwrap() {
        key.zeroize();
    }
    *state.vault_key.lock().unwrap() = None;
    *state.password_hash.lock().unwrap() = None;
    if let Some(ref mut key) = *state.protection_key.lock().unwrap() {
        key.zeroize();
    }
    *state.protection_key.lock().unwrap() = None;
    *state.protection_hash.lock().unwrap() = None;
    *state.vault_status.lock().unwrap() = VaultStatus::Locked;
    *state.notes.lock().unwrap() = Vec::new();

    Ok(())
}

#[tauri::command]
pub fn get_vault_status(state: State<'_, AppState>) -> String {
    let status = state.vault_status.lock().unwrap().clone();
    match status {
        VaultStatus::Plaintext => "plaintext".to_string(),
        VaultStatus::Locked => "locked".to_string(),
        VaultStatus::Unlocked => "unlocked".to_string(),
    }
}

#[tauri::command]
pub fn verify_password(mut password: String, state: State<'_, AppState>) -> Result<bool, String> {
    // Fast path: compare SHA-256 hash against stored hash (constant-time)
    if let Some(ref stored_hash) = *state.password_hash.lock().unwrap() {
        let hash: [u8; 32] = Sha256::digest(password.as_bytes()).into();
        let result = hash.ct_eq(stored_hash).into();
        password.zeroize();
        return Ok(result);
    }

    // Slow path: full Argon2 derivation
    let folder = state.folder()?;
    let config = load_vault_config(&folder).ok_or("No vault configured")?;
    let key = crypto::derive_key(&password, &config.kdf)?;
    password.zeroize();
    crypto::verify_key(&key, &config.verification_record)
}

#[tauri::command]
pub fn set_active_note(id: Option<String>, state: State<'_, AppState>) {
    *state.active_note_id.lock().unwrap() = id;
}

#[tauri::command]
pub fn change_vault_password(
    current: String,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let folder = state.folder()?;

    let config = load_vault_config(&folder).ok_or("No vault configured")?;

    let old_key = verify_and_derive(&current, &config)?;

    // Create new vault config with new password
    let (new_config, new_key) = crypto::create_vault_config(&new_password)?;

    // Re-encrypt all notes with new key
    let notes = storage::load_encrypted_notes_from_folder(&folder, &old_key);
    let mut re_encrypted_notes = Vec::new();

    for mut note in notes {
        // Remove old encrypted file
        if !note.file_path.is_empty() {
            let old_path = PathBuf::from(&note.file_path);
            if old_path.exists() {
                let _ = fs::remove_file(&old_path);
            }
        }
        // Write with new key
        let path = storage::write_note_encrypted(&folder, &note, &new_key)?;
        note.file_path = path.to_string_lossy().to_string();
        re_encrypted_notes.push(note);
    }

    // Save new vault config
    save_vault_config(&folder, &new_config)?;

    // Update state
    *state.vault_key.lock().unwrap() = Some(new_key);
    *state.vault_status.lock().unwrap() = VaultStatus::Unlocked;
    *state.notes.lock().unwrap() = re_encrypted_notes;

    Ok(())
}

#[tauri::command]
pub fn disable_vault(password: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?;

    let config = load_vault_config(&folder).ok_or("No vault configured")?;

    let key = verify_and_derive(&password, &config)?;

    // Load and decrypt all notes
    let notes = storage::load_encrypted_notes_from_folder(&folder, &key);
    let mut plaintext_notes = Vec::new();

    for mut note in notes {
        // Remove old encrypted file
        if !note.file_path.is_empty() {
            let old_path = PathBuf::from(&note.file_path);
            if old_path.exists() {
                let _ = fs::remove_file(&old_path);
            }
        }
        // Write as plaintext markdown
        note.encrypted = false;
        let path = storage::write_note_atomic(&folder, &note)?;
        note.file_path = path.to_string_lossy().to_string();
        plaintext_notes.push(note);
    }

    // Remove vault config
    let config_path = config_path(&folder, "vault.json");
    if config_path.exists() {
        let _ = fs::remove_file(&config_path);
    }

    // Update state
    *state.vault_key.lock().unwrap() = None;
    *state.vault_status.lock().unwrap() = VaultStatus::Plaintext;
    *state.notes.lock().unwrap() = plaintext_notes;

    Ok(())
}

#[tauri::command]
pub fn restore_from_trash(filename: String, state: State<'_, AppState>) -> Result<NoteDto, String> {
    let folder = state.folder()?;

    let note = storage::restore_note_from_trash(&folder, &filename)?;
    let dto = NoteDto::from(&note);
    state.notes.lock().unwrap().push(note);
    Ok(dto)
}


#[tauri::command]
pub fn get_protection_status(state: State<'_, AppState>) -> String {
    let folder = match state.folder() {
        Ok(f) => f,
        Err(_) => return "none".to_string(),
    };
    if load_protection_config(&folder).is_some() {
        if state.protection_key.lock().unwrap().is_some() {
            "unlocked".to_string()
        } else {
            "locked".to_string()
        }
    } else {
        "none".to_string()
    }
}

#[tauri::command]
pub fn setup_protection(password: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?;

    if load_protection_config(&folder).is_some() {
        return Err("Protection already configured".to_string());
    }

    let (config, key) = crypto::create_vault_config(&password)?;
    save_protection_config(&folder, &config)?;

    *state.protection_key.lock().unwrap() = Some(key);
    store_hash(&state.protection_hash, &password);

    Ok(())
}

#[tauri::command]
pub fn unlock_protection(password: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?;
    let config = load_protection_config(&folder).ok_or("No protection configured")?;
    let key = verify_and_derive(&password, &config)?;

    store_hash(&state.protection_hash, &password);
    *state.protection_key.lock().unwrap() = Some(key);

    // Load protected note stubs and merge with existing notes
    let protected_stubs = storage::load_protected_note_stubs(&folder);
    let mut notes = state.notes.lock().unwrap();
    for stub in protected_stubs {
        if !notes.iter().any(|n| n.id == stub.id) {
            notes.push(stub);
        }
    }
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    Ok(())
}

#[tauri::command]
pub fn verify_protection_password(mut password: String, state: State<'_, AppState>) -> Result<bool, String> {
    // Fast path: compare SHA-256 hash (constant-time)
    if let Some(ref stored_hash) = *state.protection_hash.lock().unwrap() {
        let hash: [u8; 32] = Sha256::digest(password.as_bytes()).into();
        let result = hash.ct_eq(stored_hash).into();
        password.zeroize();
        return Ok(result);
    }

    // Slow path: full Argon2 derivation
    let folder = state.folder()?;
    let config = load_protection_config(&folder).ok_or("No protection configured")?;
    let key = crypto::derive_key(&password, &config.kdf)?;
    password.zeroize();
    crypto::verify_key(&key, &config.verification_record)
}

#[tauri::command]
pub fn protect_note(id: String, state: State<'_, AppState>) -> Result<NoteDto, String> {
    let folder = state.folder()?;
    let key = state.protection_key.lock().unwrap().clone()
        .ok_or("Protection not unlocked")?;

    let mut notes = state.notes.lock().unwrap();
    let note = notes.iter_mut().find(|n| n.id == id).ok_or("Note not found")?;

    // Write as protected .pnote
    let path = storage::write_note_protected(&folder, note, &key)?;

    // Remove old plaintext .md file
    let old_path = PathBuf::from(&note.file_path);
    if old_path.exists() && old_path.extension().and_then(|e| e.to_str()) == Some("md") {
        let _ = fs::remove_file(&old_path);
    }

    note.encrypted = true;
    note.file_path = path.to_string_lossy().to_string();

    Ok(NoteDto::from(&*note))
}

#[tauri::command]
pub fn unprotect_note(id: String, state: State<'_, AppState>) -> Result<NoteDto, String> {
    let folder = state.folder()?;
    let key = state.protection_key.lock().unwrap().clone()
        .ok_or("Protection not unlocked")?;

    let mut notes = state.notes.lock().unwrap();
    let note = notes.iter_mut().find(|n| n.id == id).ok_or("Note not found")?;

    // Decrypt body
    let pnote_path = Path::new(&note.file_path);
    let body = storage::decrypt_protected_note_body(pnote_path, &key)?;

    // Write as plaintext .md
    note.body = body;
    note.encrypted = false;
    let path = storage::unprotect_note(&folder, note, &note.body.clone())?;

    note.file_path = path.to_string_lossy().to_string();

    Ok(NoteDto::from(&*note))
}

#[tauri::command]
pub fn get_protected_note_body(id: String, state: State<'_, AppState>) -> Result<String, String> {
    let key = state.protection_key.lock().unwrap().clone()
        .ok_or("Protection not unlocked")?;

    let notes = state.notes.lock().unwrap();
    let note = notes.iter().find(|n| n.id == id).ok_or("Note not found")?;

    let path = Path::new(&note.file_path);
    storage::decrypt_protected_note_body(path, &key)
}

#[tauri::command]
pub fn save_protected_note(
    id: String,
    title: String,
    body: String,
    codex: Option<String>,
    state: State<'_, AppState>,
) -> Result<NoteDto, String> {
    let folder = state.folder()?;
    let key = state.protection_key.lock().unwrap().clone()
        .ok_or("Protection not unlocked")?;

    let mut notes = state.notes.lock().unwrap();
    let note = notes.iter_mut().find(|n| n.id == id).ok_or("Note not found")?;

    note.title = title;
    note.body = body;
    note.codex = codex;
    note.updated_at = Utc::now();

    let path = storage::write_note_protected(&folder, note, &key)?;
    note.file_path = path.to_string_lossy().to_string();

    Ok(NoteDto::from(&*note))
}

#[tauri::command]
pub fn disable_protection(password: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?;
    let config = load_protection_config(&folder).ok_or("No protection configured")?;
    let key = verify_and_derive(&password, &config)?;

    // Decrypt all protected notes back to plaintext
    let mut notes = state.notes.lock().unwrap();
    for note in notes.iter_mut() {
        let path = Path::new(&note.file_path);
        if path.extension().and_then(|e| e.to_str()) == Some("pnote") {
            if let Ok(body) = storage::decrypt_protected_note_body(path, &key) {
                note.body = body;
                note.encrypted = false;
                if let Ok(new_path) = storage::write_note_atomic(&folder, note) {
                    let _ = fs::remove_file(path);
                    note.file_path = new_path.to_string_lossy().to_string();
                }
            }
        }
    }

    // Remove protection config
    let cp = config_path(&folder, "protection.json");
    if cp.exists() {
        let _ = fs::remove_file(&cp);
    }

    *state.protection_key.lock().unwrap() = None;
    *state.protection_hash.lock().unwrap() = None;

    Ok(())
}

#[tauri::command]
pub fn change_protection_password(
    current: String,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let folder = state.folder()?;
    let config = load_protection_config(&folder).ok_or("No protection configured")?;

    let old_key = verify_and_derive(&current, &config)?;
    let (new_config, new_key) = crypto::create_vault_config(&new_password)?;

    // Re-encrypt all protected notes with new key
    let mut notes = state.notes.lock().unwrap();
    for note in notes.iter_mut() {
        let path = Path::new(&note.file_path);
        if path.extension().and_then(|e| e.to_str()) == Some("pnote") {
            if let Ok(body) = storage::decrypt_protected_note_body(path, &old_key) {
                note.body = body;
                if let Ok(new_path) = storage::write_note_protected(&folder, note, &new_key) {
                    note.file_path = new_path.to_string_lossy().to_string();
                }
                note.body = String::new();
            }
        }
    }

    save_protection_config(&folder, &new_config)?;

    *state.protection_key.lock().unwrap() = Some(new_key);
    store_hash(&state.protection_hash, &new_password);

    Ok(())
}

// --- Scratchpad ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScratchpadEntry {
    pub id: String,
    pub text: String,
    pub timestamp: String,
}

fn scratchpad_path(folder: &Path) -> PathBuf {
    folder.join(".scratch").join("scratchpad.json")
}

fn load_scratchpad(folder: &Path) -> Vec<ScratchpadEntry> {
    let path = scratchpad_path(folder);
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_scratchpad(folder: &Path, entries: &[ScratchpadEntry]) -> Result<(), String> {
    let scratch_dir = folder.join(".scratch");
    fs::create_dir_all(&scratch_dir)
        .map_err(|e| format!("Failed to create .scratch dir: {}", e))?;
    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("Failed to serialize scratchpad: {}", e))?;
    let dest = scratchpad_path(folder);
    let temp = scratch_dir.join(".tmp-scratchpad.json");
    fs::write(&temp, &json).map_err(|e| format!("Failed to write scratchpad: {}", e))?;
    fs::rename(&temp, &dest).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("Failed to rename scratchpad: {}", e)
    })?;
    Ok(())
}

#[tauri::command]
pub fn get_scratchpad_entries(state: State<'_, AppState>) -> Result<Vec<ScratchpadEntry>, String> {
    let folder = state.folder()?;
    Ok(load_scratchpad(&folder))
}

#[tauri::command]
pub fn append_scratchpad_entry(text: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?;
    let mut entries = load_scratchpad(&folder);
    let entry = ScratchpadEntry {
        id: ulid::Ulid::new().to_string(),
        text,
        timestamp: Utc::now().to_rfc3339(),
    };
    entries.insert(0, entry);
    save_scratchpad(&folder, &entries)
}

#[tauri::command]
pub fn delete_scratchpad_entry(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?;
    let mut entries = load_scratchpad(&folder);
    entries.retain(|e| e.id != id);
    save_scratchpad(&folder, &entries)
}
