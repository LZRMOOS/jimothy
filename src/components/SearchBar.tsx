import { forwardRef } from "react";

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
    },
    ref
  ) => {
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
              onChange={(e) => onChange(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              onKeyDown={(e) => {
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
