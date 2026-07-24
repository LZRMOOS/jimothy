import { useEffect } from "react";

type DeleteDialogProps = {
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeleteDialog({ onConfirm, onCancel }: DeleteDialogProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onConfirm, onCancel]);

  return (
    <div className="conflict-overlay" role="dialog" aria-modal="true">
      <div className="conflict-dialog">
        <h2>Delete Note</h2>
        <p>Delete this note? This cannot be undone.</p>
        <div className="conflict-actions">
          <button className="btn secondary conflict-btn" onClick={onCancel}>
            No
          </button>
          <button className="btn primary conflict-btn" onClick={onConfirm}>
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
