import type { Recurrence, RecurrenceUnit } from "./taskList";

export type ParsedInput = {
  text: string;
  date: string | null;
  time: number | null;
  recurrence: Recurrence | null;
};

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function parseTime(token: string): number | null {
  const t = token.toLowerCase();
  if (t === "noon") return 12 * 60;
  if (t === "midnight") return 0;
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/) || t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = m[2] !== undefined && m[2] !== "am" && m[2] !== "pm" ? Number(m[2]) : 0;
  const mer = t.endsWith("am") ? "am" : t.endsWith("pm") ? "pm" : null;
  if (mer) {
    if (hh < 1 || hh > 12) return null;
    if (hh === 12) hh = 0;
    if (mer === "pm") hh += 12;
  } else {
    if (hh > 23) return null;
  }
  if (mm > 59) return null;
  return hh * 60 + mm;
}

function matchDatePhrase(
  words: string[],
  now: Date,
): { date: string; consumed: number } | null {
  const w = words[0];
  if (!w) return null;

  if (w === "today") return { date: ymd(now), consumed: 1 };
  if (w === "tomorrow" || w === "tmrw" || w === "tom") return { date: ymd(addDays(now, 1)), consumed: 1 };
  if (w === "yesterday") return { date: ymd(addDays(now, -1)), consumed: 1 };

  if (w === "in" && words[1] && words[2]) {
    const num = Number(words[1]);
    const unit = words[2];
    if (Number.isInteger(num) && num > 0) {
      if (unit === "day" || unit === "days") return { date: ymd(addDays(now, num)), consumed: 3 };
      if (unit === "week" || unit === "weeks") return { date: ymd(addDays(now, num * 7)), consumed: 3 };
    }
  }

  if (w === "next" && words[1]) {
    const wd = WEEKDAYS[words[1]];
    if (wd !== undefined) {
      const thisWeek = (wd - now.getDay() + 7) % 7 || 7;
      return { date: ymd(addDays(now, thisWeek + 7)), consumed: 2 };
    }
    if (words[1] === "week") return { date: ymd(addDays(now, 7)), consumed: 2 };
  }

  if (WEEKDAYS[w] !== undefined) {
    let delta = (WEEKDAYS[w] - now.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    return { date: ymd(addDays(now, delta)), consumed: 1 };
  }

  if (MONTHS[w] !== undefined && words[1]) {
    const day = Number(words[1].replace(/(st|nd|rd|th)$/, ""));
    if (Number.isInteger(day) && day >= 1 && day <= 31) {
      const month = MONTHS[w];
      let year = now.getFullYear();
      let consumed = 2;
      if (words[2] && /^\d{4}$/.test(words[2])) {
        year = Number(words[2]);
        consumed = 3;
      } else {
        const candidate = new Date(year, month - 1, day);
        const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (candidate < todayMid) year += 1;
      }
      const d = new Date(year, month - 1, day);
      if (d.getMonth() + 1 === month && d.getDate() === day) {
        return { date: ymd(d), consumed };
      }
    }
  }

  const iso = w.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]);
    const da = Number(iso[3]);
    const d = new Date(y, mo - 1, da);
    if (d.getFullYear() === y && d.getMonth() + 1 === mo && d.getDate() === da) {
      return { date: `${y}-${pad2(mo)}-${pad2(da)}`, consumed: 1 };
    }
  }

  const mdy = w.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (mdy) {
    const mo = Number(mdy[1]);
    const da = Number(mdy[2]);
    const y = Number(mdy[3]);
    const d = new Date(y, mo - 1, da);
    if (d.getFullYear() === y && d.getMonth() + 1 === mo && d.getDate() === da) {
      return { date: `${y}-${pad2(mo)}-${pad2(da)}`, consumed: 1 };
    }
  }

  return null;
}

type Token = { text: string; lower: string; start: number; end: number };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    tokens.push({
      text: m[0],
      lower: m[0].toLowerCase(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return tokens;
}

const RECURRENCE_UNITS: Record<string, RecurrenceUnit> = {
  day: "d", days: "d",
  week: "w", weeks: "w",
  month: "m", months: "m",
  year: "y", years: "y",
};

const SINGLE_WORD_RECURRENCE: Record<string, Recurrence> = {
  daily: { every: 1, unit: "d" },
  weekly: { every: 1, unit: "w" },
  monthly: { every: 1, unit: "m" },
  yearly: { every: 1, unit: "y" },
  annually: { every: 1, unit: "y" },
  biweekly: { every: 2, unit: "w" },
  bimonthly: { every: 2, unit: "m" },
};

function matchRecurrence(
  words: string[],
  now: Date,
): { recurrence: Recurrence; consumed: number; impliedDate?: string } | null {
  // Single-word: "daily", "weekly", "biweekly", etc.
  if (SINGLE_WORD_RECURRENCE[words[0]]) {
    return { recurrence: SINGLE_WORD_RECURRENCE[words[0]], consumed: 1 };
  }

  if (words[0] !== "every") return null;

  // "every other day/week/month/year" = every 2 units
  if (words[1] === "other" && words[2] && RECURRENCE_UNITS[words[2]]) {
    return { recurrence: { every: 2, unit: RECURRENCE_UNITS[words[2]] }, consumed: 3 };
  }

  // "every day/week/month/year" = every 1 unit
  if (words[1] && RECURRENCE_UNITS[words[1]]) {
    return { recurrence: { every: 1, unit: RECURRENCE_UNITS[words[1]] }, consumed: 2 };
  }

  // "every monday/weds/friday/..." = every 1 week, start on next occurrence
  if (words[1] && WEEKDAYS[words[1]] !== undefined) {
    const wd = WEEKDAYS[words[1]];
    let delta = (wd - now.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    return { recurrence: { every: 1, unit: "w" }, consumed: 2, impliedDate: ymd(addDays(now, delta)) };
  }

  // "every jul 30" / "every december 25th" = every 1 year, start on next occurrence
  if (words[1] && MONTHS[words[1]] !== undefined && words[2]) {
    const day = Number(words[2].replace(/(st|nd|rd|th)$/, ""));
    if (Number.isInteger(day) && day >= 1 && day <= 31) {
      const month = MONTHS[words[1]];
      let year = now.getFullYear();
      const candidate = new Date(year, month - 1, day);
      const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (candidate <= todayMid) year += 1;
      const d = new Date(year, month - 1, day);
      if (d.getMonth() + 1 === month && d.getDate() === day) {
        return { recurrence: { every: 1, unit: "y" }, consumed: 3, impliedDate: ymd(d) };
      }
      return { recurrence: { every: 1, unit: "y" }, consumed: 3 };
    }
  }

  // "every N days/weeks/months/years"
  if (words[1] && words[2]) {
    const num = Number(words[1]);
    if (Number.isInteger(num) && num > 0 && RECURRENCE_UNITS[words[2]]) {
      return { recurrence: { every: num, unit: RECURRENCE_UNITS[words[2]] }, consumed: 3 };
    }
  }

  return null;
}

type Kind = "none" | "date" | "time" | "recurrence";

function analyze(
  input: string,
  now: Date,
  opts?: { allowBareTime?: boolean },
): { tokens: Token[]; kind: Kind[]; date: string | null; time: number | null; recurrence: Recurrence | null } {
  const tokens = tokenize(input);
  const lower = tokens.map((t) => t.lower);
  const kind: Kind[] = new Array(tokens.length).fill("none");

  let date: string | null = null;
  let time: number | null = null;
  let recurrence: Recurrence | null = null;

  for (let i = 0; i < tokens.length && date === null; i++) {
    const hit = matchDatePhrase(lower.slice(i), now);
    if (hit) {
      date = hit.date;
      for (let k = 0; k < hit.consumed; k++) kind[i + k] = "date";
    }
  }

  let timeIndex = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (kind[i] !== "none") continue;
    const t = parseTime(lower[i]);
    if (t !== null) {
      time = t;
      timeIndex = i;
      kind[i] = "time";
      break;
    }
  }

  if (time !== null && date === null && !opts?.allowBareTime) {
    time = null;
    if (timeIndex >= 0) kind[timeIndex] = "none";
  }

  for (let i = 0; i < tokens.length && recurrence === null; i++) {
    if (kind[i] !== "none") continue;
    const hit = matchRecurrence(lower.slice(i), now);
    if (hit) {
      recurrence = hit.recurrence;
      for (let k = 0; k < hit.consumed; k++) {
        if (kind[i + k] === "date") date = null;
        kind[i + k] = "recurrence";
      }
      if (hit.impliedDate && date === null) date = hit.impliedDate;
    }
  }

  return { tokens, kind, date, time, recurrence };
}

export function parseTaskInput(input: string, now: Date = new Date()): ParsedInput {
  const { tokens, kind, date, time, recurrence } = analyze(input, now);
  if (tokens.length === 0) return { text: "", date: null, time: null, recurrence: null };

  const text = tokens
    .filter((_, i) => kind[i] === "none")
    .map((t) => t.text)
    .join(" ")
    .trim();
  return { text: text || input.trim(), date, time: date ? time : null, recurrence };
}

export type Recognition = {
  date: string | null;
  time: number | null;
  recurrence: Recurrence | null;
  dateSpans: Array<[number, number]>;
  timeSpans: Array<[number, number]>;
  recurrenceSpans: Array<[number, number]>;
};

export function recognize(input: string, now: Date = new Date(), opts?: { allowBareTime?: boolean }): Recognition {
  const { tokens, kind, date, time, recurrence } = analyze(input, now, opts);
  const dateSpans: Array<[number, number]> = [];
  const timeSpans: Array<[number, number]> = [];
  const recurrenceSpans: Array<[number, number]> = [];

  let i = 0;
  while (i < tokens.length) {
    if (kind[i] === "date") {
      const start = tokens[i].start;
      let end = tokens[i].end;
      let j = i + 1;
      while (j < tokens.length && kind[j] === "date") { end = tokens[j].end; j++; }
      dateSpans.push([start, end]);
      i = j;
    } else if (kind[i] === "recurrence") {
      const start = tokens[i].start;
      let end = tokens[i].end;
      let j = i + 1;
      while (j < tokens.length && kind[j] === "recurrence") { end = tokens[j].end; j++; }
      recurrenceSpans.push([start, end]);
      i = j;
    } else { i++; }
  }
  for (let k = 0; k < tokens.length; k++) {
    if (kind[k] === "time") timeSpans.push([tokens[k].start, tokens[k].end]);
  }

  return { date, time, recurrence, dateSpans, timeSpans, recurrenceSpans };
}
