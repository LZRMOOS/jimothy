use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
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

/// Persist a note in the on-disk format matching the current vault status,
/// clean up any stale file at the note's previous path (e.g. a legacy
/// `{slug}--{id}.md` name being migrated), and update `note.file_path` to the
/// new location. Sets `note.encrypted` when writing to the vault.
///
/// `vault_key` is the already-resolved key so callers lock the mutex once;
/// `locked_msg` tailors the error shown when the vault is locked. This is the
/// single write path shared by create/save/archive/conflict-resolution.
fn persist_note(
    folder: &Path,
    vault_status: &VaultStatus,
    vault_key: Option<&[u8]>,
    note: &mut Note,
    locked_msg: &str,
) -> Result<(), String> {
    let old_path = PathBuf::from(&note.file_path);

    let new_path = match vault_status {
        VaultStatus::Unlocked => {
            let key = vault_key.ok_or("Vault key not available")?;
            note.encrypted = true;
            storage::write_note_encrypted(folder, note, key)?
        }
        VaultStatus::Locked => return Err(locked_msg.to_string()),
        VaultStatus::Plaintext => storage::write_note_atomic(folder, note)?,
    };

    if !old_path.as_os_str().is_empty() && old_path != new_path && old_path.exists() {
        let _ = fs::remove_file(&old_path);
    }
    note.file_path = new_path.to_string_lossy().to_string();
    Ok(())
}

fn extract_image_paths(body: &str) -> Vec<&str> {
    let mut paths = Vec::new();
    for cap in body.match_indices(".scratch/images/") {
        let start = cap.0;
        // Walk forward to find end of path (next whitespace, ), or ")
        let rest = &body[start..];
        let end = rest.find(|c: char| c == ')' || c == '"' || c == '\'' || c.is_whitespace())
            .unwrap_or(rest.len());
        let path = &rest[..end];
        if !path.is_empty() {
            paths.push(path);
        }
    }
    paths
}

fn cleanup_removed_images(folder: &Path, old_body: &str, new_body: &str) {
    let old_images = extract_image_paths(old_body);
    let new_images: Vec<&str> = extract_image_paths(new_body);
    for img in old_images {
        if !new_images.contains(&img) {
            let path = folder.join(img);
            let _ = fs::remove_file(&path);
        }
    }
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

/// Emitted when a save loses a race against an external write. The frontend
/// reloads the (now external) note and offers the preserved copy in the resolver.
#[derive(Clone, serde::Serialize)]
pub struct SaveConflictPayload {
    pub id: String,
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

    // Seed app-bundled starter emoji on first sight (idempotent; respects
    // user deletions via the seed manifest).
    seed_starter_emojis(&folder, &app_handle);

    // Clean up orphaned temp files from previous sessions
    storage::cleanup_temp_files(&folder);

    // Clear stale encryption state from the previous vault
    if let Some(ref mut key) = *state.protection_key.lock().unwrap() {
        key.zeroize();
    }
    *state.protection_key.lock().unwrap() = None;
    *state.protection_hash.lock().unwrap() = None;
    if let Some(ref mut key) = *state.vault_key.lock().unwrap() {
        key.zeroize();
    }
    *state.vault_key.lock().unwrap() = None;
    *state.password_hash.lock().unwrap() = None;

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

    let vault_key = state.vault_key.lock().unwrap().clone();
    persist_note(
        &folder,
        &vault_status,
        vault_key.as_deref(),
        &mut note,
        "Vault is locked. Unlock before creating notes.",
    )?;

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
    base_updated_at: Option<String>,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<NoteDto, String> {
    let folder = state.folder()?;

    let vault_status = state.vault_status.lock().unwrap().clone();
    let vault_key = state.vault_key.lock().unwrap().clone();

    // Optimistic-concurrency guard: if the caller told us which version its edit
    // was based on, re-read the note's *actual* current state from disk (the
    // in-memory cache can lag during active editing) and compare. If disk is
    // newer, an external writer (another machine via Dropbox) got there first.
    // We don't block the user's save — instead we back up the external version
    // they'd otherwise clobber, then let the save proceed and signal the UI.
    let mut hit_conflict = false;
    if let Some(base) = base_updated_at.as_ref().and_then(|s| {
        chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|dt| dt.with_timezone(&Utc))
    }) {
        let key_ref = vault_key.as_deref();
        if let Some(disk) = storage::read_note_from_disk(&folder, &id, key_ref) {
            // A hair of slack absorbs sub-millisecond RFC3339 round-tripping.
            if (disk.updated_at - base) > chrono::Duration::milliseconds(1) {
                // Preserve the external version before the save overwrites it.
                let _ = storage::write_conflict_copy(&folder, &disk, key_ref);
                hit_conflict = true;
            }
        }
    }

    let mut notes = state.notes.lock().unwrap();
    let note = notes
        .iter_mut()
        .find(|n| n.id == id)
        .ok_or("Note not found")?;

    let old_body = note.body.clone();
    note.title = title;
    note.body = body;
    note.codex = codex;
    note.updated_at = Utc::now();

    persist_note(
        &folder,
        &vault_status,
        vault_key.as_deref(),
        note,
        "Vault is locked. Unlock before saving.",
    )?;

    cleanup_removed_images(&folder, &old_body, &note.body);

    let dto = NoteDto::from(&*note);
    drop(notes);

    if hit_conflict {
        let _ = app_handle.emit("save-conflict", SaveConflictPayload { id });
    }

    Ok(dto)
}

#[tauri::command]
pub fn set_note_archived(id: String, archived: bool, state: State<'_, AppState>) -> Result<NoteDto, String> {
    let folder = state.folder()?;
    let vault_status = state.vault_status.lock().unwrap().clone();
    let vault_key = state.vault_key.lock().unwrap().clone();

    let mut notes = state.notes.lock().unwrap();
    let note = notes
        .iter_mut()
        .find(|n| n.id == id)
        .ok_or("Note not found")?;

    note.archived = archived;
    persist_note(
        &folder,
        &vault_status,
        vault_key.as_deref(),
        note,
        "Vault is locked. Unlock before saving.",
    )?;

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
    cleanup_removed_images(&folder, &note.body, "");
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

    // The vault PIN escrow wraps the OLD key, which no longer opens the vault.
    // Drop it so a stale wrapped key can't linger; the user re-enrolls the PIN if
    // wanted. The protection escrow is untouched (it wraps a different key).
    let _ = crate::pin::disable(crate::pin::EscrowKind::Vault, &folder.to_string_lossy());

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

    // Notes are plaintext now — a PIN-wrapped vault key is useless and a needless
    // secret at rest. Remove it. Any protection escrow stays (protection can
    // still be active with the vault disabled).
    let _ = crate::pin::disable(crate::pin::EscrowKind::Vault, &folder.to_string_lossy());

    // Update state
    *state.vault_key.lock().unwrap() = None;
    *state.vault_status.lock().unwrap() = VaultStatus::Plaintext;
    *state.notes.lock().unwrap() = plaintext_notes;

    Ok(())
}

// ---------------------------------------------------------------------------
// PIN quick-unlock
//
// A 4-digit PIN is an opt-in convenience gate over a device-local, wrapped
// copy of the vault key (see crate::pin). The password stays the source of
// truth. The escrow lives in the app config dir (never synced), and is wiped
// after `MAX_ATTEMPTS` wrong guesses and on any key change.
// ---------------------------------------------------------------------------

/// Whether a vault PIN is enrolled (device-local check). Vault-scoped on purpose:
/// this is what the vault UnlockScreen keys off, so a protection-only PIN must
/// NOT make it true (there'd be no vault escrow to unlock). Settings combines
/// this with `pin_protection_enrolled` to decide "any PIN exists".
#[tauri::command]
pub fn pin_enrolled(state: State<'_, AppState>) -> Result<bool, String> {
    let folder = state.folder()?;
    Ok(crate::pin::is_enrolled(
        crate::pin::EscrowKind::Vault,
        &folder.to_string_lossy(),
    ))
}

/// Enroll a PIN by wrapping whichever keys are unlocked right now: the vault key,
/// the protection key, or both. At least one must be in memory (we escrow the
/// exact in-memory key, never a re-derived one). This means a plaintext user who
/// only uses note protection can still set a PIN.
///
/// This always REPLACES the PIN entirely (see `pin::enroll_keys`): re-setting the
/// PIN drops any prior escrow for a layer that isn't unlocked right now, so a
/// stale escrow can't keep answering to the OLD PIN. A layer not unlocked at
/// enroll time is simply not covered until the PIN is re-set with it unlocked.
#[tauri::command]
pub fn enroll_pin(pin: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?;
    let vault_path = folder.to_string_lossy();

    let vault_key = state.vault_key.lock().unwrap().clone();
    let protection_key = state.protection_key.lock().unwrap().clone();

    if vault_key.is_none() && protection_key.is_none() {
        return Err("Unlock the vault or note protection to set a PIN".into());
    }

    crate::pin::enroll_keys(
        &vault_path,
        &pin,
        vault_key.as_deref(),
        protection_key.as_deref(),
    )
}

/// Result of a PIN unlock, surfaced to the frontend so it can message the user
/// (remaining attempts, escrow wiped, etc.).
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum PinUnlockDto {
    Ok,
    Wrong { remaining: u32 },
    Wiped,
    NotEnrolled,
}

/// Shared skeleton for the three PIN-unlock commands. Attempts to unwrap the
/// `kind` escrow, validates the key against `verification_record`, and on success
/// hands the validated key to `on_success` (which installs it, loads notes, or
/// just verifies). A validation failure zeroizes the key and drops the stale
/// escrow. The Wrong/Wiped/NotEnrolled arms map straight to the DTO, so all three
/// commands share identical attempt-counter and error behavior by construction.
///
/// `on_success` takes ownership of the key: install-style callers move it into
/// state (zeroized later on lock); verify-only callers must zeroize it themselves.
fn pin_unlock_with<F>(
    kind: crate::pin::EscrowKind,
    vault_path: &str,
    verification_record: &str,
    pin: &str,
    stale_msg: &str,
    on_success: F,
) -> Result<PinUnlockDto, String>
where
    F: FnOnce(Vec<u8>) -> Result<(), String>,
{
    match crate::pin::attempt_unlock(kind, vault_path, pin)? {
        crate::pin::PinUnlockResult::Ok(mut key) => {
            // Validate the unwrapped key still opens this layer (e.g. reject a
            // stale escrow after an external re-key via sync).
            if !crypto::verify_key(&key, verification_record)? {
                key.zeroize();
                let _ = crate::pin::disable(kind, vault_path);
                return Err(stale_msg.into());
            }
            on_success(key)?;
            let _ = crate::pin::record_success(vault_path);
            Ok(PinUnlockDto::Ok)
        }
        crate::pin::PinUnlockResult::Wrong { remaining } => Ok(PinUnlockDto::Wrong { remaining }),
        crate::pin::PinUnlockResult::Wiped => Ok(PinUnlockDto::Wiped),
        crate::pin::PinUnlockResult::NotEnrolled => Ok(PinUnlockDto::NotEnrolled),
    }
}

/// Try to unlock the vault with a PIN. On the correct PIN the unwrapped key is
/// validated against the vault verification record before being installed, so a
/// tampered escrow can't inject a bad key.
#[tauri::command]
pub fn pin_unlock(pin: String, state: State<'_, AppState>) -> Result<PinUnlockDto, String> {
    let folder = state.folder()?;
    let vault_path = folder.to_string_lossy().to_string();
    let config = load_vault_config(&folder).ok_or("No vault configured")?;

    pin_unlock_with(
        crate::pin::EscrowKind::Vault,
        &vault_path,
        &config.verification_record,
        &pin,
        "Saved PIN no longer matches this vault. Use your password.",
        |key| {
            let notes = storage::load_encrypted_notes_from_folder(&folder, &key);
            *state.vault_key.lock().unwrap() = Some(key);
            *state.vault_status.lock().unwrap() = VaultStatus::Unlocked;
            *state.notes.lock().unwrap() = notes;
            Ok(())
        },
    )
}

/// Remove the PIN escrow(s) for the current vault (user turned the PIN off).
/// Clears both the vault and protection escrows — it's one PIN.
#[tauri::command]
pub fn disable_pin(state: State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?;
    crate::pin::disable_all(&folder.to_string_lossy())
}

/// Verify a PIN against the vault WITHOUT re-installing the key — used by the
/// sensitive-note re-auth gate while the vault is already unlocked. This is the
/// "you left the vault unlocked, but the PIN still guards sensitive notes" path:
/// the note is vault-encrypted, so verifying the PIN against the vault is the
/// right check. Shares the same escrow + attempt counter as `pin_unlock`, so
/// brute-forcing at this gate also burns the PIN.
#[tauri::command]
pub fn pin_verify(pin: String, state: State<'_, AppState>) -> Result<PinUnlockDto, String> {
    let folder = state.folder()?;
    let vault_path = folder.to_string_lossy().to_string();
    let config = load_vault_config(&folder).ok_or("No vault configured")?;

    pin_unlock_with(
        crate::pin::EscrowKind::Vault,
        &vault_path,
        &config.verification_record,
        &pin,
        "Saved PIN no longer matches this vault. Use your password.",
        // Re-auth only: don't install, just drop the validated key.
        |mut key| {
            key.zeroize();
            Ok(())
        },
    )
}

/// Whether a protection PIN escrow exists for the current vault. Distinct from
/// `pin_enrolled` (which reports the vault escrow) — this tells the frontend the
/// PIN can decrypt `.pnote` protected notes.
#[tauri::command]
pub fn pin_protection_enrolled(state: State<'_, AppState>) -> Result<bool, String> {
    let folder = state.folder()?;
    Ok(crate::pin::is_enrolled(
        crate::pin::EscrowKind::Protection,
        &folder.to_string_lossy(),
    ))
}

/// Unlock note protection with a PIN: unwrap the protection key, validate it
/// against the protection verification record, and install it into state so
/// `.pnote` notes decrypt. Used by the plaintext-mode sensitive-note gate.
#[tauri::command]
pub fn pin_unlock_protection(
    pin: String,
    state: State<'_, AppState>,
) -> Result<PinUnlockDto, String> {
    let folder = state.folder()?;
    let vault_path = folder.to_string_lossy().to_string();
    let config = load_protection_config(&folder).ok_or("No protection configured")?;

    pin_unlock_with(
        crate::pin::EscrowKind::Protection,
        &vault_path,
        &config.verification_record,
        &pin,
        "Saved PIN no longer matches note protection. Use your password.",
        |key| {
            *state.protection_key.lock().unwrap() = Some(key);

            // Merge protected note stubs into the cache, mirroring unlock_protection.
            let protected_stubs = storage::load_protected_note_stubs(&folder);
            let mut notes = state.notes.lock().unwrap();
            for stub in protected_stubs {
                if !notes.iter().any(|n| n.id == stub.id) {
                    notes.push(stub);
                }
            }
            notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            Ok(())
        },
    )
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

    // Protection is gone — its PIN escrow wraps a now-useless key. Drop it (the
    // vault PIN escrow, if any, is untouched).
    let _ = crate::pin::disable(crate::pin::EscrowKind::Protection, &folder.to_string_lossy());

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

    // The protection PIN escrow wraps the OLD protection key. Drop it so a stale
    // wrapped key can't linger; the user re-enrolls the PIN if wanted.
    let _ = crate::pin::disable(crate::pin::EscrowKind::Protection, &folder.to_string_lossy());

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

fn tasks_path(folder: &Path) -> PathBuf {
    folder.join(".scratch").join("tasks.md")
}

#[tauri::command]
pub fn get_tasks(state: State<'_, AppState>) -> Result<String, String> {
    let folder = state.folder()?;
    let path = tasks_path(&folder);
    if path.exists() {
        return Ok(std::fs::read_to_string(&path).unwrap_or_default());
    }
    // Migrate from legacy task note (codex: Tasks) if present
    let notes = state.notes.lock().unwrap();
    if let Some(note) = notes.iter().find(|n| n.codex.as_deref() == Some("Tasks") && !n.archived) {
        let body = note.body.clone();
        drop(notes);
        if !body.is_empty() {
            let scratch_dir = folder.join(".scratch");
            let _ = std::fs::create_dir_all(&scratch_dir);
            let _ = std::fs::write(&path, &body);
        }
        return Ok(body);
    }
    Ok(String::new())
}

#[tauri::command]
pub fn save_tasks(content: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?;
    let scratch_dir = folder.join(".scratch");
    std::fs::create_dir_all(&scratch_dir).map_err(|e| e.to_string())?;
    let dest = tasks_path(&folder);
    let temp = scratch_dir.join(".tmp-tasks.md");
    std::fs::write(&temp, &content).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, &dest).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        e.to_string()
    })?;
    Ok(())
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    // `open` treats its argument as a URL on macOS, so a non-directory string
    // (e.g. an `https://` URL smuggled in via a compromised webview) could
    // make it open something other than a local folder. Only ever hand it a
    // path that resolves to a real directory on disk.
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err("Not a directory".to_string());
    }
    std::process::Command::new("open")
        .arg(dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn check_vault_exists(path: String) -> bool {
    let dir = Path::new(&path);
    dir.is_dir() && dir.join(".scratch").join("vault.json").exists()
}

/// One entry in the conflict resolver: the preserved conflict file plus the
/// current live note it collides with (if any).
#[derive(serde::Serialize)]
pub struct ConflictEntry {
    /// Filename of the preserved copy inside `.scratch/conflicts/`.
    pub filename: String,
    /// Note id parsed from the conflict file (empty if unreadable).
    pub note_id: String,
    /// Title from the conflict file.
    pub conflict_title: String,
    /// Body from the conflict file (decrypted when possible).
    pub conflict_body: String,
    /// `updated_at` from the conflict file (RFC3339, empty if unknown).
    pub conflict_updated_at: String,
    /// True when the conflict file could be read/decrypted for a diff.
    pub readable: bool,
    /// True when a live note with the same id currently exists.
    pub live_exists: bool,
    pub live_title: String,
    pub live_body: String,
    pub live_updated_at: String,
    /// Absolute path to the conflict file (for the "show commands" helper).
    pub path: String,
}

/// Read + parse a single conflict file, decrypting with the vault key when the
/// vault is unlocked. Returns (note, readable). An unreadable file (e.g. a
/// locked-vault `.snote` or garbled content) still yields a stub so the user
/// can see it and delete it.
fn read_conflict_note(path: &Path, state: &AppState) -> (Option<Note>, bool) {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return (None, false),
    };

    // Vault-encrypted notes are stored as JSON blobs (.snote) — try that first.
    if let Ok(encrypted) = crypto::parse_encrypted_note(&content) {
        let key = state.vault_key.lock().unwrap();
        if let Some(ref key) = *key {
            if let Ok(note) = crypto::decrypt_note(&encrypted, key) {
                return (Some(note), true);
            }
        }
        // Vault locked or wrong key — can't show contents.
        return (None, false);
    }

    match crate::notes::parse_note(&content, &path.to_string_lossy()) {
        Some(note) => (Some(note), true),
        None => (None, false),
    }
}

/// List every preserved conflict file with a diff-ready view against its live note.
#[tauri::command]
pub fn list_conflicts(state: State<'_, AppState>) -> Result<Vec<ConflictEntry>, String> {
    let folder = state.folder()?;
    let conflicts_dir = folder.join(".scratch").join("conflicts");

    let mut out: Vec<ConflictEntry> = Vec::new();
    let entries = match fs::read_dir(&conflicts_dir) {
        Ok(e) => e,
        // No directory yet just means no conflicts.
        Err(_) => return Ok(out),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if filename.starts_with('.') {
            continue;
        }

        let (parsed, readable) = read_conflict_note(&path, &state);
        let note_id = parsed.as_ref().map(|n| n.id.clone()).unwrap_or_default();

        // Match against the live in-memory note by id.
        let notes = state.notes.lock().unwrap();
        let live = if note_id.is_empty() {
            None
        } else {
            notes.iter().find(|n| n.id == note_id)
        };

        out.push(ConflictEntry {
            filename: filename.clone(),
            note_id: note_id.clone(),
            conflict_title: parsed.as_ref().map(|n| n.title.clone()).unwrap_or_default(),
            conflict_body: parsed.as_ref().map(|n| n.body.clone()).unwrap_or_default(),
            conflict_updated_at: parsed
                .as_ref()
                .map(|n| n.updated_at.to_rfc3339())
                .unwrap_or_default(),
            readable,
            live_exists: live.is_some(),
            live_title: live.map(|n| n.title.clone()).unwrap_or_default(),
            live_body: live.map(|n| n.body.clone()).unwrap_or_default(),
            live_updated_at: live.map(|n| n.updated_at.to_rfc3339()).unwrap_or_default(),
            path: path.to_string_lossy().to_string(),
        });
    }

    // Newest conflict first.
    out.sort_by(|a, b| b.conflict_updated_at.cmp(&a.conflict_updated_at));
    Ok(out)
}

/// Resolve a single conflict.
/// - `keep-live`: discard the conflict copy, keep the current note untouched.
/// - `delete`: same as keep-live (alias for unreadable files with no live match).
/// - `keep-conflict`: overwrite the live note's content with the conflict copy.
/// - `keep-both`: import the conflict copy as a brand-new note (fresh id).
/// In every case the conflict file is removed afterward.
#[tauri::command]
pub fn resolve_conflict(
    filename: String,
    action: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let folder = state.folder()?;
    let conflicts_dir = folder.join(".scratch").join("conflicts");
    let conflict_path = conflicts_dir.join(&filename);

    // Guard against path traversal — the resolved path must stay inside the dir.
    let canonical_dir = conflicts_dir
        .canonicalize()
        .map_err(|e| format!("Conflicts folder unavailable: {}", e))?;
    let canonical_file = conflict_path
        .canonicalize()
        .map_err(|_| "Conflict file not found".to_string())?;
    if !canonical_file.starts_with(&canonical_dir) {
        return Err("Invalid conflict filename".to_string());
    }

    match action.as_str() {
        "keep-live" | "delete" => {
            fs::remove_file(&canonical_file)
                .map_err(|e| format!("Failed to delete conflict file: {}", e))?;
        }
        "keep-conflict" => {
            let (parsed, readable) = read_conflict_note(&canonical_file, &state);
            if !readable {
                return Err("Conflict file could not be read (vault may be locked).".to_string());
            }
            let conflict = parsed.ok_or("Conflict file could not be parsed")?;

            let vault_status = state.vault_status.lock().unwrap().clone();
            let vault_key = state.vault_key.lock().unwrap().clone();
            let mut notes = state.notes.lock().unwrap();
            let note = notes
                .iter_mut()
                .find(|n| n.id == conflict.id)
                .ok_or("No matching live note to overwrite")?;

            note.title = conflict.title;
            note.body = conflict.body;
            note.codex = conflict.codex;
            note.updated_at = Utc::now();
            persist_note(
                &folder,
                &vault_status,
                vault_key.as_deref(),
                note,
                "Vault is locked. Unlock before resolving.",
            )?;
            drop(notes);

            fs::remove_file(&canonical_file)
                .map_err(|e| format!("Failed to delete conflict file: {}", e))?;
        }
        "keep-both" => {
            let (parsed, readable) = read_conflict_note(&canonical_file, &state);
            if !readable {
                return Err("Conflict file could not be read (vault may be locked).".to_string());
            }
            let conflict = parsed.ok_or("Conflict file could not be parsed")?;

            // Build a fresh note so it no longer collides on id.
            let mut new_note = Note::new(format!("{} (conflict copy)", conflict.title));
            new_note.body = conflict.body;
            new_note.codex = conflict.codex;

            let vault_status = state.vault_status.lock().unwrap().clone();
            let vault_key = state.vault_key.lock().unwrap().clone();
            persist_note(
                &folder,
                &vault_status,
                vault_key.as_deref(),
                &mut new_note,
                "Vault is locked. Unlock before resolving.",
            )?;
            state.notes.lock().unwrap().push(new_note);

            fs::remove_file(&canonical_file)
                .map_err(|e| format!("Failed to delete conflict file: {}", e))?;
        }
        other => return Err(format!("Unknown resolve action: {}", other)),
    }

    Ok(())
}

#[tauri::command]
pub fn save_image(data: String, extension: String, state: State<'_, AppState>) -> Result<String, String> {
    let folder = state.folder()?;
    let images_dir = folder.join(".scratch").join("images");
    fs::create_dir_all(&images_dir)
        .map_err(|e| format!("Failed to create images dir: {}", e))?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    let id = ulid::Ulid::new().to_string();
    let filename = format!("{}.{}", id, extension);
    let path = images_dir.join(&filename);
    fs::write(&path, &bytes)
        .map_err(|e| format!("Failed to write image: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}

/// Largest dimension we keep for a custom emoji. Anything bigger is downscaled.
const EMOJI_MAX_DIM: u32 = 128;
/// Smallest square we accept. Tiny images look bad scaled up to text height.
const EMOJI_MIN_DIM: u32 = 100;
/// Cap on animated GIFs. We keep the original bytes (re-encoding kills the
/// animation) so there's no downscale to lean on — this stops a giant GIF from
/// bloating the synced folder.
const EMOJI_MAX_GIF_BYTES: usize = 3 * 1024 * 1024;

/// Extensions we store emoji under. Static images become `.png`; animated
/// emoji keep their original `.gif`.
const EMOJI_EXTENSIONS: [&str; 2] = ["png", "gif"];

/// Filename of the seed manifest inside `.scratch/emojis/`. Records the
/// shortcodes we've ever seeded into this vault so a starter emoji the user
/// deleted never reappears on the next launch (or after a re-seed when a new
/// release ships new starters). Lives in the synced folder, so the "already
/// seeded" decision follows the vault across devices.
const EMOJI_SEED_MANIFEST: &str = ".seeded.json";

/// Copy the app-bundled starter emoji into a vault's `.scratch/emojis/` the
/// first time each one is seen. Idempotent and non-fatal: any failure (missing
/// resource dir in dev, unreadable manifest, etc.) is logged-by-return and
/// never blocks folder init. Emoji are never encrypted, so this runs
/// regardless of vault status and needs no key.
fn seed_starter_emojis(folder: &Path, app_handle: &AppHandle) {
    use tauri::Manager;

    let resource_dir = match app_handle
        .path()
        .resolve("resources/starter-emojis", tauri::path::BaseDirectory::Resource)
    {
        Ok(dir) if dir.exists() => dir,
        _ => return, // no bundled starters (e.g. dev without a build) — nothing to do
    };

    let emojis_dir = folder.join(".scratch").join("emojis");
    if fs::create_dir_all(&emojis_dir).is_err() {
        return;
    }

    // Load the set of shortcodes we've already seeded into this vault.
    let manifest_path = emojis_dir.join(EMOJI_SEED_MANIFEST);
    let mut seeded: Vec<String> = fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let mut changed = false;
    let read = match fs::read_dir(&resource_dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for entry in read.flatten() {
        let src = entry.path();
        if !src.is_file() {
            continue;
        }
        let stem = match src.file_stem().and_then(|s| s.to_str()) {
            Some(n) if emoji_name_valid(n) => n.to_string(),
            _ => continue,
        };
        // Skip if we've seeded this name before (even if the user has since
        // deleted it) or if a same-named emoji already exists on disk.
        if seeded.contains(&stem) || find_emoji_path(&emojis_dir, &stem).is_some() {
            continue;
        }
        let dest = match src.extension().and_then(|e| e.to_str()) {
            Some(ext) => emojis_dir.join(format!("{}.{}", stem, ext)),
            None => continue,
        };
        if fs::copy(&src, &dest).is_ok() {
            seeded.push(stem);
            changed = true;
        }
    }

    if changed {
        if let Ok(json) = serde_json::to_string(&seeded) {
            let _ = fs::write(&manifest_path, json);
        }
    }
}

/// Resolve a shortcode to its on-disk file, trying each known extension. Emoji
/// can be stored as `.png` or `.gif`, so callers must not assume `.png`.
fn find_emoji_path(dir: &Path, name: &str) -> Option<PathBuf> {
    EMOJI_EXTENSIONS
        .iter()
        .map(|ext| dir.join(format!("{}.{}", name, ext)))
        .find(|p| p.exists())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmojiEntry {
    /// Shortcode name (filename without extension), e.g. "pepe".
    pub name: String,
    /// Absolute path on disk.
    pub path: String,
}

fn emoji_name_valid(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[tauri::command]
pub fn list_emojis(state: State<'_, AppState>) -> Result<Vec<EmojiEntry>, String> {
    let folder = state.folder()?;
    let emojis_dir = folder.join(".scratch").join("emojis");
    if !emojis_dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let read = fs::read_dir(&emojis_dir)
        .map_err(|e| format!("Failed to read emojis dir: {}", e))?;
    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_stem().and_then(|s| s.to_str()) {
            Some(n) if emoji_name_valid(n) => n.to_string(),
            _ => continue,
        };
        entries.push(EmojiEntry {
            name,
            path: path.to_string_lossy().to_string(),
        });
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
pub fn import_emoji(
    data: String,
    filename: String,
    state: State<'_, AppState>,
) -> Result<EmojiEntry, String> {
    let folder = state.folder()?;
    let emojis_dir = folder.join(".scratch").join("emojis");
    fs::create_dir_all(&emojis_dir)
        .map_err(|e| format!("Failed to create emojis dir: {}", e))?;

    // Derive the shortcode name from the file's base name.
    let stem = Path::new(&filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
        .chars()
        .map(|c| if c == ' ' { '-' } else { c })
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>();
    if !emoji_name_valid(&stem) {
        return Err("Emoji name must contain letters, numbers, dashes or underscores".into());
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    // Detect the format up front. Re-encoding an animated GIF to PNG flattens
    // it to a single frame, so GIFs take a different path: we validate the
    // first frame's dimensions but write the original bytes untouched.
    let is_gif = image::guess_format(&bytes)
        .map(|f| f == image::ImageFormat::Gif)
        .unwrap_or(false);

    let img = image::load_from_memory(&bytes)
        .map_err(|e| format!("Could not read image: {}", e))?;
    let (w, h) = (img.width(), img.height());
    if w != h {
        return Err(format!("Emoji must be square (got {}x{})", w, h));
    }
    if w < EMOJI_MIN_DIM {
        return Err(format!(
            "Emoji must be at least {}x{} pixels (got {}x{})",
            EMOJI_MIN_DIM, EMOJI_MIN_DIM, w, h
        ));
    }

    // A shortcode can only map to one file, so drop any existing version in a
    // different format before writing (e.g. replacing a .png with a .gif).
    if let Some(existing) = find_emoji_path(&emojis_dir, &stem) {
        let _ = fs::remove_file(&existing);
    }

    let path = if is_gif {
        // Keep animation intact by preserving the original bytes. There's no
        // downscale here, so guard on file size instead of dimensions.
        if bytes.len() > EMOJI_MAX_GIF_BYTES {
            return Err(format!(
                "Animated emoji must be under {}MB (got {:.1}MB)",
                EMOJI_MAX_GIF_BYTES / (1024 * 1024),
                bytes.len() as f64 / (1024.0 * 1024.0)
            ));
        }
        let path = emojis_dir.join(format!("{}.gif", stem));
        fs::write(&path, &bytes).map_err(|e| format!("Failed to write emoji: {}", e))?;
        path
    } else {
        // Downscale oversized static images to keep sync light; emoji never
        // render large.
        let out = if w > EMOJI_MAX_DIM {
            img.resize(EMOJI_MAX_DIM, EMOJI_MAX_DIM, image::imageops::FilterType::Lanczos3)
        } else {
            img
        };
        let path = emojis_dir.join(format!("{}.png", stem));
        out.save_with_format(&path, image::ImageFormat::Png)
            .map_err(|e| format!("Failed to write emoji: {}", e))?;
        path
    };

    Ok(EmojiEntry {
        name: stem,
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn delete_emoji(name: String, state: State<'_, AppState>) -> Result<(), String> {
    if !emoji_name_valid(&name) {
        return Err("Invalid emoji name".into());
    }
    let emojis_dir = state.folder()?.join(".scratch").join("emojis");
    if let Some(path) = find_emoji_path(&emojis_dir, &name) {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete emoji: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn rename_emoji(
    old_name: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<EmojiEntry, String> {
    // Normalize the requested name the same way import does.
    let new_stem = new_name
        .to_lowercase()
        .chars()
        .map(|c| if c == ' ' { '-' } else { c })
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>();
    if !emoji_name_valid(&new_stem) {
        return Err("Name must contain letters, numbers, dashes or underscores".into());
    }
    if !emoji_name_valid(&old_name) {
        return Err("Invalid emoji name".into());
    }
    let emojis_dir = state.folder()?.join(".scratch").join("emojis");
    let old_path = find_emoji_path(&emojis_dir, &old_name)
        .ok_or_else(|| "Emoji not found".to_string())?;

    if new_stem == old_name {
        // No change; just return the existing entry.
        return Ok(EmojiEntry {
            name: old_name,
            path: old_path.to_string_lossy().to_string(),
        });
    }

    // Keep whatever extension the file already has (.png or .gif).
    let ext = old_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let new_path = emojis_dir.join(format!("{}.{}", new_stem, ext));
    if find_emoji_path(&emojis_dir, &new_stem).is_some() {
        return Err(format!("An emoji named :{}: already exists", new_stem));
    }
    fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to rename emoji: {}", e))?;

    Ok(EmojiEntry {
        name: new_stem,
        path: new_path.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp(content: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("copy.md");
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        (dir, path)
    }

    #[test]
    fn read_conflict_note_parses_plaintext() {
        let content = "---\nid: ABC123\ntitle: Hello\ncreated_at: 2026-01-01T00:00:00+00:00\nupdated_at: 2026-01-01T00:00:00+00:00\nencrypted: false\n---\n\nBody text";
        let (_dir, path) = write_temp(content);
        let state = AppState::new();

        let (note, readable) = read_conflict_note(&path, &state);
        assert!(readable);
        let note = note.unwrap();
        assert_eq!(note.id, "ABC123");
        assert_eq!(note.title, "Hello");
        assert_eq!(note.body, "Body text");
    }

    #[test]
    fn read_conflict_note_marks_garbage_unreadable() {
        let (_dir, path) = write_temp("not a note at all");
        let state = AppState::new();

        let (note, readable) = read_conflict_note(&path, &state);
        assert!(!readable);
        assert!(note.is_none());
    }

    #[test]
    fn read_conflict_note_handles_locked_vault_snote() {
        // Encrypt a note, then try to read it with no vault key in state.
        let (_cfg, key) = crypto::create_vault_config("pw").unwrap();
        let mut note = Note::new("Secret".into());
        note.body = "hidden".into();
        let encrypted = crypto::encrypt_note(&note, &key).unwrap();
        let json = crypto::serialize_encrypted_note(&encrypted).unwrap();
        let (_dir, path) = write_temp(&json);

        let state = AppState::new(); // vault_key is None → locked
        let (parsed, readable) = read_conflict_note(&path, &state);
        assert!(!readable);
        assert!(parsed.is_none());
    }
}
