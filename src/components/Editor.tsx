import { useEffect, useCallback, useState, useRef, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { common, createLowlight } from "lowlight";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Note, SaveStatus } from "../types";
import { buildSearchPattern, highlightMatches } from "../utils/search";
import { createNoteLinkExtension } from "../extensions/noteLink";
import { createMentionExtension } from "../extensions/mention";
import { createTagHighlightExtension } from "../extensions/tagHighlight";
import { createTaskPriorityExtension } from "../extensions/taskPriority";
import { createTaskDueDateExtension } from "../extensions/taskDueDate";
import { extractTags } from "../utils/tags";

const lowlight = createLowlight(common);

function buildDecorations(doc: any, query: string, currentMatch?: { from: number; to: number }): DecorationSet {
  const regex = buildSearchPattern(query);
  if (!regex) return DecorationSet.empty;
  const decorations: Decoration[] = [];

  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return;
    const text = node.text || "";
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const from = pos + match.index;
      const to = pos + match.index + match[0].length;
      const isCurrent = currentMatch && from === currentMatch.from && to === currentMatch.to;
      decorations.push(
        Decoration.inline(from, to, {
          class: isCurrent ? "search-highlight search-highlight-current" : "search-highlight",
        })
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

function createSearchHighlightExtension(
  queryRef: { current: string },
  currentMatchRef: { current: { from: number; to: number } | undefined }
) {
  let cachedDecos: DecorationSet = DecorationSet.empty;
  let cachedQuery = "";
  let cachedDoc: any = null;
  let cachedMatchFrom = -1;

  return Extension.create({
    name: "searchHighlight",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            decorations(state) {
              const query = queryRef.current;
              const matchFrom = currentMatchRef.current?.from ?? -1;
              if (query === cachedQuery && state.doc === cachedDoc && matchFrom === cachedMatchFrom) {
                return cachedDecos;
              }
              cachedQuery = query;
              cachedDoc = state.doc;
              cachedMatchFrom = matchFrom;
              cachedDecos = buildDecorations(state.doc, query, currentMatchRef.current);
              return cachedDecos;
            },
          },
        }),
      ];
    },
  });
}

const BUILTIN_MACROS: Record<string, () => string> = {
  "/date": () => new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
  "/time": () => new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
};

function expandMacro(view: any, macrosRef: { current: Record<string, string> }): boolean {
  const { state } = view;
  const { from } = state.selection;
  const $from = state.doc.resolve(from);
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const match = textBefore.match(/(\/\w+)$/);
  if (!match) return false;

  const trigger = match[1];
  let expansion: string | null = null;

  if (BUILTIN_MACROS[trigger]) {
    expansion = BUILTIN_MACROS[trigger]();
  } else if (macrosRef.current[trigger]) {
    expansion = macrosRef.current[trigger];
  }

  if (!expansion) return false;

  const triggerStart = from - trigger.length;
  const tr = state.tr.deleteRange(triggerStart, from);

  if (expansion.includes("\n")) {
    const lines = expansion.split("\n");
    const nodes = lines.map((line: string) => {
      const textNode = line ? state.schema.text(line) : undefined;
      return state.schema.nodes.paragraph.create(null, textNode || undefined);
    });
    const fragment = state.schema.nodes.doc.create(null, nodes).content;
    tr.insert(triggerStart, fragment);
  } else {
    tr.insertText(expansion, triggerStart);
  }

  view.dispatch(tr);
  return true;
}

function createMacroExtension(macrosRef: { current: Record<string, string> }) {
  return Extension.create({
    name: "macroExpansion",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleTextInput(view, _from, _to, text) {
              if (text !== " ") return false;
              return expandMacro(view, macrosRef);
            },
            handleKeyDown(view, event) {
              if (event.key !== "Enter") return false;
              return expandMacro(view, macrosRef);
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
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = codexList.filter(
    (c) => c.toLowerCase().includes(inputValue.toLowerCase()) && c !== inputValue
  );

  const commit = useCallback((val: string) => {
    const trimmed = val.trim();
    onChange(trimmed || null);
    setEditing(false);
  }, [onChange]);

  useEffect(() => {
    if (!editing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        commit(inputValue);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [editing, inputValue, commit]);

  if (editing) {
    return (
      <div className="codex-picker" ref={containerRef}>
        <input
          ref={inputRef}
          className="codex-input"
          autoFocus
          placeholder="Codex name"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setHighlightIndex(-1);
          }}
          name="codex-picker-nonce"
          autoComplete="nope"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={filtered.length > 0}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (highlightIndex >= 0 && highlightIndex < filtered.length) {
                commit(filtered[highlightIndex]);
              } else {
                commit(inputValue);
              }
            } else if (e.key === "Escape") {
              setEditing(false);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightIndex((i) => Math.max(i - 1, -1));
            }
          }}
        />
        {filtered.length > 0 && (
          <div className="codex-picker-menu">
            {filtered.map((c, i) => (
              <button
                key={c}
                className={`codex-picker-item${i === highlightIndex ? " highlighted" : ""}${c === value ? " selected" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(c);
                }}
                onMouseEnter={() => setHighlightIndex(i)}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <span
      className="editor-meta codex-label"
      onClick={() => {
        setInputValue(value || "");
        setHighlightIndex(-1);
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
  // Reports the version (updated_at) the editor buffer is now derived from,
  // for optimistic-concurrency conflict detection on save.
  onBaseVersion?: (id: string, updatedAt: string) => void;
  focusTrigger?: number;
  searchQuery?: string;
  codexList: string[];
  isSensitive?: boolean;
  editorRef?: React.MutableRefObject<any>;
  macros?: Record<string, string>;
  allNotes?: Note[];
  onNavigateToNote?: (id: string) => void;
  frozen?: boolean;
  onToggleFreeze?: () => void;
  tocDefault?: boolean;
  onCloseSplit?: () => void;
  onToggleSplit?: () => void;
  isSplit?: boolean;
  tagColors?: Record<string, string>;
  dictionary?: string[];
};

type TocHeading = { level: number; text: string; pos: number };
type Backlink = { id: string; title: string };

export function Editor({ note, saveStatus, onTitleChange, onBodyChange, onCodexChange, onEditingChange, onBaseVersion, searchQuery = "", codexList, isSensitive, editorRef, macros = {}, allNotes = [], onNavigateToNote, frozen, onToggleFreeze, tocDefault, onCloseSplit, onToggleSplit, isSplit, tagColors, dictionary = [] }: Props) {
  const [showCharCount, setShowCharCount] = useState(false);
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [activeHeadingPos, setActiveHeadingPos] = useState<number | null>(null);
  const editorBodyRef = useRef<HTMLDivElement>(null);
  const tocInitializedForNote = useRef<string | null>(null);
  const [localTitle, setLocalTitle] = useState(note.title);
  const localTitleNoteId = useRef(note.id);

  if (localTitleNoteId.current !== note.id) {
    localTitleNoteId.current = note.id;
    setLocalTitle(note.title);
  }
  const [showInNoteSearch, setShowInNoteSearch] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [inNoteQuery, setInNoteQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [matchPositions, setMatchPositions] = useState<{ from: number; to: number }[]>([]);
  const inNoteSearchRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const noteIdRef = useRef(note.id);
  const onBodyChangeRef = useRef(onBodyChange);
  onBodyChangeRef.current = onBodyChange;
  const searchQueryRef = useRef(searchQuery);
  const currentMatchRef = useRef<{ from: number; to: number } | undefined>(undefined);
  const macrosRef = useRef(macros);
  macrosRef.current = macros;
  const titleInputRef = useRef<HTMLInputElement>(null);
  const notesListRef = useRef(allNotes.map((n) => ({ id: n.id, title: n.title, codex: n.codex })));
  notesListRef.current = allNotes.filter((n) => n.id !== note.id).map((n) => ({ id: n.id, title: n.title, codex: n.codex }));
  const onNavigateRef = useRef(onNavigateToNote || (() => {}));
  onNavigateRef.current = onNavigateToNote || (() => {});

  const [searchExt] = useState(() => createSearchHighlightExtension(searchQueryRef, currentMatchRef));
  const [macroExt] = useState(() => createMacroExtension(macrosRef));
  const [noteLinkExt] = useState(() => createNoteLinkExtension(notesListRef, onNavigateRef));
  const tagColorsRef = useRef(tagColors);
  tagColorsRef.current = tagColors;
  const [tagExt] = useState(() => createTagHighlightExtension(tagColorsRef));
  const dictionaryRef = useRef(dictionary);
  dictionaryRef.current = dictionary;
  const [mentionExt] = useState(() => createMentionExtension(dictionaryRef));
  const suppressUpdate = useRef(false);

  const editor = useEditor({
    editable: !frozen,
    editorProps: {
      attributes: {
        'data-editor': 'true',
      },
    },
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: {
          autolink: false,
        },
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
        transformCopiedText: false,
      }),
      searchExt,
      macroExt,
      noteLinkExt,
      mentionExt,
      tagExt,
      createTaskPriorityExtension(),
      createTaskDueDateExtension(),
    ],
    content: note.body,
    onUpdate: ({ editor }) => {
      if (suppressUpdate.current || !editor.isEditable) return;
      const md = (editor.storage as any).markdown.getMarkdown();
      onBodyChangeRef.current(md);
    },
    onFocus: ({ editor }) => {
      if (!editor.isEditable) return;
      onEditingChange?.(true);
    },
  });

  useEffect(() => {
    if (editor) editor.setEditable(!frozen, false);
  }, [frozen, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.view) return;
    const tr = editor.view.state.tr.setMeta("tagColorUpdate", true);
    editor.view.dispatch(tr);
  }, [tagColors, editor]);

  // Update the combined query ref: in-note search takes priority over global search
  searchQueryRef.current = inNoteQuery.trim() ? inNoteQuery : searchQuery;
  currentMatchRef.current = matchPositions.length > 0 ? matchPositions[currentMatchIndex] : undefined;

  const matchCount = matchPositions.length;
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.view) return;
    // Dispatch a no-op transaction to force ProseMirror to re-read decorations
    const tr = editor.view.state.tr.setMeta("searchHighlightUpdate", true);
    editor.view.dispatch(tr);
  }, [searchQuery, inNoteQuery, currentMatchIndex, matchCount, editor]);

  // Expose editor instance via ref
  useEffect(() => {
    if (editorRef && editor) {
      editorRef.current = editor;
    }
  }, [editor, editorRef]);

  // Cmd+F / Cmd+H in-note search handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "f" && !e.shiftKey) {
        e.preventDefault();
        if (showInNoteSearch) {
          inNoteSearchRef.current?.focus();
          inNoteSearchRef.current?.select();
        } else {
          setShowInNoteSearch(true);
        }
      } else if (mod && e.key === "h" && !e.shiftKey) {
        e.preventDefault();
        if (!showInNoteSearch) setShowInNoteSearch(true);
        setShowReplace(true);
        setTimeout(() => replaceInputRef.current?.focus(), 0);
      } else if (mod && e.key === "]" && showInNoteSearch) {
        e.preventDefault();
        cycleMatchRef.current(1);
      } else if (mod && e.key === "[" && showInNoteSearch) {
        e.preventDefault();
        cycleMatchRef.current(-1);
      }
    };
    const handleOpenFind = () => {
      setShowInNoteSearch(true);
    };
    const handleOpenReplace = () => {
      setShowInNoteSearch(true);
      setShowReplace(true);
      setTimeout(() => replaceInputRef.current?.focus(), 0);
    };
    const handleToggleToc = () => {
      setShowToc((s) => !s);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("open-in-note-search", handleOpenFind);
    window.addEventListener("open-find-replace", handleOpenReplace);
    window.addEventListener("toggle-toc", handleToggleToc);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("open-in-note-search", handleOpenFind);
      window.removeEventListener("open-find-replace", handleOpenReplace);
      window.removeEventListener("toggle-toc", handleToggleToc);
    };
  }, [showInNoteSearch]);

  useEffect(() => {
    if (showInNoteSearch) {
      inNoteSearchRef.current?.focus();
    }
  }, [showInNoteSearch]);

  // Find all matches in document when in-note query changes
  useEffect(() => {
    if (!editor || !inNoteQuery.trim()) {
      setMatchPositions([]);
      setCurrentMatchIndex(0);
      return;
    }
    const regex = buildSearchPattern(inNoteQuery);
    if (!regex) {
      setMatchPositions([]);
      setCurrentMatchIndex(0);
      return;
    }
    const positions: { from: number; to: number }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      const text = node.text || "";
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text)) !== null) {
        positions.push({ from: pos + match.index, to: pos + match.index + match[0].length });
      }
    });
    setMatchPositions(positions);
    setCurrentMatchIndex(positions.length > 0 ? 0 : 0);
  }, [inNoteQuery, editor]);

  // Scroll to current match and highlight it
  useEffect(() => {
    if (!editor || matchPositions.length === 0) return;
    const pos = matchPositions[currentMatchIndex];
    if (!pos) return;
    editor.commands.setTextSelection(pos);
    const dom = editor.view.domAtPos(pos.from);
    if (dom.node) {
      const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [currentMatchIndex, matchPositions, editor]);

  const cycleMatch = useCallback((direction: 1 | -1) => {
    if (matchPositions.length === 0) return;
    setCurrentMatchIndex((prev) => {
      const next = prev + direction;
      if (next < 0) return matchPositions.length - 1;
      if (next >= matchPositions.length) return 0;
      return next;
    });
  }, [matchPositions]);
  const cycleMatchRef = useRef(cycleMatch);
  cycleMatchRef.current = cycleMatch;

  const closeInNoteSearch = useCallback(() => {
    setShowInNoteSearch(false);
    setShowReplace(false);
    setInNoteQuery("");
    setReplaceText("");
    setMatchPositions([]);
    setCurrentMatchIndex(0);
    editor?.commands.focus();
  }, [editor]);

  const handleReplace = useCallback(() => {
    if (!editor || matchPositions.length === 0) return;
    const pos = matchPositions[currentMatchIndex];
    if (!pos) return;
    const skipUntil = pos.from + replaceText.length;
    editor.chain().setTextSelection(pos).insertContent(replaceText).run();
    // Re-find all matches, then advance index past the replacement
    const regex = buildSearchPattern(inNoteQuery);
    if (!regex) { setMatchPositions([]); return; }
    const positions: { from: number; to: number }[] = [];
    editor.state.doc.descendants((node, nodePos) => {
      if (!node.isText) return;
      const text = node.text || "";
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text)) !== null) {
        positions.push({ from: nodePos + match.index, to: nodePos + match.index + match[0].length });
      }
    });
    setMatchPositions(positions);
    const nextIndex = positions.findIndex((p) => p.from >= skipUntil);
    setCurrentMatchIndex(nextIndex >= 0 ? nextIndex : 0);
    replaceInputRef.current?.focus();
  }, [editor, matchPositions, currentMatchIndex, replaceText, inNoteQuery]);

  const handleReplaceAll = useCallback(() => {
    if (!editor || matchPositions.length === 0) return;
    const sorted = [...matchPositions].sort((a, b) => b.from - a.from);
    editor.chain().command(({ tr }) => {
      for (const pos of sorted) {
        if (replaceText) {
          tr.insertText(replaceText, pos.from, pos.to);
        } else {
          tr.delete(pos.from, pos.to);
        }
      }
      return true;
    }).run();
    setMatchPositions([]);
    setCurrentMatchIndex(0);
    replaceInputRef.current?.focus();
  }, [editor, matchPositions, replaceText]);

  const onBaseVersionRef = useRef(onBaseVersion);
  onBaseVersionRef.current = onBaseVersion;

  useEffect(() => {
    if (!editor) return;
    if (noteIdRef.current !== note.id) {
      noteIdRef.current = note.id;
      suppressUpdate.current = true;
      editor.setEditable(!frozen, false);
      editor.commands.setContent(note.body);
      suppressUpdate.current = false;
      // Switching notes: this note's on-disk version is our edit base.
      onBaseVersionRef.current?.(note.id, note.updated_at);
      return;
    }
    const currentMd = (editor.storage as any).markdown.getMarkdown();
    if (currentMd !== note.body && !editor.isFocused) {
      suppressUpdate.current = true;
      editor.commands.setContent(note.body);
      suppressUpdate.current = false;
      // Adopted an external change while not editing: rebase to it.
      onBaseVersionRef.current?.(note.id, note.updated_at);
    }
  }, [note.id, note.body, note.updated_at, editor, frozen]);

  // Extract headings from editor document for TOC
  useEffect(() => {
    if (!editor) return;
    const extractHeadings = () => {
      const items: TocHeading[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
          items.push({ level: node.attrs.level, text: node.textContent, pos });
        }
      });
      setHeadings(items);
      if (tocInitializedForNote.current !== note.id) {
        tocInitializedForNote.current = note.id;
        setShowToc(tocDefault ? items.length > 0 : false);
      }
    };
    extractHeadings();
    editor.on("update", extractHeadings);
    return () => { editor.off("update", extractHeadings); };
  }, [editor, note.id, tocDefault]);

  // Track which heading is "active" based on cursor position
  useEffect(() => {
    if (!showToc || !editor || headings.length === 0) return;
    const updateActive = () => {
      const cursorPos = editor.state.selection.from;
      let active: number | null = null;
      for (const h of headings) {
        if (h.pos <= cursorPos) active = h.pos;
      }
      if (active === null && headings.length > 0) active = headings[0].pos;
      setActiveHeadingPos(active);
    };
    updateActive();
    editor.on("selectionUpdate", updateActive);
    editor.on("update", updateActive);
    return () => {
      editor.off("selectionUpdate", updateActive);
      editor.off("update", updateActive);
    };
  }, [showToc, editor, headings]);

  const scrollToHeading = useCallback((pos: number) => {
    if (!editor) return;
    const el = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      editor.commands.setTextSelection(pos + 1);
    }
  }, [editor]);

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
    saveStatus === "saved" || saveStatus === "saving"
      ? "Saved"
      : saveStatus === "unsaved"
        ? "Unsaved"
        : saveStatus === "error"
          ? "Save failed"
          : "";

  const wordCount = useMemo(() => note.body.trim() ? note.body.trim().split(/\s+/).length : 0, [note.body]);
  const charCount = useMemo(() => note.body.replace(/\s/g, "").length, [note.body]);

  const backlinks: Backlink[] = useMemo(() => {
    const pattern = `scratch://${note.id}`;
    return allNotes
      .filter((n) => n.id !== note.id && n.body.includes(pattern))
      .map((n) => ({ id: n.id, title: n.title || "Untitled" }));
  }, [note.id, allNotes]);

  const createdDate = new Date(note.created_at);
  const createdStr = createdDate.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: createdDate.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
  const modifiedDate = new Date(note.updated_at);
  const modifiedStr = modifiedDate.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const tags = useMemo(() => extractTags(note.body), [note.body]);

  const titleHasMatch = searchQuery && buildSearchPattern(searchQuery)?.test(localTitle);

  return (
    <div className="editor">
      <div className="editor-header">
        <div className="editor-title-wrapper">
          <input
            ref={titleInputRef}
            type="text"
            className="editor-title"
            value={localTitle}
            onChange={(e) => {
              if (frozen) return;
              setLocalTitle(e.target.value);
              onTitleChange(e.target.value);
            }}
            onKeyDown={handleTitleKeyDown}
            onFocus={() => {
              setIsTitleFocused(true);
              onEditingChange?.(true);
            }}
            onBlur={() => setIsTitleFocused(false)}
            placeholder="Note title"
            readOnly={frozen}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
          {titleHasMatch && !isTitleFocused && (
            <div className="editor-title-overlay" aria-hidden="true">
              {highlightMatches(localTitle, searchQuery)}
            </div>
          )}
          <div className="editor-created-row">
            <span className="editor-created">Created {createdStr}</span>
            {tags.length > 0 && (
              <span className="editor-tags">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="editor-tag"
                    style={tagColors?.[tag] ? { color: tagColors[tag], background: `${tagColors[tag]}20` } : undefined}
                  >#{tag}</span>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="editor-status">
          {frozen && <span className="frozen-status" onClick={onToggleFreeze} title="Click to unfreeze">Frozen</span>}
          {note.archived && <span className="archived-status">Archived</span>}
          {isSensitive && <span className="sensitive-status">Protected</span>}
          {note.encrypted && <span className="encrypted-status">Encrypted</span>}
          {statusLabel && !frozen && <span className={`save-status ${saveStatus}`}>{statusLabel}</span>}
          {onCloseSplit && (
            <button className="split-close-btn" onClick={onCloseSplit} title="Close split view">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2L10 10M10 2L2 10" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {showInNoteSearch && (
        <div className="in-note-search-container">
          <div className="in-note-search">
            <svg className="in-note-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inNoteSearchRef}
              type="text"
              className="in-note-search-input"
              placeholder="Find in note..."
              value={inNoteQuery}
              onChange={(e) => setInNoteQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  cycleMatch(e.shiftKey ? -1 : 1);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  closeInNoteSearch();
                }
              }}
              autoComplete="off"
              spellCheck="false"
            />
            {inNoteQuery && (
              <span className="in-note-search-count">
                {matchPositions.length > 0
                  ? `${currentMatchIndex + 1}/${matchPositions.length}`
                  : "0/0"}
              </span>
            )}
            <button
              className="in-note-search-btn"
              onClick={() => cycleMatch(-1)}
              title="Previous (Shift+Enter)"
              disabled={matchPositions.length === 0}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8 7L5 3L2 7" />
              </svg>
            </button>
            <button
              className="in-note-search-btn"
              onClick={() => cycleMatch(1)}
              title="Next (Enter)"
              disabled={matchPositions.length === 0}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 3L5 7L8 3" />
              </svg>
            </button>
            <button
              className={`in-note-search-btn${showReplace ? " active" : ""}`}
              onClick={() => setShowReplace((s) => !s)}
              title="Toggle Replace (Cmd+H)"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 3h6M7 3L5 1M7 3L5 5M9 7H3M3 7l2-2M3 7l2 2" />
              </svg>
            </button>
            <button
              className="in-note-search-btn"
              onClick={closeInNoteSearch}
              title="Close (Esc)"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 2L8 8M8 2L2 8" />
              </svg>
            </button>
          </div>
          {showReplace && (
            <div className="in-note-replace">
              <svg className="in-note-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              <input
                ref={replaceInputRef}
                type="text"
                className="in-note-search-input"
                placeholder="Replace with..."
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleReplace();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    closeInNoteSearch();
                  }
                }}
                autoComplete="off"
                spellCheck="false"
              />
              <button
                className="in-note-search-btn replace-btn"
                onClick={handleReplace}
                title="Replace"
                disabled={matchPositions.length === 0}
              >
                Replace
              </button>
              <button
                className="in-note-search-btn replace-btn"
                onClick={handleReplaceAll}
                title="Replace All"
                disabled={matchPositions.length === 0}
              >
                All
              </button>
            </div>
          )}
        </div>
      )}
      <div className="editor-content-area">
        <div className="editor-body" ref={editorBodyRef} onKeyDownCapture={(e) => {
          if (e.key !== "Tab" || e.altKey || e.metaKey || e.ctrlKey || !editor) return;
          const isTask = editor.isActive("taskItem");
          const isList = editor.isActive("listItem");
          if (!isTask && !isList) return;
          e.preventDefault();
          e.stopPropagation();
          const nodeType = isTask ? "taskItem" : "listItem";
          if (e.shiftKey) {
            editor.commands.liftListItem(nodeType);
          } else {
            editor.commands.sinkListItem(nodeType);
          }
        }}>
          <EditorContent editor={editor} />
          {backlinks.length > 0 && (
            <div className="editor-backlinks">
              <div className="editor-backlinks-header">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 17H7A5 5 0 0 1 7 7h2" />
                  <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                <span>{backlinks.length} backlink{backlinks.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="editor-backlinks-list">
                {backlinks.map((bl) => (
                  <button
                    key={bl.id}
                    className="editor-backlink-item"
                    onClick={() => onNavigateToNote?.(bl.id)}
                  >
                    {bl.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {showToc && headings.length > 0 && (
          <div className="editor-toc">
            <div className="editor-toc-items">
              {headings.map((h, i) => (
                <button
                  key={i}
                  className={`editor-toc-item editor-toc-h${h.level}${h.pos === activeHeadingPos ? " active" : ""}`}
                  onClick={() => scrollToHeading(h.pos)}
                  title={h.text}
                >
                  {h.text}
                </button>
              ))}
            </div>
          </div>
        )}
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
        {onToggleSplit && (
          <button
            className={`editor-toc-toggle${isSplit ? " active" : ""}`}
            onClick={onToggleSplit}
            title="Split View"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="2" width="14" height="12" rx="1.5" />
              <line x1="8" y1="2" x2="8" y2="14" />
            </svg>
          </button>
        )}
        <button
          className={`editor-toc-toggle${showToc ? " active" : ""}`}
          onClick={() => setShowToc((s) => !s)}
          title="Table of Contents"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="3" y1="3" x2="13" y2="3" />
            <line x1="5" y1="7" x2="13" y2="7" />
            <line x1="5" y1="11" x2="13" y2="11" />
            <circle cx="2" cy="7" r="1" fill="currentColor" stroke="none" />
            <circle cx="2" cy="11" r="1" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>
    </div>
  );
}
