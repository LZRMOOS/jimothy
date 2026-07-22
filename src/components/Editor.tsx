import { useEffect, useRef, useCallback } from "react";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import type { Note, SaveStatus } from "../types";

type Props = {
  note: Note;
  saveStatus: SaveStatus;
  onTitleChange: (title: string) => void;
  onBodyChange: (body: string) => void;
};

export function Editor({ note, saveStatus, onTitleChange, onBodyChange }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const noteIdRef = useRef<string>(note.id);

  const onBodyChangeRef = useRef(onBodyChange);
  onBodyChangeRef.current = onBodyChange;

  useEffect(() => {
    if (!editorRef.current) return;

    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onBodyChangeRef.current(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: note.body,
      extensions: [
        keymap.of([...defaultKeymap, ...historyKeymap]),
        history(),
        markdown(),
        placeholder("Start writing…"),
        updateListener,
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { height: "100%", fontSize: "14px" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { padding: "8px 0", fontFamily: "inherit" },
          "&.cm-focused": { outline: "none" },
        }),
      ],
    });

    viewRef.current = new EditorView({
      state,
      parent: editorRef.current,
    });

    noteIdRef.current = note.id;

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [note.id]);

  useEffect(() => {
    if (noteIdRef.current !== note.id) return;
    const view = viewRef.current;
    if (!view) return;

    const currentDoc = view.state.doc.toString();
    if (currentDoc !== note.body && !view.hasFocus) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: note.body },
      });
    }
  }, [note.body, note.id]);

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        viewRef.current?.focus();
      }
    },
    []
  );

  const statusLabel =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "saved"
        ? "Saved"
        : saveStatus === "error"
          ? "Save failed"
          : "";

  return (
    <div className="editor">
      <div className="editor-header">
        <input
          ref={titleRef}
          type="text"
          className="editor-title"
          value={note.title}
          onChange={(e) => onTitleChange(e.target.value)}
          onKeyDown={handleTitleKeyDown}
          placeholder="Note title"
        />
        <span className={`save-status ${saveStatus}`}>{statusLabel}</span>
      </div>
      <div className="editor-body" ref={editorRef} />
    </div>
  );
}
