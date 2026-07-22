use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use regex::Regex;
use unicode_normalization::UnicodeNormalization;

use crate::crypto;
use crate::notes::{self, Note};

const MAX_TITLE_SLUG_LEN: usize = 60;

pub fn sanitize_filename(title: &str) -> String {
    let normalized: String = title.nfc().collect();

    let slug: String = normalized
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => c,
            ' ' => '-',
            _ => '_',
        })
        .collect();

    let slug = slug.to_lowercase();
    let slug = slug.trim_matches(|c| c == '-' || c == '_' || c == '.');

    let slug = if slug.len() > MAX_TITLE_SLUG_LEN {
        &slug[..MAX_TITLE_SLUG_LEN]
    } else {
        slug
    };

    let slug = slug.trim_end_matches(|c| c == '-' || c == '_' || c == '.');

    if slug.is_empty() {
        return "untitled".to_string();
    }

    if is_windows_reserved(slug) {
        return format!("_{}", slug);
    }

    slug.to_string()
}

fn is_windows_reserved(name: &str) -> bool {
    let upper = name.to_uppercase();
    let base = upper.split('.').next().unwrap_or("");
    matches!(
        base,
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

pub fn note_filename(note: &Note) -> String {
    let slug = sanitize_filename(&note.title);
    format!("{}--{}.md", slug, note.id)
}

pub fn write_note_atomic(folder: &Path, note: &Note) -> Result<PathBuf, String> {
    let filename = note_filename(note);
    let dest = folder.join(&filename);
    let content = notes::serialize_note(note);

    let temp_name = format!(".scratch-tmp-{}.md", ulid::Ulid::new());
    let temp_path = folder.join(&temp_name);

    fs::write(&temp_path, &content).map_err(|e| format!("Failed to write temp file: {}", e))?;

    fs::rename(&temp_path, &dest).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("Failed to rename temp file: {}", e)
    })?;

    Ok(dest)
}

pub fn delete_note_file(folder: &Path, note: &Note) -> Result<(), String> {
    let trash_dir = folder.join(".scratch").join("trash");
    fs::create_dir_all(&trash_dir)
        .map_err(|e| format!("Failed to create trash dir: {}", e))?;

    let src = Path::new(&note.file_path);
    if !src.exists() {
        return Ok(());
    }

    let filename = src
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let trash_path = trash_dir.join(&filename);

    fs::rename(src, &trash_path).map_err(|e| format!("Failed to move to trash: {}", e))?;

    Ok(())
}

pub fn load_notes_from_folder(folder: &Path) -> Vec<Note> {
    let mut notes = Vec::new();

    let entries = match fs::read_dir(folder) {
        Ok(entries) => entries,
        Err(_) => return notes,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let filename = path.file_name().unwrap_or_default().to_string_lossy();
        if filename.starts_with('.') {
            continue;
        }

        if let Ok(content) = fs::read_to_string(&path) {
            if let Some(note) = notes::parse_note(&content, &path.to_string_lossy()) {
                notes.push(note);
            }
        }
    }

    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    notes
}

pub fn validate_folder(folder: &Path) -> Result<(), String> {
    if !folder.exists() {
        return Err("Folder does not exist".to_string());
    }
    if !folder.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let test_file = folder.join(".scratch-write-test");
    fs::write(&test_file, "test")
        .map_err(|e| format!("Folder is not writable: {}", e))?;
    let _ = fs::remove_file(&test_file);

    Ok(())
}

pub fn ensure_quicknotes_dirs(folder: &Path) -> Result<(), String> {
    let qn_dir = folder.join(".scratch");
    fs::create_dir_all(qn_dir.join("trash"))
        .map_err(|e| format!("Failed to create .scratch dirs: {}", e))?;
    fs::create_dir_all(qn_dir.join("conflicts"))
        .map_err(|e| format!("Failed to create .scratch dirs: {}", e))?;
    Ok(())
}

/// Scan the notes folder for orphaned `.scratch-tmp-*` files and remove them.
pub fn cleanup_temp_files(folder: &Path) -> Vec<PathBuf> {
    let mut removed = Vec::new();
    let entries = match fs::read_dir(folder) {
        Ok(entries) => entries,
        Err(_) => return removed,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let filename = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        if filename.starts_with(".scratch-tmp-") {
            if fs::remove_file(&path).is_ok() {
                removed.push(path);
            }
        }
    }
    removed
}

/// Check if a filename matches the Dropbox conflict copy pattern.
/// Pattern: `* (*.conflicted copy *)*`
pub fn is_dropbox_conflict(filename: &str) -> bool {
    let re = Regex::new(r".+\s+\(.+conflicted copy .+\)").unwrap();
    re.is_match(filename)
}

/// Move a file to the `.scratch/conflicts/` directory, preserving its filename.
pub fn move_to_conflicts(folder: &Path, file_path: &Path) -> Result<PathBuf, String> {
    let conflicts_dir = folder.join(".scratch").join("conflicts");
    fs::create_dir_all(&conflicts_dir)
        .map_err(|e| format!("Failed to create conflicts dir: {}", e))?;

    let filename = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let dest = conflicts_dir.join(&filename);

    fs::rename(file_path, &dest)
        .or_else(|_| {
            // If rename fails (cross-device), try copy + remove
            fs::copy(file_path, &dest).and_then(|_| fs::remove_file(file_path))
        })
        .map_err(|e| format!("Failed to move to conflicts: {}", e))?;

    Ok(dest)
}

#[allow(dead_code)]
pub fn save_conflict_copy(
    folder: &Path,
    note_path: &Path,
    slug: &str,
    note_id: &str,
) -> Result<PathBuf, String> {
    let conflicts_dir = folder.join(".scratch").join("conflicts");
    fs::create_dir_all(&conflicts_dir)
        .map_err(|e| format!("Failed to create conflicts dir: {}", e))?;

    let timestamp = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    // Replace colons in timestamp with dashes for filename safety
    let safe_timestamp = timestamp.replace(':', "-");
    let conflict_filename = format!("{}--{}--conflict-{}.md", slug, note_id, safe_timestamp);
    let dest = conflicts_dir.join(&conflict_filename);

    fs::copy(note_path, &dest)
        .map_err(|e| format!("Failed to copy conflict file: {}", e))?;

    Ok(dest)
}

/// Load notes from folder, detecting and handling duplicate IDs.
/// When duplicates are found, keeps the one with the more recent `updated_at`
/// and moves the other to `.scratch/conflicts/`.
/// Also detects and moves Dropbox conflict copies.
/// Returns: (notes, dropbox_conflict_paths)
pub fn load_notes_deduped(folder: &Path) -> (Vec<Note>, Vec<PathBuf>) {
    let mut notes_by_id: HashMap<String, Note> = HashMap::new();
    let mut duplicates_moved: Vec<PathBuf> = Vec::new();
    let mut dropbox_conflicts: Vec<PathBuf> = Vec::new();

    let entries = match fs::read_dir(folder) {
        Ok(entries) => entries,
        Err(_) => return (Vec::new(), Vec::new()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if filename.starts_with('.') {
            continue;
        }

        // Check for Dropbox conflict copy
        if is_dropbox_conflict(&filename) {
            if let Ok(dest) = move_to_conflicts(folder, &path) {
                dropbox_conflicts.push(dest);
            }
            continue;
        }

        if let Ok(content) = fs::read_to_string(&path) {
            if let Some(note) = notes::parse_note(&content, &path.to_string_lossy()) {
                let note_id = note.id.clone();
                if let Some(existing) = notes_by_id.get(&note_id) {
                    // Duplicate detected - keep the one with more recent updated_at
                    if note.updated_at > existing.updated_at {
                        // Move the existing (older) one to conflicts
                        let old_path = PathBuf::from(&existing.file_path);
                        if let Ok(dest) = move_to_conflicts(folder, &old_path) {
                            duplicates_moved.push(dest);
                        }
                        notes_by_id.insert(note_id, note);
                    } else {
                        // Move the new (older) one to conflicts
                        if let Ok(dest) = move_to_conflicts(folder, &path) {
                            duplicates_moved.push(dest);
                        }
                    }
                } else {
                    notes_by_id.insert(note_id, note);
                }
            }
        }
    }

    let mut notes: Vec<Note> = notes_by_id.into_values().collect();
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    (notes, dropbox_conflicts)
}

/// Check if a folder exists and is accessible.
pub fn check_folder_available(folder: &Path) -> Result<(), String> {
    if !folder.exists() {
        return Err("Folder does not exist or is unavailable".to_string());
    }
    if !folder.is_dir() {
        return Err("Path is not a directory".to_string());
    }
    // Try to read the directory to confirm accessibility
    fs::read_dir(folder)
        .map_err(|e| format!("Folder is not accessible: {}", e))?;
    Ok(())
}

/// Restore a note from `.scratch/trash/` back to the notes folder.
pub fn restore_note_from_trash(folder: &Path, filename: &str) -> Result<Note, String> {
    let trash_dir = folder.join(".scratch").join("trash");
    let trash_path = trash_dir.join(filename);

    if !trash_path.exists() {
        return Err(format!("File not found in trash: {}", filename));
    }

    let content = fs::read_to_string(&trash_path)
        .map_err(|e| format!("Failed to read trash file: {}", e))?;

    let note = notes::parse_note(&content, &trash_path.to_string_lossy())
        .ok_or_else(|| "Failed to parse note from trash file".to_string())?;

    let dest = folder.join(filename);
    fs::rename(&trash_path, &dest)
        .map_err(|e| format!("Failed to restore from trash: {}", e))?;

    let mut restored_note = note;
    restored_note.file_path = dest.to_string_lossy().to_string();
    Ok(restored_note)
}

/// Write an encrypted note file (.snote) atomically
pub fn write_note_encrypted(folder: &Path, note: &Note, key: &[u8]) -> Result<PathBuf, String> {
    let encrypted = crypto::encrypt_note(note, key)?;
    let json = crypto::serialize_encrypted_note(&encrypted)?;

    let filename = format!("{}.snote", note.id);
    let dest = folder.join(&filename);

    let temp_name = format!(".scratch-tmp-{}.snote", ulid::Ulid::new());
    let temp_path = folder.join(&temp_name);

    fs::write(&temp_path, &json).map_err(|e| format!("Failed to write temp file: {}", e))?;

    fs::rename(&temp_path, &dest).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("Failed to rename temp file: {}", e)
    })?;

    Ok(dest)
}

/// Load and decrypt all .snote files from a folder
pub fn load_encrypted_notes_from_folder(folder: &Path, key: &[u8]) -> Vec<Note> {
    let mut notes = Vec::new();

    let entries = match fs::read_dir(folder) {
        Ok(entries) => entries,
        Err(_) => return notes,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("snote") {
            continue;
        }
        let filename = path.file_name().unwrap_or_default().to_string_lossy();
        if filename.starts_with('.') {
            continue;
        }

        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(encrypted) = crypto::parse_encrypted_note(&content) {
                if let Ok(mut note) = crypto::decrypt_note(&encrypted, key) {
                    note.file_path = path.to_string_lossy().to_string();
                    note.encrypted = true;
                    notes.push(note);
                }
            }
        }
    }

    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    notes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notes::Note;
    use chrono::Utc;

    fn make_note(title: &str) -> Note {
        Note {
            id: "01ABC".to_string(),
            title: title.to_string(),
            body: "Hello world".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            encrypted: false,
            file_path: String::new(),
        }
    }

    #[test]
    fn test_sanitize_basic() {
        assert_eq!(sanitize_filename("Hello World"), "hello-world");
        assert_eq!(sanitize_filename("My Note!"), "my-note");
        assert_eq!(sanitize_filename(""), "untitled");
    }

    #[test]
    fn test_sanitize_windows_reserved() {
        assert_eq!(sanitize_filename("CON"), "_con");
        assert_eq!(sanitize_filename("PRN"), "_prn");
        assert_eq!(sanitize_filename("com1"), "_com1");
    }

    #[test]
    fn test_sanitize_special_chars() {
        assert_eq!(sanitize_filename("foo<bar>baz"), "foo_bar_baz");
        assert_eq!(sanitize_filename("a:b|c?d"), "a_b_c_d");
    }

    #[test]
    fn test_sanitize_long_title() {
        let long = "a".repeat(100);
        let result = sanitize_filename(&long);
        assert!(result.len() <= MAX_TITLE_SLUG_LEN);
    }

    #[test]
    fn test_note_filename() {
        let note = make_note("Meeting Notes");
        let filename = note_filename(&note);
        assert_eq!(filename, "meeting-notes--01ABC.md");
    }

    #[test]
    fn test_validate_folder_nonexistent() {
        let result = validate_folder(Path::new("/nonexistent/path"));
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_folder_ok() {
        let dir = tempfile::tempdir().unwrap();
        let result = validate_folder(dir.path());
        assert!(result.is_ok());
    }

    #[test]
    fn test_atomic_write_and_load() {
        let dir = tempfile::tempdir().unwrap();
        let mut note = make_note("Test Note");
        let path = write_note_atomic(dir.path(), &note).unwrap();
        note.file_path = path.to_string_lossy().to_string();

        assert!(path.exists());
        assert!(path.to_string_lossy().contains("test-note--01ABC.md"));

        let loaded = load_notes_from_folder(dir.path());
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].title, "Test Note");
        assert_eq!(loaded[0].body, "Hello world");
    }

    #[test]
    fn test_delete_note_to_trash() {
        let dir = tempfile::tempdir().unwrap();
        let mut note = make_note("Delete Me");
        let path = write_note_atomic(dir.path(), &note).unwrap();
        note.file_path = path.to_string_lossy().to_string();

        ensure_quicknotes_dirs(dir.path()).unwrap();
        delete_note_file(dir.path(), &note).unwrap();

        assert!(!path.exists());
        let trash = dir.path().join(".scratch").join("trash");
        assert!(trash.join("delete-me--01ABC.md").exists());
    }

    #[test]
    fn test_cleanup_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        // Create some temp files
        fs::write(dir.path().join(".scratch-tmp-abc123.md"), "temp1").unwrap();
        fs::write(dir.path().join(".scratch-tmp-def456.md"), "temp2").unwrap();
        // Create a normal file that should not be removed
        fs::write(dir.path().join("normal-note.md"), "normal").unwrap();

        let removed = cleanup_temp_files(dir.path());
        assert_eq!(removed.len(), 2);
        assert!(!dir.path().join(".scratch-tmp-abc123.md").exists());
        assert!(!dir.path().join(".scratch-tmp-def456.md").exists());
        assert!(dir.path().join("normal-note.md").exists());
    }

    #[test]
    fn test_is_dropbox_conflict() {
        assert!(is_dropbox_conflict(
            "my-note--ABC123 (John's conflicted copy 2026-01-15).md"
        ));
        assert!(is_dropbox_conflict(
            "notes--XYZ (laptop conflicted copy 2026-07-01).md"
        ));
        assert!(!is_dropbox_conflict("normal-note--ABC123.md"));
        assert!(!is_dropbox_conflict("some-file.md"));
        assert!(!is_dropbox_conflict("conflicted copy.md"));
    }

    #[test]
    fn test_load_notes_deduped_handles_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        ensure_quicknotes_dirs(dir.path()).unwrap();

        let now = Utc::now();
        let earlier = now - chrono::Duration::hours(1);

        // Create two notes with the same ID but different updated_at
        let note1_content = format!(
            "---\nid: DUPID\ntitle: Note V1\ncreated_at: {}\nupdated_at: {}\nencrypted: false\n---\n\nOld body",
            earlier.to_rfc3339(),
            earlier.to_rfc3339()
        );
        let note2_content = format!(
            "---\nid: DUPID\ntitle: Note V2\ncreated_at: {}\nupdated_at: {}\nencrypted: false\n---\n\nNew body",
            now.to_rfc3339(),
            now.to_rfc3339()
        );

        fs::write(dir.path().join("note-v1--DUPID.md"), &note1_content).unwrap();
        fs::write(dir.path().join("note-v2--DUPID.md"), &note2_content).unwrap();

        let (notes, _dropbox) = load_notes_deduped(dir.path());
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "Note V2");
        assert_eq!(notes[0].body, "New body");

        // The older one should have been moved to conflicts
        let conflicts_dir = dir.path().join(".scratch").join("conflicts");
        let conflict_entries: Vec<_> = fs::read_dir(&conflicts_dir)
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(conflict_entries.len(), 1);
    }

    #[test]
    fn test_load_notes_deduped_handles_dropbox_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        ensure_quicknotes_dirs(dir.path()).unwrap();

        let content = "---\nid: ABC123\ntitle: My Note\ncreated_at: 2026-01-01T00:00:00+00:00\nupdated_at: 2026-01-01T00:00:00+00:00\nencrypted: false\n---\n\nBody";

        // Normal file
        fs::write(dir.path().join("my-note--ABC123.md"), content).unwrap();
        // Dropbox conflict copy
        fs::write(
            dir.path().join("my-note--ABC123 (John's conflicted copy 2026-01-15).md"),
            content,
        )
        .unwrap();

        let (notes, dropbox_conflicts) = load_notes_deduped(dir.path());
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, "ABC123");
        assert_eq!(dropbox_conflicts.len(), 1);

        // Dropbox conflict should be moved to .scratch/conflicts/
        let conflicts_dir = dir.path().join(".scratch").join("conflicts");
        let entries: Vec<_> = fs::read_dir(&conflicts_dir).unwrap().flatten().collect();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn test_restore_note_from_trash() {
        let dir = tempfile::tempdir().unwrap();
        ensure_quicknotes_dirs(dir.path()).unwrap();

        let content = "---\nid: RESTORE1\ntitle: Restore Me\ncreated_at: 2026-01-01T00:00:00+00:00\nupdated_at: 2026-01-01T00:00:00+00:00\nencrypted: false\n---\n\nBody";
        let trash_dir = dir.path().join(".scratch").join("trash");
        fs::write(trash_dir.join("restore-me--RESTORE1.md"), content).unwrap();

        let note = restore_note_from_trash(dir.path(), "restore-me--RESTORE1.md").unwrap();
        assert_eq!(note.id, "RESTORE1");
        assert_eq!(note.title, "Restore Me");
        assert!(dir.path().join("restore-me--RESTORE1.md").exists());
        assert!(!trash_dir.join("restore-me--RESTORE1.md").exists());
    }

    #[test]
    fn test_check_folder_available() {
        let dir = tempfile::tempdir().unwrap();
        assert!(check_folder_available(dir.path()).is_ok());
        assert!(check_folder_available(Path::new("/nonexistent/path/xyz")).is_err());
    }

    #[test]
    fn test_save_conflict_copy() {
        let dir = tempfile::tempdir().unwrap();
        ensure_quicknotes_dirs(dir.path()).unwrap();

        let note_file = dir.path().join("my-note--ID1.md");
        fs::write(&note_file, "some content").unwrap();

        let result = save_conflict_copy(dir.path(), &note_file, "my-note", "ID1");
        assert!(result.is_ok());

        let conflict_path = result.unwrap();
        assert!(conflict_path.exists());
        let filename = conflict_path.file_name().unwrap().to_string_lossy();
        assert!(filename.starts_with("my-note--ID1--conflict-"));
        assert!(filename.ends_with(".md"));
    }
}
