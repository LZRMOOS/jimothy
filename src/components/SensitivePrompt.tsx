import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PasswordInput } from "./PasswordInput";
import { PinInput } from "./PinInput";
import { usePinEntry } from "../hooks/usePinEntry";
import type { PinUnlockResult } from "../hooks/useVault";

type Props = {
  onUnlock: () => void;
  onCancel?: () => void;
  onNavigate?: (direction: 1 | -1) => void;
  onVerify?: (password: string) => Promise<boolean>;
  verifyCommand?: string;
  title?: string;
  hint?: string;
  // When a PIN can satisfy this gate, pass the enrolled flag and a submit
  // handler. The prompt then defaults to PIN entry with a link to fall back to
  // the password. onPinSubmit shares the vault's attempt counter, so a wiped
  // escrow flips the UI back to password automatically.
  pinEnrolled?: boolean;
  onPinSubmit?: (pin: string) => Promise<PinUnlockResult>;
};

export function SensitivePrompt({
  onUnlock,
  onCancel,
  onNavigate,
  onVerify,
  verifyCommand = "verify_password",
  title = "This note is protected",
  hint = "This note is encrypted with note protection. Enter your protection password to decrypt and view its contents.",
  pinEnrolled = false,
  onPinSubmit,
}: Props) {
  const [password, setPassword] = useState("");
  const [errorCount, setErrorCount] = useState(0);
  const [shake, setShake] = useState(false);
  const [emptyError, setEmptyError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);

  const pinEntry = usePinEntry({
    pinEnrolled,
    onPinSubmit,
    onSuccess: onUnlock,
    inputRef: pinInputRef,
    formatWrong: (remaining) =>
      remaining <= 3
        ? `Wrong PIN. ${remaining} ${remaining === 1 ? "try" : "tries"} left before it's disabled.`
        : "Wrong PIN.",
  });

  useEffect(() => {
    if (pinEntry.usePin) pinInputRef.current?.focus();
    else inputRef.current?.focus();
  }, [pinEntry.usePin]);

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
    if (errorCount > 0 || pinEntry.message) {
      setShake(true);
      const t = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(t);
    }
  }, [errorCount, pinEntry.message]);

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
        <p className="sensitive-prompt-hint">
          {pinEntry.usePin ? "Enter your PIN to unlock this note." : hint}
        </p>
        {pinEntry.usePin ? (
          <form onSubmit={pinEntry.submit}>
            <PinInput
              length={4}
              firstSlotRef={pinInputRef}
              value={pinEntry.pin}
              onChange={pinEntry.changePin}
              onComplete={(v) => pinEntry.submit(v)}
              autoFocus
              error={!!pinEntry.message}
            />
            <button className="btn primary unlock-btn" type="submit" disabled={!pinEntry.canSubmit || pinEntry.busy}>
              {pinEntry.busy ? "Unlocking…" : "Unlock"}
            </button>
            {pinEntry.message && <p className="unlock-error">{pinEntry.message}</p>}
            <button
              type="button"
              className="btn-link unlock-alt"
              onClick={pinEntry.switchToPassword}
            >
              Use password instead
            </button>
          </form>
        ) : (
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
            {emptyError && <p className="unlock-error">Password required</p>}
            {errorCount > 0 && !emptyError && <p className="unlock-error">Invalid password</p>}
            {pinEntry.available && (
              <button
                type="button"
                className="btn-link unlock-alt"
                onClick={() => {
                  pinEntry.switchToPin();
                  setErrorCount(0);
                  setPassword("");
                }}
              >
                Use PIN instead
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
