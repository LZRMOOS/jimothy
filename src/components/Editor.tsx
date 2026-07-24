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
    regex.lastIndex = 0; // Reset regex state for each text node
    let match;
    while ((match = regex.exec(text)) !== null) {
      decorations.push(
        Decoration.inline(pos + match.index, pos + match.index + match[0].length, {
          class: "search-highlight",
        })
      );
    }
  });

  console.log('Search decorations:', query, decorations.length, 'matches');
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
              const decos = buildDecorations(doc, queryRef.current);
              return decos;
            },
            apply(tr, oldDecoSet, oldState, newState) {
              const meta = tr.getMeta(searchHighlightKey);
              if (meta || tr.docChanged) {
                const decos = buildDecorations(newState.doc, queryRef.current);
                return decos;
              }
              // Map old decorations to new positions
              if (oldDecoSet) {
                return oldDecoSet.map(tr.mapping, tr.doc);
              }
              return oldDecoSet;
            },
          },
          props: {
            decorations(state) {
              return searchHighlightKey.getState(state);
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
  onEditingChange?: (editing: boolean) => void;
  focusTrigger?: number;
  searchQuery?: string;
  codexList: string[];
  isSensitive?: boolean;
  editorRef?: React.MutableRefObject<any>;
};

export function Editor({ note, saveStatus, onTitleChange, onBodyChange, onCodexChange, onEditingChange, focusTrigger, searchQuery = "", codexList, isSensitive, editorRef }: Props) {
  const [showCharCount, setShowCharCount] = useState(false);
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const noteIdRef = useRef(note.id);
  const onBodyChangeRef = useRef(onBodyChange);
  onBodyChangeRef.current = onBodyChange;
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  const titleInputRef = useRef<HTMLInputElement>(null);

  const [searchExt] = useState(() => createSearchHighlightExtension(searchQueryRef));
  const suppressUpdate = useRef(false);

  const editor = useEditor({
    editorProps: {
      attributes: {
        'data-editor': 'true',
      },
    },
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
    onFocus: ({ editor }) => {
      onEditingChange?.(true);
    },
  });

  useEffect(() => {
    if (!editor || !editor.view) return;
    // Force recreate decorations by updating plugin state
    const { state } = editor.view;
    const pluginState = searchHighlightKey.getState(state);
    if (pluginState !== undefined) {
      const tr = state.tr.setMeta(searchHighlightKey, { forceUpdate: true });
      editor.view.dispatch(tr);
    }
  }, [searchQuery, editor]);

  // Expose editor instance via ref
  useEffect(() => {
    if (editorRef && editor) {
      editorRef.current = editor;
    }
  }, [editor, editorRef]);

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
            ref={titleInputRef}
            type="text"
            className="editor-title"
            value={note.title}
            onChange={(e) => onTitleChange(e.target.value)}
            onKeyDown={handleTitleKeyDown}
            onFocus={() => {
              setIsTitleFocused(true);
              onEditingChange?.(true);
            }}
            onBlur={() => setIsTitleFocused(false)}
            placeholder="Note title"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
          {titleHasMatch && !isTitleFocused && (
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
