import { useState, useRef, useEffect, useLayoutEffect } from "react";
import type { ReactNode } from "react";

type Option = {
  value: string;
  label: string;
  icon?: ReactNode;
  dividerAfter?: boolean;
};

type Props = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

export function Dropdown({ options, value, onChange, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  // Flip the menu upward when there isn't enough room below the trigger (e.g.
  // a dropdown near the bottom of the settings pane). useLayoutEffect so the
  // direction is decided before paint, avoiding a flash at the wrong spot.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const trigger = ref.current.getBoundingClientRect();
    const menuMax = 200; // keep in sync with .dropdown-menu max-height
    const spaceBelow = window.innerHeight - trigger.bottom;
    const spaceAbove = trigger.top;
    setDropUp(spaceBelow < menuMax + 8 && spaceAbove > spaceBelow);
  }, [open]);

  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setHighlightIndex(idx >= 0 ? idx : 0);
    }
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, options.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < options.length) {
          onChange(options[highlightIndex].value);
          setOpen(false);
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, highlightIndex, options, onChange]);

  return (
    <div className={`dropdown ${className}`} ref={ref}>
      <button
        className="dropdown-trigger"
        onClick={() => setOpen((s) => !s)}
        type="button"
      >
        <span className="dropdown-value">{selected?.label || ""}</span>
        <svg className="dropdown-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none">
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className={`dropdown-menu${dropUp ? " drop-up" : ""}`}>
          {options.map((opt, i) => (
            <div key={opt.value}>
              <button
                className={`dropdown-item${opt.value === value ? " selected" : ""}${i === highlightIndex ? " highlighted" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                onMouseEnter={() => setHighlightIndex(i)}
                type="button"
              >
                {opt.icon && <span className="dropdown-item-icon">{opt.icon}</span>}
                {opt.label}
              </button>
              {opt.dividerAfter && <div className="dropdown-divider" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
