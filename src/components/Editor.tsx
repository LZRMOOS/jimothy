import { useEffect, useRef, useCallback } from "react";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting, HighlightStyle, defaultHighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import type { Note, SaveStatus } from "../types";

const markdownHighlight = HighlightStyle.define([
  // Markdown formatting
  { tag: tags.heading1, fontSize: "1.4em", fontWeight: "700" },
  { tag: tags.heading2, fontSize: "1.25em", fontWeight: "700" },
  { tag: tags.heading3, fontSize: "1.1em", fontWeight: "600" },
  { tag: tags.heading4, fontSize: "1em", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--text-hint)" },
  { tag: tags.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--accent)", opacity: "0.7" },
  { tag: tags.monospace, fontFamily: "'JetBrains Mono', monospace", background: "var(--bg-tertiary)", borderRadius: "3px", padding: "1px 4px" },
  { tag: tags.processingInstruction, color: "var(--text-hint)" },
  { tag: tags.quote, color: "var(--text-secondary)", fontStyle: "italic" },
  // Code syntax highlighting
  { tag: tags.keyword, color: "#c084fc" },
  { tag: tags.controlKeyword, color: "#c084fc" },
  { tag: tags.operatorKeyword, color: "#c084fc" },
  { tag: tags.operator, color: "#94a3b8" },
  { tag: tags.separator, color: "#94a3b8" },
  { tag: tags.punctuation, color: "#94a3b8" },
  { tag: tags.bracket, color: "#94a3b8" },
  { tag: tags.atom, color: "#e879f9" },
  { tag: tags.bool, color: "#e879f9" },
  { tag: tags.null, color: "#e879f9" },
  { tag: tags.number, color: "#f59e0b" },
  { tag: tags.integer, color: "#f59e0b" },
  { tag: tags.float, color: "#f59e0b" },
  { tag: tags.string, color: "#34d399" },
  { tag: tags.character, color: "#34d399" },
  { tag: tags.regexp, color: "#fb923c" },
  { tag: tags.escape, color: "#fbbf24" },
  { tag: tags.comment, color: "#64748b", fontStyle: "italic" },
  { tag: tags.lineComment, color: "#64748b", fontStyle: "italic" },
  { tag: tags.blockComment, color: "#64748b", fontStyle: "italic" },
  { tag: tags.variableName, color: "#60a5fa" },
  { tag: tags.local(tags.variableName), color: "#60a5fa" },
  { tag: tags.special(tags.variableName), color: "#f472b6" },
  { tag: tags.definition(tags.variableName), color: "#818cf8" },
  { tag: tags.function(tags.variableName), color: "#818cf8" },
  { tag: tags.definition(tags.function(tags.variableName)), color: "#818cf8" },
  { tag: tags.typeName, color: "#f472b6" },
  { tag: tags.className, color: "#f472b6" },
  { tag: tags.namespace, color: "#f472b6" },
  { tag: tags.propertyName, color: "#34d399" },
  { tag: tags.definition(tags.propertyName), color: "#34d399" },
  { tag: tags.function(tags.propertyName), color: "#818cf8" },
  { tag: tags.labelName, color: "#60a5fa" },
  { tag: tags.attributeName, color: "#60a5fa" },
  { tag: tags.attributeValue, color: "#34d399" },
  { tag: tags.meta, color: "#94a3b8" },
  { tag: tags.tagName, color: "#f87171" },
  { tag: tags.angleBracket, color: "#94a3b8" },
  { tag: tags.self, color: "#e879f9" },
]);

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
        markdown({ codeLanguages: languages }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        syntaxHighlighting(markdownHighlight),
        placeholder("Start writing…"),
        updateListener,
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { height: "100%", fontSize: "14px", lineHeight: "1.6" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { padding: "8px 0", fontFamily: "'JetBrains Mono', monospace", caretColor: "var(--text-primary)" },
          ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text-primary)" },
          "&.cm-focused": { outline: "none" },
          ".cm-line:has(.tok-processingInstruction)": { background: "var(--bg-tertiary)", borderRadius: "4px" },
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

  const wordCount = note.body.trim()
    ? note.body.trim().split(/\s+/).length
    : 0;

  const modifiedDate = new Date(note.updated_at);
  const modifiedStr = modifiedDate.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

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
      <div className="editor-footer">
        <span className="editor-meta">{modifiedStr}</span>
        <span className="editor-meta">{wordCount} words</span>
      </div>
    </div>
  );
}
