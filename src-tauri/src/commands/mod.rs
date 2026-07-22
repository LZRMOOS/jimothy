use std::path::PathBuf;
use std::sync::Mutex;

use chrono::Utc;
use tauri::{AppHandle, State};

use crate::notes::Note;
use crate::storage;
use crate::watcher::FileWatcher;

pub struct AppState {
    pub notes_folder: Mutex<Option<PathBuf>>,
    pub notes: Mutex<Vec<Note>>,
    pub watcher: Mutex<Option<FileWatcher>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            notes_folder: Mutex::new(None),
            notes: Mutex::new(Vec::new()),
            watcher: Mutex::new(None),
        }
    }
}

#[derive(serde::Serialize)]
pub struct NoteDto {
    pub id: String,
    pub title: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
    pub encrypted: bool,
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

    let notes = storage::load_notes_from_folder(&folder);
    *state.notes.lock().unwrap() = notes;
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

    let mut note = Note::new(title);
    let path = storage::write_note_atomic(&folder, &note)?;
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
    state: State<'_, AppState>,
) -> Result<NoteDto, String> {
    let folder = state
        .notes_folder
        .lock()
        .unwrap()
        .clone()
        .ok_or("No notes folder set")?;

    let mut notes = state.notes.lock().unwrap();
    let note = notes
        .iter_mut()
        .find(|n| n.id == id)
        .ok_or("Note not found")?;

    let old_path = PathBuf::from(&note.file_path);

    note.title = title;
    note.body = body;
    note.updated_at = Utc::now();

    let new_path = storage::write_note_atomic(&folder, note)?;

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
pub fn reload_notes(state: State<'_, AppState>) -> Vec<NoteDto> {
    let folder = state.notes_folder.lock().unwrap().clone();
    if let Some(folder) = folder {
        let notes = storage::load_notes_from_folder(&folder);
        let dtos: Vec<NoteDto> = notes.iter().map(NoteDto::from).collect();
        *state.notes.lock().unwrap() = notes;
        dtos
    } else {
        Vec::new()
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
