import { forwardRef } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onArrowDown: () => void;
  onArrowUp: () => void;
  onEscape: () => void;
  onSettingsClick?: () => void;
};

export const SearchBar = forwardRef<HTMLInputElement, Props>(
  (
    {
      value,
      onChange,
      onSubmit,
      onArrowDown,
      onArrowUp,
      onEscape,
      onSettingsClick,
    },
    ref
  ) => {
    return (
      <div className="search-bar">
        <div className="search-bar-inner">
          <input
            ref={ref}
            type="text"
            className="search-input"
            placeholder="Search notes or type a title to create..."
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
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
          {onSettingsClick && (
            <button
              className="settings-gear-btn"
              onClick={onSettingsClick}
              title="Settings (Cmd+,)"
              aria-label="Settings"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6.86 1.45a1.2 1.2 0 0 1 2.28 0l.2.6a1.2 1.2 0 0 0 1.57.72l.57-.26a1.2 1.2 0 0 1 1.61 1.14l-.02.62a1.2 1.2 0 0 0 1.1 1.22l.62.05a1.2 1.2 0 0 1 .79 1.97l-.42.46a1.2 1.2 0 0 0 .04 1.64l.42.46a1.2 1.2 0 0 1-.79 1.97l-.62.05a1.2 1.2 0 0 0-1.1 1.22l.02.62a1.2 1.2 0 0 1-1.61 1.14l-.57-.26a1.2 1.2 0 0 0-1.57.72l-.2.6a1.2 1.2 0 0 1-2.28 0l-.2-.6a1.2 1.2 0 0 0-1.57-.72l-.57.26a1.2 1.2 0 0 1-1.61-1.14l.02-.62a1.2 1.2 0 0 0-1.1-1.22l-.62-.05a1.2 1.2 0 0 1-.79-1.97l.42-.46a1.2 1.2 0 0 0-.04-1.64l-.42-.46a1.2 1.2 0 0 1 .79-1.97l.62-.05A1.2 1.2 0 0 0 2.93 4.27l-.02-.62A1.2 1.2 0 0 1 4.52 2.51l.57.26a1.2 1.2 0 0 0 1.57-.72l.2-.6Z" />
                <circle cx="8" cy="8" r="2.5" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }
);
