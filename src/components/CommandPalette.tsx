import { useState, useEffect, useRef, useMemo } from "react";

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
};

export function CommandPalette({ commands, pinnedIds = [], onTogglePin, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    let list = commands;
    if (query.trim()) {
      const terms = query.toLowerCase().split(/\s+/);
      list = commands.filter((cmd) => {
        const label = cmd.label.toLowerCase();
        return terms.every((t) => label.includes(t));
      });
    }
    const pinned = list.filter((cmd) => pinnedIds.includes(cmd.id));
    const unpinned = list.filter((cmd) => !pinnedIds.includes(cmd.id));
    return [...pinned, ...unpinned];
  }, [commands, query, pinnedIds]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const runCommand = (cmd: Command) => {
    onClose();
    cmd.action();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIndex]) runCommand(filtered[selectedIndex]);
    }
  };

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
        <div className="command-palette-list" ref={listRef}>
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`command-palette-item ${i === selectedIndex ? "selected" : ""}`}
              onClick={() => runCommand(cmd)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="command-palette-label">{cmd.label}</span>
              <span className="command-palette-actions">
                {cmd.shortcut && (
                  <span className="command-palette-shortcut">{cmd.shortcut}</span>
                )}
                {onTogglePin && (
                  <span
                    className={`command-palette-pin${pinnedIds.includes(cmd.id) ? " pinned" : ""}`}
                    onClick={(e) => { e.stopPropagation(); onTogglePin(cmd.id); }}
                    title={pinnedIds.includes(cmd.id) ? "Unpin" : "Pin to top"}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill={pinnedIds.includes(cmd.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                  </span>
                )}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="command-palette-empty">No matching commands</div>
          )}
        </div>
      </div>
    </div>
  );
}
