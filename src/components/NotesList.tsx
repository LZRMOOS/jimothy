import { useState } from "react";
import type { Note } from "../types";
import { buildSearchPattern } from "../utils/search";

type Props = {
  notes: Note[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleSensitive?: (id: string) => void;
  pinnedIds: string[];
  sensitiveIds: string[];
  searchQuery?: string;
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function getPreview(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "No content";
  const firstLine = trimmed.split("\n")[0];
  return firstLine.length > 80 ? firstLine.slice(0, 80) + "…" : firstLine;
}

type ContextMenuState = {
  noteId: string;
  x: number;
  y: number;
} | null;

function highlightMatches(text: string, query: string): React.ReactNode {
  const regex = buildSearchPattern(query);
  if (!regex) return text;
  const splitter = new RegExp(`(${regex.source})`, "gi");
  const parts = text.split(splitter);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="search-highlight">{part}</mark>
    ) : (
      part
    )
  );
}

export function NotesList({ notes, selectedId, onSelect, onDelete, onTogglePin, onToggleSensitive, pinnedIds, sensitiveIds, searchQuery = "" }: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  const handleContextMenu = (e: React.MouseEvent, noteId: string) => {
    e.preventDefault();
    onSelect(noteId);
    setContextMenu({ noteId, x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleCopyMarkdown = (noteId: string) => {
    const note = notes.find(n => n.id === noteId);
    if (!note) return;

    // Format as markdown with title and body
    const markdown = `# ${note.title}\n\n${note.body}`;
    navigator.clipboard.writeText(markdown);
    closeContextMenu();
  };

  if (notes.length === 0) {
    return (
      <div className="notes-list-empty">
        <p>No notes yet</p>
        <p className="hint">Type a title above and press Enter to create one</p>
      </div>
    );
  }

  const pinned = notes.filter((n) => pinnedIds.includes(n.id));
  const unpinned = notes.filter((n) => !pinnedIds.includes(n.id));
  const sorted = [...pinned, ...unpinned];

  return (
    <div className="notes-list" onClick={closeContextMenu}>
      {sorted.map((note) => (
        <div
          key={note.id}
          className={`note-item ${note.id === selectedId ? "selected" : ""} ${pinnedIds.includes(note.id) ? "pinned" : ""}`}
          onClick={() => onSelect(note.id)}
          onContextMenu={(e) => handleContextMenu(e, note.id)}
        >
          <div className="note-item-header">
            <div className="note-item-title">
              {sensitiveIds.includes(note.id) && (
                <svg className="sensitive-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              )}
              {highlightMatches(note.title || "Untitled", searchQuery)}
            </div>
            <div className="note-item-actions">
              <button
                className={`note-action-btn ${pinnedIds.includes(note.id) ? "active" : ""}`}
                onClick={(e) => { e.stopPropagation(); onTogglePin(note.id); }}
                title={pinnedIds.includes(note.id) ? "Unpin" : "Pin"}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill={pinnedIds.includes(note.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </button>
            </div>
          </div>
          <div className="note-item-preview">
            {sensitiveIds.includes(note.id) && !note.body ? (
              <span className="protected-placeholder">Protected note</span>
            ) : (
              highlightMatches(getPreview(note.body), searchQuery)
            )}
          </div>
          <div className="note-item-footer">
            <div className="note-item-date">{formatDate(note.updated_at)}</div>
            {note.codex && (
              <div className="note-codex-pill">{note.codex}</div>
            )}
          </div>
        </div>
      ))}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              onTogglePin(contextMenu.noteId);
              closeContextMenu();
            }}
          >
            {pinnedIds.includes(contextMenu.noteId) ? "Unpin Note" : "Pin Note"}
          </button>
          {onToggleSensitive && (
            <button
              className="context-menu-item"
              onClick={() => {
                onToggleSensitive(contextMenu.noteId);
                closeContextMenu();
              }}
            >
              {sensitiveIds.includes(contextMenu.noteId)
                ? "Remove File Protection" : "Protect File"}
            </button>
          )}
          <button
            className="context-menu-item"
            onClick={() => handleCopyMarkdown(contextMenu.noteId)}
          >
            Copy as Markdown
          </button>
          <button
            className="context-menu-item danger"
            onClick={() => {
              onDelete(contextMenu.noteId);
              closeContextMenu();
            }}
          >
            Delete Note
          </button>
        </div>
      )}
    </div>
  );
}
