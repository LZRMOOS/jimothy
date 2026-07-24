type DeleteDialogProps = {
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeleteDialog({ onConfirm, onCancel }: DeleteDialogProps) {
  return (
    <div className="conflict-overlay" role="dialog" aria-modal="true">
      <div className="conflict-dialog">
        <h2>Delete Note</h2>
        <p>Delete this note? This cannot be undone.</p>
        <div className="conflict-actions">
          <button className="conflict-btn secondary" onClick={onCancel}>
            No
          </button>
          <button className="conflict-btn primary" onClick={onConfirm}>
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
