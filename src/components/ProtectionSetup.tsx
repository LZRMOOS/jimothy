import { useState, useEffect, useRef } from "react";
import { PasswordInput } from "./PasswordInput";

type Props = {
  onSetup: (password: string) => Promise<boolean>;
};

export function ProtectionSetup({ onSetup }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError("Password cannot be empty");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setError(null);
    setLoading(true);
    const ok = await onSetup(password);
    setLoading(false);
    if (!ok) {
      setError("Failed to set up protection");
    }
  };

  return (
    <div className="sensitive-prompt">
      <div className="sensitive-prompt-content">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        <p className="sensitive-prompt-title">Set Up File Protection</p>
        <p className="sensitive-prompt-hint">
          This password will be used to encrypt all files you mark as protected.
          Note contents are encrypted on disk while titles remain searchable.
        </p>
        <form onSubmit={handleSubmit}>
          <PasswordInput
            ref={inputRef}
            className="unlock-input"
            placeholder="Password"
            value={password}
            onChange={setPassword}
          />
          <PasswordInput
            className="unlock-input"
            placeholder="Confirm password"
            value={confirm}
            onChange={setConfirm}
          />
          {error && <p className="unlock-error">{error}</p>}
          <button
            className="btn primary unlock-btn"
            type="submit"
            disabled={!password.trim() || !confirm.trim() || loading}
          >
            {loading ? "Setting up…" : "Set Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
