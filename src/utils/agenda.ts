import type { Task, CalendarEvent } from "./taskList";
import { sortForAgenda, ymd, addDays } from "./taskList";

export { ymd } from "./taskList";

export type IdTask = Task & { cid: string };
export type IdEvent = CalendarEvent & { cid: string };

export type AgendaSection = {
  date: string;
  title: string;
  tasks: IdTask[];
  events: IdEvent[];
};

export function fromYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
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
  events: IdEvent[],
  opts: { today: string; daysAhead: number },
): AgendaSection[] {
  const active = tasks.filter((t) => !t.done);

  const tasksByDate = new Map<string, IdTask[]>();
  for (const t of active) {
    const key = t.date === null || t.date < opts.today ? opts.today : t.date;
    const arr = tasksByDate.get(key);
    if (arr) arr.push(t);
    else tasksByDate.set(key, [t]);
  }

  const eventsByDate = new Map<string, IdEvent[]>();
  for (const e of events) {
    // Skip events in the past - they should disappear after their date
    if (e.date < opts.today) continue;
    const arr = eventsByDate.get(e.date);
    if (arr) arr.push(e);
    else eventsByDate.set(e.date, [e]);
  }

  const windowDays = new Set<string>();
  const base = fromYmd(opts.today);
  for (let i = 0; i <= opts.daysAhead; i++) windowDays.add(ymd(addDays(base, i)));
  for (const key of tasksByDate.keys()) windowDays.add(key);
  for (const key of eventsByDate.keys()) windowDays.add(key);

  const dayKeys = [...windowDays].sort();

  const sections: AgendaSection[] = [];
  for (const key of dayKeys) {
    const dayTasks = tasksByDate.get(key) ?? [];
    const dayEvents = eventsByDate.get(key) ?? [];
    // Sort events by start time
    const sortedEvents = dayEvents.sort((a, b) => a.startTime - b.startTime);

    sections.push({
      date: key,
      title: dayTitle(key, opts.today),
      tasks: sortForAgenda(dayTasks) as IdTask[],
      events: sortedEvents,
    });
  }
  return sections;
}

export function buildDoneList(
  tasks: IdTask[],
  opts: { today: string; maxSections?: number },
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
  const limit = opts.maxSections ?? dayKeys.length;

  const sections: AgendaSection[] = [];
  for (const key of dayKeys.slice(0, limit)) {
    sections.push({
      date: key,
      title: key === "undated" ? "Undated" : dayTitle(key, opts.today),
      tasks: byDate.get(key) ?? [],
      events: [], // No events in done list
    });
  }
  return sections;
}
