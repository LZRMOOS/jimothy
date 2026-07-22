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
