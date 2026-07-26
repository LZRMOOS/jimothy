import { useState, useEffect, useCallback, type RefObject } from "react";
import type { PinUnlockResult } from "./useVault";

type Options = {
  /** Whether a PIN is enrolled for this gate. */
  pinEnrolled?: boolean;
  /** Attempt the unlock; returns the discriminated result. Absent = no PIN path. */
  onPinSubmit?: (pin: string) => Promise<PinUnlockResult>;
  /** Called once the PIN validates and the gate should open. */
  onSuccess: () => void;
  /** Focused after a wrong/error result so the user can retry. */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Message for a wrong PIN (remaining tries before wipe). */
  formatWrong?: (remaining: number) => string;
  /** Message shown after the escrow is wiped (null = show nothing, just flip). */
  wipedMessage?: string | null;
};

/**
 * Shared PIN-entry state machine for the unlock screen and the sensitive-note
 * prompt. Owns the digit buffer, the busy flag, the password/PIN mode toggle,
 * and the status handling (ok/wrong/wiped/not-enrolled/error) so both callers
 * stay identical by construction — they only differ in markup and copy.
 *
 * `usePin` starts on when a PIN is available and re-syncs if availability
 * changes, but a manual switch to the password isn't clobbered (the effect only
 * fires when availability itself flips).
 */
export function usePinEntry({
  pinEnrolled = false,
  onPinSubmit,
  onSuccess,
  inputRef,
  formatWrong = (remaining) =>
    `Wrong PIN. ${remaining} ${remaining === 1 ? "try" : "tries"} left.`,
  wipedMessage = null,
}: Options) {
  const available = pinEnrolled && !!onPinSubmit;
  const [usePin, setUsePin] = useState(available);
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUsePin(available);
  }, [available]);

  // Numeric only, capped at 4. Auto-submit is driven by PinInput's onComplete
  // (fires when the last slot fills), so we don't submit from here.
  const changePin = useCallback((raw: string) => {
    setPin(raw.replace(/\D/g, "").slice(0, 4));
    setMessage(null);
  }, []);

  const switchToPin = useCallback(() => {
    setUsePin(true);
    setMessage(null);
    setPin("");
  }, []);

  const switchToPassword = useCallback(() => {
    setUsePin(false);
    setMessage(null);
    setPin("");
  }, []);

  const submit = useCallback(
    async (arg?: React.FormEvent | string) => {
      // Auto-submit passes the just-completed value straight through: on the
      // keystroke that fills the 4th slot, our `pin` state hasn't re-rendered
      // yet, so relying on the closed-over `pin` would still see 3 digits.
      const explicit = typeof arg === "string" ? arg : undefined;
      if (arg && typeof arg !== "string") arg.preventDefault();
      const candidate = explicit ?? pin;
      if (!onPinSubmit || candidate.length < 4 || busy) return;
      setBusy(true);
      setMessage(null);
      try {
        const res = await onPinSubmit(candidate);
        switch (res.status) {
          case "ok":
            onSuccess();
            break;
          case "wrong":
            setPin("");
            setMessage(formatWrong(res.remaining));
            inputRef?.current?.focus();
            break;
          case "wiped":
            // Too many wrong tries — the PIN is gone. Fall back to the password.
            setPin("");
            setUsePin(false);
            setMessage(wipedMessage);
            break;
          case "not-enrolled":
            setPin("");
            setUsePin(false);
            break;
          case "error":
            setPin("");
            setMessage(res.message || "Something went wrong.");
            inputRef?.current?.focus();
            break;
        }
      } finally {
        setBusy(false);
      }
    },
    [onPinSubmit, pin, busy, onSuccess, formatWrong, wipedMessage, inputRef]
  );

  return {
    /** True when PIN entry is available at all (enrolled + handler). */
    available,
    /** Whether the PIN field (vs the password field) is showing. */
    usePin,
    pin,
    message,
    busy,
    /** PIN is long enough to submit. */
    canSubmit: pin.length >= 4,
    changePin,
    submit,
    switchToPin,
    switchToPassword,
  };
}
