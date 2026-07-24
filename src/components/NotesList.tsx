import { useState, useMemo } from "react";
import type { Note } from "../types";
import { highlightMatches } from "../utils/search";

type Props = {
  notes: Note[];
  allNotes?: Note[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleSensitive?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  onToggleFreeze?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onOpenSplit?: (id: string) => void;
  pinnedIds: string[];
  sensitiveIds: string[];
  frozenIds?: string[];
  searchQuery?: string;
  codexColors?: Record<string, string>;
  expandedIds?: Set<string>;
  onToggleExpand?: (id: string) => void;
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


export function NotesList({ notes, allNotes, selectedId, onSelect, onDelete, onTogglePin, onToggleSensitive, onToggleArchive, onToggleFreeze, onDuplicate, onOpenSplit, pinnedIds, sensitiveIds, frozenIds = [], searchQuery = "", codexColors, expandedIds: expandedIdsProp, onToggleExpand }: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [localExpanded, setLocalExpanded] = useState<Set<string>>(new Set());
  const expandedIds = expandedIdsProp || localExpanded;

  const handleContextMenu = (e: React.MouseEvent, noteId: string) => {
    e.preventDefault();
    onSelect(noteId);
    setContextMenu({ noteId, x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleCopyMarkdown = (noteId: string) => {
    const note = notes.find(n => n.id === noteId);
    if (!note) return;

    const markdown = `# ${note.title}\n\n${note.body}`;
    navigator.clipboard.writeText(markdown);
    closeContextMenu();
  };

  const backlinkMap = useMemo(() => {
    const source = allNotes || notes;
    const map = new Map<string, { id: string; title: string }[]>();
    for (const note of notes) {
      const pattern = `scratch://${note.id}`;
      const links = source
        .filter((n) => n.id !== note.id && n.body.includes(pattern))
        .map((n) => ({ id: n.id, title: n.title || "Untitled" }));
      if (links.length > 0) {
        map.set(note.id, links);
      }
    }
    return map;
  }, [notes, allNotes]);

  const toggleExpand = (id: string) => {
    if (onToggleExpand) {
      onToggleExpand(id);
    } else {
      setLocalExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
  };

  const sorted = useMemo(() => {
    const pinned = notes.filter((n) => pinnedIds.includes(n.id));
    const unpinned = notes.filter((n) => !pinnedIds.includes(n.id));
    return [...pinned, ...unpinned];
  }, [notes, pinnedIds]);

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
      {sorted.map((note) => {
        const backlinks = backlinkMap.get(note.id);
        const isExpanded = expandedIds.has(note.id);

        return (
          <div key={note.id}>
            <div
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
                <div className="note-item-footer-right">
                  {note.codex && (
                    <div
                      className="note-codex-pill"
                      style={codexColors?.[note.codex] ? { background: codexColors[note.codex] + "20", color: codexColors[note.codex] } : undefined}
                    >{note.codex}</div>
                  )}
                  {backlinks && (
                    <button
                      className={`backlink-toggle ${isExpanded ? "expanded" : ""}`}
                      onClick={(e) => { e.stopPropagation(); toggleExpand(note.id); }}
                      aria-label={isExpanded ? "Collapse backlinks" : "Expand backlinks"}
                    >
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                        <path d="M2 1L6 4L2 7z"/>
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
            {backlinks && isExpanded && (
              <div className="backlink-children">
                {backlinks.map((bl) => (
                  <div
                    key={bl.id}
                    className={`backlink-child-item ${bl.id === selectedId ? "selected" : ""}`}
                    onClick={() => onSelect(bl.id)}
                  >
                    <svg className="backlink-child-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 17H7A5 5 0 0 1 7 7h2"/>
                      <path d="M15 7h2a5 5 0 0 1 0 10h-2"/>
                      <line x1="8" y1="12" x2="16" y2="12"/>
                    </svg>
                    <span className="backlink-child-title">{bl.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
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
          {onToggleFreeze && (
            <button
              className="context-menu-item"
              onClick={() => {
                onToggleFreeze(contextMenu.noteId);
                closeContextMenu();
              }}
            >
              {frozenIds.includes(contextMenu.noteId) ? "Unfreeze Note" : "Freeze Note"}
            </button>
          )}
          {onDuplicate && (
            <button
              className="context-menu-item"
              onClick={() => {
                onDuplicate(contextMenu.noteId);
                closeContextMenu();
              }}
            >
              Duplicate Note
            </button>
          )}
          {onOpenSplit && (
            <button
              className="context-menu-item"
              onClick={() => {
                onOpenSplit(contextMenu.noteId);
                closeContextMenu();
              }}
            >
              Open in Split View
            </button>
          )}
          <button
            className="context-menu-item"
            onClick={() => handleCopyMarkdown(contextMenu.noteId)}
          >
            Copy as Markdown
          </button>
          {onToggleArchive && (
            <button
              className="context-menu-item subtle"
              onClick={() => {
                onToggleArchive(contextMenu.noteId);
                closeContextMenu();
              }}
            >
              {notes.find((n) => n.id === contextMenu.noteId)?.archived
                ? "Unarchive Note" : "Archive Note"}
            </button>
          )}
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
