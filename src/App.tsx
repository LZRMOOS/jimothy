import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SearchBar } from "./components/SearchBar";
import { NotesList } from "./components/NotesList";
import { Editor } from "./components/Editor";
import { FolderSetup } from "./components/FolderSetup";
import { useNotes } from "./hooks/useNotes";
import type { Note } from "./types";

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
  } = useNotes();

  const [query, setQuery] = useState("");
  const [filteredNotes, setFilteredNotes] = useState<Note[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const settingsJson = (await invoke("get_app_settings")) as string;
        const settings = JSON.parse(settingsJson);
        if (settings.notesFolder) {
          await initFolder(settings.notesFolder);
        }
      } catch {
        // No settings yet, show folder picker
      }
      await checkExistingFolder();
      setInitialized(true);
    }
    init();
  }, [initFolder, checkExistingFolder]);

  useEffect(() => {
    setFilteredNotes(search(query));
  }, [query, search, notes]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        searchInputRef.current?.focus();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen("create-new-note", () => {
      searchInputRef.current?.focus();
      setQuery("");
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

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
    const appWindow = getCurrentWindow();
    await appWindow.hide();
  }, []);

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
    if (confirm("Delete this note?")) {
      await deleteNote(selectedId);
    }
  }, [selectedId, deleteNote]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "n") {
        e.preventDefault();
        searchInputRef.current?.focus();
        setQuery("");
      } else if (mod && e.key === "l") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (mod && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        handleDelete();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDelete]);

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

  const displayNotes = query ? filteredNotes : notes;

  return (
    <div className="app">
      <SearchBar
        ref={searchInputRef}
        value={query}
        onChange={setQuery}
        onSubmit={handleSearchSubmit}
        onArrowDown={handleArrowDown}
        onArrowUp={handleArrowUp}
        onEscape={handleEscape}
      />
      <div className="main-content">
        <NotesList
          notes={displayNotes}
          selectedId={selectedId}
          onSelect={setSelectedId}
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
    </div>
  );
}

export default App;
