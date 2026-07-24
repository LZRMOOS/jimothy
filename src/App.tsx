import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEventListener } from "./hooks/useEventListener";
import { SearchBar } from "./components/SearchBar";
import { NotesList } from "./components/NotesList";
import { Editor } from "./components/Editor";
import { Dropdown } from "./components/Dropdown";
import { FolderSetup } from "./components/FolderSetup";
import { UnlockScreen } from "./components/UnlockScreen";
import { CommandPalette } from "./components/CommandPalette";
import type { Command } from "./components/CommandPalette";
import { SensitivePrompt } from "./components/SensitivePrompt";
import { ProtectionSetup } from "./components/ProtectionSetup";
import { ConflictDialog } from "./components/ConflictDialog";
import type { ConflictChoice } from "./components/ConflictDialog";
import { DeleteDialog } from "./components/DeleteDialog";
import { Settings } from "./components/Settings";
import { useNotes } from "./hooks/useNotes";
import { useVault } from "./hooks/useVault";
import { useProtection } from "./hooks/useProtection";
import { useIdleLock } from "./hooks/useIdleLock";
import type { Note, AppSettings } from "./types";

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
    debouncedSave,
    deleteNote,
    search,
    loadNotes,
    updateNoteLocally,
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
  const [filteredNotes, setFilteredNotes] = useState<Note[]>([]);
  const [activeCodex, setActiveCodex] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editingCodexIcon, setEditingCodexIcon] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const isEditingNoteRef = useRef(false);

  const setEditingNote = useCallback((value: boolean) => {
    setIsEditingNote(value);
    isEditingNoteRef.current = value;
  }, []);
  const [editorFocusTrigger, setEditorFocusTrigger] = useState(0);
  const editorRef = useRef<any>(null);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [conflictNoteId, setConflictNoteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [sensitivePromptId, setSensitivePromptId] = useState<string | null>(null);
  const sensitiveUnlockTime = useRef<Record<string, number>>({});
  const [appSettings, setAppSettings] = useState<AppSettings>({
    theme: "system",
    confirmDelete: true,
  });
  const [notesFolder, setNotesFolder] = useState<string | null>(null);

  const codexList = Array.from(
    new Set(notes.map((n) => n.codex).filter(Boolean) as string[])
  ).sort();

  useIdleLock(
    vaultStatus === "unlocked" && (appSettings.idleLockMinutes ?? 0) > 0,
    appSettings.idleLockMinutes ?? 0,
    lockVault
  );

  useEffect(() => {
    async function init() {
      try {
        const settingsJson = (await invoke("get_app_settings")) as string;
        const settings = JSON.parse(settingsJson);
        if (settings.notesFolder) {
          await initFolder(settings.notesFolder);
          setNotesFolder(settings.notesFolder);
        }
        setAppSettings((prev) => ({ ...prev, ...settings }));
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

  // Zoom level
  useEffect(() => {
    const zoom = appSettings.zoomLevel ?? 100;
    getCurrentWebview().setZoom(zoom / 100);
  }, [appSettings.zoomLevel]);


  useEffect(() => {
    if (isCreateMode) {
      setFilteredNotes(notes);
      return;
    }
    let results = search(query);
    if (activeCodex) {
      results = results.filter((n) => n.codex === activeCodex);
    }
    setFilteredNotes(results);
  }, [query, search, notes, activeCodex, isCreateMode]);

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
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [vaultStatus]);

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

  useEventListener("note-conflict", () => {
    setNotification(
      "A note was modified externally while you were editing. Both versions were preserved."
    );
  });

  useEventListener("dropbox-conflict", () => {
    setNotification(
      "A Dropbox sync conflict was detected and preserved in the conflicts folder."
    );
  });

  useEventListener("folder-unavailable", () => {
    setNotification("Notes folder is no longer accessible.");
  });

  useEventListener<{ id: string }>("note-conflict-active", (payload) => {
    setConflictNoteId(payload.id);
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

  const handleSettingsChange = useCallback(
    async (newSettings: AppSettings) => {
      setAppSettings(newSettings);
      await invoke("save_app_settings", {
        settingsJson: JSON.stringify({ ...newSettings, notesFolder }),
      });
    },
    [notesFolder]
  );

  const handleChangeFolder = useCallback(
    async (path: string) => {
      await initFolder(path);
      setNotesFolder(path);
      await invoke("save_app_settings", {
        settingsJson: JSON.stringify({ ...appSettings, notesFolder: path }),
      });
    },
    [initFolder, appSettings]
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



  const handleSelectNote = useCallback(
    (id: string) => {
      const note = notes.find((n) => n.id === id);
      // Per-file protection in plaintext mode
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
    [notes, vaultStatus, setSelectedId, appSettings.protectedNotes]
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
    let list = query || activeCodex ? filteredNotes : notes;
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
  }, [query, activeCodex, filteredNotes, notes, selectedId, appSettings.pinnedNotes, handleSelectNote]);

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
    if (document.activeElement === searchInputRef.current) {
      searchInputRef.current.blur();
      return;
    }
    // Otherwise hide the window
    const appWindow = getCurrentWindow();
    await appWindow.hide();
  }, [showSettings, isCreateMode, query]);

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
      updateNoteLocally(selectedNote.id, { title });
      const body = decryptedBodies[selectedNote.id] ?? selectedNote.body;
      if (isSelectedProtected) {
        setDecryptedBodies((prev) => ({ ...prev, [selectedNote.id]: body }));
        saveProtectedNote(selectedNote.id, title, body, selectedNote.codex ?? null);
      } else {
        debouncedSave(selectedNote.id, title, selectedNote.body, selectedNote.codex);
      }
    },
    [selectedNote, debouncedSave, saveProtectedNote, isSelectedProtected, decryptedBodies, updateNoteLocally]
  );

  const handleBodyChange = useCallback(
    (body: string) => {
      if (!selectedNote) return;
      if (isSelectedProtected) {
        setDecryptedBodies((prev) => ({ ...prev, [selectedNote.id]: body }));
        saveProtectedNote(selectedNote.id, selectedNote.title, body, selectedNote.codex ?? null);
      } else {
        debouncedSave(selectedNote.id, selectedNote.title, body, selectedNote.codex);
      }
    },
    [selectedNote, debouncedSave, saveProtectedNote, isSelectedProtected]
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

  const handleDeleteById = useCallback(
    async (id: string) => {
      if (appSettings.confirmDelete !== false) {
        setShowDeleteDialog(true);
        // Wait for user decision
        return new Promise<void>((resolve) => {
          const checkDialog = () => {
            if (!showDeleteDialog) {
              resolve();
            } else {
              setTimeout(checkDialog, 100);
            }
          };
          checkDialog();
        });
      } else {
        await deleteNote(id);
      }
    },
    [deleteNote, appSettings.confirmDelete, showDeleteDialog]
  );

  const handleConfirmDelete = useCallback(async () => {
    setShowDeleteDialog(false);
    if (selectedId) {
      await deleteNote(selectedId);
    }
  }, [selectedId, deleteNote]);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteDialog(false);
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
        } else if (idx - 1 < codexList.length) {
          setActiveCodex(codexList[idx - 1]);
        }
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
  }, [handleDelete, handleLock, handleZoom, handleSettingsChange, appSettings, codexList]);

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
        } else if (e.key === "Enter" || e.key === "ArrowRight") {
          e.preventDefault();
          // Directly focus the editor if we have a ref to it
          if (editorRef.current && editorRef.current.view) {
            editorRef.current.view.dom.focus();
            // Set cursor to start
            const tr = editorRef.current.state.tr.setSelection(
              editorRef.current.state.selection.constructor.atStart(editorRef.current.state.doc)
            );
            editorRef.current.view.dispatch(tr);
          }
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleBrowseKeys);
    return () => window.removeEventListener("keydown", handleBrowseKeys);
  }, [showSettings, showCommandPalette, sensitivePromptId, editingCodexIcon, selectedId, navigateNote]);

  const commands: Command[] = useMemo(() => [
    { id: "new-note", label: "New Note", shortcut: "⌘N", action: () => { searchInputRef.current?.focus(); setQuery(""); } },
    { id: "search", label: "Search Notes", shortcut: "⌘F", action: () => { searchInputRef.current?.focus(); searchInputRef.current?.select(); } },
    { id: "delete-note", label: "Delete Note", shortcut: "⌘⌫", action: handleDelete },
    { id: "settings", label: "Open Settings", shortcut: "⌘,", action: () => setShowSettings(true) },
    { id: "lock-vault", label: "Lock Vault", action: handleLock },
    { id: "toggle-sidebar", label: "Toggle Sidebar", shortcut: "⌘/", action: () => setSidebarCollapsed((s) => !s) },
    { id: "zoom-in", label: "Zoom In", shortcut: "⌘+", action: () => handleZoom(10) },
    { id: "zoom-out", label: "Zoom Out", shortcut: "⌘-", action: () => handleZoom(-10) },
    { id: "zoom-reset", label: "Reset Zoom", shortcut: "⌘0", action: () => handleSettingsChange({ ...appSettings, zoomLevel: 100 }) },
    ...(selectedId && (vaultStatus === "plaintext" || vaultStatus === "unlocked") ? [{
      id: "toggle-sensitive",
      label: (() => {
        if (vaultStatus === "plaintext") {
          return notes.find(n => n.id === selectedId)?.encrypted
            ? "Remove File Protection" : "Protect File";
        }
        return (appSettings.protectedNotes || []).includes(selectedId)
          ? "Remove Protection" : "Mark as Protected";
      })(),
      action: () => handleToggleSensitive(selectedId),
    }] : []),
    { id: "all-notes", label: "All Notes", shortcut: "⌘1", action: () => setActiveCodex(null) },
    ...codexList.map((c, i) => ({
      id: `codex-${c}`,
      label: `Codex: ${c}`,
      shortcut: i < 8 ? `⌘${i + 2}` : undefined,
      action: () => setActiveCodex(c),
    })),
  ], [handleDelete, handleLock, handleZoom, handleSettingsChange, handleToggleSensitive, appSettings, selectedId, codexList, notes, vaultStatus]);

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

  const displayNotes = (query && !isCreateMode) || activeCodex ? filteredNotes : notes;

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
          <button
            className="notification-dismiss"
            onClick={() => setNotification(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {showCommandPalette && (
        <CommandPalette
          commands={commands}
          onClose={() => setShowCommandPalette(false)}
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
        onSettingsClick={() => setShowSettings(true)}
        isCreateMode={isCreateMode}
      />
      <div className="app-body">
      {!sidebarCollapsed && (
        <div className="codex-sidebar">
          <button
            className={`codex-sidebar-item ${activeCodex === null ? "active" : ""}`}
            onClick={() => setActiveCodex(null)}
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
            editingCodexIcon === codex ? (
              <input
                key={codex}
                className="codex-sidebar-item codex-icon-input"
                autoFocus
                maxLength={2}
                defaultValue={appSettings.codexIcons?.[codex] || ""}
                onBlur={(e) => {
                  const emoji = e.target.value.trim();
                  const newIcons = { ...appSettings.codexIcons, [codex]: emoji };
                  if (!emoji) delete newIcons[codex];
                  handleSettingsChange({ ...appSettings, codexIcons: newIcons });
                  setEditingCodexIcon(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
            ) : (
              <button
                key={codex}
                className={`codex-sidebar-item ${activeCodex === codex ? "active" : ""}`}
                onClick={() => setActiveCodex(activeCodex === codex ? null : codex)}
                onDoubleClick={() => setEditingCodexIcon(codex)}
                title={`${codex} (double-click to set icon)`}
              >
                <span className="codex-sidebar-letter">
                  {appSettings.codexIcons?.[codex] || codex[0].toUpperCase()}
                </span>
              </button>
            )
          ))}
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
        />
      ) : (
        <div className="main-content">
          {!sidebarCollapsed && (
            <div className="notes-panel">
              <div className="codex-dropdown">
                <Dropdown
                  value={activeCodex || ""}
                  onChange={(v) => setActiveCodex(v || null)}
                  options={[
                    { value: "", label: "All Notes" },
                    ...codexList.map((c) => ({ value: c, label: `Codex: ${c}` })),
                  ]}
                />
              </div>
              <NotesList
                notes={displayNotes}
                selectedId={selectedId}
                onSelect={handleSelectNote}
                onDelete={handleDeleteById}
                onTogglePin={handleTogglePin}
                onToggleSensitive={vaultStatus === "plaintext" || vaultStatus === "unlocked" ? handleToggleSensitive : undefined}
                pinnedIds={appSettings.pinnedNotes || []}
                sensitiveIds={
                  vaultStatus === "plaintext"
                    ? notes.filter(n => n.encrypted).map(n => n.id)
                    : appSettings.protectedNotes || []
                }
                searchQuery={query}
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
              title={protectionUnlockPending.startsWith("unprotect:") ? "Remove file protection" : "Authenticate"}
              hint={protectionUnlockPending.startsWith("unprotect:")
                ? "Enter your protection password to decrypt this note and convert it back to a regular file."
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
            />
          ) : (
            <div className="editor-placeholder">
              <p>Select a note or create one</p>
            </div>
          )}
        </div>
      )}
      </div>
      </div>
    </div>
  );
}

export default App;
