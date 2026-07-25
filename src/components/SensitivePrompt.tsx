import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PasswordInput } from "./PasswordInput";

type Props = {
  onUnlock: () => void;
  onCancel?: () => void;
  onNavigate?: (direction: 1 | -1) => void;
  onVerify?: (password: string) => Promise<boolean>;
  verifyCommand?: string;
  title?: string;
  hint?: string;
};

export function SensitivePrompt({
  onUnlock,
  onCancel,
  onNavigate,
  onVerify,
  verifyCommand = "verify_password",
  title = "This note is protected",
  hint = "This note is encrypted with note protection. Enter your protection password to decrypt and view its contents.",
}: Props) {
  const [password, setPassword] = useState("");
  const [errorCount, setErrorCount] = useState(0);
  const [shake, setShake] = useState(false);
  const [emptyError, setEmptyError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onCancel) {
        onCancel();
      } else if (e.key === "ArrowDown" && onNavigate) {
        e.preventDefault();
        onNavigate(1);
      } else if (e.key === "ArrowUp" && onNavigate) {
        e.preventDefault();
        onNavigate(-1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, onNavigate]);

  useEffect(() => {
    if (errorCount > 0) {
      setShake(true);
      const t = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(t);
    }
  }, [errorCount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setEmptyError(true);
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setEmptyError(false);
      }, 500);
      return;
    }
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
          <PasswordInput
            ref={inputRef}
            className="unlock-input"
            placeholder="Password"
            value={password}
            onChange={setPassword}
            error={errorCount > 0 || emptyError}
          />
          <button className="btn primary unlock-btn" type="submit">
            Unlock
          </button>
        </form>
        {emptyError && <p className="unlock-error">Password required</p>}
        {errorCount > 0 && !emptyError && <p className="unlock-error">Invalid password</p>}
      </div>
    </div>
  );
}
