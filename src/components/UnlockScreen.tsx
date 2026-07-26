import { useState, useRef, useEffect } from "react";
import { PasswordInput } from "./PasswordInput";
import { PinInput } from "./PinInput";
import { usePinEntry } from "../hooks/usePinEntry";
import type { PinUnlockResult } from "../hooks/useVault";

type Props = {
  onUnlock: (password: string) => Promise<boolean>;
  error: string | null;
  loading: boolean;
  /** Whether a PIN is enrolled for this vault on this device. */
  pinEnrolled?: boolean;
  /** Attempt a PIN unlock; returns the discriminated result. */
  onPinUnlock?: (pin: string) => Promise<PinUnlockResult>;
};

export function UnlockScreen({ onUnlock, error, loading, pinEnrolled, onPinUnlock }: Props) {
  const [password, setPassword] = useState("");
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  const pinEntry = usePinEntry({
    pinEnrolled,
    onPinSubmit: onPinUnlock,
    onSuccess: () => {}, // App swaps to the unlocked view on its own.
    inputRef: pinRef,
    formatWrong: (remaining) =>
      `Incorrect PIN. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`,
    wipedMessage: "Too many attempts. PIN removed — please use your password.",
  });

  useEffect(() => {
    if (pinEntry.usePin) pinRef.current?.focus();
    else inputRef.current?.focus();
  }, [pinEntry.usePin]);

  useEffect(() => {
    if (error || pinEntry.message) {
      setShake(true);
      const t = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(t);
    }
  }, [error, pinEntry.message]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    const success = await onUnlock(password);
    if (!success) {
      setPassword("");
      inputRef.current?.focus();
    }
  };

  return (
    <div className="unlock-screen">
      <div className={`unlock-content ${shake ? "shake" : ""}`}>
        <div className="unlock-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h2>Notes Locked</h2>

        {pinEntry.usePin && onPinUnlock ? (
          <>
            <p>Enter your PIN to unlock your notes.</p>
            <form onSubmit={pinEntry.submit}>
              <PinInput
                length={4}
                firstSlotRef={pinRef}
                value={pinEntry.pin}
                onChange={pinEntry.changePin}
                onComplete={(v) => pinEntry.submit(v)}
                autoFocus
                disabled={loading}
                error={!!pinEntry.message}
              />
              <button
                className="btn primary unlock-btn"
                type="submit"
                disabled={loading || pinEntry.busy || !pinEntry.canSubmit}
              >
                {loading || pinEntry.busy ? "Unlocking…" : "Unlock"}
              </button>
            </form>
            <button
              className="btn-link unlock-alt"
              type="button"
              disabled={loading}
              onClick={pinEntry.switchToPassword}
            >
              Use password instead
            </button>
            {pinEntry.message && <p className="unlock-error">{pinEntry.message}</p>}
          </>
        ) : (
          <>
            <p>Enter your password to unlock your notes.</p>
            <form onSubmit={handleSubmit}>
              <PasswordInput
                ref={inputRef}
                className="unlock-input"
                placeholder="Password"
                value={password}
                onChange={setPassword}
                error={!!error}
                disabled={loading}
              />
              <button className="btn primary unlock-btn" type="submit" disabled={loading}>
                {loading ? "Unlocking…" : "Unlock"}
              </button>
            </form>
            {pinEntry.available && (
              <button
                className="btn-link unlock-alt"
                type="button"
                disabled={loading}
                onClick={pinEntry.switchToPin}
              >
                Use PIN instead
              </button>
            )}
            {error && <p className="unlock-error">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
