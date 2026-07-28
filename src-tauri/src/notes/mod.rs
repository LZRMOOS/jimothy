use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ulid::Ulid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub encrypted: bool,
    pub file_path: String,
    pub codex: Option<String>,
    pub archived: bool,
}

/// Notes are named on disk purely by id (`{id}.md`/`.snote`/`.pnote`), so an id
/// containing a path separator or `..` must never reach a path join — a
/// frontmatter value like `../../../etc/passwd` would otherwise let a
/// synced-in file read or write outside the notes folder. This intentionally
/// stays looser than "is a well-formed ULID" (existing ids predate ULID-only
/// generation in some test/legacy paths) and only blocks traversal.
pub fn is_safe_note_id(id: &str) -> bool {
    !id.is_empty()
        && !id.contains('/')
        && !id.contains('\\')
        && !id.contains("..")
        && id != "."
}

impl Note {
    pub fn new(title: String) -> Self {
        let id = Ulid::new().to_string();
        let now = Utc::now();
        Self {
            id,
            title,
            body: String::new(),
            created_at: now,
            updated_at: now,
            encrypted: false,
            file_path: String::new(),
            codex: None,
            archived: false,
        }
    }
}

pub fn serialize_note(note: &Note) -> String {
    let codex_line = match &note.codex {
        Some(c) if !c.is_empty() => format!("codex: {}\n", c),
        _ => String::new(),
    };
    let archived_line = if note.archived { "archived: true\n" } else { "" };
    format!(
        "---\nid: {}\ntitle: {}\ncreated_at: {}\nupdated_at: {}\nencrypted: {}\n{}{}---\n\n{}",
        note.id,
        note.title,
        note.created_at.to_rfc3339(),
        note.updated_at.to_rfc3339(),
        note.encrypted,
        codex_line,
        archived_line,
        note.body
    )
}

pub fn parse_note(content: &str, file_path: &str) -> Option<Note> {
    if !content.starts_with("---\n") {
        return None;
    }

    let end = content[4..].find("\n---\n")?;
    let frontmatter = &content[4..4 + end];
    let body_start = 4 + end + 5; // skip past "\n---\n"
    let body = if body_start < content.len() {
        content[body_start..].trim_start_matches('\n').to_string()
    } else {
        String::new()
    };

    let mut id = String::new();
    let mut title = String::new();
    let mut created_at: Option<DateTime<Utc>> = None;
    let mut updated_at: Option<DateTime<Utc>> = None;
    let mut encrypted = false;
    let mut codex: Option<String> = None;
    let mut archived = false;

    for line in frontmatter.lines() {
        if let Some((key, value)) = line.split_once(": ") {
            let value = value.trim();
            match key.trim() {
                "id" => id = value.to_string(),
                "title" => title = value.to_string(),
                "created_at" => {
                    created_at = DateTime::parse_from_rfc3339(value)
                        .ok()
                        .map(|dt| dt.with_timezone(&Utc));
                }
                "updated_at" => {
                    updated_at = DateTime::parse_from_rfc3339(value)
                        .ok()
                        .map(|dt| dt.with_timezone(&Utc));
                }
                "encrypted" => encrypted = value == "true",
                "codex" => {
                    if !value.is_empty() {
                        codex = Some(value.to_string());
                    }
                }
                "archived" => archived = value == "true",
                _ => {}
            }
        }
    }

    if !is_safe_note_id(&id) {
        return None;
    }

    Some(Note {
        id,
        title,
        body,
        created_at: created_at.unwrap_or_else(Utc::now),
        updated_at: updated_at.unwrap_or_else(Utc::now),
        encrypted,
        file_path: file_path.to_string(),
        codex,
        archived,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_note() {
        let note = Note::new("Test".to_string());
        assert_eq!(note.title, "Test");
        assert!(note.body.is_empty());
        assert!(!note.encrypted);
        assert!(!note.id.is_empty());
    }

    #[test]
    fn test_serialize_and_parse_roundtrip() {
        let note = Note::new("My Note".to_string());
        let serialized = serialize_note(&note);
        let parsed = parse_note(&serialized, "/tmp/test.md").unwrap();
        assert_eq!(parsed.id, note.id);
        assert_eq!(parsed.title, "My Note");
        assert_eq!(parsed.body, "");
    }

    #[test]
    fn test_parse_with_body() {
        let content = "---\nid: ABC123\ntitle: Hello\ncreated_at: 2026-01-01T00:00:00+00:00\nupdated_at: 2026-01-01T00:00:00+00:00\nencrypted: false\n---\n\nThis is the body.\nSecond line.";
        let note = parse_note(content, "test.md").unwrap();
        assert_eq!(note.id, "ABC123");
        assert_eq!(note.title, "Hello");
        assert_eq!(note.body, "This is the body.\nSecond line.");
    }

    #[test]
    fn test_parse_rejects_path_traversal_id() {
        let content = "---\nid: ../../../etc/passwd\ntitle: Evil\n---\n\nBody";
        assert!(parse_note(content, "test.md").is_none());
    }

    #[test]
    fn test_is_safe_note_id() {
        assert!(is_safe_note_id("01JABC123"));
        assert!(!is_safe_note_id(""));
        assert!(!is_safe_note_id("../secret"));
        assert!(!is_safe_note_id("a/b"));
        assert!(!is_safe_note_id("a\\b"));
        assert!(!is_safe_note_id(".."));
    }

    #[test]
    fn test_parse_invalid_no_frontmatter() {
        let result = parse_note("Just some text", "test.md");
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_invalid_no_id() {
        let content = "---\ntitle: No ID\n---\n\nBody";
        let result = parse_note(content, "test.md");
        assert!(result.is_none());
    }
}
