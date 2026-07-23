import { useState, useRef, useEffect } from "react";
import { PasswordInput } from "./PasswordInput";

type Props = {
  onUnlock: (password: string) => Promise<boolean>;
  error: string | null;
  loading: boolean;
};

export function UnlockScreen({ onUnlock, error, loading }: Props) {
  const [password, setPassword] = useState("");
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
        {error && <p className="unlock-error">{error}</p>}
      </div>
    </div>
  );
}
