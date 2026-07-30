import { forwardRef, useMemo, useState, useCallback, useEffect, useRef } from "react";
import type { VaultProfile } from "../types";
import { mod, modName } from "../utils/platform";
import { IonIcon } from "./IonIcon";

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
  dictionary?: string[];
  vaultProfiles?: VaultProfile[];
  activeFolder?: string | null;
  onVaultSwitch?: (path: string) => Promise<void>;
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
      dictionary = [],
      vaultProfiles = [],
      activeFolder,
      onVaultSwitch,
    },
    ref
  ) => {
    const [vaultOpen, setVaultOpen] = useState(false);
    const vaultRef = useRef<HTMLDivElement>(null);
    const activeVault = vaultProfiles.find(p => p.path === activeFolder);

    useEffect(() => {
      if (!vaultOpen) return;
      const handleClick = (e: MouseEvent) => {
        if (vaultRef.current && !vaultRef.current.contains(e.target as Node)) setVaultOpen(false);
      };
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }, [vaultOpen]);
    const tagSet = useMemo(() => new Set(activeTags.map((t) => t.toLowerCase())), [activeTags]);
    const dictSet = useMemo(() => new Set(dictionary.map((d) => d.toLowerCase())), [dictionary]);

    const highlightedValue = useMemo(() => {
      if (!value || (tagSet.size === 0 && dictSet.size === 0)) return null;
      const parts = value.split(/(\s+)/);
      let hasMatch = false;
      const rendered = parts.map((part, i) => {
        if (/^#[a-zA-Z]\w*$/.test(part) && tagSet.has(part.slice(1).toLowerCase())) {
          hasMatch = true;
          return <span key={i} className="search-tag-pill">{part}</span>;
        }
        if (/^@.+$/.test(part) && dictSet.has(part.slice(1).toLowerCase())) {
          hasMatch = true;
          return <span key={i} className="search-mention-pill">{part}</span>;
        }
        return <span key={i}>{part}</span>;
      });
      return hasMatch ? rendered : null;
    }, [value, tagSet, dictSet]);

    const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
    const [mentionSuggestions, setMentionSuggestions] = useState<string[]>([]);
    const [selectedSuggestion, setSelectedSuggestion] = useState(0);
    const [tagQuery, setTagQuery] = useState<{ start: number; fragment: string } | null>(null);
    const [mentionQuery, setMentionQuery] = useState<{ start: number; fragment: string } | null>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);

    const activeSuggestions = tagSuggestions.length > 0 ? tagSuggestions : mentionSuggestions;
    const activeSuggestionType = tagSuggestions.length > 0 ? "tag" : mentionSuggestions.length > 0 ? "mention" : null;

    const updateTagSuggestions = useCallback((inputValue: string, cursorPos: number) => {
      const before = inputValue.slice(0, cursorPos);
      const tagMatch = before.match(/#([a-zA-Z]\w*)$/);
      if (tagMatch) {
        const fragment = tagMatch[1].toLowerCase();
        const start = cursorPos - tagMatch[0].length;
        const matches = activeTags.filter((t) => t.toLowerCase().startsWith(fragment));
        setTagQuery({ start, fragment });
        setTagSuggestions(matches.slice(0, 8));
        setMentionQuery(null);
        setMentionSuggestions([]);
        setSelectedSuggestion(0);
        return;
      }
      setTagQuery(null);
      setTagSuggestions([]);

      const mentionMatch = before.match(/@(\S+)$/);
      if (mentionMatch && mentionMatch[1].length >= 1) {
        const fragment = mentionMatch[1].toLowerCase();
        const start = cursorPos - mentionMatch[0].length;
        const matches = dictionary.filter((d) => d.toLowerCase().includes(fragment));
        setMentionQuery({ start, fragment });
        setMentionSuggestions(matches.slice(0, 8));
        setSelectedSuggestion(0);
      } else {
        setMentionQuery(null);
        setMentionSuggestions([]);
      }
    }, [activeTags, dictionary]);

    const applyTagSuggestion = useCallback((tag: string) => {
      if (!tagQuery) return;
      const before = value.slice(0, tagQuery.start);
      const after = value.slice(tagQuery.start + 1 + tagQuery.fragment.length);
      const newValue = before + "#" + tag + (after.startsWith(" ") ? "" : " ") + after;
      onChange(newValue);
      setTagSuggestions([]);
      setTagQuery(null);
    }, [tagQuery, value, onChange]);

    const applyMentionSuggestion = useCallback((entry: string) => {
      if (!mentionQuery) return;
      const before = value.slice(0, mentionQuery.start);
      const after = value.slice(mentionQuery.start + 1 + mentionQuery.fragment.length);
      const newValue = before + "@" + entry + (after.startsWith(" ") ? "" : " ") + after;
      onChange(newValue);
      setMentionSuggestions([]);
      setMentionQuery(null);
    }, [mentionQuery, value, onChange]);

    useEffect(() => {
      if (activeSuggestions.length > 0 && suggestionsRef.current) {
        const selected = suggestionsRef.current.children[selectedSuggestion] as HTMLElement;
        selected?.scrollIntoView({ block: "nearest" });
      }
    }, [selectedSuggestion, activeSuggestions.length]);

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
                data-tour="search"
                placeholder={isCreateMode ? "Type title and press Enter..." : "Search or create notes..."}
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
                if (activeSuggestions.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSelectedSuggestion((s) => (s + 1) % activeSuggestions.length);
                    return;
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSelectedSuggestion((s) => (s - 1 + activeSuggestions.length) % activeSuggestions.length);
                    return;
                  } else if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    if (activeSuggestionType === "tag") {
                      applyTagSuggestion(activeSuggestions[selectedSuggestion]);
                    } else {
                      applyMentionSuggestion(activeSuggestions[selectedSuggestion]);
                    }
                    return;
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setTagSuggestions([]);
                    setTagQuery(null);
                    setMentionSuggestions([]);
                    setMentionQuery(null);
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
              {activeSuggestions.length > 0 && (
                <div className="search-tag-suggestions" ref={suggestionsRef}>
                  {activeSuggestions.map((item, i) => (
                    <div
                      key={item}
                      className={`search-tag-suggestion ${i === selectedSuggestion ? "selected" : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (activeSuggestionType === "tag") {
                          applyTagSuggestion(item);
                        } else {
                          applyMentionSuggestion(item);
                        }
                      }}
                      onMouseEnter={() => setSelectedSuggestion(i)}
                    >
                      {activeSuggestionType === "tag" ? `#${item}` : `@${item}`}
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
                      <span><span className="helper-icon">{mod}⏎</span> Create</span>
                    </>
                  )}
                </div>
              )}
              {onCommandPaletteClick && (
                <button
                  className="search-bar-action-btn"
                  data-tour="command-palette"
                  onClick={onCommandPaletteClick}
                  title={`Command Palette (${modName}+K)`}
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
              data-tour="settings"
              onClick={onSettingsClick}
              title={`Settings (${modName}+,)`}
              aria-label="Settings"
            >
              <IonIcon name="menu-outline" size={15} />
            </button>
          )}
          {vaultProfiles.length > 1 && onVaultSwitch && (
            <div className="vault-switcher header-vault-switcher" ref={vaultRef}>
              <button className="vault-switcher-btn" onClick={() => setVaultOpen(!vaultOpen)} title="Switch vault">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={activeVault?.color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
                <span className="vault-switcher-name">{activeVault?.name || "Vault"}</span>
                <svg className="vault-switcher-chevron" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {vaultOpen && (
                <div className="vault-switcher-menu">
                  {vaultProfiles.map((p) => (
                    <button
                      key={p.path}
                      className={`vault-switcher-option ${p.path === activeFolder ? "active" : ""}`}
                      onClick={() => { if (p.path !== activeFolder) onVaultSwitch(p.path); setVaultOpen(false); }}
                      title={p.path}
                    >
                      <span className="vault-switcher-option-dot" style={p.color ? { color: p.color } : undefined}>{p.path === activeFolder ? "●" : "○"}</span>
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);
