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
  onSave: (id: string, title: string, body: string, codex: string | null) => void;
  onCreate: (title: string, codex: string) => Promise<Note | null>;
  onNavigateNote: (id: string) => void;
};

export function TasksPanel({ notes, onSave, onCreate, onNavigateNote }: Props) {
  const [tab, setTab] = useState<"active" | "done">("active");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addPriority, setAddPriority] = useState<Priority | null>(null);
  const [schedDate, setSchedDate] = useState<{ value: string; label: string; phrase: string } | null>(null);
  const [schedTime, setSchedTime] = useState<{ value: number; label: string; phrase: string } | null>(null);
  const [focusedDay, setFocusedDay] = useState<string | null>(null);
  const [dragCid, setDragCid] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ cid: string; position: "before" | "after" } | null>(null);
  const [dropSectionDate, setDropSectionDate] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
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

  const activeSections = useMemo(
    () => buildAgenda(allTasks, { today, daysAhead: 30 }),
    [allTasks, today]
  );

  const doneSections = useMemo(() => buildDoneList(allTasks), [allTasks]);

  const onDraftChange = useCallback(
    (next: string) => {
      const justCompletedWord = next.length > addInput.length && /\s$/.test(next);
      if (!justCompletedWord) {
        setAddInput(next);
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
    [addInput, schedDate, schedTime, today]
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

  const handleAdd = useCallback(async () => {
    const text = addInput.trim();
    if (!text) return;

    const date = schedDate?.value ?? focusedDay ?? null;
    const time = schedTime?.value ?? null;
    const newTask: Task = {
      text,
      date,
      time,
      priority: addPriority,
      done: false,
    };
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

    setAddInput("");
    setAddPriority(null);
    setSchedDate(null);
    setSchedTime(null);
    setShowAddModal(false);
  }, [addInput, addPriority, schedDate, schedTime, focusedDay, taskNote, onSave, onCreate]);

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
  }, []);

  useEffect(() => {
    if (sections.length > 0 && !focusedDay) {
      setFocusedDay(sections[0].date);
    }
  }, [sections, focusedDay]);

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
      <div className="tasks-header">
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
        <div className="tasks-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="tasks-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tasks-modal-header">
              <div className="tasks-modal-title-row">
                <span className="tasks-modal-title">
                  {schedDate ? "Add to" : `Add to ${focusLabel || "Today"}`}
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
              <button className="tasks-modal-close" onClick={() => setShowAddModal(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <input
              ref={addInputRef}
              className="tasks-modal-input"
              type="text"
              placeholder="e.g. Call dentist tomorrow 9am"
              value={addInput}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } if (e.key === "Escape") setShowAddModal(false); }}
              autoFocus
            />
            <div className="tasks-modal-actions">
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
              <button className="tasks-modal-submit" onClick={handleAdd} disabled={!addInput.trim()}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {focusLabel && tab === "active" && !isEmpty && (
        <div className="tasks-focus-bar">
          <div className="tasks-focus-accent" />
          <div className="tasks-focus-text">
            <span className="tasks-focus-eyebrow">IN FOCUS</span>
            <span className="tasks-focus-day">
              {focusLabel}
              {focusCount > 0 && <span className="tasks-focus-count">{focusCount}</span>}
            </span>
          </div>
        </div>
      )}

      <div className="tasks-list" ref={listRef} onScroll={handleScroll}>
        {isEmpty && tab === "active" && (
          <div className="tasks-empty">No tasks yet. Add one above.</div>
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
                  onToggle={() => toggleDone(task.cid)}
                  onDelete={() => deleteTask(task.cid)}
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
        <button className="tasks-fab" onClick={() => { setAddInput(""); setAddPriority(null); setSchedDate(null); setSchedTime(null); setShowAddModal(true); }}>
          + New
        </button>
      )}
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
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
  onToggle: () => void;
  onDelete: () => void;
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
      className={`task-row ${task.done ? "task-done" : ""} ${isDragging ? "task-dragging" : ""} ${dropIndicator ? `task-drop-${dropIndicator}` : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
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
      <button className="task-delete" onClick={onDelete} title="Delete task">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
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
