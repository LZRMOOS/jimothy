import { useState, useEffect, useRef, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { Dropdown } from "./Dropdown";
import { PasswordInput } from "./PasswordInput";
import type { AppSettings, VaultStatus, ThemeColors, ColorPreset } from "../types";

type SettingsTab = "general" | "organization" | "keyboard" | "macros" | "dictionary" | "colors" | "storage" | "security" | "markdown";

function NoteProtectionSection({
  protectionStatus,
  onChangeProtectionPassword,
  onDisableProtection,
  protectionError,
  protectionLoading,
  onReloadNotes,
  showToast,
}: {
  protectionStatus: ProtectionStatus;
  onChangeProtectionPassword: (current: string, newPassword: string) => Promise<boolean>;
  onDisableProtection: (password: string) => Promise<boolean>;
  protectionError: string | null;
  protectionLoading: boolean;
  onReloadNotes: () => Promise<void>;
  showToast: (msg: string) => void;
}) {
  const [showDisable, setShowDisable] = useState(false);
  const [showChange, setShowChange] = useState(false);
  const [disablePw, setDisablePw] = useState("");
  const [disableErr, setDisableErr] = useState<string | null>(null);
  const [disableShake, setDisableShake] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newConfirm, setNewConfirm] = useState("");
  const [changeErr, setChangeErr] = useState<string | null>(null);
  const [changeErrField, setChangeErrField] = useState<"current" | "new" | "confirm" | null>(null);
  const [changeShake, setChangeShake] = useState(false);

  const triggerShake = (setter: (v: boolean) => void) => {
    setter(true);
    setTimeout(() => setter(false), 500);
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableErr(null);
    const ok = await onDisableProtection(disablePw);
    if (ok) {
      setShowDisable(false);
      setDisablePw("");
      await onReloadNotes();
      showToast("File protection disabled");
    } else {
      setDisableErr(protectionError || "Failed to disable protection.");
      triggerShake(setDisableShake);
      setDisablePw("");
    }
  };

  const handleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangeErr(null);
    setChangeErrField(null);
    if (!newPw.trim()) {
      setChangeErr("New password cannot be empty.");
      setChangeErrField("new");
      triggerShake(setChangeShake);
      return;
    }
    if (newPw !== newConfirm) {
      setChangeErr("Passwords do not match.");
      setChangeErrField("confirm");
      triggerShake(setChangeShake);
      return;
    }
    const ok = await onChangeProtectionPassword(currentPw, newPw);
    if (ok) {
      setShowChange(false);
      setCurrentPw("");
      setNewPw("");
      setNewConfirm("");
      showToast("Protection password changed");
    } else {
      setChangeErr(protectionError || "Invalid current password.");
      setChangeErrField("current");
      triggerShake(setChangeShake);
      setCurrentPw("");
    }
  };

  return (
    <>
      <h3>File Protection<InfoTooltip><ul><li>Encrypt individual notes while keeping the rest as plaintext</li><li>All protected files share a single password</li><li>Protected files are stored as .pnote files on disk</li><li>When vault is also enabled, file protection adds a re-authentication gate for marked notes</li></ul></InfoTooltip></h3>
      {protectionStatus === "none" && (
        <p className="settings-hint">
          No protection password set. Right-click a note and select &ldquo;Protect
          File&rdquo; to set up per-file encryption.
        </p>
      )}
      {(protectionStatus === "locked" || protectionStatus === "unlocked") && !showDisable && !showChange && (
        <>
          <p className="settings-hint">
            File protection is active. Protected files are individually encrypted
            on disk.
          </p>
          <div className="settings-actions">
            <button
              className="btn secondary"
              onClick={() => { setShowChange(true); setShowDisable(false); }}
            >
              Change Password
            </button>
            <button
              className="btn danger-outline"
              onClick={() => { setShowDisable(true); setShowChange(false); }}
            >
              Disable File Protection
            </button>
          </div>
        </>
      )}
      {showChange && (
        <form className={`settings-form ${changeShake ? "shake" : ""}`} onSubmit={handleChange}>
          <PasswordInput
            placeholder="Current password"
            value={currentPw}
            onChange={setCurrentPw}
            error={changeErrField === "current"}
          />
          <PasswordInput
            placeholder="New password"
            value={newPw}
            onChange={setNewPw}
            error={changeErrField === "new"}
          />
          <PasswordInput
            placeholder="Confirm new password"
            value={newConfirm}
            onChange={setNewConfirm}
            error={changeErrField === "confirm"}
          />
          {changeErr && <p className="error">{changeErr}</p>}
          <div className="settings-actions">
            <button
              type="submit"
              className="btn primary"
              disabled={protectionLoading}
            >
              {protectionLoading ? "Changing..." : "Update Password"}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => { setShowChange(false); setChangeErr(null); setCurrentPw(""); setNewPw(""); setNewConfirm(""); }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {showDisable && (
        <form className={`settings-form ${disableShake ? "shake" : ""}`} onSubmit={handleDisable}>
          <p className="settings-warning">
            This will decrypt all protected files back to plaintext.
          </p>
          <PasswordInput
            placeholder="Protection password"
            value={disablePw}
            onChange={setDisablePw}
            error={!!disableErr}
          />
          {disableErr && <p className="error">{disableErr}</p>}
          <div className="settings-actions">
            <button
              type="submit"
              className="btn danger"
              disabled={protectionLoading}
            >
              {protectionLoading ? "Decrypting..." : "Confirm Disable"}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => { setShowDisable(false); setDisablePw(""); setDisableErr(null); }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </>
  );
}

const isMac = navigator.platform.toUpperCase().includes("MAC");
const mod = isMac ? "Cmd" : "Ctrl";

function keyToTauriToken(_key: string, code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const map: Record<string, string> = {
    Space: "Space", Backslash: "Backslash", Slash: "Slash",
    BracketLeft: "BracketLeft", BracketRight: "BracketRight",
    Semicolon: "Semicolon", Quote: "Quote", Comma: "Comma",
    Period: "Period", Minus: "Minus", Equal: "Equal",
    Backquote: "Backquote", Enter: "Enter", Backspace: "Backspace",
    Tab: "Tab", Escape: "Escape", ArrowUp: "Up", ArrowDown: "Down",
    ArrowLeft: "Left", ArrowRight: "Right",
  };
  if (code.startsWith("F") && !isNaN(Number(code.slice(1)))) return code;
  return map[code] || null;
}

const keyDisplayNames: Record<string, string> = {
  Backslash: "\\", Slash: "/", BracketLeft: "[", BracketRight: "]",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Minus: "-",
  Equal: "=", Backquote: "`", Space: "Space", Enter: "Enter",
  Backspace: "Delete", Tab: "Tab", Escape: "Esc",
  Up: "↑", Down: "↓", Left: "←", Right: "→",
};

function shortcutToDisplay(shortcut: string): string {
  const parts = shortcut.split("+");
  const displayParts = parts.map((p) => {
    if (p === "Command") return isMac ? "Cmd" : "Cmd";
    if (p === "CmdOrCtrl") return isMac ? "Cmd" : "Ctrl";
    if (p === "Control") return "Ctrl";
    if (p === "Shift") return "Shift";
    if (p === "Alt") return isMac ? "Opt" : "Alt";
    if (p === "Super") return isMac ? "Cmd" : "Win";
    return keyDisplayNames[p] || p;
  });
  return displayParts.join(" + ");
}

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (shortcut: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [previous, setPrevious] = useState<string | null>(null);
  const [showUndo, setShowUndo] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      setRecording(false);
      return;
    }

    if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return;

    const keyToken = keyToTauriToken(e.key, e.code);
    if (!keyToken) return;

    const parts: string[] = [];
    if (e.metaKey) parts.push(isMac ? "Command" : "Super");
    if (e.ctrlKey) parts.push("Control");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    parts.push(keyToken);

    if (parts.length < 2) return;

    const shortcutStr = parts.join("+");
    setRecording(false);
    setPrevious(value);
    setShowUndo(true);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setShowUndo(false), 4000);
    invoke("update_global_shortcut", { shortcut: shortcutStr }).then(() => {
      onChange(shortcutStr);
    }).catch(() => {
      setPrevious(null);
      setShowUndo(false);
    });
  }, [value, onChange]);

  useEffect(() => {
    if (!recording) return;
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [recording, handleKeyDown]);

  const handleUndo = async () => {
    if (!previous) return;
    try {
      await invoke("update_global_shortcut", { shortcut: previous });
      onChange(previous);
    } catch { /* ignore */ }
    setPrevious(null);
    setShowUndo(false);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  };

  return (
    <div className="shortcut-recorder">
      <button
        className={`shortcut-recorder-btn${recording ? " recording" : ""}`}
        onClick={() => setRecording(true)}
      >
        {recording ? "Press shortcut..." : shortcutToDisplay(value)}
      </button>
      {showUndo && (
        <button className="shortcut-undo" onClick={handleUndo}>Undo</button>
      )}
    </div>
  );
}

const DEFAULT_COLORS_LIGHT: ThemeColors = {
  accent: "#4f46e5",
  accentHover: "#4338ca",
  bgPrimary: "#f5f4f1",
  bgSecondary: "#efeee9",
  bgSelected: "#e0ddd7",
  textPrimary: "#1a1a2e",
  textSecondary: "#64648c",
};

const DEFAULT_COLORS_DARK: ThemeColors = {
  accent: "#818cf8",
  accentHover: "#a5b4fc",
  bgPrimary: "#16161e",
  bgSecondary: "#1e1e28",
  bgSelected: "#2a2a42",
  textPrimary: "#e2e2f0",
  textSecondary: "#9898b8",
};

function ColorSwatch({ label, value, defaultValue, onChange }: {
  label: string;
  value: string | undefined;
  defaultValue: string;
  onChange: (color: string | undefined) => void;
}) {
  const current = value || defaultValue;
  return (
    <div className="color-swatch-row">
      <label className="color-swatch-label">{label}</label>
      <div className="color-swatch-controls">
        <input
          type="color"
          className="color-swatch-input"
          value={current}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="color-swatch-value">{current}</span>
        {value && value !== defaultValue && (
          <button
            className="color-swatch-reset"
            onClick={() => onChange(undefined)}
            title="Reset to default"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

function generateRandomTheme(isDark: boolean): ThemeColors {
  const hue = Math.random() * 360;
  const strategy = Math.random();
  let accentHue: number;
  if (strategy < 0.33) {
    accentHue = hue;
  } else if (strategy < 0.66) {
    accentHue = (hue + 30 + Math.random() * 30) % 360;
  } else {
    accentHue = (hue + 150 + Math.random() * 60) % 360;
  }

  const hsl = (h: number, s: number, l: number) => {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s));
    l = Math.max(0, Math.min(100, l));
    const c = (1 - Math.abs(2 * l / 100 - 1)) * (s / 100);
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l / 100 - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  if (isDark) {
    const bgL = 6 + Math.random() * 6;
    const bgS = 10 + Math.random() * 20;
    return {
      accent: hsl(accentHue, 55 + Math.random() * 25, 65 + Math.random() * 10),
      accentHover: hsl(accentHue, 55 + Math.random() * 25, 75 + Math.random() * 10),
      bgPrimary: hsl(hue, bgS, bgL),
      bgSecondary: hsl(hue, bgS, bgL + 4),
      bgSelected: hsl(hue, bgS + 5, bgL + 12),
      textPrimary: hsl(hue, 10 + Math.random() * 15, 88 + Math.random() * 7),
      textSecondary: hsl(hue, 15 + Math.random() * 15, 55 + Math.random() * 10),
    };
  } else {
    const bgL = 94 + Math.random() * 4;
    const bgS = 5 + Math.random() * 20;
    return {
      accent: hsl(accentHue, 60 + Math.random() * 25, 40 + Math.random() * 15),
      accentHover: hsl(accentHue, 60 + Math.random() * 25, 30 + Math.random() * 15),
      bgPrimary: hsl(hue, bgS, bgL),
      bgSecondary: hsl(hue, bgS, bgL - 3),
      bgSelected: hsl(hue, bgS + 5, bgL - 10),
      textPrimary: hsl(hue, 15 + Math.random() * 20, 8 + Math.random() * 8),
      textSecondary: hsl(hue, 10 + Math.random() * 20, 35 + Math.random() * 15),
    };
  }
}

function ColorSettings({ settings, onSettingsChange }: { settings: AppSettings; onSettingsChange: (s: AppSettings) => void }) {
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const [presetName, setPresetName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("__default__");
  const [diceRolling, setDiceRolling] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const theme = settings.theme || "system";
  const isDark = theme === "system" ? systemDark : theme === "dark";

  useEffect(() => {
    setSelectedPreset("__default__");
  }, [isDark]);

  const colors = isDark ? (settings.colorsDark || {}) : (settings.colorsLight || {});
  const defaults = isDark ? DEFAULT_COLORS_DARK : DEFAULT_COLORS_LIGHT;
  const presets = settings.colorPresets || [];

  const updateColor = (key: keyof ThemeColors, value: string | undefined) => {
    const field = isDark ? "colorsDark" : "colorsLight";
    const current = isDark ? (settings.colorsDark || {}) : (settings.colorsLight || {});
    const updated = { ...current, [key]: value };
    if (value === undefined) delete updated[key];
    onSettingsChange({ ...settings, [field]: Object.keys(updated).length > 0 ? updated : undefined });
  };

  const mode = isDark ? "dark" : "light";
  const modePresets = presets.filter((p) => p.mode === mode);

  const handlePresetChange = (value: string) => {
    setSelectedPreset(value);
    if (value === "__default__") {
      const field = isDark ? "colorsDark" : "colorsLight";
      onSettingsChange({ ...settings, [field]: undefined });
    } else {
      const preset = modePresets.find((p) => p.name === value);
      if (preset) {
        const field = isDark ? "colorsDark" : "colorsLight";
        onSettingsChange({ ...settings, [field]: preset.colors });
      }
    }
  };

  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const newPreset: ColorPreset = {
      name,
      mode,
      colors: isDark ? (settings.colorsDark || {}) : (settings.colorsLight || {}),
    };
    const existing = presets.findIndex((p) => p.name === name && p.mode === mode);
    let updated: ColorPreset[];
    if (existing >= 0) {
      updated = presets.map((p, i) => i === existing ? newPreset : p);
    } else {
      updated = [...presets, newPreset];
    }
    onSettingsChange({ ...settings, colorPresets: updated });
    setPresetName("");
    setSelectedPreset(name);
  };

  const handleOverwritePreset = () => {
    if (selectedPreset === "__default__") return;
    const index = presets.findIndex((p) => p.name === selectedPreset && p.mode === mode);
    if (index < 0) return;
    const currentColors = isDark ? (settings.colorsDark || {}) : (settings.colorsLight || {});
    const updated = presets.map((p, i) => i === index ? { ...p, colors: currentColors } : p);
    onSettingsChange({ ...settings, colorPresets: updated });
  };

  const handleDeletePreset = () => {
    if (selectedPreset === "__default__") return;
    const index = presets.findIndex((p) => p.name === selectedPreset && p.mode === mode);
    if (index < 0) return;
    const updated = presets.filter((_, i) => i !== index);
    onSettingsChange({ ...settings, colorPresets: updated.length > 0 ? updated : undefined });
    setSelectedPreset("__default__");
  };

  const handleRandomize = () => {
    setDiceRolling(true);
    const field = isDark ? "colorsDark" : "colorsLight";
    const generated = generateRandomTheme(isDark);
    onSettingsChange({ ...settings, [field]: generated });
    setSelectedPreset("__default__");
    setTimeout(() => setDiceRolling(false), 600);
  };

  const presetOptions = [
    { value: "__default__", label: "Default" },
    ...modePresets.map((p) => ({ value: p.name, label: p.name })),
  ];

  const isUserPreset = selectedPreset !== "__default__";

  return (
    <div className="color-settings">
      <p className="settings-hint">
        Customizing <strong>{isDark ? "dark" : "light"}</strong> theme colors.
        {theme === "system"
          ? " Your theme is set to system, switch to the other to customize it."
          : ` Switch to ${isDark ? "light" : "dark"} to customize it.`}
      </p>

      <div className="color-presets">
        <div className="color-preset-row">
          <Dropdown
            options={presetOptions}
            value={selectedPreset}
            onChange={handlePresetChange}
            className="color-preset-dropdown"
          />
          {isUserPreset && (
            <div className="color-preset-actions">
              <button
                className="color-preset-action"
                onClick={handleOverwritePreset}
                title="Save current colors to this preset"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
              </button>
              <button
                className="color-preset-action danger"
                onClick={handleDeletePreset}
                title="Delete this preset"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          )}
          <button
            className={`color-randomize-btn${diceRolling ? " rolling" : ""}`}
            onClick={handleRandomize}
            title="Randomize colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="3"/>
              <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/>
              <circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/>
              <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
              <circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/>
              <circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/>
            </svg>
          </button>
        </div>
        <div className="color-preset-save">
          <input
            className="color-preset-name-input"
            placeholder="New preset name..."
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSavePreset(); }}
          />
          <button
            className="btn secondary"
            onClick={handleSavePreset}
            disabled={!presetName.trim()}
          >
            Save
          </button>
        </div>
      </div>

      <ColorSwatch
        label="Primary accent"
        value={colors.accent}
        defaultValue={defaults.accent!}
        onChange={(v) => updateColor("accent", v)}
      />
      <ColorSwatch
        label="Accent hover"
        value={colors.accentHover}
        defaultValue={defaults.accentHover!}
        onChange={(v) => updateColor("accentHover", v)}
      />
      <ColorSwatch
        label="Primary background"
        value={colors.bgPrimary}
        defaultValue={defaults.bgPrimary!}
        onChange={(v) => updateColor("bgPrimary", v)}
      />
      <ColorSwatch
        label="Secondary background"
        value={colors.bgSecondary}
        defaultValue={defaults.bgSecondary!}
        onChange={(v) => updateColor("bgSecondary", v)}
      />
      <ColorSwatch
        label="Selection highlight"
        value={colors.bgSelected}
        defaultValue={defaults.bgSelected!}
        onChange={(v) => updateColor("bgSelected", v)}
      />
      <ColorSwatch
        label="Primary text"
        value={colors.textPrimary}
        defaultValue={defaults.textPrimary!}
        onChange={(v) => updateColor("textPrimary", v)}
      />
      <ColorSwatch
        label="Secondary text"
        value={colors.textSecondary}
        defaultValue={defaults.textSecondary!}
        onChange={(v) => updateColor("textSecondary", v)}
      />
    </div>
  );
}

function MacroEditor({ macros, onChange }: { macros: Record<string, string>; onChange: (macros: Record<string, string>) => void }) {
  const [newTrigger, setNewTrigger] = useState("");
  const [newExpansion, setNewExpansion] = useState("");

  const entries = Object.entries(macros);

  const handleAdd = () => {
    const raw = newTrigger.trim().replace(/^\//, "");
    if (!raw || !newExpansion) return;
    const trigger = `/${raw}`;
    onChange({ ...macros, [trigger]: newExpansion });
    setNewTrigger("");
    setNewExpansion("");
  };

  const handleRemove = (key: string) => {
    const next = { ...macros };
    delete next[key];
    onChange(next);
  };

  return (
    <div className="macro-editor">
      {entries.length > 0 && (
        <div className="macro-list">
          {entries.map(([trigger, expansion]) => (
            <div key={trigger} className="macro-row">
              <kbd className="macro-trigger">{trigger}</kbd>
              <span className="macro-expansion">{expansion}</span>
              <button className="macro-remove" onClick={() => handleRemove(trigger)} title="Remove">×</button>
            </div>
          ))}
        </div>
      )}
      <div className="macro-add">
        <div className="macro-input-wrapper">
          <span className="macro-input-prefix">/</span>
          <input
            className="macro-input macro-input-trigger"
            placeholder="trigger"
            value={newTrigger}
            onChange={(e) => setNewTrigger(e.target.value.replace(/^\//, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
        </div>
        <input
          className="macro-input macro-input-expansion"
          placeholder="Expansion text"
          value={newExpansion}
          onChange={(e) => setNewExpansion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <button className="btn secondary btn-sm" onClick={handleAdd} disabled={!newTrigger.trim() || !newExpansion}>Add</button>
      </div>
    </div>
  );
}

function DictionaryEditor({ entries, onChange }: { entries: string[]; onChange: (entries: string[]) => void }) {
  const [newEntry, setNewEntry] = useState("");

  const handleAdd = () => {
    const value = newEntry.trim();
    if (!value || entries.includes(value)) return;
    onChange([...entries, value]);
    setNewEntry("");
  };

  const handleRemove = (entry: string) => {
    onChange(entries.filter((e) => e !== entry));
  };

  return (
    <div className="macro-editor">
      {entries.length > 0 && (
        <div className="macro-list">
          {entries.map((entry) => (
            <div key={entry} className="macro-row">
              <span className="macro-expansion">{entry}</span>
              <button className="macro-remove" onClick={() => handleRemove(entry)} title="Remove">×</button>
            </div>
          ))}
        </div>
      )}
      <div className="macro-add">
        <input
          className="macro-input macro-input-expansion"
          placeholder="Add a person, place, or word..."
          value={newEntry}
          onChange={(e) => setNewEntry(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <button className="btn secondary btn-sm" onClick={handleAdd} disabled={!newEntry.trim()}>Add</button>
      </div>
    </div>
  );
}

function CodexList({ codexList, codexCounts, onRenameCodex }: {
  codexList: string[];
  codexCounts: Record<string, number>;
  onRenameCodex?: (oldName: string, newName: string) => void;
}) {
  const [editingCodex, setEditingCodex] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startRename = (name: string) => {
    setEditingCodex(name);
    setEditValue(name);
  };

  const submitRename = (oldName: string) => {
    const cleaned = editValue.trim();
    if (cleaned && cleaned !== oldName && onRenameCodex) {
      onRenameCodex(oldName, cleaned);
    }
    setEditingCodex(null);
    setEditValue("");
  };

  return (
    <div className="org-list">
      {codexList.map((codex) => {
        const count = codexCounts[codex] || 0;
        return (
          <div key={codex} className="org-list-item">
            {editingCodex === codex ? (
              <div className="org-list-edit">
                <input
                  className="org-list-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitRename(codex);
                    if (e.key === "Escape") setEditingCodex(null);
                  }}
                  autoFocus
                />
                <button className="btn secondary btn-sm" onClick={() => submitRename(codex)}>Save</button>
                <button className="btn secondary btn-sm" onClick={() => setEditingCodex(null)}>Cancel</button>
              </div>
            ) : (
              <>
                <span className="org-list-name">{codex}</span>
                <span className="org-list-count">{count} {count === 1 ? "note" : "notes"}</span>
                <div className="org-list-actions">
                  {onRenameCodex && (
                    <button
                      className="org-list-action"
                      onClick={() => startRename(codex)}
                      title="Rename codex"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TagsList({ allTags, onRenameTag, onDeleteTag }: {
  allTags: { name: string; count: number }[];
  onRenameTag?: (oldTag: string, newTag: string) => void;
  onDeleteTag?: (tag: string) => void;
}) {
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const startRename = (name: string) => {
    setEditingTag(name);
    setEditValue(name);
    setConfirmingDelete(null);
  };

  const submitRename = (oldName: string) => {
    const cleaned = editValue.replace(/[^a-zA-Z0-9_]/g, "");
    if (cleaned && cleaned !== oldName && onRenameTag) {
      onRenameTag(oldName, cleaned);
    }
    setEditingTag(null);
    setEditValue("");
  };

  return (
    <div className="org-list">
      {allTags.map(({ name, count }) => (
        <div key={name} className="org-list-item">
          {editingTag === name ? (
            <div className="org-list-edit">
              <span className="org-list-hash">#</span>
              <input
                className="org-list-edit-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename(name);
                  if (e.key === "Escape") setEditingTag(null);
                }}
                autoFocus
              />
              <button className="btn secondary btn-sm" onClick={() => submitRename(name)}>Save</button>
              <button className="btn secondary btn-sm" onClick={() => setEditingTag(null)}>Cancel</button>
            </div>
          ) : confirmingDelete === name ? (
            <div className="org-list-edit">
              <span className="org-list-name">Remove #{name} from all notes?</span>
              <button className="btn danger btn-sm" onClick={() => { onDeleteTag?.(name); setConfirmingDelete(null); }}>Remove</button>
              <button className="btn secondary btn-sm" onClick={() => setConfirmingDelete(null)}>Cancel</button>
            </div>
          ) : (
            <>
              <span className="org-list-name">#{name}</span>
              <span className="org-list-count">{count} {count === 1 ? "note" : "notes"}</span>
              <div className="org-list-actions">
                {onRenameTag && (
                  <button
                    className="org-list-action"
                    onClick={() => startRename(name)}
                    title="Rename tag"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                )}
                {onDeleteTag && (
                  <button
                    className="org-list-action danger"
                    onClick={() => { setConfirmingDelete(name); setEditingTag(null); }}
                    title="Remove from all notes"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function InfoTooltip({ text, children }: { text?: string; children?: React.ReactNode }) {
  return (
    <span className="settings-tooltip-wrapper">
      <svg className="settings-tooltip-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 16v-4"/>
        <path d="M12 8h.01"/>
      </svg>
      <span className="settings-tooltip">{children || text}</span>
    </span>
  );
}

type ProtectionStatus = "none" | "locked" | "unlocked";

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
  protectionStatus: ProtectionStatus;
  onChangeProtectionPassword: (current: string, newPassword: string) => Promise<boolean>;
  onDisableProtection: (password: string) => Promise<boolean>;
  protectionError: string | null;
  protectionLoading: boolean;
  codexList: string[];
  allTags: { name: string; count: number }[];
  onRenameTag?: (oldTag: string, newTag: string) => void;
  onDeleteTag?: (tag: string) => void;
  onRenameCodex?: (oldName: string, newName: string) => void;
  codexCounts: Record<string, number>;
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
  protectionStatus,
  onChangeProtectionPassword,
  onDisableProtection,
  protectionError,
  protectionLoading,
  codexList,
  allTags,
  onRenameTag,
  onDeleteTag,
  onRenameCodex,
  codexCounts,
}: Props) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [autoStart, setAutoStart] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    isEnabled().then(setAutoStart).catch(() => {});
    getVersion().then(setAppVersion).catch(() => {});
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
  const [changeErrField, setChangeErrField] = useState<"current" | "new" | "confirm" | null>(null);
  const [vaultChangeShake, setVaultChangeShake] = useState(false);

  // Disable encryption form
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);
  const [vaultDisableShake, setVaultDisableShake] = useState(false);
  // Setup form shake
  const [setupShake, setSetupShake] = useState(false);
  const [setupErrField, setSetupErrField] = useState<"password" | "confirm" | null>(null);

  // Success toast
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 4000);
  };

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
      await openPath(notesFolder);
    }
  };

  const shake = (setter: (v: boolean) => void) => {
    setter(true);
    setTimeout(() => setter(false), 500);
  };

  const handleSetupVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError(null);
    setSetupErrField(null);
    if (!setupPassword.trim()) {
      setSetupError("Password cannot be empty.");
      setSetupErrField("password");
      shake(setSetupShake);
      return;
    }
    if (setupPassword !== setupConfirm) {
      setSetupError("Passwords do not match.");
      setSetupErrField("confirm");
      shake(setSetupShake);
      return;
    }
    const success = await onSetupVault(setupPassword);
    if (success) {
      setShowSetupForm(false);
      setSetupPassword("");
      setSetupConfirm("");
      showToast("Vault encryption enabled");
    } else {
      setSetupError(vaultError || "Failed to set up encryption.");
      shake(setSetupShake);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangeError(null);
    setChangeErrField(null);
    if (!newPassword.trim()) {
      setChangeError("New password cannot be empty.");
      setChangeErrField("new");
      shake(setVaultChangeShake);
      return;
    }
    if (newPassword !== newConfirm) {
      setChangeError("Passwords do not match.");
      setChangeErrField("confirm");
      shake(setVaultChangeShake);
      return;
    }
    const success = await onChangePassword(currentPassword, newPassword);
    if (success) {
      setShowChangeForm(false);
      setCurrentPassword("");
      setNewPassword("");
      setNewConfirm("");
      showToast("Password changed");
    } else {
      setChangeError(vaultError || "Invalid current password.");
      setChangeErrField("current");
      shake(setVaultChangeShake);
      setCurrentPassword("");
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
      showToast("Vault encryption disabled");
    } else {
      setDisableError(vaultError || "Invalid password.");
      shake(setVaultDisableShake);
      setDisablePassword("");
    }
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "organization", label: "Organization" },
    { id: "keyboard", label: "Controls" },
    { id: "macros", label: "Macros" },
    { id: "dictionary", label: "Dictionary" },
    { id: "colors", label: "Colors" },
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
                <h3>Updates</h3>
                <div className="settings-row">
                  <label>Version {appVersion || "..."}</label>
                  <span className="settings-hint">Auto-updates coming soon</span>
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
                <div className="settings-row">
                  <label>Show table of contents by default</label>
                  <input
                    type="checkbox"
                    checked={settings.tocDefault || false}
                    onChange={(e) =>
                      onSettingsChange({ ...settings, tocDefault: e.target.checked })
                    }
                  />
                </div>
              </div>
            )}

            {activeTab === "organization" && (
              <div className="settings-section">
                <h3>Codexes</h3>
                <p className="settings-hint">
                  Codexes are collections for grouping notes. Create one by assigning a codex name to any note.
                </p>
                {codexList.length > 0 ? (
                  <>
                    <div className="settings-row">
                      <label>Default codex on startup</label>
                      <Dropdown
                        options={[
                          { value: "", label: "None" },
                          ...codexList.map((c) => ({ value: c, label: c })),
                        ]}
                        value={settings.defaultCodex || ""}
                        onChange={(val) =>
                          onSettingsChange({
                            ...settings,
                            defaultCodex: val || null,
                          })
                        }
                      />
                    </div>
                    <CodexList codexList={codexList} codexCounts={codexCounts} onRenameCodex={onRenameCodex} />
                  </>
                ) : (
                  <p className="settings-hint">No codexes yet.</p>
                )}

                <h3>Tags</h3>
                <p className="settings-hint">
                  Tags are extracted from note content. Use #tagname in your notes to tag them.
                </p>
                {allTags.length > 0 ? (
                  <TagsList allTags={allTags} onRenameTag={onRenameTag} onDeleteTag={onDeleteTag} />
                ) : (
                  <p className="settings-hint">No tags yet. Use #tagname in your notes to create tags.</p>
                )}

                <h3>Daily Notes</h3>
                <p className="settings-hint">
                  Press {mod}+J to create or open today's daily note.
                </p>
                <div className="settings-row">
                  <label>Title format</label>
                  <input
                    type="text"
                    className="settings-input"
                    placeholder="{date}"
                    value={settings.dailyNoteFormat || ""}
                    onChange={(e) =>
                      onSettingsChange({ ...settings, dailyNoteFormat: e.target.value || undefined })
                    }
                  />
                </div>
                <p className="settings-hint">
                  Use <code>{"{date}"}</code> for today's date. Example: <code>{"{date}"} - Standup</code> becomes "{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} - Standup"
                </p>
                {codexList.length > 0 && (
                  <div className="settings-row">
                    <label>Codex</label>
                    <Dropdown
                      options={[
                        { value: "", label: "None" },
                        ...codexList.map((c) => ({ value: c, label: c })),
                      ]}
                      value={settings.dailyNoteCodex || ""}
                      onChange={(val) =>
                        onSettingsChange({
                          ...settings,
                          dailyNoteCodex: val || null,
                        })
                      }
                    />
                  </div>
                )}
              </div>
            )}

            {activeTab === "keyboard" && (
              <div className="settings-section">
                <h3>Global</h3>
                <div className="settings-row">
                  <label>Toggle window</label>
                  <ShortcutRecorder
                    value={settings.globalShortcut || (isMac ? "Command+Shift+Space" : "Control+Shift+Space")}
                    onChange={(shortcut) => onSettingsChange({ ...settings, globalShortcut: shortcut })}
                  />
                </div>
                <p className="settings-hint">Click the shortcut to change it</p>
                <h3>Search</h3>
                <div className="settings-row">
                  <label>Find in note</label>
                  <kbd className="shortcut-display">{mod}+F</kbd>
                </div>
                <div className="settings-row">
                  <label>Next match</label>
                  <kbd className="shortcut-display">{mod}+]</kbd>
                </div>
                <div className="settings-row">
                  <label>Previous match</label>
                  <kbd className="shortcut-display">{mod}+[</kbd>
                </div>
                <div className="settings-row">
                  <label>Search notes</label>
                  <span>
                    <kbd className="shortcut-display">{mod}+Shift+F</kbd>{" "}
                    <kbd className="shortcut-display">{mod}+L</kbd>
                  </span>
                </div>
                <div className="settings-row">
                  <label>Command palette</label>
                  <kbd className="shortcut-display">{mod}+K</kbd>
                </div>
                <h3>Notes</h3>
                <div className="settings-row">
                  <label>New note</label>
                  <kbd className="shortcut-display">{mod}+N</kbd>
                </div>
                <div className="settings-row">
                  <label>Daily note</label>
                  <kbd className="shortcut-display">{mod}+J</kbd>
                </div>
                <div className="settings-row">
                  <label>Navigate notes</label>
                  <span>
                    <kbd className="shortcut-display">↑</kbd>{" "}
                    <kbd className="shortcut-display">↓</kbd>
                  </span>
                </div>
                <div className="settings-row">
                  <label>Edit note</label>
                  <kbd className="shortcut-display">Enter</kbd>
                </div>
                <div className="settings-row">
                  <label>Expand backlinks</label>
                  <kbd className="shortcut-display">→</kbd>
                </div>
                <div className="settings-row">
                  <label>Collapse backlinks</label>
                  <kbd className="shortcut-display">←</kbd>
                </div>
                <div className="settings-row">
                  <label>Next note</label>
                  <kbd className="shortcut-display">{mod}+Shift+]</kbd>
                </div>
                <div className="settings-row">
                  <label>Previous note</label>
                  <kbd className="shortcut-display">{mod}+Shift+[</kbd>
                </div>
                <h3>Editor</h3>
                <div className="settings-row">
                  <label>Link to note</label>
                  <kbd className="shortcut-display">[[</kbd>
                </div>
                <div className="settings-row">
                  <label>Dictionary mention</label>
                  <kbd className="shortcut-display">@</kbd>
                </div>
                <div className="settings-row">
                  <label>Expand macro</label>
                  <kbd className="shortcut-display">/trigger + Space</kbd>
                </div>
                <h3>View</h3>
                <div className="settings-row">
                  <label>Toggle sidebar</label>
                  <kbd className="shortcut-display">{mod}+/</kbd>
                </div>
                <div className="settings-row">
                  <label>Table of contents</label>
                  <kbd className="shortcut-display">{mod}+T</kbd>
                </div>
                <div className="settings-row">
                  <label>Split view</label>
                  <kbd className="shortcut-display">{mod}+\</kbd>
                </div>
                <div className="settings-row">
                  <label>Switch codex</label>
                  <kbd className="shortcut-display">{mod}+1–9</kbd>
                </div>
                <div className="settings-row">
                  <label>Zoom in</label>
                  <kbd className="shortcut-display">{mod}+=</kbd>
                </div>
                <div className="settings-row">
                  <label>Zoom out</label>
                  <kbd className="shortcut-display">{mod}+-</kbd>
                </div>
                <div className="settings-row">
                  <label>Reset zoom</label>
                  <kbd className="shortcut-display">{mod}+0</kbd>
                </div>
                <h3>App</h3>
                <div className="settings-row">
                  <label>Open settings</label>
                  <kbd className="shortcut-display">{mod}+,</kbd>
                </div>
                <div className="settings-row">
                  <label>Markdown reference</label>
                  <kbd className="shortcut-display">{mod}+.</kbd>
                </div>
                <div className="settings-row">
                  <label>Controls reference</label>
                  <kbd className="shortcut-display">{mod}+;</kbd>
                </div>
                <div className="settings-row">
                  <label>Hide window</label>
                  <kbd className="shortcut-display">Escape</kbd>
                </div>
              </div>
            )}

            {activeTab === "macros" && (
              <div className="settings-section">
                <h3>Text Macros</h3>
                <p className="settings-hint">
                  Macros expand while you type in the editor. Type a trigger
                  (like /date) followed by Space or Enter and it will be replaced
                  with the expansion text.
                </p>
                <h3>Built-in</h3>
                <div className="macro-list">
                  <div className="macro-row">
                    <kbd className="macro-trigger">/date</kbd>
                    <span className="macro-expansion">Inserts today's date (e.g., July 23, 2026)</span>
                  </div>
                  <div className="macro-row">
                    <kbd className="macro-trigger">/time</kbd>
                    <span className="macro-expansion">Inserts the current time (e.g., 3:45 PM)</span>
                  </div>
                </div>
                <h3>Custom</h3>
                <p className="settings-hint">
                  Add your own triggers below. Use letters and numbers for the trigger name.
                </p>
                <MacroEditor
                  macros={settings.macros || {}}
                  onChange={(macros) => onSettingsChange({ ...settings, macros })}
                />
              </div>
            )}

            {activeTab === "dictionary" && (
              <div className="settings-section">
                <h3>Dictionary</h3>
                <p className="settings-hint">
                  Add people, places, or anything you mention often. Type <kbd>@</kbd> in
                  the editor to autocomplete from this list. Mentions are highlighted and
                  searchable.
                </p>
                <DictionaryEditor
                  entries={settings.dictionary || []}
                  onChange={(dictionary) => onSettingsChange({ ...settings, dictionary })}
                />
              </div>
            )}

            {activeTab === "colors" && (
              <div className="settings-section">
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
                <h3>Colors</h3>
                <ColorSettings settings={settings} onSettingsChange={onSettingsChange} />
                {codexList.length > 0 && (
                  <>
                    <h3>Codex Colors</h3>
                    {codexList.map((codex) => (
                      <div className="settings-row" key={codex}>
                        <label>{codex}</label>
                        <div className="codex-color-picker">
                          <input
                            type="color"
                            value={settings.codexColors?.[codex] || "#808080"}
                            onChange={(e) => {
                              const newColors = { ...settings.codexColors, [codex]: e.target.value };
                              onSettingsChange({ ...settings, codexColors: newColors });
                            }}
                          />
                          {settings.codexColors?.[codex] && (
                            <button
                              className="codex-color-reset"
                              onClick={() => {
                                const newColors = { ...settings.codexColors };
                                delete newColors[codex];
                                onSettingsChange({ ...settings, codexColors: newColors });
                              }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {allTags.length > 0 && (
                  <>
                    <h3>Tag Colors</h3>
                    {allTags.map(({ name }) => (
                      <div className="settings-row" key={name}>
                        <label>#{name}</label>
                        <div className="codex-color-picker">
                          <input
                            type="color"
                            value={settings.tagColors?.[name] || "#808080"}
                            onChange={(e) => {
                              const newColors = { ...settings.tagColors, [name]: e.target.value };
                              onSettingsChange({ ...settings, tagColors: newColors });
                            }}
                          />
                          {settings.tagColors?.[name] && (
                            <button
                              className="codex-color-reset"
                              onClick={() => {
                                const newColors = { ...settings.tagColors };
                                delete newColors[name];
                                onSettingsChange({ ...settings, tagColors: newColors });
                              }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {activeTab === "storage" && (
              <div className="settings-section">
                <h3>Notes Folder<InfoTooltip><ul><li>Where your notes are stored as Markdown files</li><li>Use a synced folder (Dropbox, iCloud) to access notes across devices</li></ul></InfoTooltip></h3>
                <div className="settings-row">
                  <span className="folder-path">
                    {notesFolder || "Not set"}
                  </span>
                </div>
                <p className="settings-hint">To sync notes across devices, point this to a folder inside Dropbox, iCloud Drive, or another sync service.</p>
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
                  <button className="btn secondary" onClick={onReloadNotes} title="Re-reads all notes from disk and rebuilds the search index. Use if notes appear missing or search results seem stale.">
                    Rebuild Index
                  </button>
                </div>
              </div>
            )}

            {activeTab === "security" && (
              <div className="settings-section">
                {successToast && (
                  <span className="update-toast success">{successToast}</span>
                )}
                <h3>Auto-Lock<InfoTooltip><ul><li>Automatically locks the vault after inactivity</li><li>Also locks on system sleep and screen lock</li><li>Requires vault encryption to be enabled</li></ul></InfoTooltip></h3>
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
                  Also locks on system sleep and screen lock.
                </p>

                <h3>Vault Encryption<InfoTooltip><ul><li>Encrypts all notes on disk with one password</li><li>When locked, all files are unreadable without the password</li><li>Can be used alongside file protection — vault encrypts everything, while file protection adds re-authentication for individual notes</li></ul></InfoTooltip></h3>

                {vaultStatus === "plaintext" && !showSetupForm && (
                  <div className="settings-actions">
                    <p className="settings-warning">
                      Vault encryption protects all notes with a single password.
                      If you forget it, your notes cannot be recovered.
                    </p>
                    <button
                      className="btn primary"
                      onClick={() => setShowSetupForm(true)}
                    >
                      Enable Vault Encryption
                    </button>
                  </div>
                )}

                {vaultStatus === "plaintext" && showSetupForm && (
                  <form
                    className={`settings-form ${setupShake ? "shake" : ""}`}
                    onSubmit={handleSetupVault}
                  >
                    <p className="settings-warning">
                      This will encrypt all notes. If you forget this password,
                      your notes cannot be recovered.
                    </p>
                    <PasswordInput
                      placeholder="Password"
                      value={setupPassword}
                      onChange={setSetupPassword}
                      error={setupErrField === "password"}
                    />
                    <PasswordInput
                      placeholder="Confirm password"
                      value={setupConfirm}
                      onChange={setSetupConfirm}
                      error={setupErrField === "confirm"}
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
                        {vaultLoading ? "Encrypting..." : "Enable Vault"}
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
                      Vault encryption is enabled. All notes are encrypted on disk.
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
                        Disable Vault
                      </button>
                    </div>

                    {showChangeForm && (
                      <form
                        className={`settings-form ${vaultChangeShake ? "shake" : ""}`}
                        onSubmit={handleChangePassword}
                      >
                        <PasswordInput
                          placeholder="Current password"
                          value={currentPassword}
                          onChange={setCurrentPassword}
                          error={changeErrField === "current"}
                        />
                        <PasswordInput
                          placeholder="New password"
                          value={newPassword}
                          onChange={setNewPassword}
                          error={changeErrField === "new"}
                        />
                        <PasswordInput
                          placeholder="Confirm new password"
                          value={newConfirm}
                          onChange={setNewConfirm}
                          error={changeErrField === "confirm"}
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
                        className={`settings-form ${vaultDisableShake ? "shake" : ""}`}
                        onSubmit={handleDisableVault}
                      >
                        <p className="settings-warning">
                          This will decrypt all notes and disable vault encryption.
                          Notes will be stored as plaintext.
                        </p>
                        <PasswordInput
                          placeholder="Current password"
                          value={disablePassword}
                          onChange={setDisablePassword}
                          error={!!disableError}
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
                    Vault is locked. Unlock to manage encryption settings.
                  </p>
                )}

                {vaultStatus === "plaintext" && (
                  <NoteProtectionSection
                    protectionStatus={protectionStatus}
                    onChangeProtectionPassword={onChangeProtectionPassword}
                    onDisableProtection={onDisableProtection}
                    protectionError={protectionError}
                    protectionLoading={protectionLoading}
                    onReloadNotes={onReloadNotes}
                    showToast={showToast}
                  />
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
                  </tbody>
                </table>

                <h3>Tasks</h3>
                <table className="md-ref-table">
                  <tbody>
                    <tr>
                      <td className="md-ref-syntax">- [ ] task</td>
                      <td className="md-ref-desc">Task item</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">- [x] done</td>
                      <td className="md-ref-desc">Completed task</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">!high</td>
                      <td className="md-ref-desc">High priority (red)</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">!med</td>
                      <td className="md-ref-desc">Medium priority (orange)</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">!low</td>
                      <td className="md-ref-desc">Low priority (green)</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">!YYYY-MM-DD</td>
                      <td className="md-ref-desc">Due date (color shifts)</td>
                    </tr>
                  </tbody>
                </table>
                <p className="settings-hint">
                  Type priority or date markers inside a task item. Priority pills
                  cycle on click (high → med → low → remove). Due dates shift from
                  green to red as the deadline approaches. Click to remove.
                </p>

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

                <h3>Note Links</h3>
                <table className="md-ref-table">
                  <tbody>
                    <tr>
                      <td className="md-ref-syntax">[[note name</td>
                      <td className="md-ref-desc">Link to another note</td>
                    </tr>
                  </tbody>
                </table>
                <p className="settings-hint">
                  Type <code>[[</code> in the editor to search and link to other notes.
                  Links stay valid even if the target note is renamed.
                </p>

                <h3>Tags</h3>
                <table className="md-ref-table">
                  <tbody>
                    <tr>
                      <td className="md-ref-syntax">#tagname</td>
                      <td className="md-ref-desc">Tag (searchable, filterable)</td>
                    </tr>
                  </tbody>
                </table>
                <p className="settings-hint">
                  Tags are highlighted in the editor and searchable with <code>#tag</code> in
                  the search bar. Customize tag colors in{" "}
                  <button className="settings-link" onClick={() => setActiveTab("colors")}>Colors</button>.
                </p>

                <h3>Dictionary Mentions</h3>
                <table className="md-ref-table">
                  <tbody>
                    <tr>
                      <td className="md-ref-syntax">@name</td>
                      <td className="md-ref-desc">Dictionary mention</td>
                    </tr>
                  </tbody>
                </table>
                <p className="settings-hint">
                  Type <code>@</code> in the editor to autocomplete from your dictionary.
                  Mentions are highlighted and searchable with <code>@name</code> in the search bar.
                  Manage entries in{" "}
                  <button className="settings-link" onClick={() => setActiveTab("dictionary")}>Dictionary</button>.
                </p>

                <h3>Macros</h3>
                <table className="md-ref-table">
                  <tbody>
                    <tr>
                      <td className="md-ref-syntax">/date</td>
                      <td className="md-ref-desc">Insert today's date</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">/time</td>
                      <td className="md-ref-desc">Insert current time</td>
                    </tr>
                    <tr>
                      <td className="md-ref-syntax">/custom</td>
                      <td className="md-ref-desc">Your custom macros</td>
                    </tr>
                  </tbody>
                </table>
                <p className="settings-hint">
                  Type a macro trigger followed by Space or Enter to expand it.
                  Create custom macros in{" "}
                  <button className="settings-link" onClick={() => setActiveTab("macros")}>Macros</button>.
                </p>

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
