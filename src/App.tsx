import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEventListener } from "./hooks/useEventListener";
import { SearchBar } from "./components/SearchBar";
import { NotesList } from "./components/NotesList";
import { Editor } from "./components/Editor";
import type { EmojiEntry } from "./extensions/emoji";
import { CodexIconPicker, renderCodexIcon } from "./components/CodexIconPicker";
import { Dropdown } from "./components/Dropdown";
import { FolderSetup } from "./components/FolderSetup";
import { UnlockScreen } from "./components/UnlockScreen";
import { CommandPalette } from "./components/CommandPalette";
import type { Command } from "./components/CommandPalette";
import { SensitivePrompt } from "./components/SensitivePrompt";
import { ProtectionSetup } from "./components/ProtectionSetup";
import { ConflictDialog } from "./components/ConflictDialog";
import type { ConflictChoice } from "./components/ConflictDialog";
import { ConflictResolver } from "./components/ConflictResolver";
import { DeleteDialog } from "./components/DeleteDialog";
import { Settings } from "./components/Settings";
import { ReferencePanel } from "./components/ReferencePanel";
import { useNotes } from "./hooks/useNotes";
import { useVault } from "./hooks/useVault";
import { useProtection } from "./hooks/useProtection";
import { useIdleLock } from "./hooks/useIdleLock";
import type { AppSettings, LocalSettings, Preferences } from "./types";
import { extractTags, noteHasTag } from "./utils/tags";
import { mod, shift } from "./utils/platform";
import { LOCAL_KEYS, isLocalKey, splitSettings } from "./utils/settings";

function App() {
  const {
    notes,
    selectedNote,
    selectedId,
    setSelectedId,
    folderSet,
    saveStatus,
    initFolder,
    checkExistingFolder,
    createNote,
    saveNote,
    debouncedSave,
    flushSave,
    deleteNote,
    search,
    loadNotes,
    updateNoteLocally,
    recordBaseVersion,
  } = useNotes();

  const {
    vaultStatus,
    vaultError,
    vaultLoading,
    checkVaultStatus,
    unlockVault,
    lockVault,
    setupVault,
    changePassword,
    disableVault,
  } = useVault();

  const {
    protectionStatus,
    protectionError,
    protectionLoading,
    checkProtectionStatus,
    setupProtection,
    unlockProtection,
    verifyProtectionPassword,
    protectNote,
    unprotectNote,
    getProtectedNoteBody,
    changeProtectionPassword,
    disableProtection,
  } = useProtection();

  const [query, setQuery] = useState("");
  const [activeCodex, setActiveCodex] = useState<string | null>(null);
  const [viewingArchive, setViewingArchive] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editingCodexIcon, setEditingCodexIcon] = useState<string | null>(null);
  const [codexIconAnchor, setCodexIconAnchor] = useState<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [, setIsEditingNote] = useState(false);
  const isEditingNoteRef = useRef(false);

  const setEditingNote = useCallback((value: boolean) => {
    setIsEditingNote(value);
    isEditingNoteRef.current = value;
  }, []);
  const [editorFocusTrigger, setEditorFocusTrigger] = useState(0);
  const editorRef = useRef<any>(null);
  const splitEditorRef = useRef<any>(null);
  const [splitNoteId, setSplitNoteId] = useState<string | null>(null);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  // When set, the notification shows an extra action button (e.g. "Resolve").
  const [notificationAction, setNotificationAction] = useState<{
    label: string;
    run: () => void;
  } | null>(null);
  const [conflictNoteId, setConflictNoteId] = useState<string | null>(null);
  const [showConflictResolver, setShowConflictResolver] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showReferencePanel, setShowReferencePanel] = useState(false);
  const [expandedBacklinks, setExpandedBacklinks] = useState<Set<string>>(new Set());
  const [sensitivePromptId, setSensitivePromptId] = useState<string | null>(null);
  const sensitiveUnlockTime = useRef<Record<string, number>>({});
  const [appSettings, setAppSettings] = useState<AppSettings>({
    theme: "system",
    confirmDelete: true,
  });
  // Always-current mirror of appSettings, so handlers that fire in the same
  // tick as a setAppSettings (e.g. add-profile-then-switch-folder) can read the
  // latest settings without waiting for a re-render.
  const appSettingsRef = useRef<AppSettings>(appSettings);
  const [notesFolder, setNotesFolder] = useState<string | null>(null);
  const [emojis, setEmojis] = useState<EmojiEntry[]>([]);
  useEffect(() => {
    appSettingsRef.current = appSettings;
  }, [appSettings]);

  const reloadEmojis = useCallback(async () => {
    try {
      const list = (await invoke("list_emojis")) as EmojiEntry[];
      setEmojis(list);
    } catch {
      setEmojis([]);
    }
  }, []);

  useEffect(() => {
    if (notesFolder) reloadEmojis();
  }, [notesFolder, reloadEmojis]);

  const splitNote = useMemo(() => splitNoteId ? notes.find((n) => n.id === splitNoteId) || null : null, [notes, splitNoteId]);

  useEffect(() => {
    if (splitNoteId && !notes.find((n) => n.id === splitNoteId)) {
      setSplitNoteId(null);
    }
  }, [notes, splitNoteId]);

  const activeNotes = useMemo(() =>
    viewingArchive ? notes.filter((n) => n.archived) : notes.filter((n) => !n.archived),
    [notes, viewingArchive]
  );

  const archivedCount = useMemo(() => notes.filter((n) => n.archived).length, [notes]);

  useEffect(() => {
    if (viewingArchive && archivedCount === 0) {
      setViewingArchive(false);
    }
  }, [viewingArchive, archivedCount]);

  const codexList = useMemo(() =>
    Array.from(new Set(notes.filter((n) => !n.archived).map((n) => n.codex).filter(Boolean) as string[])).sort(),
    [notes]
  );

  const codexCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of notes) {
      if (n.archived || !n.codex) continue;
      counts[n.codex] = (counts[n.codex] || 0) + 1;
    }
    return counts;
  }, [notes]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const n of notes) {
      if (n.archived) continue;
      for (const t of extractTags(n.body)) tagSet.add(t);
    }
    return Array.from(tagSet).sort();
  }, [notes]);

  const allTagsWithCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) {
      if (n.archived) continue;
      for (const t of extractTags(n.body)) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [notes]);

  const backlinkIndex = useMemo(() => {
    const SCRATCH_RE = /scratch:\/\/([A-Za-z0-9]+)/g;
    const map = new Map<string, { id: string; title: string }[]>();
    for (const note of notes) {
      if (note.archived) continue;
      SCRATCH_RE.lastIndex = 0;
      let match;
      while ((match = SCRATCH_RE.exec(note.body)) !== null) {
        const targetId = match[1];
        if (targetId === note.id) continue;
        const list = map.get(targetId) || [];
        if (!list.some((l) => l.id === note.id)) {
          list.push({ id: note.id, title: note.title || "Untitled" });
          map.set(targetId, list);
        }
      }
    }
    return map;
  }, [notes]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedBacklinks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRenameTag = useCallback(async (oldTag: string, newTag: string) => {
    const cleaned = newTag.replace(/[^a-zA-Z0-9_]/g, "");
    if (!cleaned) return;
    const regex = new RegExp(`((?:^|[\\s(]))#${oldTag}\\b`, "g");
    const toUpdate = notes.filter((n) => !n.archived && noteHasTag(n.body, oldTag));
    await Promise.all(toUpdate.map((note) => {
      const newBody = note.body.replace(regex, `$1#${cleaned}`);
      if (newBody === note.body) return null;
      return invoke("save_note", { id: note.id, title: note.title, body: newBody, codex: note.codex ?? null });
    }));
    await loadNotes();
  }, [notes, loadNotes]);

  const handleDeleteTag = useCallback(async (tag: string) => {
    const regex = new RegExp(`((?:^|[\\s(]))#${tag}\\b`, "g");
    const toUpdate = notes.filter((n) => !n.archived && noteHasTag(n.body, tag));
    await Promise.all(toUpdate.map((note) => {
      const newBody = note.body.replace(regex, "$1");
      if (newBody === note.body) return null;
      return invoke("save_note", { id: note.id, title: note.title, body: newBody.replace(/  +/g, " "), codex: note.codex ?? null });
    }));
    await loadNotes();
  }, [notes, loadNotes]);

  useIdleLock(
    vaultStatus === "unlocked" && (appSettings.idleLockMinutes ?? 0) > 0,
    appSettings.idleLockMinutes ?? 0,
    lockVault
  );

  useEffect(() => {
    async function init() {
      try {
        const settingsJson = (await invoke("get_app_settings")) as string;
        const saved = JSON.parse(settingsJson);

        const local: LocalSettings = {};
        for (const k of LOCAL_KEYS) {
          if (k in saved) (local as Record<string, unknown>)[k] = saved[k];
        }

        if (local.notesFolder) {
          await initFolder(local.notesFolder);
          setNotesFolder(local.notesFolder);
        }

        let prefs: Preferences = {};
        try {
          const prefsJson = (await invoke("get_preferences")) as string;
          prefs = JSON.parse(prefsJson);
        } catch {
          // Preferences not available yet (no folder set)
        }

        // Migration: if local settings contain portable keys, move them
        const portableFromLocal: Preferences = {};
        let needsMigration = false;
        for (const [k, v] of Object.entries(saved)) {
          if (!isLocalKey(k) && v !== undefined) {
            (portableFromLocal as Record<string, unknown>)[k] = v;
            needsMigration = true;
          }
        }

        if (needsMigration && local.notesFolder) {
          // Merge: existing preferences take priority over migrated ones
          const merged = { ...portableFromLocal, ...prefs };
          prefs = merged;
          await invoke("save_preferences", { prefsJson: JSON.stringify(prefs) });
          // Clean portable keys from local settings
          await invoke("save_app_settings", { settingsJson: JSON.stringify(local) });
        }

        setAppSettings((prev) => ({ ...prev, ...local, ...prefs }));
      } catch {
        // No settings yet
      }
      await checkExistingFolder();
      await checkVaultStatus();
      await checkProtectionStatus();
      const folder = (await invoke("get_notes_folder")) as string | null;
      if (folder) setNotesFolder(folder);
      setInitialized(true);
    }
    init();
  }, [initFolder, checkExistingFolder, checkVaultStatus, checkProtectionStatus]);

  useEffect(() => {
    if (initialized && appSettings.defaultCodex && codexList.includes(appSettings.defaultCodex)) {
      setActiveCodex(appSettings.defaultCodex);
    }
  }, [initialized]);

  // Tray icon visibility
  useEffect(() => {
    invoke("set_tray_visible", { visible: appSettings.showTrayIcon !== false });
  }, [appSettings.showTrayIcon]);

  // Theme application
  useEffect(() => {
    const theme = appSettings.theme || "system";
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      document.documentElement.setAttribute(
        "data-theme",
        mq.matches ? "dark" : "light"
      );
      const handler = (e: MediaQueryListEvent) => {
        document.documentElement.setAttribute(
          "data-theme",
          e.matches ? "dark" : "light"
        );
      };
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [appSettings.theme]);

  // Custom color overrides
  useEffect(() => {
    const root = document.documentElement;
    const currentTheme = root.getAttribute("data-theme");
    const isDark = currentTheme === "dark";
    const colors = isDark ? appSettings.colorsDark : appSettings.colorsLight;
    const clamp = (v: number) => Math.max(0, Math.min(255, v));
    const hexRgb = (hex: string) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];

    const ALL_PROPS = [
      "--accent", "--accent-subtle", "--accent-hover",
      "--bg-primary", "--bg-secondary", "--bg-tertiary", "--bg-hover", "--bg-selected",
      "--text-primary", "--text-secondary", "--text-hint",
    ];

    const props: Record<string, string | null> = {};
    for (const p of ALL_PROPS) props[p] = null;

    if (colors?.accent) {
      const [r, g, b] = hexRgb(colors.accent);
      props["--accent"] = colors.accent;
      props["--accent-subtle"] = `rgba(${r}, ${g}, ${b}, ${isDark ? 0.1 : 0.08})`;
    }
    if (colors?.accentHover) props["--accent-hover"] = colors.accentHover;

    if (colors?.bgPrimary) {
      const [r, g, b] = hexRgb(colors.bgPrimary);
      const shift = isDark ? 12 : -8;
      const hoverShift = isDark ? 6 : -4;
      props["--bg-primary"] = colors.bgPrimary;
      props["--bg-tertiary"] = `rgb(${clamp(r + shift)}, ${clamp(g + shift)}, ${clamp(b + shift)})`;
      props["--bg-hover"] = `rgb(${clamp(r + hoverShift)}, ${clamp(g + hoverShift)}, ${clamp(b + hoverShift)})`;
    }
    if (colors?.bgSecondary) props["--bg-secondary"] = colors.bgSecondary;
    if (colors?.bgSelected) props["--bg-selected"] = colors.bgSelected;
    if (colors?.textPrimary) props["--text-primary"] = colors.textPrimary;

    if (colors?.textSecondary) {
      const [r, g, b] = hexRgb(colors.textSecondary);
      const hintShift = isDark ? -20 : 20;
      props["--text-secondary"] = colors.textSecondary;
      props["--text-hint"] = `rgb(${clamp(r + hintShift)}, ${clamp(g + hintShift)}, ${clamp(b + hintShift)})`;
    }

    for (const [prop, value] of Object.entries(props)) {
      if (value) {
        root.style.setProperty(prop, value);
      } else {
        root.style.removeProperty(prop);
      }
    }
  }, [appSettings.colorsLight, appSettings.colorsDark, appSettings.theme]);

  // Zoom level
  useEffect(() => {
    const zoom = appSettings.zoomLevel ?? 100;
    getCurrentWebview().setZoom(zoom / 100);
  }, [appSettings.zoomLevel]);


  const filteredNotes = useMemo(() => {
    if (isCreateMode) return activeNotes;
    const tagTokens: string[] = [];
    const mentionTokens: string[] = [];
    const textParts: string[] = [];
    for (const token of query.trim().split(/\s+/)) {
      if (/^#[a-zA-Z]\w*$/.test(token)) {
        tagTokens.push(token.slice(1));
      } else if (/^@.+$/.test(token)) {
        mentionTokens.push(token.slice(1).toLowerCase());
      } else if (token) {
        textParts.push(token);
      }
    }
    const textQuery = textParts.join(" ");
    let results = textQuery
      ? search(textQuery).filter((n) => viewingArchive ? n.archived : !n.archived)
      : activeNotes;
    for (const tag of tagTokens) {
      results = results.filter((n) => noteHasTag(n.body, tag));
    }
    for (const mention of mentionTokens) {
      results = results.filter((n) => n.body.toLowerCase().includes(`@${mention}`));
    }
    if (activeCodex && !viewingArchive) {
      results = results.filter((n) => n.codex === activeCodex);
    }
    return results;
  }, [query, search, activeNotes, activeCodex, isCreateMode, viewingArchive]);

  // Auto-select best match when search results change
  useEffect(() => {
    if (isCreateMode) return;
    if (filteredNotes.length > 0) {
      const currentInList = filteredNotes.find((n) => n.id === selectedId);
      if (!currentInList) {
        // Only override if selected note doesn't exist in full notes list either
        // (prevents overriding selection of a just-created note before filteredNotes catches up)
        const existsInNotes = notes.find((n) => n.id === selectedId);
        if (!existsInNotes) {
          setSelectedId(filteredNotes[0].id);
        }
      }
    }
  }, [filteredNotes, selectedId, setSelectedId, isCreateMode, notes]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused && vaultStatus !== "locked") {
        searchInputRef.current?.focus();
      } else if (!focused) {
        // Window lost focus (hidden/backgrounded): commit pending edits so they
        // sync out while we're away, shrinking the multi-device collision window.
        flushSave();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [vaultStatus, flushSave]);

  useEventListener("create-new-note", () => {
    searchInputRef.current?.focus();
    setQuery("");
  });

  useEventListener("lock-vault", () => {
    if (vaultStatus === "unlocked") lockVault();
  }, [vaultStatus, lockVault]);

  useEventListener("open-settings", () => {
    setShowSettings(true);
  });

  useEventListener("system-sleep", () => {
    if (vaultStatus === "unlocked") lockVault();
  }, [vaultStatus, lockVault]);

  // Show a notification with a "Resolve" button that opens the conflict resolver.
  const notifyWithResolve = useCallback((message: string) => {
    setNotification(message);
    setNotificationAction({
      label: "Resolve",
      run: () => {
        setNotification(null);
        setNotificationAction(null);
        setShowConflictResolver(true);
      },
    });
  }, []);

  useEventListener("note-conflict", () => {
    setNotification(
      "A note was modified externally while you were editing. Both versions were preserved."
    );
  });

  useEventListener("dropbox-conflict", () => {
    notifyWithResolve(
      "A Dropbox sync conflict was detected and preserved. Review it to pick which version to keep."
    );
  });

  useEventListener("folder-unavailable", () => {
    setNotification("Vault location is no longer accessible.");
  });

  useEventListener<{ id: string }>("note-conflict-active", (payload) => {
    setConflictNoteId(payload.id);
  });

  // A save raced an external write; the losing version was backed up to conflicts.
  useEventListener<{ id: string }>("save-conflict", () => {
    loadNotes();
    notifyWithResolve(
      "This note was also changed on another device. Both versions were preserved."
    );
  });

  const handleConflictChoice = useCallback(
    async (choice: ConflictChoice) => {
      if (choice === "keep-external") {
        await loadNotes();
      }
      // "keep-local" does nothing — the local version will win on next save
      // "dismiss" just closes the dialog
      setConflictNoteId(null);
    },
    [loadNotes]
  );

  const handleUnlock = useCallback(
    async (password: string) => {
      const success = await unlockVault(password);
      if (success) {
        await loadNotes();
      }
      return success;
    },
    [unlockVault, loadNotes]
  );

  const handleLock = useCallback(async () => {
    await lockVault();
    sensitiveUnlockTime.current = {};
  }, [lockVault]);

  // The single writer for settings. Splits into local (settings.json) and
  // portable (preferences.json) via the shared LOCAL_KEYS partition so the two
  // files always agree on ownership. notesFolder is always taken from current
  // state, never trusted from the caller's (possibly stale) copy.
  const persistSettings = useCallback(
    async (next: AppSettings) => {
      const { local, prefs } = splitSettings({ ...next, notesFolder: notesFolder || undefined });
      await Promise.all([
        invoke("save_app_settings", { settingsJson: JSON.stringify(local) }),
        invoke("save_preferences", { prefsJson: JSON.stringify(prefs) }),
      ]);
    },
    [notesFolder]
  );

  const handleSettingsChange = useCallback(
    async (newSettings: AppSettings) => {
      appSettingsRef.current = newSettings;
      setAppSettings(newSettings);
      await persistSettings(newSettings);
    },
    [persistSettings]
  );

  const handleRenameCodex = useCallback(async (oldName: string, newName: string) => {
    if (!newName.trim()) return;
    const toRename = notes.filter((n) => n.codex === oldName);
    await Promise.all(toRename.map((n) =>
      invoke("save_note", { id: n.id, title: n.title, body: n.body, codex: newName.trim() })
    ));
    const updatedSettings = { ...appSettings };
    let settingsChanged = false;
    if (updatedSettings.defaultCodex === oldName) {
      updatedSettings.defaultCodex = newName.trim();
      settingsChanged = true;
    }
    if (updatedSettings.dailyNoteCodex === oldName) {
      updatedSettings.dailyNoteCodex = newName.trim();
      settingsChanged = true;
    }
    if (settingsChanged) {
      handleSettingsChange(updatedSettings);
    }
    await loadNotes();
  }, [notes, loadNotes, appSettings, handleSettingsChange]);

  const handleChangeFolder = useCallback(
    async (path: string) => {
      await initFolder(path);
      setNotesFolder(path);
      // Persist local settings (including any just-updated vaultProfiles) with
      // the new folder. Read current settings via functional setState so we
      // never clobber changes made in the same tick (e.g. onAdd sets profiles
      // then switches folder). The prefs file is unchanged here.
      const { local } = splitSettings({ ...appSettingsRef.current, notesFolder: path });
      await invoke("save_app_settings", { settingsJson: JSON.stringify(local) });
      await checkVaultStatus();
      // Load the portable preferences that belong to the new folder.
      try {
        const prefsJson = (await invoke("get_preferences")) as string;
        const prefs: Preferences = JSON.parse(prefsJson);
        setAppSettings((prev) => ({ ...prev, ...prefs, notesFolder: path }));
      } catch {
        // New folder, no preferences yet
      }
    },
    [initFolder, checkVaultStatus]
  );

  const handleTogglePin = useCallback(
    (id: string) => {
      const pinned = appSettings.pinnedNotes || [];
      const next = pinned.includes(id)
        ? pinned.filter((p) => p !== id)
        : [...pinned, id];
      handleSettingsChange({ ...appSettings, pinnedNotes: next });
    },
    [appSettings, handleSettingsChange]
  );

  const handleToggleFreeze = useCallback(
    (id: string) => {
      const frozen = appSettings.frozenNotes || [];
      const next = frozen.includes(id)
        ? frozen.filter((f) => f !== id)
        : [...frozen, id];
      handleSettingsChange({ ...appSettings, frozenNotes: next });
    },
    [appSettings, handleSettingsChange]
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      const note = notes.find((n) => n.id === id);
      if (!note) return;
      const newNote = await createNote(`${note.title} (copy)`, note.codex);
      await saveNote(newNote.id, newNote.title, note.body, note.codex);
    },
    [notes, createNote, saveNote]
  );

  const handleToggleArchive = useCallback(
    async (id: string) => {
      const note = notes.find((n) => n.id === id);
      if (!note) return;
      const newArchived = !note.archived;
      await invoke("set_note_archived", { id, archived: newArchived });
      if (!newArchived && viewingArchive) {
        const otherArchived = notes.filter((n) => n.archived && n.id !== id);
        if (otherArchived.length === 0) {
          setViewingArchive(false);
        }
      }
      await loadNotes();
    },
    [notes, loadNotes, viewingArchive]
  );

  const handleOpenSplit = useCallback(
    (id: string | null) => {
      setSplitNoteId(id === splitNoteId ? null : id);
    },
    [splitNoteId]
  );

  const handleSplitTitleChange = useCallback(
    (title: string) => {
      if (!splitNote) return;
      if ((appSettings.frozenNotes || []).includes(splitNote.id)) return;
      updateNoteLocally(splitNote.id, { title });
      debouncedSave(splitNote.id, title, splitNote.body, splitNote.codex);
    },
    [splitNote, debouncedSave, updateNoteLocally, appSettings.frozenNotes]
  );

  const handleSplitBodyChange = useCallback(
    (body: string) => {
      if (!splitNote) return;
      if ((appSettings.frozenNotes || []).includes(splitNote.id)) return;
      debouncedSave(splitNote.id, splitNote.title, body, splitNote.codex);
    },
    [splitNote, debouncedSave, appSettings.frozenNotes]
  );

  const handleSplitCodexChange = useCallback(
    (codex: string | null) => {
      if (!splitNote) return;
      debouncedSave(splitNote.id, splitNote.title, splitNote.body, codex);
    },
    [splitNote, debouncedSave]
  );

  const handleSelectNote = useCallback(
    (id: string) => {
      // Commit any pending edit to the note we're leaving before switching.
      flushSave();
      const note = notes.find((n) => n.id === id);
      // Per-note protection in plaintext mode
      const isFileProtected = note?.encrypted && vaultStatus === "plaintext";
      // Re-auth gate in vault mode
      const isVaultProtected = vaultStatus === "unlocked" && (appSettings.protectedNotes || []).includes(id);

      if (isFileProtected || isVaultProtected) {
        const unlockedAt = sensitiveUnlockTime.current[id];
        const expired = !unlockedAt || Date.now() - unlockedAt > 5 * 60 * 1000;
        if (expired) {
          if (isFileProtected) {
            setDecryptedBodies((prev) => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
          }
          setSensitivePromptId(id);
          setSelectedId(id); // Highlight the protected note
          return;
        }
      }
      setSensitivePromptId(null);
      setSelectedId(id);
    },
    [notes, vaultStatus, setSelectedId, appSettings.protectedNotes, flushSave]
  );

  const [decryptedBodies, setDecryptedBodies] = useState<Record<string, string>>({});

  const handleSensitiveUnlock = useCallback(
    async (id: string) => {
      sensitiveUnlockTime.current[id] = Date.now();
      setSensitivePromptId(null);
      // In plaintext mode, decrypt the protected note body
      if (vaultStatus === "plaintext") {
        try {
          const body = await getProtectedNoteBody(id);
          setDecryptedBodies((prev) => ({ ...prev, [id]: body }));
        } catch {
          // If decryption fails, body stays empty
        }
      }
      setSelectedId(id);
    },
    [setSelectedId, vaultStatus, getProtectedNoteBody]
  );

  const [protectionSetupPending, setProtectionSetupPending] = useState<string | null>(null);
  const [protectionUnlockPending, setProtectionUnlockPending] = useState<string | null>(null);

  const handleToggleSensitive = useCallback(
    async (id: string) => {
      const note = notes.find((n) => n.id === id);
      if (!note) return;

      if (vaultStatus === "unlocked") {
        // Vault mode: toggle re-auth gate in settings (no file-level encryption)
        const protected_ = appSettings.protectedNotes || [];
        const next = protected_.includes(id)
          ? protected_.filter((p) => p !== id)
          : [...protected_, id];
        handleSettingsChange({ ...appSettings, protectedNotes: next });
        return;
      }

      // Plaintext mode: actual per-file encryption
      if (note.encrypted) {
        // Always require re-auth to remove protection
        setProtectionUnlockPending(`unprotect:${id}`);
        return;
      } else {
        if (protectionStatus === "none") {
          setProtectionSetupPending(id);
          return;
        }
        if (protectionStatus === "locked") {
          setProtectionUnlockPending(`protect:${id}`);
          return;
        }
        try {
          await protectNote(id);
          await loadNotes();
        } catch (e) {
          setNotification(`Failed to protect note: ${e}`);
        }
      }
    },
    [notes, vaultStatus, appSettings, handleSettingsChange, protectionStatus, protectNote, unprotectNote, loadNotes]
  );

  const focusEditor = useCallback(() => {
    setTimeout(() => {
      if (editorRef.current && editorRef.current.view) {
        editorRef.current.view.dom.focus();
        const tr = editorRef.current.state.tr.setSelection(
          editorRef.current.state.selection.constructor.atStart(editorRef.current.state.doc)
        );
        editorRef.current.view.dispatch(tr);
        setEditingNote(true);
      }
    }, 100);
  }, []);

  const handleDailyNote = useCallback(async () => {
    const today = new Date();
    const dateStr = today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const format = appSettings.dailyNoteFormat || "{date}";
    const title = format.replace("{date}", dateStr);
    const existing = notes.find((n) => n.title === title && !n.archived);
    if (existing) {
      handleSelectNote(existing.id);
    } else {
      const codex = appSettings.dailyNoteCodex || null;
      const newNote = await createNote(title, codex);
      handleSelectNote(newNote.id);
      focusEditor();
    }
  }, [notes, appSettings.dailyNoteCodex, appSettings.dailyNoteFormat, createNote, handleSelectNote, focusEditor]);

  const handleSearchSubmit = useCallback(async () => {
    if (isCreateMode) {
      // In create mode: Enter creates note with query as title
      if (!query.trim()) return;
      const newNote = await createNote(query.trim(), activeCodex);
      setQuery("");
      setIsCreateMode(false);
      handleSelectNote(newNote.id);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      focusEditor();
    } else {
      // In search mode: Enter selects note and exits search (enter browse mode)
      if (selectedId) {
        handleSelectNote(selectedId);
        // Explicitly enter browse mode
        setEditingNote(false);
        // Blur search
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
    }
  }, [isCreateMode, query, selectedId, createNote, activeCodex, handleSelectNote, focusEditor]);

  const handleSearchCreate = useCallback(async () => {
    // Cmd+Enter: create new note with search query as title
    if (!query.trim()) return;
    const newNote = await createNote(query.trim(), activeCodex);
    setQuery("");
    setIsCreateMode(false);
    handleSelectNote(newNote.id);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    focusEditor();
  }, [query, createNote, activeCodex, handleSelectNote, focusEditor]);

  const navigateNote = useCallback((direction: 1 | -1) => {
    // Use the same list that's displayed on screen
    let list = (query || activeCodex || viewingArchive) ? filteredNotes : activeNotes;
    if (list.length === 0) return;

    // Sort by pinned first, then unpinned (same as NotesList)
    const pinnedIds = appSettings.pinnedNotes || [];
    const pinned = list.filter((n) => pinnedIds.includes(n.id));
    const unpinned = list.filter((n) => !pinnedIds.includes(n.id));
    list = [...pinned, ...unpinned];

    const idx = list.findIndex((n) => n.id === selectedId);
    const next = Math.max(0, Math.min(idx + direction, list.length - 1));

    // Exit edit mode when navigating and reset focus trigger
    setEditingNote(false);
    setEditorFocusTrigger(0);
    handleSelectNote(list[next].id);
  }, [query, activeCodex, viewingArchive, filteredNotes, activeNotes, selectedId, appSettings.pinnedNotes, handleSelectNote]);

  const handleArrowDown = useCallback(() => navigateNote(1), [navigateNote]);
  const handleArrowUp = useCallback(() => navigateNote(-1), [navigateNote]);

  const handleZoom = useCallback(
    (delta: number) => {
      const current = appSettings.zoomLevel ?? 100;
      const next = Math.max(70, Math.min(150, current + delta));
      if (next !== current) handleSettingsChange({ ...appSettings, zoomLevel: next });
    },
    [appSettings, handleSettingsChange]
  );

  const handleEscape = useCallback(async () => {
    if (showSettings) {
      setShowSettings(false);
      return;
    }
    // Exit create mode if active
    if (isCreateMode) {
      setIsCreateMode(false);
      setQuery("");
      return;
    }
    // If there's a query, clear it
    if (query) {
      setQuery("");
      return;
    }
    // If search is focused, blur it
    if (searchInputRef.current && document.activeElement === searchInputRef.current) {
      searchInputRef.current.blur();
      return;
    }
    // Otherwise hide the window — flush pending edits first so nothing lingers.
    flushSave();
    const appWindow = getCurrentWindow();
    await appWindow.hide();
  }, [showSettings, isCreateMode, query, flushSave]);

  const saveProtectedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveProtectedNote = useCallback(
    (id: string, title: string, body: string, codex: string | null) => {
      if (saveProtectedDebounceRef.current) {
        clearTimeout(saveProtectedDebounceRef.current);
      }
      saveProtectedDebounceRef.current = setTimeout(async () => {
        try {
          await invoke("save_protected_note", { id, title, body, codex });
        } catch {
          // silently fail — same as regular save
        }
      }, 400);
    },
    []
  );

  const isSelectedProtected = selectedNote?.encrypted && vaultStatus === "plaintext";

  const verifyProtection = useCallback(
    async (pw: string) => {
      if (protectionStatus !== "unlocked") {
        return await unlockProtection(pw);
      }
      return await verifyProtectionPassword(pw);
    },
    [protectionStatus, unlockProtection, verifyProtectionPassword]
  );

  const handleTitleChange = useCallback(
    (title: string) => {
      if (!selectedNote) return;
      if ((appSettings.frozenNotes || []).includes(selectedNote.id)) return;
      updateNoteLocally(selectedNote.id, { title });
      const body = decryptedBodies[selectedNote.id] ?? selectedNote.body;
      if (isSelectedProtected) {
        setDecryptedBodies((prev) => ({ ...prev, [selectedNote.id]: body }));
        saveProtectedNote(selectedNote.id, title, body, selectedNote.codex ?? null);
      } else {
        debouncedSave(selectedNote.id, title, selectedNote.body, selectedNote.codex);
      }
    },
    [selectedNote, debouncedSave, saveProtectedNote, isSelectedProtected, decryptedBodies, updateNoteLocally, appSettings.frozenNotes]
  );

  const handleBodyChange = useCallback(
    (body: string) => {
      if (!selectedNote) return;
      if ((appSettings.frozenNotes || []).includes(selectedNote.id)) return;
      if (isSelectedProtected) {
        setDecryptedBodies((prev) => ({ ...prev, [selectedNote.id]: body }));
        saveProtectedNote(selectedNote.id, selectedNote.title, body, selectedNote.codex ?? null);
      } else {
        debouncedSave(selectedNote.id, selectedNote.title, body, selectedNote.codex);
      }
    },
    [selectedNote, debouncedSave, saveProtectedNote, isSelectedProtected, appSettings.frozenNotes]
  );

  const handleCodexChange = useCallback(
    (codex: string | null) => {
      if (!selectedNote) return;
      const body = decryptedBodies[selectedNote.id] ?? selectedNote.body;
      if (isSelectedProtected) {
        saveProtectedNote(selectedNote.id, selectedNote.title, body, codex);
      } else {
        debouncedSave(selectedNote.id, selectedNote.title, selectedNote.body, codex);
      }
    },
    [selectedNote, debouncedSave, saveProtectedNote, isSelectedProtected, decryptedBodies]
  );

  const pendingDeleteId = useRef<string | null>(null);

  const handleDeleteById = useCallback(
    async (id: string) => {
      if (appSettings.confirmDelete !== false) {
        pendingDeleteId.current = id;
        setShowDeleteDialog(true);
      } else {
        await deleteNote(id);
      }
    },
    [deleteNote, appSettings.confirmDelete]
  );

  const handleConfirmDelete = useCallback(async () => {
    setShowDeleteDialog(false);
    const id = pendingDeleteId.current;
    pendingDeleteId.current = null;
    if (id) {
      await deleteNote(id);
    }
  }, [deleteNote]);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteDialog(false);
    pendingDeleteId.current = null;
  }, []);

  const handleDelete = useCallback(async () => {
    if (selectedId) await handleDeleteById(selectedId);
  }, [selectedId, handleDeleteById]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "n" && !e.shiftKey) {
        e.preventDefault();
        // Enter create mode: focus search and wait for title input
        setIsCreateMode(true);
        setQuery("");
        searchInputRef.current?.focus();
      } else if (mod && e.shiftKey && key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (mod && !e.shiftKey && key === "l") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (mod && !e.shiftKey && key === "k") {
        e.preventDefault();
        setShowCommandPalette((s) => !s);
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setShowSettings((s) => !s);
      } else if (mod && e.key === ".") {
        e.preventDefault();
        setShowReferencePanel((s) => !s);
      } else if (mod && e.key === "/") {
        e.preventDefault();
        setSidebarCollapsed((s) => !s);
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        handleZoom(10);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        handleZoom(-10);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        handleSettingsChange({ ...appSettings, zoomLevel: 100 });
      } else if (mod && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx === 0) {
          setActiveCodex(null);
          setViewingArchive(false);
        } else if (idx - 1 < codexList.length) {
          setActiveCodex(codexList[idx - 1]);
          setViewingArchive(false);
        }
      } else if (mod && key === "j" && !e.shiftKey) {
        e.preventDefault();
        handleDailyNote();
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        setSplitNoteId((s) => s ? null : selectedId);
      } else if (mod && key === "t" && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new Event("toggle-toc"));
      } else if (mod && e.shiftKey && e.key === "]") {
        e.preventDefault();
        navigateNote(1);
      } else if (mod && e.shiftKey && e.key === "[") {
        e.preventDefault();
        navigateNote(-1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDelete, handleLock, handleZoom, handleSettingsChange, handleDailyNote, appSettings, codexList]);

  // Browse mode keyboard navigation
  useEffect(() => {
    const handleBrowseKeys = (e: KeyboardEvent) => {
      // Skip if in a modal, editing codex icon, or typing in an input/textarea
      if (showSettings || showCommandPalette || sensitivePromptId || editingCodexIcon) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Check if we're in the editor (tiptap)
      const target = e.target as HTMLElement;
      const inEditor = target.closest('.ProseMirror') || target.closest('.editor-title');

      // In edit mode - only handle Escape
      if (inEditor || isEditingNoteRef.current) {
        if (e.key === "Escape") {
          e.preventDefault();
          setEditingNote(false);
          // Blur any focused element
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        }
        return;
      }

      // Browse mode: note selected but not editing
      if (selectedId && !isEditingNoteRef.current) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          navigateNote(e.key === "ArrowDown" ? 1 : -1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const isFrozen = selectedId && (appSettings.frozenNotes || []).includes(selectedId);
          if (!isFrozen && editorRef.current && editorRef.current.view && editorRef.current.isEditable) {
            editorRef.current.view.dom.focus();
            const tr = editorRef.current.state.tr.setSelection(
              editorRef.current.state.selection.constructor.atStart(editorRef.current.state.doc)
            );
            editorRef.current.view.dispatch(tr);
          }
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          if (selectedId && backlinkIndex.has(selectedId) && !expandedBacklinks.has(selectedId)) {
            handleToggleExpand(selectedId);
          }
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          if (selectedId && expandedBacklinks.has(selectedId)) {
            handleToggleExpand(selectedId);
          } else {
            searchInputRef.current?.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleBrowseKeys);
    return () => window.removeEventListener("keydown", handleBrowseKeys);
  }, [showSettings, showCommandPalette, sensitivePromptId, editingCodexIcon, selectedId, navigateNote, appSettings.frozenNotes, backlinkIndex, expandedBacklinks, handleToggleExpand]);

  const commands: Command[] = useMemo(() => [
    { id: "new-note", label: "New Note", shortcut: `${mod}N`, action: () => { setIsCreateMode(true); setQuery(""); searchInputRef.current?.focus(); } },
    { id: "daily-note", label: "Daily Note", shortcut: `${mod}J`, action: handleDailyNote },
    { id: "find-in-note", label: "Find in Note", shortcut: `${mod}F`, action: () => window.dispatchEvent(new Event("open-in-note-search")) },
    { id: "find-replace", label: "Find & Replace", shortcut: `${mod}H`, action: () => window.dispatchEvent(new Event("open-find-replace")) },
    { id: "search", label: "Search Notes", shortcut: `${mod}${shift}F`, action: () => { searchInputRef.current?.focus(); searchInputRef.current?.select(); } },
    { id: "delete-note", label: "Delete Note", action: handleDelete },
    ...(selectedId ? [
      {
        id: "pin-note",
        label: (appSettings.pinnedNotes || []).includes(selectedId) ? "Unpin Note" : "Pin Note",
        action: () => handleTogglePin(selectedId),
      },
      {
        id: "freeze-note",
        label: (appSettings.frozenNotes || []).includes(selectedId) ? "Unfreeze Note" : "Freeze Note",
        action: () => handleToggleFreeze(selectedId),
      },
      {
        id: "archive-note",
        label: notes.find((n) => n.id === selectedId)?.archived ? "Unarchive Note" : "Archive Note",
        action: () => handleToggleArchive(selectedId),
      },
      {
        id: "copy-markdown",
        label: "Copy as Markdown",
        action: () => {
          const md = editorRef.current?.storage?.markdown?.getMarkdown?.() ?? selectedNote?.body ?? "";
          navigator.clipboard.writeText(md);
        },
      },
      {
        id: "duplicate-note",
        label: "Duplicate Note",
        action: () => handleDuplicate(selectedId),
      },
      {
        id: "split-view",
        label: splitNoteId === selectedId ? "Close Split View" : "Open in Split View",
        shortcut: splitNoteId ? `${mod}\\` : undefined,
        action: () => setSplitNoteId(splitNoteId === selectedId ? null : selectedId),
      },
    ] : []),
    { id: "settings", label: "Open Settings", shortcut: `${mod},`, action: () => setShowSettings(true) },
    { id: "resolve-conflicts", label: "Resolve Sync Conflicts", action: () => setShowConflictResolver(true) },
    { id: "reference-panel", label: showReferencePanel ? "Hide Reference Panel" : "Reference Panel", shortcut: `${mod}.`, action: () => setShowReferencePanel((s) => !s) },
    { id: "scratchpad", label: "Open Scratchpad", action: () => invoke("open_scratchpad") },
    { id: "lock-vault", label: "Lock Vault", action: handleLock },
    { id: "toggle-sidebar", label: "Toggle Sidebar", shortcut: `${mod}/`, action: () => setSidebarCollapsed((s) => !s) },
    { id: "next-note", label: "Next Note", shortcut: `${mod}${shift}]`, action: () => navigateNote(1) },
    { id: "prev-note", label: "Previous Note", shortcut: `${mod}${shift}[`, action: () => navigateNote(-1) },
    { id: "zoom-in", label: "Zoom In", shortcut: `${mod}+`, action: () => handleZoom(10) },
    { id: "zoom-out", label: "Zoom Out", shortcut: `${mod}-`, action: () => handleZoom(-10) },
    { id: "zoom-reset", label: "Reset Zoom", shortcut: `${mod}0`, action: () => handleSettingsChange({ ...appSettings, zoomLevel: 100 }) },
    ...(selectedId && (vaultStatus === "plaintext" || vaultStatus === "unlocked") ? [{
      id: "toggle-sensitive",
      label: (() => {
        if (vaultStatus === "plaintext") {
          return notes.find(n => n.id === selectedId)?.encrypted
            ? "Remove Note Protection" : "Protect Note";
        }
        return (appSettings.protectedNotes || []).includes(selectedId)
          ? "Remove Protection" : "Mark as Protected";
      })(),
      action: () => handleToggleSensitive(selectedId),
    }] : []),
    ...(splitNoteId ? [{ id: "close-split", label: "Close Split View", shortcut: `${mod}\\`, action: () => setSplitNoteId(null) }] : []),
    { id: "all-notes", label: "All Notes", shortcut: `${mod}1`, action: () => { setActiveCodex(null); setViewingArchive(false); } },
    { id: "view-archive", label: viewingArchive ? "Exit Archive" : "View Archive", action: () => { setViewingArchive((s) => !s); setActiveCodex(null); } },
    ...codexList.map((c, i) => ({
      id: `codex-${c}`,
      label: `Codex: ${c}`,
      shortcut: i < 8 ? `${mod}${i + 2}` : undefined,
      action: () => { setActiveCodex(c); setViewingArchive(false); },
    })),
  ], [handleDelete, handleLock, handleDailyNote, handleTogglePin, handleToggleFreeze, handleToggleArchive, handleZoom, handleSettingsChange, handleToggleSensitive, navigateNote, appSettings, selectedId, selectedNote, splitNoteId, codexList, notes, vaultStatus, showReferencePanel, viewingArchive]);

  if (!initialized) {
    return <div className="loading">Loading…</div>;
  }

  if (!folderSet) {
    return (
      <FolderSetup
        onFolderSelected={(path) => {
          initFolder(path);
        }}
      />
    );
  }

  if (vaultStatus === "locked") {
    return (
      <UnlockScreen
        onUnlock={handleUnlock}
        error={vaultError}
        loading={vaultLoading}
      />
    );
  }

  const displayNotes = (query && !isCreateMode) || activeCodex || viewingArchive ? filteredNotes : activeNotes;

  return (
    <div className={`app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      {conflictNoteId && (
        <ConflictDialog
          noteId={conflictNoteId}
          onChoice={handleConflictChoice}
        />
      )}
      {showDeleteDialog && (
        <DeleteDialog
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}
      {notification && (
        <div className="notification">
          <span>{notification}</span>
          {notificationAction && (
            <button
              className="notification-action"
              onClick={notificationAction.run}
            >
              {notificationAction.label}
            </button>
          )}
          <button
            className="notification-dismiss"
            onClick={() => {
              setNotification(null);
              setNotificationAction(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {showConflictResolver && (
        <ConflictResolver
          onClose={() => setShowConflictResolver(false)}
          onResolved={() => {
            loadNotes();
          }}
        />
      )}
      {showCommandPalette && (
        <CommandPalette
          commands={commands}
          pinnedIds={appSettings.pinnedCommands || []}
          onTogglePin={(id) => {
            const pinned = appSettings.pinnedCommands || [];
            const next = pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id];
            handleSettingsChange({ ...appSettings, pinnedCommands: next });
          }}
          onClose={() => setShowCommandPalette(false)}
          notes={notes}
          onSelectNote={(id) => setSelectedId(id)}
        />
      )}
      <SearchBar
        ref={searchInputRef}
        value={query}
        onChange={setQuery}
        onSubmit={handleSearchSubmit}
        onCreate={handleSearchCreate}
        onArrowDown={handleArrowDown}
        onArrowUp={handleArrowUp}
        onEscape={handleEscape}
        onCommandPaletteClick={() => setShowCommandPalette(true)}
        onSettingsClick={() => setShowSettings(s => !s)}
        isCreateMode={isCreateMode}
        activeTags={allTags}
        dictionary={appSettings.dictionary}
        vaultProfiles={appSettings.vaultProfiles}
        activeFolder={notesFolder}
        onVaultSwitch={handleChangeFolder}
      />
      <div className="app-body">
      {!sidebarCollapsed && (
        <div className="codex-sidebar">
          <button
            className={`codex-sidebar-item ${activeCodex === null && !viewingArchive ? "active" : ""}`}
            onClick={() => { setActiveCodex(null); setViewingArchive(false); }}
            title="All Notes"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          {codexList.map((codex) => (
            <div key={codex} className="codex-sidebar-item-wrap">
              <button
                className={`codex-sidebar-item ${activeCodex === codex && !viewingArchive ? "active" : ""}`}
                style={appSettings.codexColors?.[codex] ? { color: appSettings.codexColors[codex] } : undefined}
                onClick={() => { setActiveCodex(activeCodex === codex ? null : codex); setViewingArchive(false); }}
                onDoubleClick={(e) => { setEditingCodexIcon(codex); setCodexIconAnchor(e.currentTarget); }}
                title={`${codex} (double-click to set icon)`}
              >
                {renderCodexIcon(appSettings.codexIcons?.[codex], emojis, codex[0].toUpperCase())}
              </button>
              {editingCodexIcon === codex && (
                <CodexIconPicker
                  value={appSettings.codexIcons?.[codex] || ""}
                  emojis={emojis}
                  anchorEl={codexIconAnchor}
                  onSelect={(icon) => {
                    const newIcons = { ...appSettings.codexIcons, [codex]: icon };
                    if (!icon) delete newIcons[codex];
                    handleSettingsChange({ ...appSettings, codexIcons: newIcons });
                  }}
                  onClose={() => { setEditingCodexIcon(null); setCodexIconAnchor(null); }}
                />
              )}
            </div>
          ))}
          <div className="codex-sidebar-bottom">
            {archivedCount > 0 && (
              <button
                className={`codex-sidebar-item codex-sidebar-archive ${viewingArchive ? "active" : ""}`}
                onClick={() => { setViewingArchive((s) => !s); setActiveCodex(null); }}
                title={`Archive (${archivedCount})`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="21 8 21 21 3 21 3 8"/>
                  <rect x="1" y="3" width="22" height="5"/>
                  <line x1="10" y1="12" x2="14" y2="12"/>
                </svg>
              </button>
            )}
            <button
              className="codex-sidebar-item codex-sidebar-toggle"
              onClick={() => setSidebarCollapsed(true)}
              title="Collapse sidebar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>
        </div>
      )}
      {sidebarCollapsed && (
        <button
          className="codex-sidebar-expand"
          onClick={() => setSidebarCollapsed(false)}
          title="Expand sidebar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
      <div className="app-main">
      {showSettings ? (
        <Settings
          settings={appSettings}
          onSettingsChange={handleSettingsChange}
          notesFolder={notesFolder}
          vaultStatus={vaultStatus}
          onClose={() => setShowSettings(false)}
          onSetupVault={setupVault}
          onLockVault={handleLock}
          onChangePassword={changePassword}
          onDisableVault={disableVault}
          onReloadNotes={loadNotes}
          onChangeFolder={handleChangeFolder}
          vaultError={vaultError}
          vaultLoading={vaultLoading}
          protectionStatus={protectionStatus}
          onChangeProtectionPassword={changeProtectionPassword}
          onDisableProtection={disableProtection}
          protectionError={protectionError}
          protectionLoading={protectionLoading}
          codexList={codexList}
          allTags={allTagsWithCounts}
          onRenameTag={handleRenameTag}
          onDeleteTag={handleDeleteTag}
          onRenameCodex={handleRenameCodex}
          codexCounts={codexCounts}
          emojis={emojis}
          onReloadEmojis={reloadEmojis}
        />
      ) : (
        <div className="main-content">
          {!sidebarCollapsed && (
            <div className="notes-panel">
                <div className="codex-dropdown">
                <Dropdown
                  value={viewingArchive ? "__archive__" : (activeCodex || "")}
                  onChange={(v) => {
                    if (v === "__archive__") {
                      setViewingArchive(true);
                      setActiveCodex(null);
                    } else {
                      setViewingArchive(false);
                      setActiveCodex(v || null);
                    }
                  }}
                  options={[
                    { value: "", label: "All Notes" },
                    ...codexList.map((c) => ({ value: c, label: `Codex: ${c}` })),
                    ...(archivedCount > 0 ? [{ value: "__archive__", label: `Archive (${archivedCount})` }] : []),
                  ]}
                />
              </div>
              <NotesList
                notes={displayNotes}
                backlinkIndex={backlinkIndex}
                selectedId={selectedId}
                onSelect={handleSelectNote}
                onDelete={handleDeleteById}
                onTogglePin={handleTogglePin}
                onToggleSensitive={vaultStatus === "plaintext" || vaultStatus === "unlocked" ? handleToggleSensitive : undefined}
                onToggleArchive={handleToggleArchive}
                onToggleFreeze={handleToggleFreeze}
                onDuplicate={handleDuplicate}
                onOpenSplit={handleOpenSplit}
                pinnedIds={appSettings.pinnedNotes || []}
                frozenIds={appSettings.frozenNotes || []}
                sensitiveIds={
                  vaultStatus === "plaintext"
                    ? notes.filter(n => n.encrypted).map(n => n.id)
                    : appSettings.protectedNotes || []
                }
                searchQuery={query}
                codexColors={appSettings.codexColors}
                expandedIds={expandedBacklinks}
                onToggleExpand={handleToggleExpand}
              />
            </div>
          )}
          {protectionSetupPending ? (
            <ProtectionSetup
              onSetup={async (pw) => {
                const ok = await setupProtection(pw);
                if (ok) {
                  try {
                    await protectNote(protectionSetupPending);
                    await loadNotes();
                  } catch (e) {
                    setNotification(`Failed to protect note: ${e}`);
                  }
                  setProtectionSetupPending(null);
                }
                return ok;
              }}
            />
          ) : protectionUnlockPending ? (
            <SensitivePrompt
              title={protectionUnlockPending.startsWith("unprotect:") ? "Remove note protection" : "Authenticate"}
              hint={protectionUnlockPending.startsWith("unprotect:")
                ? "Enter your protection password to decrypt this note and remove its protection."
                : "Enter your protection password to encrypt this note."}
              onUnlock={async () => {
                const action = protectionUnlockPending;
                setProtectionUnlockPending(null);
                if (action.startsWith("protect:")) {
                  const noteId = action.slice(8);
                  try {
                    await protectNote(noteId);
                    await loadNotes();
                  } catch (e) {
                    setNotification(`Failed to protect note: ${e}`);
                  }
                } else if (action.startsWith("unprotect:")) {
                  const noteId = action.slice(10);
                  try {
                    await unprotectNote(noteId);
                    await loadNotes();
                  } catch (e) {
                    setNotification(`Failed to unprotect note: ${e}`);
                  }
                }
              }}
              onVerify={verifyProtection}
            />
          ) : sensitivePromptId ? (
            <SensitivePrompt
              onUnlock={() => handleSensitiveUnlock(sensitivePromptId)}
              onCancel={() => setSensitivePromptId(null)}
              onNavigate={navigateNote}
              onVerify={vaultStatus === "plaintext" ? verifyProtection : undefined}
              verifyCommand={vaultStatus !== "plaintext" ? "verify_password" : undefined}
            />
          ) : selectedNote ? (
            <div className={`editor-split-container${splitNote ? " split-active" : ""}`}>
              <Editor
                note={
                  selectedNote.encrypted && vaultStatus === "plaintext" && decryptedBodies[selectedNote.id] !== undefined
                    ? { ...selectedNote, body: decryptedBodies[selectedNote.id] }
                    : selectedNote
                }
                saveStatus={saveStatus}
                onTitleChange={handleTitleChange}
                onBodyChange={handleBodyChange}
                onCodexChange={handleCodexChange}
                onEditingChange={setEditingNote}
                onBaseVersion={recordBaseVersion}
                onFlush={flushSave}
                focusTrigger={editorFocusTrigger}
                searchQuery={query}
                codexList={codexList}
                editorRef={editorRef}
                isSensitive={
                  vaultStatus === "plaintext"
                    ? selectedNote.encrypted
                    : (appSettings.protectedNotes || []).includes(selectedNote.id)
                }
                macros={appSettings.macros}
                allNotes={notes}
                onNavigateToNote={handleSelectNote}
                frozen={(appSettings.frozenNotes || []).includes(selectedNote.id)}
                onToggleFreeze={() => handleToggleFreeze(selectedNote.id)}
                tocDefault={appSettings.tocDefault}
                onToggleSplit={() => setSplitNoteId((s) => s ? null : selectedNote.id)}
                isSplit={!!splitNote}
                tagColors={appSettings.tagColors}
                dictionary={appSettings.dictionary}
                notesFolder={notesFolder}
                emojis={emojis}
              />
              {splitNote && splitNote.id !== selectedNote.id && (
                <Editor
                  note={splitNote}
                  saveStatus={saveStatus}
                  onTitleChange={handleSplitTitleChange}
                  onBodyChange={handleSplitBodyChange}
                  onCodexChange={handleSplitCodexChange}
                  onBaseVersion={recordBaseVersion}
                  onFlush={flushSave}
                  codexList={codexList}
                  editorRef={splitEditorRef}
                  macros={appSettings.macros}
                  allNotes={notes}
                  onNavigateToNote={handleSelectNote}
                  frozen={(appSettings.frozenNotes || []).includes(splitNote.id)}
                  onToggleFreeze={() => handleToggleFreeze(splitNote.id)}
                  tocDefault={appSettings.tocDefault}
                  onCloseSplit={() => setSplitNoteId(null)}
                  tagColors={appSettings.tagColors}
                  dictionary={appSettings.dictionary}
                  notesFolder={notesFolder}
                  emojis={emojis}
                />
              )}
            </div>
          ) : (
            <div className="editor-placeholder">
              <p>Select a note or create one</p>
            </div>
          )}
          {showReferencePanel && (
            <ReferencePanel
              macros={appSettings.macros}
              onClose={() => setShowReferencePanel(false)}
            />
          )}
        </div>
      )}
      </div>
      </div>
    </div>
  );
}

export default App;
