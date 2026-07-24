import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

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
        <h1>Jimothy</h1>
        <p>Choose where to store your notes.</p>
        <p className="hint">
          Pick a folder inside Dropbox to sync across devices.
        </p>

        <div className="folder-actions">
          <button className="btn primary" onClick={handleChooseFolder}>
            Choose Folder…
          </button>
          {defaultPath && (
            <button className="btn secondary" onClick={handleUseDefault}>
              Use Default ({defaultPath.split("/").slice(-2).join("/")})
            </button>
          )}
        </div>

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
