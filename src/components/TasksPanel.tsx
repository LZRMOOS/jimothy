import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { Note } from "../types";
import {
  parseTaskDoc,
  serializeTaskDoc,
  serializeTask,
  TASK_CODEX,
  type Task,
  type TaskDoc,
} from "../utils/taskList";
import { buildAgenda, buildDoneList, ymd, dayTitle, type IdTask } from "../utils/agenda";
import { parseTaskInput, recognize, type Recognition } from "../utils/naturalDate";

type Props = {
  notes: Note[];
  onSave: (id: string, title: string, body: string, codex: string | null) => void;
  onCreate: (title: string, codex: string) => Promise<Note | null>;
  onNavigateNote: (id: string) => void;
};

export function TasksPanel({ notes, onSave, onCreate, onNavigateNote }: Props) {
  const [tab, setTab] = useState<"active" | "done">("active");
  const [addInput, setAddInput] = useState("");
  const [focusedDay, setFocusedDay] = useState<string | null>(null);
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

  const recognition = useMemo<Recognition>(
    () => recognize(addInput),
    [addInput]
  );

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

  const handleAdd = useCallback(async () => {
    const raw = addInput.trim();
    if (!raw) return;

    const parsed = parseTaskInput(raw);
    const newTask: Task = {
      text: parsed.text,
      date: parsed.date,
      time: parsed.time,
      priority: null,
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
    addInputRef.current?.focus();
  }, [addInput, taskNote, onSave, onCreate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAdd();
    }
  };

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

      {tab === "active" && (
        <div className="tasks-add">
          <div className="tasks-add-field">
            <input
              ref={addInputRef}
              className="tasks-add-input"
              type="text"
              placeholder="Add a task... (e.g. &quot;Call dentist tomorrow 9am&quot;)"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {(recognition.date || recognition.time !== null) && (
              <div className="tasks-add-pills">
                {recognition.date && (
                  <span className="tasks-add-pill tasks-add-pill-date">
                    {recognition.date}
                  </span>
                )}
                {recognition.time !== null && (
                  <span className="tasks-add-pill tasks-add-pill-time">
                    {formatTime(recognition.time)}
                  </span>
                )}
              </div>
            )}
          </div>
          <button className="tasks-add-btn" onClick={handleAdd} disabled={!addInput.trim()}>
            Add
          </button>
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
              <div className="tasks-section-header">
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
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
  onNavigateNote,
}: {
  task: IdTask;
  onToggle: () => void;
  onDelete: () => void;
  onNavigateNote: (id: string) => void;
}) {
  const { title, chips } = useMemo(() => extractChips(task.text), [task.text]);

  return (
    <div className={`task-row ${task.done ? "task-done" : ""}`}>
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
