import { useState, useRef, useEffect } from "react";

type Props = {
  onUnlock: (password: string) => Promise<boolean>;
  error: string | null;
  loading: boolean;
};

export function UnlockScreen({ onUnlock, error, loading }: Props) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
      <div className="unlock-content">
        <div className="unlock-icon">&#128274;</div>
        <h2>Notes Locked</h2>
        <p>Enter your password to unlock your notes.</p>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="password"
            className="unlock-input"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
          <button className="btn primary" type="submit" disabled={loading}>
            {loading ? "Unlocking…" : "Unlock"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
