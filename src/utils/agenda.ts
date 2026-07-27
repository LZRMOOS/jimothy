import type { Task } from "./taskList";
import { sortForAgenda } from "./taskList";

export type IdTask = Task & { cid: string };

export type AgendaSection = {
  date: string;
  title: string;
  tasks: IdTask[];
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function dayTitle(date: string, todayYmd: string): string {
  if (date === todayYmd) return "Today";
  const d = fromYmd(date);
  const today = fromYmd(todayYmd);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const base = `${WEEKDAY[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() !== today.getFullYear() ? `${base}, ${d.getFullYear()}` : base;
}

export function buildAgenda(
  tasks: IdTask[],
  opts: { today: string; daysAhead: number },
): AgendaSection[] {
  const active = tasks.filter((t) => !t.done);

  const byDate = new Map<string, IdTask[]>();
  for (const t of active) {
    const key = t.date === null || t.date < opts.today ? opts.today : t.date;
    const arr = byDate.get(key);
    if (arr) arr.push(t);
    else byDate.set(key, [t]);
  }

  const windowDays = new Set<string>();
  const base = fromYmd(opts.today);
  for (let i = 0; i <= opts.daysAhead; i++) windowDays.add(ymd(addDays(base, i)));
  for (const key of byDate.keys()) windowDays.add(key);

  const dayKeys = [...windowDays].sort();

  const sections: AgendaSection[] = [];
  for (const key of dayKeys) {
    sections.push({
      date: key,
      title: dayTitle(key, opts.today),
      tasks: sortForAgenda(byDate.get(key) ?? []) as IdTask[],
    });
  }
  return sections;
}

export function buildDoneList(
  tasks: IdTask[],
  opts?: { maxSections?: number },
): AgendaSection[] {
  const done = tasks.filter((t) => t.done);

  const byDate = new Map<string, IdTask[]>();
  for (const t of done) {
    const key = t.date ?? "undated";
    const arr = byDate.get(key);
    if (arr) arr.push(t);
    else byDate.set(key, [t]);
  }

  const dayKeys = [...byDate.keys()].sort().reverse();
  const todayStr = ymd(new Date());
  const limit = opts?.maxSections ?? dayKeys.length;

  const sections: AgendaSection[] = [];
  for (const key of dayKeys.slice(0, limit)) {
    sections.push({
      date: key,
      title: key === "undated" ? "Undated" : dayTitle(key, todayStr),
      tasks: byDate.get(key) ?? [],
    });
  }
  return sections;
}
