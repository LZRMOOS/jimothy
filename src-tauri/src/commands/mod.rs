use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

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
            active_note_id: Mutex::new(None),
        }
    }
}

/// Get the path to vault.json in the notes folder
fn vault_config_path(folder: &Path) -> PathBuf {
    folder.join(".scratch").join("vault.json")
}

/// Check if a vault config exists and load it
fn load_vault_config(folder: &Path) -> Option<VaultConfig> {
    let path = vault_config_path(folder);
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Save vault config to disk
fn save_vault_config(folder: &Path, config: &VaultConfig) -> Result<(), String> {
    let scratch_dir = folder.join(".scratch");
    fs::create_dir_all(&scratch_dir)
        .map_err(|e| format!("Failed to create .scratch dir: {}", e))?;
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize vault config: {}", e))?;
    fs::write(vault_config_path(folder), json)
        .map_err(|e| format!("Failed to write vault config: {}", e))?;
    Ok(())
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
        let (notes, dropbox_conflicts) = storage::load_notes_deduped(&folder);
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
pub fn create_note(title: String, state: State<'_, AppState>) -> Result<NoteDto, String> {
    let folder = state
        .notes_folder
        .lock()
        .unwrap()
        .clone()
        .ok_or("No notes folder set")?;

    let vault_status = state.vault_status.lock().unwrap().clone();

    let mut note = Note::new(title);

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
    let folder = state
        .notes_folder
        .lock()
        .unwrap()
        .clone()
        .ok_or("No notes folder set")?;

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
pub fn delete_note(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state
        .notes_folder
        .lock()
        .unwrap()
        .clone()
        .ok_or("No notes folder set")?;

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
                let (notes, dropbox_conflicts) = storage::load_notes_deduped(&folder);
                if !dropbox_conflicts.is_empty() {
                    let _ = app_handle.emit("dropbox-conflict", ());
                }
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
        home.join("Scratch").to_string_lossy().to_string()
    } else {
        "Scratch".to_string()
    }
}

#[tauri::command]
pub fn get_app_settings() -> Result<String, String> {
    let config_dir = dirs::config_dir().ok_or("Cannot find config directory")?;
    let settings_path = config_dir.join("scratch").join("settings.json");
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
    let settings_dir = config_dir.join("scratch");
    std::fs::create_dir_all(&settings_dir)
        .map_err(|e| format!("Failed to create settings dir: {}", e))?;
    let settings_path = settings_dir.join("settings.json");
    std::fs::write(&settings_path, settings_json)
        .map_err(|e| format!("Failed to write settings: {}", e))
}

#[tauri::command]
pub fn setup_vault(password: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state
        .notes_folder
        .lock()
        .unwrap()
        .clone()
        .ok_or("No notes folder set")?;

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
    *state.vault_key.lock().unwrap() = Some(key);
    *state.vault_status.lock().unwrap() = VaultStatus::Unlocked;
    *state.notes.lock().unwrap() = encrypted_notes;

    Ok(())
}

#[tauri::command]
pub fn unlock_vault(password: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state
        .notes_folder
        .lock()
        .unwrap()
        .clone()
        .ok_or("No notes folder set")?;

    let config = load_vault_config(&folder).ok_or("No vault configured")?;

    // Derive key from password
    let key = crypto::derive_key(&password, &config.kdf)?;

    // Verify password
    if !crypto::verify_key(&key, &config.verification_record)? {
        return Err("Invalid password".to_string());
    }

    // Load and decrypt all notes
    let notes = storage::load_encrypted_notes_from_folder(&folder, &key);

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

    // Clear key and notes from memory
    *state.vault_key.lock().unwrap() = None;
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
pub fn set_active_note(id: Option<String>, state: State<'_, AppState>) {
    *state.active_note_id.lock().unwrap() = id;
}

#[tauri::command]
pub fn change_vault_password(
    current: String,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let folder = state
        .notes_folder
        .lock()
        .unwrap()
        .clone()
        .ok_or("No notes folder set")?;

    let config = load_vault_config(&folder).ok_or("No vault configured")?;

    // Verify current password
    let old_key = crypto::derive_key(&current, &config.kdf)?;
    if !crypto::verify_key(&old_key, &config.verification_record)? {
        return Err("Invalid current password".to_string());
    }

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
    let folder = state
        .notes_folder
        .lock()
        .unwrap()
        .clone()
        .ok_or("No notes folder set")?;

    let config = load_vault_config(&folder).ok_or("No vault configured")?;

    // Verify password
    let key = crypto::derive_key(&password, &config.kdf)?;
    if !crypto::verify_key(&key, &config.verification_record)? {
        return Err("Invalid password".to_string());
    }

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
    let config_path = vault_config_path(&folder);
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
    let folder = state
        .notes_folder
        .lock()
        .unwrap()
        .clone()
        .ok_or("No notes folder set")?;

    let note = storage::restore_note_from_trash(&folder, &filename)?;
    let dto = NoteDto::from(&note);
    state.notes.lock().unwrap().push(note);
    Ok(dto)
}
