import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import jimothyImg from "../assets/jimothy.png";

type Props = {
  onFolderSelected: (path: string) => void;
};

export function FolderSetup({ onFolderSelected }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [defaultPath, setDefaultPath] = useState<string | null>(null);

  useState(() => {
    invoke("get_default_notes_path").then((path) => {
      setDefaultPath(path as string);
    });
  });

  const handleChooseFolder = async () => {
    setError(null);
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      try {
        await invoke("set_notes_folder", { path: selected });
        await invoke("save_app_settings", {
          settingsJson: JSON.stringify({ notesFolder: selected }),
        });
        onFolderSelected(selected as string);
      } catch (e) {
        setError(String(e));
      }
    }
  };

  const handleUseDefault = async () => {
    if (!defaultPath) return;
    setError(null);
    try {
      const { mkdir } = await import("@tauri-apps/plugin-fs");
      await mkdir(defaultPath, { recursive: true });
      await invoke("set_notes_folder", { path: defaultPath });
      await invoke("save_app_settings", {
        settingsJson: JSON.stringify({ notesFolder: defaultPath }),
      });
      onFolderSelected(defaultPath);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="folder-setup">
      <div className="folder-setup-content">
        <img src={jimothyImg} alt="Jimothy" className="folder-setup-mascot" />
        <h1>Hey there! I'm Jimothy.</h1>
        <p className="folder-setup-intro">
          Your new favorite spot for notes, thoughts, and half-baked ideas.
          Everything lives as plain Markdown files on your computer.
        </p>

        <div className="folder-setup-features">
          <div className="folder-setup-feature">
            <span className="folder-setup-feature-icon">*</span>
            <span>Keyboard-first, lightning fast</span>
          </div>
          <div className="folder-setup-feature">
            <span className="folder-setup-feature-icon">*</span>
            <span>Organize with codexes and tags</span>
          </div>
          <div className="folder-setup-feature">
            <span className="folder-setup-feature-icon">*</span>
            <span>Encrypt notes you want to keep secret</span>
          </div>
          <div className="folder-setup-feature">
            <span className="folder-setup-feature-icon">*</span>
            <span>Syncs anywhere via Dropbox (or wherever you like)</span>
          </div>
        </div>

        <p className="folder-setup-prompt">
          First things first, pick a home for your vault:
        </p>

        <div className="folder-actions">
          {defaultPath && (
            <button className="btn primary" onClick={handleUseDefault}>
              Get Started ({defaultPath.split("/").slice(-2).join("/")})
            </button>
          )}
          <button className="btn secondary" onClick={handleChooseFolder}>
            Choose a Different Location...
          </button>
        </div>

        <p className="folder-setup-sync-hint">
          Want notes on multiple devices? Pick a location inside Dropbox, iCloud Drive, or your preferred sync service.
        </p>

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
