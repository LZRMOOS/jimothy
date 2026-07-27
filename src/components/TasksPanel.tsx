import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { Note } from "../types";
import {
  parseTaskDoc,
  serializeTaskDoc,
  serializeTask,
  TASK_CODEX,
  type Task,
  type TaskDoc,
  type Priority,
} from "../utils/taskList";
import { buildAgenda, buildDoneList, ymd, dayTitle, type IdTask } from "../utils/agenda";
import { recognize } from "../utils/naturalDate";

type Props = {
  notes: Note[];
  dictionary?: string[];
  onSave: (id: string, title: string, body: string, codex: string | null) => void;
  onCreate: (title: string, codex: string) => Promise<Note | null>;
  onNavigateNote: (id: string) => void;
};

export function TasksPanel({ notes, dictionary = [], onSave, onCreate, onNavigateNote }: Props) {
  const [tab, setTab] = useState<"active" | "done">("active");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addPriority, setAddPriority] = useState<Priority | null>(null);
  const [schedDate, setSchedDate] = useState<{ value: string; label: string; phrase: string } | null>(null);
  const [schedTime, setSchedTime] = useState<{ value: number; label: string; phrase: string } | null>(null);
  const [focusedDay, setFocusedDay] = useState<string | null>(null);
  const [editingCid, setEditingCid] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Array<{ kind: "url"; label: string; href: string } | { kind: "note"; label: string; id: string }>>([]);
  const [noteSuggestions, setNoteSuggestions] = useState<Note[]>([]);
  const [noteQueryStart, setNoteQueryStart] = useState<number | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [showNotePicker, setShowNotePicker] = useState(false);
  const [notePickerQuery, setNotePickerQuery] = useState("");
  const [mentionSuggestions, setMentionSuggestions] = useState<string[]>([]);
  const [mentionQueryStart, setMentionQueryStart] = useState<number | null>(null);
  const [selectedMention, setSelectedMention] = useState(0);
  const notePickerRef = useRef<HTMLInputElement>(null);
  const [dragCid, setDragCid] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ cid: string; position: "before" | "after" } | null>(null);
  const [dropSectionDate, setDropSectionDate] = useState<string | null>(null);
  const addInputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const taskNote = useMemo(
    () => notes.find((n) => n.codex === TASK_CODEX && !n.archived) ?? null,
    [notes]
  );

  const doc = useMemo<TaskDoc>(
    () => (taskNote ? parseTaskDoc(taskNote.body) : []),
    [taskNote]
  );

  const allTasks = useMemo<IdTask[]>(() => {
    let idx = 0;
    return doc.flatMap((item) =>
      item.kind === "task" ? [{ ...item.task, cid: `t${idx++}` }] : []
    );
  }, [doc]);

  const today = useMemo(() => ymd(new Date()), []);
  const [daysAhead, setDaysAhead] = useState(30);

  const activeSections = useMemo(
    () => buildAgenda(allTasks, { today, daysAhead }),
    [allTasks, today, daysAhead]
  );

  const doneSections = useMemo(() => buildDoneList(allTasks), [allTasks]);

  const onDraftChange = useCallback(
    (next: string, cursorPos?: number) => {
      const justCompletedWord = next.length > addInput.length && /\s$/.test(next);

      const cursor = cursorPos ?? next.length;
      const beforeCursor = next.slice(0, cursor);

      // Check for @ trigger (dictionary mentions)
      const mentionMatch = beforeCursor.match(/(^|\s)@([^\s]*)$/);
      if (mentionMatch && dictionary.length > 0) {
        const query = mentionMatch[2].toLowerCase();
        const atStart = beforeCursor.length - mentionMatch[2].length - 1; // position of @
        setMentionQueryStart(atStart);
        setSelectedMention(0);
        const filtered = dictionary
          .filter((d) => d.toLowerCase().includes(query))
          .slice(0, 8);
        setMentionSuggestions(filtered);
        setAddInput(next);
        // Clear note suggestions if active
        if (noteQueryStart !== null) { setNoteSuggestions([]); setNoteQueryStart(null); }
        return;
      } else {
        if (mentionQueryStart !== null) {
          setMentionSuggestions([]);
          setMentionQueryStart(null);
        }
      }

      // Check for [[ trigger (note links)
      const bracketMatch = beforeCursor.match(/\[\[([^\]]*)$/);
      if (bracketMatch) {
        const query = bracketMatch[1].toLowerCase();
        const queryStart = beforeCursor.length - bracketMatch[0].length;
        setNoteQueryStart(queryStart);
        setSelectedSuggestion(0);
        const filtered = notes
          .filter((n) => n.title.toLowerCase().includes(query) && n.codex !== TASK_CODEX)
          .slice(0, 8);
        setNoteSuggestions(filtered);
        setAddInput(next);
        return;
      } else {
        if (noteQueryStart !== null) {
          setNoteSuggestions([]);
          setNoteQueryStart(null);
        }
      }

      if (!justCompletedWord) {
        setAddInput(next);
        return;
      }

      // Detect pasted/typed URLs and lift into attachment chips
      const urlMatch = next.match(/(^|\s)((?:https?:\/\/|www\.)\S+)\s$/);
      if (urlMatch) {
        const raw = urlMatch[2];
        const href = raw.startsWith("http") ? raw : `https://${raw}`;
        const host = href.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.replace(/^www\./i, "") ?? raw;
        const stripped = next.slice(0, urlMatch.index! + urlMatch[1].length).trimEnd();
        setAddInput(stripped ? stripped + " " : "");
        setAttachments((prev) => [...prev, { kind: "url", label: host, href }]);
        return;
      }

      const r = recognize(next, undefined, { allowBareTime: true });
      let lifted = false;
      const allSpans: Array<[number, number]> = [];

      if (r.date && r.dateSpans.length > 0 && !schedDate) {
        const phrase = r.dateSpans.map(([s, e]) => next.slice(s, e)).join(" ");
        setSchedDate({ value: r.date, label: dayTitle(r.date, today), phrase });
        allSpans.push(...r.dateSpans);
        lifted = true;
      }

      if (r.time !== null && r.timeSpans.length > 0 && !schedTime) {
        const tPhrase = r.timeSpans.map(([s, e]) => next.slice(s, e)).join(" ");
        setSchedTime({ value: r.time, label: formatTime(r.time), phrase: tPhrase });
        allSpans.push(...r.timeSpans);
        lifted = true;
      }

      if (lifted) {
        let stripped = next;
        for (const [s, e] of allSpans.sort((a, b) => b[0] - a[0])) {
          stripped = stripped.slice(0, s) + stripped.slice(e);
        }
        setAddInput(stripped.replace(/\s+/g, " ").trim() + " ");
      } else {
        setAddInput(next);
      }
    },
    [addInput, schedDate, schedTime, today, notes, dictionary, noteQueryStart, mentionQueryStart]
  );

  const insertMention = useCallback(
    (mention: string) => {
      if (mentionQueryStart === null) return;
      const before = addInput.slice(0, mentionQueryStart);
      const afterMatch = addInput.slice(mentionQueryStart).match(/^@[^\s]*/);
      const after = afterMatch ? addInput.slice(mentionQueryStart + afterMatch[0].length) : addInput.slice(mentionQueryStart);
      setAddInput(before + `@${mention}` + " " + after.trimStart());
      setMentionSuggestions([]);
      setMentionQueryStart(null);
      addInputRef.current?.focus();
    },
    [addInput, mentionQueryStart]
  );

  const insertNoteLink = useCallback(
    (note: Note) => {
      if (noteQueryStart !== null) {
        const before = addInput.slice(0, noteQueryStart);
        const afterBracket = addInput.slice(noteQueryStart);
        const queryMatch = afterBracket.match(/\[\[([^\]]*)$/);
        const after = queryMatch
          ? addInput.slice(noteQueryStart + queryMatch[0].length)
          : "";
        setAddInput((before + after).replace(/\s+/g, " ").trimEnd() + (before + after ? " " : ""));
      }
      setAttachments((prev) => [...prev, { kind: "note", label: note.title, id: note.id }]);
      setNoteSuggestions([]);
      setNoteQueryStart(null);
      addInputRef.current?.focus();
    },
    [addInput, noteQueryStart]
  );

  const insertNoteLinkFromPicker = useCallback(
    (note: Note) => {
      setAttachments((prev) => [...prev, { kind: "note", label: note.title, id: note.id }]);
      setShowNotePicker(false);
      setNotePickerQuery("");
      addInputRef.current?.focus();
    },
    []
  );

  const removeAttachment = useCallback(
    (index: number) => {
      setAttachments((prev) => prev.filter((_, i) => i !== index));
    },
    []
  );

  const notePickerResults = useMemo(
    () => notes
      .filter((n) => n.title.toLowerCase().includes(notePickerQuery.toLowerCase()) && n.codex !== TASK_CODEX)
      .slice(0, 8),
    [notes, notePickerQuery]
  );

  const dismissDate = useCallback(() => {
    const words = [schedDate?.phrase, schedTime?.phrase].filter(Boolean).join(" ");
    setSchedDate(null);
    setSchedTime(null);
    setAddInput((d) => (words ? `${d}${words} ` : d));
  }, [schedDate, schedTime]);

  const dismissTime = useCallback(() => {
    const w = schedTime?.phrase;
    setSchedTime(null);
    setAddInput((d) => (w ? `${d}${w} ` : d));
  }, [schedTime]);

  const persistDoc = useCallback(
    (newDoc: TaskDoc) => {
      if (!taskNote) return;
      const body = serializeTaskDoc(newDoc);
      onSave(taskNote.id, taskNote.title, body, taskNote.codex);
    },
    [taskNote, onSave]
  );

  const toggleDone = useCallback(
    (cid: string) => {
      let idx = 0;
      const newDoc = doc.map((item) => {
        if (item.kind !== "task") return item;
        const thisCid = `t${idx++}`;
        if (thisCid !== cid) return item;
        return { kind: "task" as const, task: { ...item.task, done: !item.task.done } };
      });
      persistDoc(newDoc);
    },
    [doc, persistDoc]
  );

  const deleteTask = useCallback(
    (cid: string) => {
      let idx = 0;
      const newDoc = doc.filter((item) => {
        if (item.kind !== "task") return true;
        const thisCid = `t${idx++}`;
        return thisCid !== cid;
      });
      persistDoc(newDoc);
    },
    [doc, persistDoc]
  );

  const editTask = useCallback(
    (cid: string, updates: Partial<Task>) => {
      let idx = 0;
      const newDoc = doc.map((item) => {
        if (item.kind !== "task") return item;
        const thisCid = `t${idx++}`;
        if (thisCid !== cid) return item;
        return { kind: "task" as const, task: { ...item.task, ...updates } };
      });
      persistDoc(newDoc);
    },
    [doc, persistDoc]
  );

  const openEditModal = useCallback(
    (cid: string) => {
      const task = allTasks.find((t) => t.cid === cid);
      if (!task) return;
      // Parse existing attachments out of text
      const { title, chips } = extractChips(task.text);
      setEditingCid(cid);
      setAddInput(title);
      setAddPriority(task.priority);
      setSchedDate(task.date ? { value: task.date, label: dayTitle(task.date, today), phrase: task.date } : null);
      setSchedTime(task.time !== null ? { value: task.time, label: formatTime(task.time), phrase: formatTime(task.time) } : null);
      setAttachments(chips.map((c) =>
        c.kind === "note" ? { kind: "note" as const, label: c.label, id: c.id } : { kind: "url" as const, label: c.label, href: c.href }
      ));
      setNoteSuggestions([]);
      setNoteQueryStart(null);
      setMentionSuggestions([]);
      setMentionQueryStart(null);
      setShowNotePicker(false);
      setShowAddModal(true);
    },
    [allTasks, today]
  );

  const reorderTask = useCallback(
    (fromCid: string, toCid: string, position: "before" | "after", targetDate: string | null) => {
      let idx = 0;
      let fromIdx = -1;
      let toIdx = -1;
      for (let i = 0; i < doc.length; i++) {
        if (doc[i].kind === "task") {
          const cid = `t${idx++}`;
          if (cid === fromCid) fromIdx = i;
          if (cid === toCid) toIdx = i;
        }
      }
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

      const item = doc[fromIdx];
      if (item.kind !== "task") return;

      const updatedItem = targetDate
        ? { kind: "task" as const, task: { ...item.task, date: targetDate === today ? null : targetDate } }
        : item;

      const newDoc = [...doc];
      newDoc.splice(fromIdx, 1);
      const adjustedTo = toIdx > fromIdx ? toIdx - 1 : toIdx;
      const insertAt = position === "after" ? adjustedTo + 1 : adjustedTo;
      newDoc.splice(insertAt, 0, updatedItem);
      persistDoc(newDoc);
    },
    [doc, persistDoc, today]
  );

  const moveToSection = useCallback(
    (fromCid: string, sectionDate: string) => {
      let idx = 0;
      let fromIdx = -1;
      for (let i = 0; i < doc.length; i++) {
        if (doc[i].kind === "task") {
          if (`t${idx++}` === fromCid) { fromIdx = i; break; }
        }
      }
      if (fromIdx === -1) return;
      const item = doc[fromIdx];
      if (item.kind !== "task") return;

      const newDate = sectionDate === today ? null : sectionDate;
      const updatedItem = { kind: "task" as const, task: { ...item.task, date: newDate } };

      const newDoc = [...doc];
      newDoc.splice(fromIdx, 1);
      newDoc.push(updatedItem);
      persistDoc(newDoc);
    },
    [doc, today, persistDoc]
  );

  const handleDragStart = useCallback((e: React.DragEvent, cid: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cid);
    requestAnimationFrame(() => setDragCid(cid));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, cid: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const pos = e.clientY < midY ? "before" : "after";
    setDropTarget({ cid, position: pos });
    setDropSectionDate(null);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toCid: string, sectionDate: string) => {
      e.preventDefault();
      const fromCid = e.dataTransfer.getData("text/plain");
      if (!fromCid || fromCid === toCid) {
        setDragCid(null);
        setDropTarget(null);
        setDropSectionDate(null);
        return;
      }
      const position = dropTarget?.cid === toCid ? dropTarget.position : "after";
      reorderTask(fromCid, toCid, position, sectionDate);
      setDragCid(null);
      setDropTarget(null);
      setDropSectionDate(null);
    },
    [dropTarget, reorderTask]
  );

  const handleDragEnd = useCallback(() => {
    setDragCid(null);
    setDropTarget(null);
    setDropSectionDate(null);
  }, []);

  const handleSectionDragOver = useCallback((e: React.DragEvent, date: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropSectionDate(date);
    setDropTarget(null);
  }, []);

  const handleSectionDragLeave = useCallback(() => {
    setDropSectionDate(null);
  }, []);

  const handleSectionDrop = useCallback(
    (e: React.DragEvent, sectionDate: string) => {
      e.preventDefault();
      const fromCid = e.dataTransfer.getData("text/plain");
      if (!fromCid) { setDragCid(null); setDropSectionDate(null); return; }
      moveToSection(fromCid, sectionDate);
      setDragCid(null);
      setDropSectionDate(null);
    },
    [moveToSection]
  );

  const handleSubmit = useCallback(async () => {
    const rawText = addInput.trim();
    if (!rawText && attachments.length === 0) return;

    const linkParts = attachments.map((a) =>
      a.kind === "url" ? `[${a.label}](${a.href})` : `[${a.label}](scratch://${a.id})`
    );
    const text = [rawText, ...linkParts].filter(Boolean).join(" ");

    const date = schedDate?.value ?? focusedDay ?? null;
    const time = schedTime?.value ?? null;

    if (editingCid) {
      editTask(editingCid, { text, date, time, priority: addPriority });
    } else {
      const newTask: Task = { text, date, time, priority: addPriority, done: false };
      const line = serializeTask(newTask);
      if (taskNote) {
        const body = taskNote.body ? taskNote.body + "\n" + line : line;
        onSave(taskNote.id, taskNote.title, body, taskNote.codex);
      } else {
        const created = await onCreate("Tasks", TASK_CODEX);
        if (created) {
          onSave(created.id, created.title, line, created.codex);
        }
      }
    }

    setAddInput("");
    setAddPriority(null);
    setSchedDate(null);
    setSchedTime(null);
    setAttachments([]);
    setEditingCid(null);
    setShowAddModal(false);
  }, [addInput, addPriority, attachments, schedDate, schedTime, focusedDay, editingCid, editTask, taskNote, onSave, onCreate]);

  const closeModal = useCallback(() => {
    setShowAddModal(false);
    setEditingCid(null);
  }, []);

  const sections = tab === "active" ? activeSections : doneSections;
  const isEmpty = sections.every((s) => s.tasks.length === 0);

  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const listTop = list.getBoundingClientRect().top;
    let closest: string | null = null;
    for (const [date, el] of sectionRefs.current) {
      const rect = el.getBoundingClientRect();
      if (rect.top <= listTop) closest = date;
    }
    if (closest) setFocusedDay(closest);

    if (tab === "active" && list.scrollTop + list.clientHeight >= list.scrollHeight - 200) {
      setDaysAhead((prev) => prev + 30);
    }
  }, [tab]);

  useEffect(() => {
    if (sections.length > 0 && !focusedDay) {
      setFocusedDay(sections[0].date);
    }
  }, [sections, focusedDay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "q" && !e.metaKey && !e.ctrlKey && !e.altKey && !showAddModal) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        setAddInput("");
        setAddPriority(null);
        setSchedDate(null);
        setSchedTime(null);
        setAttachments([]);
        setNoteSuggestions([]);
        setNoteQueryStart(null);
        setShowNotePicker(false);
        setShowAddModal(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAddModal]);

  useEffect(() => {
    if (showAddModal && addInputRef.current) {
      const el = addInputRef.current;
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [showAddModal]);

  const focusLabel = useMemo(
    () => focusedDay ? dayTitle(focusedDay, today) : "",
    [focusedDay, today]
  );

  const focusCount = useMemo(
    () => focusedDay ? (sections.find((s) => s.date === focusedDay)?.tasks.length ?? 0) : 0,
    [focusedDay, sections]
  );

  return (
    <div className="tasks-panel">
      <div className="tasks-focus-bar">
        <div className="tasks-focus-left">
          <div className="tasks-focus-accent" />
          <div className="tasks-focus-text">
            <span className="tasks-focus-eyebrow">IN FOCUS</span>
            <span className="tasks-focus-day">
              {focusLabel || "Today"}
              {focusCount > 0 && <span className="tasks-focus-count">{focusCount}</span>}
            </span>
          </div>
        </div>
        <div className="tasks-tabs">
          <button
            className={`tasks-tab ${tab === "active" ? "active" : ""}`}
            onClick={() => setTab("active")}
          >
            Active
          </button>
          <button
            className={`tasks-tab ${tab === "done" ? "active" : ""}`}
            onClick={() => setTab("done")}
          >
            Done
          </button>
        </div>
      </div>

      {showAddModal && (
        <div className="tasks-modal-overlay" onClick={closeModal}>
          <div className="tasks-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tasks-modal-header">
              <div className="tasks-modal-title-row">
                <span className="tasks-modal-title">
                  {editingCid ? "Edit" : schedDate ? "Add to" : `Add to ${focusLabel || "Today"}`}
                </span>
                {schedDate && (
                  <button className="tasks-chip tasks-chip-dismiss" onClick={dismissDate}>
                    {schedDate.label} <span className="tasks-chip-x">×</span>
                  </button>
                )}
                {schedTime && (
                  <button className="tasks-chip tasks-chip-dismiss" onClick={dismissTime}>
                    {schedTime.label} <span className="tasks-chip-x">×</span>
                  </button>
                )}
              </div>
              <button className="tasks-modal-close" onClick={closeModal}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {attachments.length > 0 && (
              <div className="tasks-modal-attachments">
                {attachments.map((a, i) => (
                  <button key={i} className={`tasks-chip tasks-chip-dismiss tasks-chip-${a.kind}`} onClick={() => removeAttachment(i)}>
                    {a.kind === "note" ? `@ ${a.label}` : a.label}
                    <span className="tasks-chip-x">×</span>
                  </button>
                ))}
              </div>
            )}
            <div className="tasks-modal-input-wrapper">
              <textarea
                ref={addInputRef}
                className="tasks-modal-input"
                placeholder="e.g. Call dentist tomorrow 9am"
                value={addInput}
                rows={1}
                onChange={(e) => {
                  onDraftChange(e.target.value, e.target.selectionStart ?? undefined);
                  e.target.style.height = "auto";
                  e.target.style.height = e.target.scrollHeight + "px";
                }}
                onKeyDown={(e) => {
                  if (mentionSuggestions.length > 0) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedMention((s) => Math.min(s + 1, mentionSuggestions.length - 1)); return; }
                    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedMention((s) => Math.max(s - 1, 0)); return; }
                    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(mentionSuggestions[selectedMention]); return; }
                    if (e.key === "Escape") { e.preventDefault(); setMentionSuggestions([]); setMentionQueryStart(null); return; }
                  }
                  if (noteSuggestions.length > 0) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedSuggestion((s) => Math.min(s + 1, noteSuggestions.length - 1)); return; }
                    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedSuggestion((s) => Math.max(s - 1, 0)); return; }
                    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertNoteLink(noteSuggestions[selectedSuggestion]); return; }
                    if (e.key === "Escape") { e.preventDefault(); setNoteSuggestions([]); setNoteQueryStart(null); return; }
                  }
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
                  if (e.key === "Escape") closeModal();
                }}
                autoFocus
              />
              {mentionSuggestions.length > 0 && (
                <div className="tasks-note-suggestions">
                  {mentionSuggestions.map((mention, i) => (
                    <button
                      key={mention}
                      className={`tasks-note-suggestion ${i === selectedMention ? "selected" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); insertMention(mention); }}
                    >
                      <span className="tasks-note-suggestion-title">@{mention}</span>
                    </button>
                  ))}
                </div>
              )}
              {noteSuggestions.length > 0 && (
                <div className="tasks-note-suggestions">
                  {noteSuggestions.map((note, i) => (
                    <button
                      key={note.id}
                      className={`tasks-note-suggestion ${i === selectedSuggestion ? "selected" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); insertNoteLink(note); }}
                    >
                      <span className="tasks-note-suggestion-title">{note.title}</span>
                      {note.codex && <span className="tasks-note-suggestion-codex">{note.codex}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="tasks-modal-actions">
              <div className="tasks-modal-actions-left">
                <button
                  className={`tasks-modal-priority ${addPriority ? `tasks-modal-priority-${addPriority}` : ""}`}
                  onClick={() => {
                    const cycle: Array<Priority | null> = ["high", "med", "low", null];
                    const idx = cycle.indexOf(addPriority);
                    setAddPriority(cycle[(idx + 1) % cycle.length]);
                  }}
                >
                  {addPriority ? `Priority: ${addPriority}` : "Priority"}
                </button>
                <div className="tasks-note-picker-wrapper">
                  <button
                    className="tasks-modal-link-btn"
                    onClick={() => { setShowNotePicker((v) => !v); setNotePickerQuery(""); }}
                    title="Link a note"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    Note
                  </button>
                  {showNotePicker && (
                    <div className="tasks-note-picker">
                      <input
                        ref={notePickerRef}
                        className="tasks-note-picker-input"
                        type="text"
                        placeholder="Search notes..."
                        value={notePickerQuery}
                        onChange={(e) => setNotePickerQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") { setShowNotePicker(false); addInputRef.current?.focus(); }
                          if (e.key === "Enter" && notePickerResults.length > 0) { e.preventDefault(); insertNoteLinkFromPicker(notePickerResults[0]); }
                        }}
                        autoFocus
                      />
                      <div className="tasks-note-picker-results">
                        {notePickerResults.map((note) => (
                          <button
                            key={note.id}
                            className="tasks-note-suggestion"
                            onMouseDown={(e) => { e.preventDefault(); insertNoteLinkFromPicker(note); }}
                          >
                            <span className="tasks-note-suggestion-title">{note.title}</span>
                            {note.codex && <span className="tasks-note-suggestion-codex">{note.codex}</span>}
                          </button>
                        ))}
                        {notePickerResults.length === 0 && (
                          <div className="tasks-note-picker-empty">No notes found</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <button className="tasks-modal-submit" onClick={handleSubmit} disabled={!addInput.trim() && attachments.length === 0}>
                {editingCid ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}


      <div className="tasks-list" ref={listRef} onScroll={handleScroll}>
        {isEmpty && tab === "active" && (
          <div className="tasks-empty">No tasks yet. Press <strong>+ New</strong> or <strong>Q</strong> to add one.</div>
        )}
        {isEmpty && tab === "done" && (
          <div className="tasks-empty">No completed tasks.</div>
        )}
        {sections.map((section) =>
          section.tasks.length === 0 && tab === "done" ? null : (
            <div key={section.date} className="tasks-section" ref={(el) => { if (el) sectionRefs.current.set(section.date, el); }}>
              <div
                className={`tasks-section-header ${dropSectionDate === section.date ? "tasks-section-header-drop" : ""}`}
                onDragOver={(e) => handleSectionDragOver(e, section.date)}
                onDragLeave={handleSectionDragLeave}
                onDrop={(e) => handleSectionDrop(e, section.date)}
              >
                <span className="tasks-section-title">{section.title}</span>
                {section.tasks.length > 0 && (
                  <span className="tasks-section-count">{section.tasks.length}</span>
                )}
              </div>
              {section.tasks.map((task) => (
                <TaskRow
                  key={task.cid}
                  task={task}
                  compact={tab === "done"}
                  onToggle={() => toggleDone(task.cid)}
                  onDelete={() => deleteTask(task.cid)}
                  onEdit={() => openEditModal(task.cid)}
                  onNavigateNote={onNavigateNote}
                  isDragging={dragCid === task.cid}
                  dropIndicator={dropTarget?.cid === task.cid ? dropTarget.position : null}
                  onDragStart={(e) => handleDragStart(e, task.cid)}
                  onDragOver={(e) => handleDragOver(e, task.cid)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, task.cid, section.date)}
                  onDragEnd={handleDragEnd}
                />
              ))}
            </div>
          )
        )}
      </div>

      {tab === "active" && (
        <button className="tasks-fab" onClick={() => { setAddInput(""); setAddPriority(null); setSchedDate(null); setSchedTime(null); setAttachments([]); setNoteSuggestions([]); setNoteQueryStart(null); setShowNotePicker(false); setShowAddModal(true); }}>
          + New <span className="tasks-fab-hint">Q</span>
        </button>
      )}
    </div>
  );
}

function TaskRow({
  task,
  compact,
  onToggle,
  onDelete,
  onEdit,
  onNavigateNote,
  isDragging,
  dropIndicator,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  task: IdTask;
  compact?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onNavigateNote: (id: string) => void;
  isDragging: boolean;
  dropIndicator: "before" | "after" | null;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const { title, chips } = useMemo(() => extractChips(task.text), [task.text]);

  return (
    <div
      className={`task-row ${task.done ? "task-done" : ""} ${compact ? "task-done-compact" : ""} ${isDragging ? "task-dragging" : ""} ${dropIndicator ? `task-drop-${dropIndicator}` : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onDoubleClick={onEdit}
    >
      <button className="task-checkbox" onClick={onToggle} aria-label={task.done ? "Mark incomplete" : "Mark complete"}>
        {task.done ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" fill="var(--accent)" stroke="var(--accent)" />
            <polyline points="9 11 12 14 16 9" stroke="var(--bg-primary)" strokeWidth="2.5" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" />
          </svg>
        )}
      </button>
      <div className="task-content">
        <span className="task-title">{title}</span>
        <div className="task-meta">
          {task.priority && (
            <span className={`task-priority task-priority-${task.priority}`}>
              {task.priority}
            </span>
          )}
          {task.time !== null && (
            <span className="task-time">
              {formatTime(task.time)}
            </span>
          )}
          {chips.map((chip, i) =>
            chip.kind === "note" ? (
              <button key={i} className="task-chip task-chip-note" onClick={() => onNavigateNote(chip.id)}>
                {chip.label}
              </button>
            ) : (
              <a key={i} className="task-chip task-chip-url" href={chip.href} target="_blank" rel="noopener noreferrer">
                {chip.label}
              </a>
            )
          )}
        </div>
      </div>
      <div className="task-actions">
        {compact && (
          <button className="task-undo" onClick={onToggle} title="Undo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
        )}
        <button className="task-edit" onClick={onEdit} title="Edit task">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button className="task-delete" onClick={onDelete} title="Delete task">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${period}` : `${h12}:${m.toString().padStart(2, "0")}${period}`;
}

type Chip =
  | { kind: "note"; label: string; id: string }
  | { kind: "url"; label: string; href: string };

const MD_LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/g;

function extractChips(text: string): { title: string; chips: Chip[] } {
  const chips: Chip[] = [];
  let title = "";
  let lastEnd = 0;

  MD_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MD_LINK_RE.exec(text)) !== null) {
    title += text.slice(lastEnd, m.index);
    const [, label, target] = m;
    const noteMatch = target.match(/^scratch:\/\/(.+)$/);
    if (noteMatch) {
      chips.push({ kind: "note", label: label || "note", id: noteMatch[1] });
    } else if (/^https?:\/\//i.test(target)) {
      const host = target.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.replace(/^www\./i, "") ?? target;
      chips.push({ kind: "url", label: host, href: target });
    } else {
      title += m[0];
    }
    lastEnd = m.index + m[0].length;
  }
  title += text.slice(lastEnd);
  title = title.replace(/\s+/g, " ").trim().replace(/[\s]*[-–—:·•]+$/, "").trim();

  return { title, chips };
}
