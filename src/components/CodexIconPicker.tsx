import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { EmojiEntry } from "../extensions/emoji";

type Props = {
  value: string;
  emojis: EmojiEntry[];
  anchorEl: HTMLElement | null;
  onSelect: (value: string) => void;
  onClose: () => void;
};

/**
 * Render a codex icon value. Values are either a `:name:` custom-emoji
 * shortcode or a literal string (unicode emoji or letter).
 */
export function renderCodexIcon(
  value: string | undefined,
  emojis: EmojiEntry[],
  fallback: string,
) {
  if (!value) return <span className="codex-sidebar-letter">{fallback}</span>;
  const match = value.match(/^:([a-zA-Z0-9_-]+):$/);
  if (match) {
    const emoji = emojis.find((e) => e.name === match[1]);
    if (emoji) {
      return <img className="codex-icon-emoji" src={convertFileSrc(emoji.path)} alt={value} />;
    }
    // Missing emoji: fall back to the shortcode's first letter.
    return <span className="codex-sidebar-letter">{fallback}</span>;
  }
  return <span className="codex-sidebar-letter">{value}</span>;
}

export function CodexIconPicker({ value, emojis, anchorEl, onSelect, onClose }: Props) {
  const [text, setText] = useState(value);
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });

  // When the text starts with ":", offer emoji-name autocomplete.
  const suggestions = useMemo(() => {
    const m = text.match(/^:([a-zA-Z0-9_-]*)$/);
    if (!m) return [];
    const q = m[1].toLowerCase();
    return emojis.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 6);
  }, [text, emojis]);

  useEffect(() => {
    setHighlight(0);
  }, [text]);

  useLayoutEffect(() => {
    if (!anchorEl || !ref.current) return;
    const anchor = anchorEl.getBoundingClientRect();
    const menu = ref.current.getBoundingClientRect();
    let left = anchor.right + 6;
    if (left + menu.width > window.innerWidth - 8) {
      left = anchor.left - menu.width - 6;
    }
    let top = anchor.top;
    if (top + menu.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - menu.height - 8);
    }
    setPos({ left, top });
  }, [anchorEl, suggestions.length]);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && e.target !== anchorEl) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose, anchorEl]);

  const commit = (raw: string) => {
    // Emoji shortcodes render as an image, but literal text sits inside the
    // small icon slot — cap it so it can't overflow the codex button.
    const v = raw.trim().slice(0, 3);
    onSelect(v);
    onClose();
  };

  const pickSuggestion = (name: string) => {
    onSelect(`:${name}:`);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickSuggestion(suggestions[highlight].name);
        return;
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(text);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div className="codex-icon-picker" ref={ref} style={{ left: pos.left, top: pos.top }}>
      <input
        className="codex-input"
        autoFocus
        placeholder="Letter or :emoji:"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {suggestions.length > 0 && (
        <div className="mention-menu codex-icon-suggestions">
          {suggestions.map((e, i) => (
            <button
              key={e.name}
              className={`mention-item emoji-item${i === highlight ? " selected" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pickSuggestion(e.name)}
            >
              <img className="emoji-item-img" src={convertFileSrc(e.path)} alt={e.name} />
              <span>:{e.name}:</span>
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
