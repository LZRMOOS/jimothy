import { useState, useEffect, useRef } from "react";
import { PasswordInput } from "./PasswordInput";

type Props = {
  onSetup: (password: string) => Promise<boolean>;
  onCancel?: () => void;
};

export function ProtectionSetup({ onSetup, onCancel }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errField, setErrField] = useState<"password" | "confirm" | null>(null);
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onCancel) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrField(null);
    if (!password.trim()) {
      setError("Password cannot be empty");
      setErrField("password");
      triggerShake();
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      setErrField("confirm");
      triggerShake();
      return;
    }
    setError(null);
    setLoading(true);
    const ok = await onSetup(password);
    setLoading(false);
    if (!ok) {
      setError("Failed to set up protection");
      triggerShake();
    }
  };

  return (
    <div className="sensitive-prompt">
      <div className={`sensitive-prompt-content ${shake ? "shake" : ""}`}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        <p className="sensitive-prompt-title">Set Up Note Protection</p>
        <p className="sensitive-prompt-hint">
          This password will be used to encrypt all notes you mark as protected.
          Note contents are encrypted on disk while titles remain searchable.
        </p>
        <p className="sensitive-prompt-hint sensitive-prompt-advice">
          No rules on length or characters, it's all up to you. A few random
          words make a password that's easy to remember and hard to crack. Don't
          reuse one from elsewhere, and keep it safe: there's no way to recover
          it if you forget it.
        </p>
        <form onSubmit={handleSubmit}>
          <PasswordInput
            ref={inputRef}
            className="unlock-input"
            placeholder="Password"
            value={password}
            onChange={setPassword}
            error={errField === "password"}
          />
          <PasswordInput
            className="unlock-input"
            placeholder="Confirm password"
            value={confirm}
            onChange={setConfirm}
            error={errField === "confirm"}
          />
          {error && <p className="unlock-error">{error}</p>}
          <button
            className="btn primary unlock-btn"
            type="submit"
            disabled={!password.trim() || !confirm.trim() || loading}
          >
            {loading ? "Setting up…" : "Set Password"}
          </button>
          {onCancel && (
            <button
              className="btn ghost unlock-btn"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
