export type Priority = "high" | "med" | "low";

export type RecurrenceUnit = "d" | "w" | "m" | "y";
export type Recurrence = { every: number; unit: RecurrenceUnit };

export type Task = {
  text: string;
  date: string | null;
  time: number | null;
  priority: Priority | null;
  recurrence: Recurrence | null;
  done: boolean;
};

export type TaskDoc = Array<
  | { kind: "task"; task: Task }
  | { kind: "raw"; text: string }
>;

const TASK_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$/;
const PRIORITY_TOKEN_RE = /(?:^|\s)(!(?:high|med|low))(?=\s|$)/g;
const DATE_TOKEN_RE = /(?:^|\s)(!(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?)(?=\s|$)/g;
const RECURRENCE_TOKEN_RE = /(?:^|\s)(!every:(\d+)([dwmy]))(?=\s|$)/g;

export function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function addDays(base: Date, days: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

export function formatDateToken(date: string | null, time: number | null): string {
  if (!date) return "";
  if (time === null) return `!${date}`;
  const hh = pad2(Math.floor(time / 60));
  const mm = pad2(time % 60);
  return `!${date}T${hh}:${mm}`;
}

export function formatRecurrenceToken(r: Recurrence | null): string {
  if (!r) return "";
  return `!every:${r.every}${r.unit}`;
}

function tokenSuffix(task: Task): string {
  const parts: string[] = [];
  if (task.priority) parts.push(`!${task.priority}`);
  const date = formatDateToken(task.date, task.time);
  if (date) parts.push(date);
  const rec = formatRecurrenceToken(task.recurrence);
  if (rec) parts.push(rec);
  return parts.length ? " " + parts.join(" ") : "";
}

function parseTaskLine(line: string): Task | null {
  const m = line.match(TASK_LINE_RE);
  if (!m) return null;
  const done = m[2] !== " ";
  let content = m[4];

  let priority: Priority | null = null;
  let date: string | null = null;
  let time: number | null = null;
  let recurrence: Recurrence | null = null;

  let pm: RegExpExecArray | null;
  PRIORITY_TOKEN_RE.lastIndex = 0;
  const priorityHits: Array<[number, number, Priority]> = [];
  while ((pm = PRIORITY_TOKEN_RE.exec(content)) !== null) {
    const tok = pm[1];
    const start = pm.index + pm[0].indexOf(tok);
    priorityHits.push([start, start + tok.length, tok.slice(1) as Priority]);
  }

  DATE_TOKEN_RE.lastIndex = 0;
  let dm: RegExpExecArray | null;
  const dateHits: Array<[number, number]> = [];
  while ((dm = DATE_TOKEN_RE.exec(content)) !== null) {
    const tok = dm[1];
    const y = Number(dm[2]);
    const mo = Number(dm[3]);
    const d = Number(dm[4]);
    if (!isValidDate(y, mo, d)) continue;
    let t: number | null = null;
    if (dm[5] !== undefined) {
      const hh = Number(dm[5]);
      const mm = Number(dm[6]);
      if (hh > 23 || mm > 59) continue;
      t = hh * 60 + mm;
    }
    const start = dm.index + dm[0].indexOf(tok);
    dateHits.push([start, start + tok.length]);
    date = `${dm[2]}-${dm[3]}-${dm[4]}`;
    time = t;
  }

  RECURRENCE_TOKEN_RE.lastIndex = 0;
  let rm: RegExpExecArray | null;
  const recurrenceHits: Array<[number, number]> = [];
  while ((rm = RECURRENCE_TOKEN_RE.exec(content)) !== null) {
    const tok = rm[1];
    const start = rm.index + rm[0].indexOf(tok);
    recurrenceHits.push([start, start + tok.length]);
    recurrence = { every: Number(rm[2]), unit: rm[3] as RecurrenceUnit };
  }

  if (priorityHits.length) priority = priorityHits[priorityHits.length - 1][2];

  const spans = [
    ...priorityHits.map(([s, e]) => [s, e] as [number, number]),
    ...dateHits,
    ...recurrenceHits,
  ].sort((a, b) => b[0] - a[0]);
  for (const [s, e] of spans) content = content.slice(0, s) + content.slice(e);

  const text = content.replace(/\s+/g, " ").trim();
  return { text, date, time, priority, recurrence, done };
}

export function parseTaskDoc(body: string): TaskDoc {
  if (body === "") return [];
  return body.split("\n").map((line) => {
    const task = parseTaskLine(line);
    return task ? { kind: "task" as const, task } : { kind: "raw" as const, text: line };
  });
}

export function serializeTask(task: Task): string {
  const box = task.done ? "[x]" : "[ ]";
  return `- ${box} ${task.text}${tokenSuffix(task)}`;
}

export function serializeTaskDoc(doc: TaskDoc): string {
  return doc.map((item) => (item.kind === "task" ? serializeTask(item.task) : item.text)).join("\n");
}

export function tasksOf(doc: TaskDoc): Task[] {
  return doc.flatMap((item) => (item.kind === "task" ? [item.task] : []));
}

export function sortForAgenda(tasks: Task[]): Task[] {
  const rank: Record<Priority, number> = { high: 0, med: 1, low: 2 };
  return tasks
    .map((t, i) => [t, i] as const)
    .sort(([a, ai], [b, bi]) => {
      const at = a.time ?? -1;
      const bt = b.time ?? -1;
      if (at !== bt) {
        if (at === -1) return -1;
        if (bt === -1) return 1;
        return at - bt;
      }
      const ap = a.priority ? rank[a.priority] : 3;
      const bp = b.priority ? rank[b.priority] : 3;
      if (ap !== bp) return ap - bp;
      return ai - bi;
    })
    .map(([t]) => t);
}

export function advanceDate(date: string, recurrence: Recurrence): string {
  const [y, m, d] = date.split("-").map(Number);
  let next: Date;
  switch (recurrence.unit) {
    case "d":
      next = new Date(y, m - 1, d + recurrence.every);
      break;
    case "w":
      next = new Date(y, m - 1, d + recurrence.every * 7);
      break;
    case "m": {
      next = new Date(y, m - 1 + recurrence.every, d);
      const expectedMonth = (m - 1 + recurrence.every) % 12;
      if (next.getMonth() !== expectedMonth) {
        next = new Date(next.getFullYear(), expectedMonth + 1, 0);
      }
      break;
    }
    case "y": {
      next = new Date(y + recurrence.every, m - 1, d);
      if (next.getMonth() !== m - 1) {
        next = new Date(y + recurrence.every, m, 0);
      }
      break;
    }
  }
  return `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`;
}

const UNIT_LABELS: Record<string, [string, string]> = {
  d: ["day", "days"],
  w: ["week", "weeks"],
  m: ["month", "months"],
  y: ["year", "years"],
};

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${period}` : `${h12}:${pad2(m)}${period}`;
}

export function formatRecurrence(r: Recurrence): string {
  const [singular, plural] = UNIT_LABELS[r.unit];
  return r.every === 1 ? `every ${singular}` : `every ${r.every} ${plural}`;
}

export function mapTask(
  doc: TaskDoc,
  cid: string,
  fn: (task: Task) => Task | null,
): TaskDoc {
  let idx = 0;
  const result: TaskDoc = [];
  for (const item of doc) {
    if (item.kind !== "task") { result.push(item); continue; }
    const thisCid = `t${idx++}`;
    if (thisCid !== cid) { result.push(item); continue; }
    const updated = fn(item.task);
    if (updated) result.push({ kind: "task", task: updated });
  }
  return result;
}

export const TASK_CODEX = "Tasks";
