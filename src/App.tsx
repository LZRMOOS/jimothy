import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { SearchBar } from "./components/SearchBar";
import { NotesList } from "./components/NotesList";
import { Editor } from "./components/Editor";
import { FolderSetup } from "./components/FolderSetup";
import { UnlockScreen } from "./components/UnlockScreen";
import { ConflictDialog } from "./components/ConflictDialog";
import type { ConflictChoice } from "./components/ConflictDialog";
import { Settings } from "./components/Settings";
import { useNotes } from "./hooks/useNotes";
import { useVault } from "./hooks/useVault";
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
  } = useVault();

  const [query, setQuery] = useState("");
  const [filteredNotes, setFilteredNotes] = useState<Note[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [initialized, setInitialized] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [conflictNoteId, setConflictNoteId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    theme: "system",
    confirmDelete: true,
  });
  const [notesFolder, setNotesFolder] = useState<string | null>(null);

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
      const folder = (await invoke("get_notes_folder")) as string | null;
      if (folder) setNotesFolder(folder);
      setInitialized(true);
    }
    init();
  }, [initFolder, checkExistingFolder, checkVaultStatus]);

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

  useEffect(() => {
    setFilteredNotes(search(query));
  }, [query, search, notes]);

  // Auto-select best match when search results change
  useEffect(() => {
    if (filteredNotes.length > 0) {
      const currentInList = filteredNotes.find((n) => n.id === selectedId);
      if (!currentInList) {
        setSelectedId(filteredNotes[0].id);
      }
    }
  }, [filteredNotes, selectedId, setSelectedId]);

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

  useEffect(() => {
    const unlisten = listen("create-new-note", () => {
      searchInputRef.current?.focus();
      setQuery("");
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Tray menu: lock vault
  useEffect(() => {
    const unlisten = listen("lock-vault", () => {
      if (vaultStatus === "unlocked") lockVault();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [vaultStatus, lockVault]);

  // Tray menu: open settings
  useEffect(() => {
    const unlisten = listen("open-settings", () => {
      setShowSettings(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Lock vault on system sleep/screen lock
  useEffect(() => {
    const unlisten = listen("system-sleep", () => {
      if (vaultStatus === "unlocked") lockVault();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [vaultStatus, lockVault]);

  useEffect(() => {
    const unlistenConflict = listen("note-conflict", () => {
      setNotification(
        "A note was modified externally while you were editing. Both versions were preserved."
      );
    });
    const unlistenDropbox = listen("dropbox-conflict", () => {
      setNotification(
        "A Dropbox sync conflict was detected and preserved in the conflicts folder."
      );
    });
    const unlistenFolder = listen("folder-unavailable", () => {
      setNotification("Notes folder is no longer accessible.");
    });
    const unlistenActiveConflict = listen<{ id: string }>(
      "note-conflict-active",
      (event) => {
        setConflictNoteId(event.payload.id);
      }
    );
    return () => {
      unlistenConflict.then((fn) => fn());
      unlistenDropbox.then((fn) => fn());
      unlistenFolder.then((fn) => fn());
      unlistenActiveConflict.then((fn) => fn());
    };
  }, []);

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

  const handleReloadNotes = useCallback(async () => {
    await loadNotes();
  }, [loadNotes]);

  const handleSearchSubmit = useCallback(async () => {
    if (!query.trim()) return;

    const exactMatch = notes.find(
      (n) => n.title.toLowerCase() === query.trim().toLowerCase()
    );

    if (exactMatch) {
      setSelectedId(exactMatch.id);
    } else {
      await createNote(query.trim());
      setQuery("");
    }
  }, [query, notes, setSelectedId, createNote]);

  const handleArrowDown = useCallback(() => {
    const list = filteredNotes.length > 0 ? filteredNotes : notes;
    if (list.length === 0) return;
    const idx = list.findIndex((n) => n.id === selectedId);
    const next = Math.min(idx + 1, list.length - 1);
    setSelectedId(list[next].id);
  }, [filteredNotes, notes, selectedId, setSelectedId]);

  const handleArrowUp = useCallback(() => {
    const list = filteredNotes.length > 0 ? filteredNotes : notes;
    if (list.length === 0) return;
    const idx = list.findIndex((n) => n.id === selectedId);
    const prev = Math.max(idx - 1, 0);
    setSelectedId(list[prev].id);
  }, [filteredNotes, notes, selectedId, setSelectedId]);

  const handleEscape = useCallback(async () => {
    if (showSettings) {
      setShowSettings(false);
      return;
    }
    const appWindow = getCurrentWindow();
    await appWindow.hide();
  }, [showSettings]);

  const handleTitleChange = useCallback(
    (title: string) => {
      if (!selectedNote) return;
      debouncedSave(selectedNote.id, title, selectedNote.body);
    },
    [selectedNote, debouncedSave]
  );

  const handleBodyChange = useCallback(
    (body: string) => {
      if (!selectedNote) return;
      debouncedSave(selectedNote.id, selectedNote.title, body);
    },
    [selectedNote, debouncedSave]
  );

  const handleDelete = useCallback(async () => {
    if (!selectedId) return;
    if (appSettings.confirmDelete !== false) {
      const confirmed = await ask("Delete this note? This cannot be undone.", {
        title: "Delete Note",
        kind: "warning",
      });
      if (!confirmed) return;
    }
    await deleteNote(selectedId);
  }, [selectedId, deleteNote, appSettings.confirmDelete]);

  const handleDeleteById = useCallback(
    async (id: string) => {
      if (appSettings.confirmDelete !== false) {
        const confirmed = await ask("Delete this note? This cannot be undone.", {
          title: "Delete Note",
          kind: "warning",
        });
        if (!confirmed) return;
      }
      await deleteNote(id);
    },
    [deleteNote, appSettings.confirmDelete]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key === "L") {
        e.preventDefault();
        handleLock();
      } else if (mod && e.key === "n") {
        e.preventDefault();
        searchInputRef.current?.focus();
        setQuery("");
      } else if (mod && e.key === "l") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setShowSettings((s) => !s);
      } else if (mod && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        handleDelete();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDelete, handleLock]);

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

  const displayNotes = query ? filteredNotes : notes;

  return (
    <div className="app">
      {conflictNoteId && (
        <ConflictDialog
          noteId={conflictNoteId}
          onChoice={handleConflictChoice}
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
      <SearchBar
        ref={searchInputRef}
        value={query}
        onChange={setQuery}
        onSubmit={handleSearchSubmit}
        onArrowDown={handleArrowDown}
        onArrowUp={handleArrowUp}
        onEscape={handleEscape}
        onSettingsClick={() => setShowSettings(true)}
      />
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
          onReloadNotes={handleReloadNotes}
          onChangeFolder={handleChangeFolder}
          vaultError={vaultError}
          vaultLoading={vaultLoading}
        />
      ) : (
        <div className="main-content">
          <NotesList
            notes={displayNotes}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDelete={handleDeleteById}
          />
          {selectedNote ? (
            <Editor
              note={selectedNote}
              saveStatus={saveStatus}
              onTitleChange={handleTitleChange}
              onBodyChange={handleBodyChange}
            />
          ) : (
            <div className="editor-placeholder">
              <p>Select a note or create one</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
