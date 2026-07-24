import { forwardRef, useMemo, useState, useCallback, useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCreate: () => void;
  onArrowDown: () => void;
  onArrowUp: () => void;
  onEscape: () => void;
  onSettingsClick?: () => void;
  onCommandPaletteClick?: () => void;
  isCreateMode?: boolean;
  activeTags?: string[];
};

export const SearchBar = forwardRef<HTMLInputElement, Props>(
  (
    {
      value,
      onChange,
      onSubmit,
      onCreate,
      onArrowDown,
      onArrowUp,
      onEscape,
      onSettingsClick,
      onCommandPaletteClick,
      isCreateMode,
      activeTags = [],
    },
    ref
  ) => {
    const tagSet = useMemo(() => new Set(activeTags.map((t) => t.toLowerCase())), [activeTags]);

    const highlightedValue = useMemo(() => {
      if (!value || tagSet.size === 0) return null;
      const parts = value.split(/(\s+)/);
      let hasMatch = false;
      const rendered = parts.map((part, i) => {
        if (/^#[a-zA-Z]\w*$/.test(part) && tagSet.has(part.slice(1).toLowerCase())) {
          hasMatch = true;
          return <span key={i} className="search-tag-pill">{part}</span>;
        }
        return <span key={i}>{part}</span>;
      });
      return hasMatch ? rendered : null;
    }, [value, tagSet]);

    const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
    const [selectedSuggestion, setSelectedSuggestion] = useState(0);
    const [tagQuery, setTagQuery] = useState<{ start: number; fragment: string } | null>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);

    const updateTagSuggestions = useCallback((inputValue: string, cursorPos: number) => {
      const before = inputValue.slice(0, cursorPos);
      const match = before.match(/#([a-zA-Z]\w*)$/);
      if (match) {
        const fragment = match[1].toLowerCase();
        const start = cursorPos - match[0].length;
        const matches = activeTags.filter((t) => t.toLowerCase().startsWith(fragment));
        setTagQuery({ start, fragment });
        setTagSuggestions(matches.slice(0, 8));
        setSelectedSuggestion(0);
      } else {
        setTagQuery(null);
        setTagSuggestions([]);
      }
    }, [activeTags]);

    const applyTagSuggestion = useCallback((tag: string) => {
      if (!tagQuery) return;
      const before = value.slice(0, tagQuery.start);
      const after = value.slice(tagQuery.start + 1 + tagQuery.fragment.length);
      const newValue = before + "#" + tag + (after.startsWith(" ") ? "" : " ") + after;
      onChange(newValue);
      setTagSuggestions([]);
      setTagQuery(null);
    }, [tagQuery, value, onChange]);

    useEffect(() => {
      if (tagSuggestions.length > 0 && suggestionsRef.current) {
        const selected = suggestionsRef.current.children[selectedSuggestion] as HTMLElement;
        selected?.scrollIntoView({ block: "nearest" });
      }
    }, [selectedSuggestion, tagSuggestions.length]);

    return (
      <div className="search-bar" data-tauri-drag-region>
        <div className="search-bar-inner">
          <div className="search-input-container">
            <div className="search-input-wrapper">
              <svg className="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={ref}
                type="text"
                className="search-input"
                placeholder={isCreateMode ? "Type note title and press Enter..." : "Search notes or type a title to create..."}
                value={value}
              onChange={(e) => {
                onChange(e.target.value);
                updateTagSuggestions(e.target.value, e.target.selectionStart || 0);
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              onKeyDown={(e) => {
                if (tagSuggestions.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSelectedSuggestion((s) => (s + 1) % tagSuggestions.length);
                    return;
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSelectedSuggestion((s) => (s - 1 + tagSuggestions.length) % tagSuggestions.length);
                    return;
                  } else if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    applyTagSuggestion(tagSuggestions[selectedSuggestion]);
                    return;
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setTagSuggestions([]);
                    setTagQuery(null);
                    return;
                  }
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (e.metaKey || e.ctrlKey) {
                    onCreate();
                  } else {
                    onSubmit();
                  }
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  onArrowDown();
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  onArrowUp();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onEscape();
                }
              }}
          />
              {highlightedValue && (
                <div className="search-input-overlay" aria-hidden="true">
                  {highlightedValue}
                </div>
              )}
              {tagSuggestions.length > 0 && (
                <div className="search-tag-suggestions" ref={suggestionsRef}>
                  {tagSuggestions.map((tag, i) => (
                    <div
                      key={tag}
                      className={`search-tag-suggestion ${i === selectedSuggestion ? "selected" : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyTagSuggestion(tag);
                      }}
                      onMouseEnter={() => setSelectedSuggestion(i)}
                    >
                      #{tag}
                    </div>
                  ))}
                </div>
              )}
              {(value || isCreateMode) && (
                <div className="search-helper">
                  {isCreateMode ? (
                    <span><span className="helper-icon">⏎</span> Create</span>
                  ) : (
                    <>
                      <span><span className="helper-icon">⏎</span> Open</span>
                      <span><span className="helper-icon">⌘⏎</span> Create</span>
                    </>
                  )}
                </div>
              )}
              {onCommandPaletteClick && (
                <button
                  className="search-bar-action-btn"
                  onClick={onCommandPaletteClick}
                  title="Command Palette (Cmd+K)"
                  aria-label="Command Palette"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
          {onSettingsClick && (
            <button
              className="settings-gear-btn"
              onClick={onSettingsClick}
              title="Settings (Cmd+,)"
              aria-label="Settings"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }
);
