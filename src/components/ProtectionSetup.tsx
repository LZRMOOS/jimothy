import { useState, useEffect, useRef } from "react";

type Props = {
  onSetup: (password: string) => Promise<boolean>;
};

function PasswordField({
  inputRef,
  placeholder,
  value,
  onChange,
}: {
  inputRef?: React.RefObject<HTMLInputElement | null>;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-input-wrapper">
      <input
        ref={inputRef}
        type={visible ? "text" : "password"}
        className="unlock-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible(!visible)}
        tabIndex={-1}
      >
        {visible ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        )}
      </button>
    </div>
  );
}

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
          <PasswordField
            inputRef={inputRef}
            placeholder="Password"
            value={password}
            onChange={setPassword}
          />
          <PasswordField
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
