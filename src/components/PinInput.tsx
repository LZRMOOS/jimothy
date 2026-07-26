import { useRef, useEffect, type RefObject } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Fired when the last slot fills (value reaches `length`). */
  onComplete?: (value: string) => void;
  /** Number of digit slots to render. PINs are a fixed 4 digits. */
  length?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  error?: boolean;
  /** Mask digits as dots (default) vs. showing them. */
  mask?: boolean;
  ariaLabel?: string;
  /** Attaches to the first slot so callers can refocus it (e.g. after a wrong
   * PIN clears the value and the active slot is back at the start). */
  firstSlotRef?: RefObject<HTMLInputElement | null>;
};

/**
 * Segmented PIN entry: one box per digit. The value is modeled as a single
 * left-to-right contiguous string (PINs aren't edited mid-sequence), so typing
 * always appends to the next empty slot and Backspace removes the last digit.
 * Emits digits-only, capped at `length`.
 */
export function PinInput({
  value,
  onChange,
  onComplete,
  length = 4,
  autoFocus,
  disabled,
  error,
  mask = true,
  ariaLabel = "PIN",
  firstSlotRef,
}: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  // Pending auto-submit timer. We wait a beat after the last digit so the final
  // box visibly fills before the form fires, and so a quick correction (typing
  // past, then backspacing) can cancel it.
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCompleteTimer = () => {
    if (completeTimer.current) {
      clearTimeout(completeTimer.current);
      completeTimer.current = null;
    }
  };

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  // Clear any pending auto-submit if we unmount mid-delay.
  useEffect(() => clearCompleteTimer, []);

  // Focus the active slot: the next empty one, capped at the last box.
  const focusAt = (len: number) => {
    refs.current[Math.min(len, length - 1)]?.focus();
  };

  const commit = (next: string) => {
    clearCompleteTimer();
    onChange(next);
    focusAt(next.length);
    if (next.length === length) {
      completeTimer.current = setTimeout(() => {
        completeTimer.current = null;
        onComplete?.(next);
      }, 200);
    }
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      if (value.length < length) commit(value + e.key);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      clearCompleteTimer();
      const next = value.slice(0, -1);
      onChange(next);
      focusAt(next.length);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      refs.current[Math.max(0, i - 1)]?.focus();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      refs.current[Math.min(length - 1, i + 1)]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (disabled) return;
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (digits) commit(digits);
  };

  // Clicking past the filled digits snaps focus back to the active slot so
  // typing never lands in a visually disconnected box.
  const handleFocus = (i: number) => {
    if (i > value.length) focusAt(value.length);
  };

  return (
    <div className={`pin-slots${error ? " error" : ""}`}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
            if (i === 0 && firstSlotRef) firstSlotRef.current = el;
          }}
          className="pin-slot"
          type={mask ? "password" : "text"}
          inputMode="numeric"
          autoComplete="off"
          maxLength={1}
          value={value[i] ?? ""}
          disabled={disabled}
          aria-label={`${ariaLabel} digit ${i + 1}`}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={() => handleFocus(i)}
          onPaste={handlePaste}
          onChange={() => {}}
        />
      ))}
    </div>
  );
}
