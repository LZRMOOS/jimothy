import { useState, useRef, useEffect } from "react";
import { PasswordInput } from "./PasswordInput";

type Props = {
  onUnlock: (password: string) => Promise<boolean>;
  error: string | null;
  loading: boolean;
  /** Whether Touch ID is enrolled for this vault on this device. */
  biometricEnrolled?: boolean;
  /** Trigger a Touch ID unlock; resolves true on success. */
  onBiometricUnlock?: () => Promise<boolean>;
};

export function UnlockScreen({ onUnlock, error, loading, biometricEnrolled, onBiometricUnlock }: Props) {
  const [password, setPassword] = useState("");
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoPrompted = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Offer Touch ID immediately when enrolled, so the common case is one tap and
  // no typing. Only auto-prompt once per mount; if the user cancels they fall
  // back to the password field (and can retap the button).
  useEffect(() => {
    if (biometricEnrolled && onBiometricUnlock && !autoPrompted.current) {
      autoPrompted.current = true;
      void onBiometricUnlock();
    }
  }, [biometricEnrolled, onBiometricUnlock]);

  useEffect(() => {
    if (error) {
      setShake(true);
      const t = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(t);
    }
  }, [error]);

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
        {biometricEnrolled && onBiometricUnlock && (
          <button
            className="btn unlock-biometric-btn"
            type="button"
            disabled={loading}
            onClick={() => { void onBiometricUnlock(); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 11a3 3 0 0 0-3 3v2m3-8a6 6 0 0 1 6 6v1m-9 0v-1a3 3 0 0 1 .5-1.7M5 9a9 9 0 0 1 14 0M8.5 6.5A6 6 0 0 1 12 5.5"/>
            </svg>
            Unlock with Touch ID
          </button>
        )}
        {error && <p className="unlock-error">{error}</p>}
      </div>
    </div>
  );
}
