import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useUpdater } from "../hooks/useUpdater";
import { Dropdown } from "./Dropdown";
import type { AppSettings, VaultStatus } from "../types";

type SettingsTab = "general" | "keyboard" | "storage" | "security" | "markdown";

const isMac = navigator.platform.toUpperCase().includes("MAC");
const mod = isMac ? "Cmd" : "Ctrl";

function PasswordInput({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-input-wrapper">
      <input
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="settings-input"
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

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="settings-tooltip-wrapper">
      <svg className="settings-tooltip-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 16v-4"/>
        <path d="M12 8h.01"/>
      </svg>
      <span className="settings-tooltip">{text}</span>
    </span>
  );
}

type Props = {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  notesFolder: string | null;
  vaultStatus: VaultStatus;
  onClose: () => void;
  onSetupVault: (password: string) => Promise<boolean>;
  onLockVault: () => Promise<void>;
  onChangePassword: (current: string, newPassword: string) => Promise<boolean>;
  onDisableVault: (password: string) => Promise<boolean>;
  onReloadNotes: () => Promise<void>;
  onChangeFolder: (path: string) => Promise<void>;
  vaultError: string | null;
  vaultLoading: boolean;
};

export function Settings({
  settings,
  onSettingsChange,
  notesFolder,
  vaultStatus,
  onClose,
  onSetupVault,
  onLockVault,
  onChangePassword,
  onDisableVault,
  onReloadNotes,
  onChangeFolder,
  vaultError,
  vaultLoading,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const { updateState, updateVersion, checkForUpdate, installUpdate } =
    useUpdater();
  const [autoStart, setAutoStart] = useState(false);

  useEffect(() => {
    isEnabled().then(setAutoStart).catch(() => {});
  }, []);

  // Encryption setup form
  const [setupPassword, setSetupPassword] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [showSetupForm, setShowSetupForm] = useState(false);

  // Change password form
  const [showChangeForm, setShowChangeForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newConfirm, setNewConfirm] = useState("");
  const [changeError, setChangeError] = useState<string | null>(null);

  // Disable encryption form
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);

  const handleThemeChange = (theme: "system" | "light" | "dark") => {
    onSettingsChange({ ...settings, theme });
  };

  const handleConfirmDeleteChange = (confirmDelete: boolean) => {
    onSettingsChange({ ...settings, confirmDelete });
  };

  const handleChangeFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      await onChangeFolder(selected);
    }
  };

  const handleOpenFolder = async () => {
    if (notesFolder) {
      await revealItemInDir(notesFolder);
    }
  };

  const handleSetupVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError(null);
    if (setupPassword.length < 8) {
      setSetupError("Password must be at least 8 characters.");
      return;
    }
    if (setupPassword !== setupConfirm) {
      setSetupError("Passwords do not match.");
      return;
    }
    const success = await onSetupVault(setupPassword);
    if (success) {
      setShowSetupForm(false);
      setSetupPassword("");
      setSetupConfirm("");
    } else {
      setSetupError(vaultError || "Failed to set up encryption.");
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangeError(null);
    if (newPassword.length < 8) {
      setChangeError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== newConfirm) {
      setChangeError("New passwords do not match.");
      return;
    }
    const success = await onChangePassword(currentPassword, newPassword);
    if (success) {
      setShowChangeForm(false);
      setCurrentPassword("");
      setNewPassword("");
      setNewConfirm("");
    } else {
      setChangeError(vaultError || "Failed to change password.");
    }
  };

  const handleDisableVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableError(null);
    const success = await onDisableVault(disablePassword);
    if (success) {
      setShowDisableForm(false);
      setDisablePassword("");
      await onReloadNotes();
    } else {
      setDisableError(vaultError || "Failed to disable encryption.");
    }
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "keyboard", label: "Keyboard" },
    { id: "storage", label: "Storage" },
    { id: "security", label: "Security" },
    { id: "markdown", label: "Markdown" },
  ];

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`settings-tab ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {activeTab === "general" && (
              <div className="settings-section">
                <h3>Updates<InfoTooltip text="Checks for new versions from GitHub releases. Updates are downloaded and applied on restart." /></h3>
                <div className="settings-row">
                  <label>Version 0.1.0</label>
                  {updateState === "idle" && (
                    <button className="btn secondary" onClick={checkForUpdate}>
                      Check for Updates
                    </button>
                  )}
                  {updateState === "available" && (
                    <button className="btn primary" onClick={installUpdate}>
                      Update to {updateVersion}
                    </button>
                  )}
                  {updateState === "downloading" && (
                    <span className="settings-hint">Downloading...</span>
                  )}
                  {updateState === "ready" && (
                    <span className="settings-hint">
                      Restart to finish updating
                    </span>
                  )}
                  {updateState === "error" && (
                    <span className="settings-hint">Update failed</span>
                  )}
                </div>

                <h3>Appearance</h3>
                <div className="settings-row">
                  <label>Theme</label>
                  <Dropdown
                    value={settings.theme || "system"}
                    onChange={(v) => handleThemeChange(v as "system" | "light" | "dark")}
                    options={[
                      { value: "system", label: "System" },
                      { value: "light", label: "Light" },
                      { value: "dark", label: "Dark" },
                    ]}
                  />
                </div>
                <h3>Behavior</h3>
                <div className="settings-row">
                  <label htmlFor="confirm-delete">
                    Confirm before deleting
                  </label>
                  <input
                    id="confirm-delete"
                    type="checkbox"
                    checked={settings.confirmDelete !== false}
                    onChange={(e) =>
                      handleConfirmDeleteChange(e.target.checked)
                    }
                  />
                </div>
                <div className="settings-row">
                  <label htmlFor="auto-start">Launch at login</label>
                  <input
                    id="auto-start"
                    type="checkbox"
                    checked={autoStart}
                    onChange={async (e) => {
                      const checked = e.target.checked;
                      try {
                        if (checked) {
                          await enable();
                        } else {
                          await disable();
                        }
                        setAutoStart(checked);
                      } catch {
                        // ignore if autostart setup fails
                      }
                    }}
                  />
                </div>
                <div className="settings-row">
                  <label htmlFor="show-tray">Show in menu bar</label>
                  <input
                    id="show-tray"
                    type="checkbox"
                    checked={settings.showTrayIcon !== false}
                    onChange={(e) =>
                      onSettingsChange({
                        ...settings,
                        showTrayIcon: e.target.checked,
                      })
                    }
                  />
                </div>
              </div>
            )}

            {activeTab === "keyboard" && (
              <div className="settings-section">
                <h3>Global</h3>
                <div className="settings-row">
                  <label>Toggle window</label>
                  <kbd className="shortcut-display">{mod}+Shift+Space</kbd>
                </div>
                <h3>Navigation</h3>
                <div className="settings-row">
                  <label>Search / Find</label>
                  <span>
                    <kbd className="shortcut-display">{mod}+F</kbd>{" "}
                    <kbd className="shortcut-display">{mod}+L</kbd>
                  </span>
                </div>
                <div className="settings-row">
                  <label>Navigate notes up</label>
                  <kbd className="shortcut-display">↑</kbd>
                </div>
                <div className="settings-row">
                  <label>Navigate notes down</label>
                  <kbd className="shortcut-display">↓</kbd>
                </div>
                <h3>Notes</h3>
                <div className="settings-row">
                  <label>New note</label>
                  <kbd className="shortcut-display">{mod}+N</kbd>
                </div>
                <div className="settings-row">
                  <label>Delete note</label>
                  <kbd className="shortcut-display">{mod}+{isMac ? "Delete" : "Backspace"}</kbd>
                </div>
                <h3>Codex</h3>
                <div className="settings-row">
                  <label>Toggle sidebar</label>
                  <kbd className="shortcut-display">{mod}+/</kbd>
                </div>
                <div className="settings-row">
                  <label>Switch codex</label>
                  <kbd className="shortcut-display">{mod}+1–9</kbd>
                </div>
                <h3>App</h3>
                <div className="settings-row">
                  <label>Open settings</label>
                  <kbd className="shortcut-display">{mod}+,</kbd>
                </div>
                <div className="settings-row">
                  <label>Lock vault</label>
                  <kbd className="shortcut-display">{mod}+Shift+L</kbd>
                </div>
                <div className="settings-row">
                  <label>Hide window</label>
                  <kbd className="shortcut-display">Escape</kbd>
                </div>
              </div>
            )}

            {activeTab === "storage" && (
              <div className="settings-section">
                <h3>Notes Folder<InfoTooltip text="Where your notes are stored as Markdown files. Use a synced folder (Dropbox, iCloud) to access notes across devices." /></h3>
                <div className="settings-row">
                  <span className="folder-path">
                    {notesFolder || "Not set"}
                  </span>
                </div>
                <div className="settings-actions">
                  <button className="btn secondary" onClick={handleChangeFolder}>
                    Change Folder
                  </button>
                  <button
                    className="btn secondary"
                    onClick={handleOpenFolder}
                    disabled={!notesFolder}
                  >
                    Open Folder
                  </button>
                  <button className="btn secondary" onClick={onReloadNotes}>
                    Rebuild Index
                  </button>
                </div>
              </div>
            )}

            {activeTab === "security" && (
              <div className="settings-section">
                <h3>Auto-Lock<InfoTooltip text="Automatically locks the vault after a period of inactivity, requiring your password to access notes again." /></h3>
                <div className="settings-row">
                  <label>Lock after idle</label>
                  <Dropdown
                    value={String(settings.idleLockMinutes ?? 0)}
                    onChange={(v) =>
                      onSettingsChange({
                        ...settings,
                        idleLockMinutes: Number(v),
                      })
                    }
                    options={[
                      { value: "0", label: "Never" },
                      { value: "1", label: "1 minute" },
                      { value: "5", label: "5 minutes" },
                      { value: "15", label: "15 minutes" },
                      { value: "30", label: "30 minutes" },
                      { value: "60", label: "1 hour" },
                    ]}
                  />
                </div>
                <p className="settings-hint">
                  Vault also locks automatically when the system sleeps or the
                  screen locks.
                </p>

                <h3>Encryption<InfoTooltip text="Protects your notes with a password. When locked, notes are unreadable without re-entering the password. Your key is only held in memory, never saved to disk." /></h3>

                {vaultStatus === "plaintext" && !showSetupForm && (
                  <div className="settings-actions">
                    <p className="settings-warning">
                      If you forget your password, your notes cannot be recovered.
                      Notes remain encrypted on disk even if the app is
                      uninstalled, but reinstalling with the correct password will
                      restore access.
                    </p>
                    <button
                      className="btn primary"
                      onClick={() => setShowSetupForm(true)}
                    >
                      Enable Encryption
                    </button>
                  </div>
                )}

                {vaultStatus === "plaintext" && showSetupForm && (
                  <form
                    className="settings-form"
                    onSubmit={handleSetupVault}
                  >
                    <p className="settings-warning">
                      If you forget this password, your encrypted notes cannot
                      be recovered.
                    </p>
                    <PasswordInput
                      placeholder="Password (min 8 characters)"
                      value={setupPassword}
                      onChange={setSetupPassword}
                    />
                    <PasswordInput
                      placeholder="Confirm password"
                      value={setupConfirm}
                      onChange={setSetupConfirm}
                    />
                    {setupError && (
                      <p className="error">{setupError}</p>
                    )}
                    <div className="settings-actions">
                      <button
                        type="submit"
                        className="btn primary"
                        disabled={vaultLoading}
                      >
                        {vaultLoading ? "Encrypting..." : "Set Up Encryption"}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => {
                          setShowSetupForm(false);
                          setSetupError(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {vaultStatus === "unlocked" && (
                  <>
                    <p className="settings-hint">
                      Your notes are encrypted. The vault is currently unlocked.
                    </p>
                    <div className="settings-actions">
                      <button className="btn secondary" onClick={onLockVault}>
                        Lock Now
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() => { setShowChangeForm(true); setShowDisableForm(false); }}
                      >
                        Change Password
                      </button>
                      <button
                        className="btn danger-outline"
                        onClick={() => { setShowDisableForm(true); setShowChangeForm(false); }}
                      >
                        Disable Encryption
                      </button>
                    </div>

                    {showChangeForm && (
                      <form
                        className="settings-form"
                        onSubmit={handleChangePassword}
                      >
                        <PasswordInput
                          placeholder="Current password"
                          value={currentPassword}
                          onChange={setCurrentPassword}
                        />
                        <PasswordInput
                          placeholder="New password (min 8 characters)"
                          value={newPassword}
                          onChange={setNewPassword}
                        />
                        <PasswordInput
                          placeholder="Confirm new password"
                          value={newConfirm}
                          onChange={setNewConfirm}
                        />
                        {changeError && (
                          <p className="error">{changeError}</p>
                        )}
                        <div className="settings-actions">
                          <button
                            type="submit"
                            className="btn primary"
                            disabled={vaultLoading}
                          >
                            {vaultLoading
                              ? "Changing..."
                              : "Update Password"}
                          </button>
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => {
                              setShowChangeForm(false);
                              setChangeError(null);
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}

                    {showDisableForm && (
                      <form
                        className="settings-form"
                        onSubmit={handleDisableVault}
                      >
                        <p className="settings-warning">
                          This will decrypt all notes and remove encryption.
                          Enter your password to confirm.
                        </p>
                        <PasswordInput
                          placeholder="Current password"
                          value={disablePassword}
                          onChange={setDisablePassword}
                        />
                        {disableError && (
                          <p className="error">{disableError}</p>
                        )}
                        <div className="settings-actions">
                          <button
                            type="submit"
                            className="btn danger"
                            disabled={vaultLoading}
                          >
                            {vaultLoading
                              ? "Decrypting..."
                              : "Confirm Disable"}
                          </button>
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => {
                              setShowDisableForm(false);
                              setDisablePassword("");
                              setDisableError(null);
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </>
                )}

                {vaultStatus === "locked" && (
                  <p className="settings-hint">
                    Your vault is locked. Unlock from the main screen to manage
                    encryption settings.
                  </p>
                )}
              </div>
            )}

            {activeTab === "markdown" && (
              <div className="settings-section markdown-reference">
                <h3>Text Formatting</h3>
                <table className="md-ref-table">
                  <tbody>
                    <tr>
                      <td className="md-ref-syntax"># Heading 1</td>
                      <td className="md-ref-desc">Large heading</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">## Heading 2</td>
                      <td className="md-ref-desc">Medium heading</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">### Heading 3</td>
                      <td className="md-ref-desc">Small heading</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">**bold**</td>
                      <td className="md-ref-desc">Bold text</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">*italic*</td>
                      <td className="md-ref-desc">Italic text</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">~~strikethrough~~</td>
                      <td className="md-ref-desc">Strikethrough text</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">`inline code`</td>
                      <td className="md-ref-desc">Inline code</td>
                    </tr>
                  </tbody>
                </table>

                <h3>Code Blocks</h3>
                <div className="md-ref-codeblock">
                  <pre>{`\`\`\`javascript
const hello = "world";
console.log(hello);
\`\`\``}</pre>
                </div>
                <p className="settings-hint">
                  Supported languages: javascript, typescript, python, rust, go,
                  c, cpp, java, ruby, html, css, json, yaml, bash, sql, and
                  more.
                </p>

                <h3>Lists</h3>
                <table className="md-ref-table">
                  <tbody>
                    <tr>
                      <td className="md-ref-syntax">- item</td>
                      <td className="md-ref-desc">Unordered list</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">1. item</td>
                      <td className="md-ref-desc">Ordered list</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">- [ ] task</td>
                      <td className="md-ref-desc">Task list</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">- [x] done</td>
                      <td className="md-ref-desc">Completed task</td>
                    </tr>
                  </tbody>
                </table>

                <h3>Links &amp; Images</h3>
                <table className="md-ref-table">
                  <tbody>
                    <tr>
                      <td className="md-ref-syntax">[text](url)</td>
                      <td className="md-ref-desc">Hyperlink</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">![alt](url)</td>
                      <td className="md-ref-desc">Image</td>
                    </tr>
                  </tbody>
                </table>

                <h3>Other</h3>
                <table className="md-ref-table">
                  <tbody>
                    <tr>
                      <td className="md-ref-syntax">&gt; quote</td>
                      <td className="md-ref-desc">Blockquote</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">---</td>
                      <td className="md-ref-desc">Horizontal rule</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
