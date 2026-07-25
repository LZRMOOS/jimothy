import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { diffLines } from "../utils/diff";

// Mirrors the Rust ConflictEntry struct from commands/mod.rs.
export type ConflictEntry = {
  filename: string;
  note_id: string;
  conflict_title: string;
  conflict_body: string;
  conflict_updated_at: string;
  readable: boolean;
  live_exists: boolean;
  live_title: string;
  live_body: string;
  live_updated_at: string;
  path: string;
};

type ResolveAction = "keep-live" | "keep-conflict" | "keep-both" | "delete";

type Props = {
  onClose: () => void;
  // Called after any resolution so the app can reload notes from disk.
  onResolved: () => void;
};

function formatTime(iso: string): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "unknown";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ConflictResolver({ onClose, onResolved }: Props) {
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<ConflictEntry[]>("list_conflicts");
      setConflicts(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = useCallback(
    async (entry: ConflictEntry, action: ResolveAction) => {
      setBusy(entry.filename);
      setError(null);
      try {
        await invoke("resolve_conflict", { filename: entry.filename, action });
        onResolved();
        await load();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [load, onResolved]
  );

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="conflict-overlay" role="dialog" aria-modal="true">
      <div className="conflict-resolver">
        <div className="conflict-resolver-header">
          <h2>Resolve Sync Conflicts</h2>
          <button className="btn secondary btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {loading && <p className="conflict-resolver-empty">Loading conflicts…</p>}

        {!loading && conflicts.length === 0 && (
          <p className="conflict-resolver-empty">
            No sync conflicts to resolve. You're all caught up!
          </p>
        )}

        {error && <p className="conflict-resolver-error">{error}</p>}

        <div className="conflict-resolver-list">
          {conflicts.map((entry) => (
            <ConflictCard
              key={entry.filename}
              entry={entry}
              busy={busy === entry.filename}
              showCommands={showCommands}
              onResolve={resolve}
            />
          ))}
        </div>

        {conflicts.length > 0 && (
          <div className="conflict-resolver-footer">
            <button
              className="btn secondary btn-sm"
              onClick={() => setShowCommands((s) => !s)}
            >
              {showCommands ? "Hide terminal commands" : "Show terminal commands"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ConflictCard({
  entry,
  busy,
  showCommands,
  onResolve,
}: {
  entry: ConflictEntry;
  busy: boolean;
  showCommands: boolean;
  onResolve: (entry: ConflictEntry, action: ResolveAction) => void;
}) {
  const diff = useMemo(() => {
    if (!entry.readable || !entry.live_exists) return [];
    return diffLines(entry.live_body, entry.conflict_body);
  }, [entry]);

  const identical =
    entry.readable &&
    entry.live_exists &&
    diff.every((l) => l.type === "equal");

  return (
    <div className="conflict-card">
      <div className="conflict-card-title">
        {entry.readable ? entry.conflict_title || "(untitled)" : entry.filename}
      </div>

      {!entry.readable && (
        <p className="conflict-card-note">
          This conflict file can't be read here (the vault may be locked, or the
          file is corrupted). You can still delete it, or unlock the vault and
          reopen this dialog.
        </p>
      )}

      {entry.readable && !entry.live_exists && (
        <p className="conflict-card-note">
          There's no matching live note — this is an orphaned copy. Keep it as a
          new note or delete it.
        </p>
      )}

      {entry.readable && entry.live_exists && identical && (
        <p className="conflict-card-note">
          The two versions are identical. Safe to delete the copy.
        </p>
      )}

      {entry.readable && entry.live_exists && !identical && (
        <>
          <div className="conflict-card-meta">
            <span className="diff-legend removed-legend">
              − Live ({formatTime(entry.live_updated_at)})
            </span>
            <span className="diff-legend added-legend">
              + Copy ({formatTime(entry.conflict_updated_at)})
            </span>
          </div>
          <div className="conflict-diff">
            {diff.map((line, i) => (
              <div key={i} className={`diff-line diff-${line.type}`}>
                <span className="diff-marker">
                  {line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}
                </span>
                <span className="diff-text">{line.text || " "}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {showCommands && (
        <pre className="conflict-commands">
{`# inspect the preserved copy
open -e "${entry.path}"
# delete it once you're done
rm "${entry.path}"`}
        </pre>
      )}

      <div className="conflict-card-actions">
        {entry.live_exists && entry.readable && (
          <>
            <button
              className="btn primary btn-sm"
              disabled={busy}
              onClick={() => onResolve(entry, "keep-live")}
            >
              Keep Live
            </button>
            <button
              className="btn secondary btn-sm"
              disabled={busy}
              onClick={() => onResolve(entry, "keep-conflict")}
            >
              Keep Copy
            </button>
            <button
              className="btn secondary btn-sm"
              disabled={busy}
              onClick={() => onResolve(entry, "keep-both")}
            >
              Keep Both
            </button>
          </>
        )}
        {entry.readable && !entry.live_exists && (
          <button
            className="btn secondary btn-sm"
            disabled={busy}
            onClick={() => onResolve(entry, "keep-both")}
          >
            Import as New Note
          </button>
        )}
        <button
          className="btn danger-outline btn-sm"
          disabled={busy}
          onClick={() => onResolve(entry, "delete")}
        >
          Delete Copy
        </button>
      </div>
    </div>
  );
}
