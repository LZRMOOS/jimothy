import type { Note } from "../types";

type Props = {
  notes: Note[];
  selectedId: string | null;
  onSelect: (id: string) => void;
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

export function NotesList({ notes, selectedId, onSelect }: Props) {
  if (notes.length === 0) {
    return (
      <div className="notes-list-empty">
        <p>No notes yet</p>
        <p className="hint">Type a title above and press Enter to create one</p>
      </div>
    );
  }

  return (
    <div className="notes-list">
      {notes.map((note) => (
        <div
          key={note.id}
          className={`note-item ${note.id === selectedId ? "selected" : ""}`}
          onClick={() => onSelect(note.id)}
        >
          <div className="note-item-title">
            {note.title || "Untitled"}
            {note.encrypted && <span className="encrypted-badge">🔒</span>}
          </div>
          <div className="note-item-preview">{getPreview(note.body)}</div>
          <div className="note-item-date">{formatDate(note.updated_at)}</div>
        </div>
      ))}
    </div>
  );
}
