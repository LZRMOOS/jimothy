use std::fs;
use std::path::{Path, PathBuf};

use unicode_normalization::UnicodeNormalization;

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
}
