import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { useEventListener } from "./hooks/useEventListener";
import { SearchBar } from "./components/SearchBar";
import { NotesList } from "./components/NotesList";
import { Editor } from "./components/Editor";
import { Dropdown } from "./components/Dropdown";
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
    disableVault,
  } = useVault();

  const [query, setQuery] = useState("");
  const [filteredNotes, setFilteredNotes] = useState<Note[]>([]);
  const [activeCodex, setActiveCodex] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editingCodexIcon, setEditingCodexIcon] = useState<string | null>(null);
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
      const folder = (await invoke("get_notes_folder")) as string | null;
      if (folder) setNotesFolder(folder);
      setInitialized(true);
    }
    init();
  }, [initFolder, checkExistingFolder, checkVaultStatus]);

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

  useEffect(() => {
    let results = search(query);
    if (activeCodex) {
      results = results.filter((n) => n.codex === activeCodex);
    }
    setFilteredNotes(results);
  }, [query, search, notes, activeCodex]);

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

  const navigateNote = useCallback((direction: 1 | -1) => {
    const list = filteredNotes.length > 0 ? filteredNotes : notes;
    if (list.length === 0) return;
    const idx = list.findIndex((n) => n.id === selectedId);
    const next = Math.max(0, Math.min(idx + direction, list.length - 1));
    setSelectedId(list[next].id);
  }, [filteredNotes, notes, selectedId, setSelectedId]);

  const handleArrowDown = useCallback(() => navigateNote(1), [navigateNote]);
  const handleArrowUp = useCallback(() => navigateNote(-1), [navigateNote]);

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
      debouncedSave(selectedNote.id, title, selectedNote.body, selectedNote.codex);
    },
    [selectedNote, debouncedSave]
  );

  const handleBodyChange = useCallback(
    (body: string) => {
      if (!selectedNote) return;
      debouncedSave(selectedNote.id, selectedNote.title, body, selectedNote.codex);
    },
    [selectedNote, debouncedSave]
  );

  const handleCodexChange = useCallback(
    (codex: string | null) => {
      if (!selectedNote) return;
      debouncedSave(selectedNote.id, selectedNote.title, selectedNote.body, codex);
    },
    [selectedNote, debouncedSave]
  );

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

  const handleDelete = useCallback(async () => {
    if (selectedId) await handleDeleteById(selectedId);
  }, [selectedId, handleDeleteById]);

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
      } else if (mod && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
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
      } else if (mod && e.key === "/") {
        e.preventDefault();
        setSidebarCollapsed((s) => !s);
      } else if (mod && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx === 0) {
          setActiveCodex(null);
        } else if (idx - 1 < codexList.length) {
          setActiveCodex(codexList[idx - 1]);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDelete, handleLock, codexList]);

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

  const displayNotes = query || activeCodex ? filteredNotes : notes;

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
          onDisableVault={disableVault}
          onReloadNotes={loadNotes}
          onChangeFolder={handleChangeFolder}
          vaultError={vaultError}
          vaultLoading={vaultLoading}
        />
      ) : (
        <div className="main-content">
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
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
                onSelect={setSelectedId}
                onDelete={handleDeleteById}
                searchQuery={query}
              />
            </div>
          )}
          {selectedNote ? (
            <Editor
              note={selectedNote}
              saveStatus={saveStatus}
              onTitleChange={handleTitleChange}
              onBodyChange={handleBodyChange}
              onCodexChange={handleCodexChange}
              searchQuery={query}
              codexList={codexList}
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
