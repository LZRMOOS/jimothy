import { useEffect, useCallback, useState, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { common, createLowlight } from "lowlight";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Note, SaveStatus } from "../types";
import { buildSearchPattern } from "../utils/search";

function highlightMatches(text: string, query: string): React.ReactNode {
  const regex = buildSearchPattern(query);
  if (!regex) return text;
  const splitter = new RegExp(`(${regex.source})`, "gi");
  const parts = text.split(splitter);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="search-highlight">{part}</mark>
    ) : (
      part
    )
  );
}

const lowlight = createLowlight(common);

const searchHighlightKey = new PluginKey("searchHighlight");

function buildDecorations(doc: any, query: string): DecorationSet {
  const regex = buildSearchPattern(query);
  if (!regex) return DecorationSet.empty;
  const decorations: Decoration[] = [];

  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return;
    const text = node.text || "";
    let match;
    while ((match = regex.exec(text)) !== null) {
      decorations.push(
        Decoration.inline(pos + match.index, pos + match.index + match[0].length, {
          class: "search-highlight",
        })
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

function createSearchHighlightExtension(queryRef: { current: string }) {
  return Extension.create({
    name: "searchHighlight",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: searchHighlightKey,
          state: {
            init(_, { doc }) {
              return buildDecorations(doc, queryRef.current);
            },
            apply(tr, old) {
              if (tr.docChanged || tr.getMeta(searchHighlightKey)) {
                return buildDecorations(tr.doc, queryRef.current);
              }
              return old;
            },
          },
          props: {
            decorations(state) {
              return this.getState(state);
            },
          },
        }),
      ];
    },
  });
}

function CodexPicker({ value, codexList, onChange }: {
  value: string | null;
  codexList: string[];
  onChange: (codex: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");

  if (editing) {
    return (
      <>
        <input
          className="codex-input"
          autoFocus
          placeholder="Codex name"
          value={inputValue}
          list="codex-options"
          onChange={(e) => setInputValue(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          onBlur={() => {
            const trimmed = inputValue.trim();
            onChange(trimmed || null);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const trimmed = inputValue.trim();
              onChange(trimmed || null);
              setEditing(false);
            } else if (e.key === "Escape") {
              setEditing(false);
            }
          }}
        />
        <datalist id="codex-options">
          {codexList.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </>
    );
  }

  return (
    <span
      className="editor-meta codex-label"
      onClick={() => {
        setInputValue(value || "");
        setEditing(true);
      }}
    >
      {value || "No codex"}
    </span>
  );
}

type Props = {
  note: Note;
  saveStatus: SaveStatus;
  onTitleChange: (title: string) => void;
  onBodyChange: (body: string) => void;
  onCodexChange: (codex: string | null) => void;
  searchQuery?: string;
  codexList: string[];
  isSensitive?: boolean;
};

export function Editor({ note, saveStatus, onTitleChange, onBodyChange, onCodexChange, searchQuery = "", codexList, isSensitive }: Props) {
  const [showCharCount, setShowCharCount] = useState(false);
  const noteIdRef = useRef(note.id);
  const onBodyChangeRef = useRef(onBodyChange);
  onBodyChangeRef.current = onBodyChange;
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  const [searchExt] = useState(() => createSearchHighlightExtension(searchQueryRef));
  const suppressUpdate = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Placeholder.configure({
        placeholder: "Start writing…",
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      searchExt,
    ],
    content: note.body,
    onUpdate: ({ editor }) => {
      if (suppressUpdate.current) return;
      const md = (editor.storage as any).markdown.getMarkdown();
      onBodyChangeRef.current(md);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const tr = editor.state.tr.setMeta(searchHighlightKey, true);
    editor.view.dispatch(tr);
  }, [searchQuery, editor]);

  useEffect(() => {
    if (!editor) return;
    if (noteIdRef.current !== note.id) {
      noteIdRef.current = note.id;
      suppressUpdate.current = true;
      editor.commands.setContent(note.body);
      suppressUpdate.current = false;
      return;
    }
    const currentMd = (editor.storage as any).markdown.getMarkdown();
    if (currentMd !== note.body && !editor.isFocused) {
      suppressUpdate.current = true;
      editor.commands.setContent(note.body);
      suppressUpdate.current = false;
    }
  }, [note.id, note.body, editor]);


  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        editor?.commands.focus("start");
      }
    },
    [editor]
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
  const charCount = note.body.replace(/\s/g, "").length;

  const modifiedDate = new Date(note.updated_at);
  const modifiedStr = modifiedDate.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const titleHasMatch = searchQuery && buildSearchPattern(searchQuery)?.test(note.title);

  return (
    <div className="editor">
      <div className="editor-header">
        <div className="editor-title-wrapper">
          <input
            type="text"
            className="editor-title"
            value={note.title}
            onChange={(e) => onTitleChange(e.target.value)}
            onKeyDown={handleTitleKeyDown}
            placeholder="Note title"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
          {titleHasMatch && (
            <div className="editor-title-overlay" aria-hidden="true">
              {highlightMatches(note.title, searchQuery)}
            </div>
          )}
        </div>
        <div className="editor-status">
          {isSensitive && <span className="sensitive-status">Protected</span>}
          {note.encrypted && <span className="encrypted-status">Encrypted</span>}
          {statusLabel && <span className={`save-status ${saveStatus}`}>{statusLabel}</span>}
        </div>
      </div>
      <div className="editor-body">
        <EditorContent editor={editor} />
      </div>
      <div className="editor-footer">
        <span className="editor-meta">{modifiedStr}</span>
        <CodexPicker
          value={note.codex}
          codexList={codexList}
          onChange={onCodexChange}
        />
        <span
          className="editor-meta editor-count"
          onClick={() => setShowCharCount((s) => !s)}
        >
          {showCharCount ? `${charCount} chars` : `${wordCount} words`}
        </span>
      </div>
    </div>
  );
}
