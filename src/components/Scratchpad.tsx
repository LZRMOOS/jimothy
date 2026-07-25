import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { mod } from "../utils/platform";

type ScratchpadEntry = {
  id: string;
  text: string;
  timestamp: string;
};

export function Scratchpad() {
  const [entries, setEntries] = useState<ScratchpadEntry[]>([]);
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadEntries = useCallback(async () => {
    try {
      const result = await invoke<ScratchpadEntry[]>("get_scratchpad_entries");
      setEntries(result);
    } catch {
      // No entries yet
    }
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    textareaRef.current?.focus();
    const handleFocus = () => textareaRef.current?.focus();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text) return;

    try {
      await invoke("append_scratchpad_entry", { text });
      setInput("");
      loadEntries();
      textareaRef.current?.focus();
    } catch (e) {
      console.error("Failed to save entry:", e);
    }
  };

  const hideWindow = useCallback(() => {
    getCurrentWindow().hide();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideWindow();
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke("delete_scratchpad_entry", { id });
      loadEntries();
    } catch (e) {
      console.error("Failed to delete entry:", e);
    }
  };

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.key === "w" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        hideWindow();
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [hideWindow]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <div className="scratchpad" data-tauri-drag-region>
      <div className="scratchpad-header" data-tauri-drag-region>
        <span className="scratchpad-title">Scratchpad</span>
        <span className="scratchpad-count">{entries.length}</span>
      </div>
      <div className="scratchpad-input-area">
        <textarea
          ref={textareaRef}
          className="scratchpad-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Jot something down..."
          rows={3}
        />
        <button
          className="scratchpad-submit"
          onClick={handleSubmit}
          disabled={!input.trim()}
        >
          Save
        </button>
      </div>
      <div className="scratchpad-entries">
        {entries.length === 0 && (
          <div className="scratchpad-empty">
            Nothing here yet. Type above and press {mod}Enter to save.
          </div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className="scratchpad-entry">
            <div className="scratchpad-entry-text">{entry.text}</div>
            <div className="scratchpad-entry-footer">
              <span className="scratchpad-entry-time">{formatTime(entry.timestamp)}</span>
              <div className="scratchpad-entry-actions">
                <button
                  className="scratchpad-entry-btn"
                  onClick={() => handleCopy(entry.text, entry.id)}
                  title="Copy"
                >
                  {copiedId === entry.id ? "✓" : "⎘"}
                </button>
                <button
                  className="scratchpad-entry-btn scratchpad-entry-btn-delete"
                  onClick={() => handleDelete(entry.id)}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
