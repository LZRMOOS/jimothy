import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

type Props = {
  onUnlock: () => void;
  onVerify?: (password: string) => Promise<boolean>;
  verifyCommand?: string;
  title?: string;
  hint?: string;
};

export function SensitivePrompt({
  onUnlock,
  onVerify,
  verifyCommand = "verify_password",
  title = "This note is protected",
  hint = "This note is encrypted with file protection. Enter your protection password to decrypt and view its contents.",
}: Props) {
  const [password, setPassword] = useState("");
  const [errorCount, setErrorCount] = useState(0);
  const [shake, setShake] = useState(false);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (errorCount > 0) {
      setShake(true);
      const t = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(t);
    }
  }, [errorCount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    try {
      const valid = onVerify
        ? await onVerify(password)
        : await invoke<boolean>(verifyCommand, { password });
      if (valid) {
        onUnlock();
      } else {
        setErrorCount((c) => c + 1);
        setPassword("");
        inputRef.current?.focus();
      }
    } catch {
      setErrorCount((c) => c + 1);
      setPassword("");
      inputRef.current?.focus();
    }
  };

  return (
    <div className="sensitive-prompt">
      <div className={`sensitive-prompt-content ${shake ? "shake" : ""}`}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <p className="sensitive-prompt-title">{title}</p>
        <p className="sensitive-prompt-hint">{hint}</p>
        <form onSubmit={handleSubmit}>
          <div className="password-input-wrapper">
            <input
              ref={inputRef}
              type={visible ? "text" : "password"}
              className={`unlock-input ${errorCount > 0 ? "unlock-input-error" : ""}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
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
          <button className="btn primary unlock-btn" type="submit" disabled={!password.trim()}>
            Unlock
          </button>
        </form>
        {errorCount > 0 && <p className="unlock-error">Invalid password</p>}
      </div>
    </div>
  );
}
