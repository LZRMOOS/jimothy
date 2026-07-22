import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export type ConflictChoice = "keep-local" | "keep-external" | "dismiss";

type ConflictDialogProps = {
  noteId: string;
  onChoice: (choice: ConflictChoice) => void;
};

export function ConflictDialog({ noteId, onChoice }: ConflictDialogProps) {
  const handleKeepExternal = useCallback(async () => {
    // Reload notes from disk so the external version is loaded
    await invoke("reload_notes");
    onChoice("keep-external");
  }, [onChoice]);

  const handleKeepLocal = useCallback(() => {
    // Do nothing — local version wins on next save
    onChoice("keep-local");
  }, [onChoice]);

  const handleDismiss = useCallback(() => {
    onChoice("dismiss");
  }, [onChoice]);

  return (
    <div className="conflict-overlay" role="dialog" aria-modal="true">
      <div className="conflict-dialog">
        <h2>External Change Detected</h2>
        <p>
          This note changed outside the app. Both versions were preserved.
        </p>
        <p className="conflict-note-id">Note: {noteId}</p>
        <div className="conflict-actions">
          <button className="conflict-btn primary" onClick={handleKeepLocal}>
            Keep Local
          </button>
          <button className="conflict-btn" onClick={handleKeepExternal}>
            Keep External
          </button>
          <button className="conflict-btn secondary" onClick={handleDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
