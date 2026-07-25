import { useState, useEffect, useRef, useMemo } from "react";
import type { Note } from "../types";

export type Command = {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
};

type Props = {
  commands: Command[];
  pinnedIds?: string[];
  onTogglePin?: (id: string) => void;
  onClose: () => void;
  notes?: Note[];
  onSelectNote?: (id: string) => void;
};

type PaletteItem =
  | { type: "command"; command: Command }
  | { type: "note"; note: Note };

export function CommandPalette({ commands, pinnedIds = [], onTogglePin, onClose, notes = [], onSelectNote }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items: PaletteItem[] = useMemo(() => {
    const trimmed = query.trim().toLowerCase();

    let cmdList = commands;
    if (trimmed) {
      const terms = trimmed.split(/\s+/);
      cmdList = commands.filter((cmd) => {
        const label = cmd.label.toLowerCase();
        return terms.every((t) => label.includes(t));
      });
    }
    const pinned = cmdList.filter((cmd) => pinnedIds.includes(cmd.id));
    const unpinned = cmdList.filter((cmd) => !pinnedIds.includes(cmd.id));
    const sortedCmds = [...pinned, ...unpinned];

    const cmdItems: PaletteItem[] = sortedCmds.map((c) => ({ type: "command", command: c }));

    if (!trimmed || !onSelectNote) return cmdItems;

    const terms = trimmed.split(/\s+/);
    const matchingNotes = notes
      .filter((n) => {
        if (n.archived) return false;
        const title = n.title.toLowerCase();
        return terms.every((t) => title.includes(t));
      })
      .slice(0, 8);

    const noteItems: PaletteItem[] = matchingNotes.map((n) => ({ type: "note", note: n }));

    return [...cmdItems, ...noteItems];
  }, [commands, query, pinnedIds, notes, onSelectNote]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const runItem = (item: PaletteItem) => {
    onClose();
    if (item.type === "command") {
      item.command.action();
    } else if (item.type === "note" && onSelectNote) {
      onSelectNote(item.note.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[selectedIndex]) runItem(items[selectedIndex]);
    }
  };

  const hasCommands = items.some((i) => i.type === "command");
  const hasNotes = items.some((i) => i.type === "note");

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          placeholder="Search notes or commands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
        <div className="command-palette-list" ref={listRef}>
          {hasCommands && hasNotes && items[0]?.type === "command" && (
            <div className="command-palette-section-label">Commands</div>
          )}
          {items.map((item, i) => {
            const showNoteHeader = item.type === "note" && (i === 0 || items[i - 1]?.type === "command");

            return (
              <>
                {showNoteHeader && (
                  <div className="command-palette-section-label" key="notes-header">Notes</div>
                )}
                <button
                  key={item.type === "command" ? item.command.id : `note-${item.note.id}`}
                  className={`command-palette-item ${i === selectedIndex ? "selected" : ""}`}
                  onClick={() => runItem(item)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span className="command-palette-label">
                    {item.type === "command" ? item.command.label : item.note.title}
                  </span>
                  <span className="command-palette-actions">
                    {item.type === "command" && item.command.shortcut && (
                      <span className="command-palette-shortcut">{item.command.shortcut}</span>
                    )}
                    {item.type === "command" && onTogglePin && (
                      <span
                        className={`command-palette-pin${pinnedIds.includes(item.command.id) ? " pinned" : ""}`}
                        onClick={(e) => { e.stopPropagation(); onTogglePin(item.command.id); }}
                        title={pinnedIds.includes(item.command.id) ? "Unpin" : "Pin to top"}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill={pinnedIds.includes(item.command.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                      </span>
                    )}
                    {item.type === "note" && item.note.codex && (
                      <span className="command-palette-codex">{item.note.codex}</span>
                    )}
                  </span>
                </button>
              </>
            );
          })}
          {items.length === 0 && (
            <div className="command-palette-empty">No matching commands or notes</div>
          )}
        </div>
      </div>
    </div>
  );
}
