import { useState } from "react";
import type { Note } from "../types";

type Props = {
  notes: Note[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
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
  if (!query.trim()) return text;
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const regex = new RegExp(`(${pattern})`, "gi");
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="search-highlight">{part}</mark>
    ) : (
      part
    )
  );
}

export function NotesList({ notes, selectedId, onSelect, onDelete, searchQuery = "" }: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  const handleContextMenu = (e: React.MouseEvent, noteId: string) => {
    e.preventDefault();
    onSelect(noteId);
    setContextMenu({ noteId, x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

  if (notes.length === 0) {
    return (
      <div className="notes-list-empty">
        <p>No notes yet</p>
        <p className="hint">Type a title above and press Enter to create one</p>
      </div>
    );
  }

  return (
    <div className="notes-list" onClick={closeContextMenu}>
      {notes.map((note) => (
        <div
          key={note.id}
          className={`note-item ${note.id === selectedId ? "selected" : ""}`}
          onClick={() => onSelect(note.id)}
          onContextMenu={(e) => handleContextMenu(e, note.id)}
        >
          <div className="note-item-title">
            {highlightMatches(note.title || "Untitled", searchQuery)}
          </div>
          <div className="note-item-preview">{highlightMatches(getPreview(note.body), searchQuery)}</div>
          <div className="note-item-date">{formatDate(note.updated_at)}</div>
        </div>
      ))}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
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
