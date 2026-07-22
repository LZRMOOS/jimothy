import { forwardRef } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onArrowDown: () => void;
  onArrowUp: () => void;
  onEscape: () => void;
};

export const SearchBar = forwardRef<HTMLInputElement, Props>(
  ({ value, onChange, onSubmit, onArrowDown, onArrowUp, onEscape }, ref) => {
    return (
      <div className="search-bar">
        <input
          ref={ref}
          type="text"
          className="search-input"
          placeholder="Search notes or type a title to create…"
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
      </div>
    );
  }
);
