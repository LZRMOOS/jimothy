// Stable registry of the command-palette actions a user is allowed to hide.
// The live `commands` array in App.tsx has dynamic labels (Pin/Unpin…),
// per-note contextual entries, and one-per-codex entries — none of which make
// sense to list in a settings toggle. This is the fixed, always-available
// subset, keyed by the same command `id` used in App.tsx so the palette can
// filter against `hiddenCommands`.
//
// Hiding only affects what shows in Cmd+K; the underlying keyboard shortcuts
// keep working, so it's safe to let any of these be hidden.
export type HideableCommand = { id: string; label: string };

export const HIDEABLE_COMMANDS: HideableCommand[] = [
  { id: "new-note", label: "New Note" },
  { id: "daily-note", label: "Daily Note" },
  { id: "find-in-note", label: "Find in Note" },
  { id: "find-replace", label: "Find & Replace" },
  { id: "search", label: "Search Notes" },
  { id: "delete-note", label: "Delete Note" },
  { id: "settings", label: "Open Settings" },
  { id: "resolve-conflicts", label: "Resolve Sync Conflicts" },
  { id: "reference-panel", label: "Reference Panel" },
  { id: "feature-tour", label: "Open Feature Tour" },
  { id: "scratchpad", label: "Open Scratchpad" },
  { id: "lock-vault", label: "Lock Vault" },
  { id: "toggle-sidebar", label: "Toggle Sidebar" },
  { id: "next-note", label: "Next Note" },
  { id: "prev-note", label: "Previous Note" },
  { id: "zoom-in", label: "Zoom In" },
  { id: "zoom-out", label: "Zoom Out" },
  { id: "zoom-reset", label: "Reset Zoom" },
  { id: "all-notes", label: "All Notes" },
  { id: "view-archive", label: "View Archive" },
];
