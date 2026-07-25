import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import MiniSearch from "minisearch";
import type { Note, SaveStatus } from "../types";

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [folderSet, setFolderSet] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveRef = useRef<number>(0);
  // The `updated_at` each note's editable buffer was last loaded/saved from.
  // Sent to the backend on save so it can detect external writes (see save_note).
  const baseVersionRef = useRef<Record<string, string>>({});
  const searchRef = useRef<MiniSearch<Note>>(
    new MiniSearch({
      fields: ["title", "body"],
      storeFields: ["title", "body"],
      searchOptions: {
        boost: { title: 3 },
        prefix: true,
        fuzzy: 0.2,
      },
    })
  );

  const rebuildIndex = useCallback((noteList: Note[]) => {
    searchRef.current.removeAll();
    searchRef.current.addAll(noteList);
  }, []);

  const loadNotes = useCallback(async () => {
    const loaded = (await invoke("reload_notes")) as Note[];
    setNotes(loaded);
    rebuildIndex(loaded);
  }, [rebuildIndex]);

  // Record the version an editor buffer is derived from. Called by the editor
  // whenever it (re)loads a note's content, and on every successful save. This,
  // not the notes list, is the source of truth for conflict detection.
  const recordBaseVersion = useCallback((id: string, updatedAt: string) => {
    baseVersionRef.current[id] = updatedAt;
  }, []);

  const initFolder = useCallback(
    async (path: string) => {
      await invoke("set_notes_folder", { path });
      setFolderSet(true);
      await loadNotes();
    },
    [loadNotes]
  );

  const checkExistingFolder = useCallback(async () => {
    const folder = (await invoke("get_notes_folder")) as string | null;
    if (folder) {
      setFolderSet(true);
      await loadNotes();
    }
  }, [loadNotes]);

  useEffect(() => {
    invoke("set_active_note", { id: selectedId ?? null });
  }, [selectedId]);

  useEffect(() => {
    const unlisten = listen("notes-changed", () => {
      const elapsed = Date.now() - lastSaveRef.current;
      if (elapsed < 2000) return;
      loadNotes();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadNotes]);

  const createNote = useCallback(
    async (title: string, codex?: string | null): Promise<Note> => {
      const note = (await invoke("create_note", { title, codex: codex || null })) as Note;
      setNotes((prev) => {
        const updated = [note, ...prev];
        rebuildIndex(updated);
        return updated;
      });
      setSelectedId(note.id);
      return note;
    },
    [rebuildIndex]
  );

  const saveNote = useCallback(
    async (id: string, title: string, body: string, codex?: string | null) => {
      setSaveStatus("saving");
      try {
        const updated = (await invoke("save_note", {
          id,
          title,
          body,
          codex: codex ?? null,
          baseUpdatedAt: baseVersionRef.current[id] ?? null,
        })) as Note;
        lastSaveRef.current = Date.now();
        // Our write is now the base for the next edit.
        baseVersionRef.current[id] = updated.updated_at;
        setNotes((prev) => {
          const newList = prev.map((n) => {
            if (n.id !== id) return n;
            return { ...n, updated_at: updated.updated_at };
          });
          rebuildIndex(newList);
          return newList;
        });
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    },
    [rebuildIndex]
  );

  const debouncedSave = useCallback(
    (id: string, title: string, body: string, codex?: string | null) => {
      setSaveStatus("unsaved");
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveNote(id, title, body, codex);
      }, 1500);
    },
    [saveNote]
  );

  const deleteNote = useCallback(
    async (id: string) => {
      await invoke("delete_note", { id });
      setNotes((prev) => {
        const updated = prev.filter((n) => n.id !== id);
        rebuildIndex(updated);
        return updated;
      });
      if (selectedId === id) {
        setSelectedId(null);
      }
    },
    [selectedId, rebuildIndex]
  );

  const search = useCallback(
    (query: string) => {
      if (!query.trim()) {
        return notes;
      }
      const results = searchRef.current.search(query);
      return results
        .map((r) => notes.find((n) => n.id === r.id))
        .filter(Boolean) as Note[];
    },
    [notes]
  );

  const selectedNote = useMemo(() => notes.find((n) => n.id === selectedId) || null, [notes, selectedId]);

  const updateNoteLocally = useCallback(
    (id: string, patch: Partial<Note>) => {
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    },
    []
  );

  return {
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
    deleteNote,
    search,
    loadNotes,
    updateNoteLocally,
    recordBaseVersion,
  };
}
