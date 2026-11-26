// Time phrases (backlog P07): "last Saturday", "two weeks ago", "in March" resolved to day ranges against a reference
// day, with no model and no library. The same resolver reads a question against its own date and a user turn against
// its session's date, so "I planted them yesterday" said on 04/21 dates the planting 04/20.

/** Inclusive range in whole days since 1970-01-01 (UTC), plus the words that named it. */
export interface DayRange {
  from: number;
  to: number;
  phrase: string;
}

/** Day number of a date as sources write it: "2023/05/20 (Sat) 10:19", "2023-05-20". */
export function dayOf(date: string | undefined): number | undefined {
  const m = date?.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) / DAY : undefined;
}

const DAY = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, few: 3 };
const NUM = `(\\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a couple of|a few)`;
// How far each unit reaches, and how loose "about N of them ago" is.
const UNIT: Record<string, { days: number; slack: number }> = { day: { days: 1, slack: 1 }, week: { days: 7, slack: 3 }, month: { days: 30, slack: 10 } };
const MONTH = `(${MONTHS.join("|")})`;

const num = (s: string) => NUMBERS[s.replace(/^a (couple of|few)$/, "$1")] ?? Number(s);
const weekday = (day: number) => (day + 4) % 7; // 1970-01-01 was a Thursday
const parts = (day: number) => new Date(day * DAY);
const utc = (y: number, m: number, d: number) => Date.UTC(y, m, d) / DAY;

/** The most recent year in which month m (and day d) falls on or before the reference day. */
function latestYear(today: number, m: number, d = 1): number {
  const y = parts(today).getUTCFullYear();
  return utc(y, m, d) <= today ? y : y - 1;
}

// shortcut: English only and the common shapes; "the week before Easter" or "next month" go unread. Widen from real misses.
const RULES: { re: RegExp; range: (m: RegExpMatchArray, today: number) => [number, number] | undefined }[] = [
  { re: /\byesterday\b/g, range: (_, t) => [t - 1, t - 1] },
  {
    re: new RegExp(`\\b${NUM} (day|week|month)s? ago\\b`, "g"),
    range: (m, t) => {
      const u = UNIT[m[2]!]!;
      const at = t - num(m[1]!) * u.days;
      return [at - u.slack, at + u.slack];
    },
  },
  {
    re: new RegExp(`\\b(?:the )?(?:last|past) ${NUM} (day|week|month)s?\\b`, "g"),
    range: (m, t) => [t - num(m[1]!) * UNIT[m[2]!]!.days, t],
  },
  {
    re: /\blast (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g,
    range: (m, t) => {
      const back = (weekday(t) - WEEKDAYS.indexOf(m[1]!) + 7) % 7 || 7;
      return [t - back, t - back];
    },
  },
  {
    re: /\b(?:last|this past) weekend\b/g,
    range: (_, t) => {
      const sat = t - ((weekday(t) - 6 + 7) % 7 || 7);
      return [sat, sat + 1];
    },
  },
  {
    re: /\blast week\b/g,
    range: (_, t) => {
      const monday = t - ((weekday(t) + 6) % 7);
      return [monday - 7, monday - 1];
    },
  },
  {
    re: /\blast month\b/g,
    range: (_, t) => {
      const d = parts(t);
      return [utc(d.getUTCFullYear(), d.getUTCMonth() - 1, 1), utc(d.getUTCFullYear(), d.getUTCMonth(), 0)];
    },
  },
  {
    // "May" alone is usually the verb, so a month name counts only after a preposition or before a day number.
    re: new RegExp(`\\b(in|during|since|early|mid|late|last) ${MONTH}\\b`, "g"),
    range: (m, t) => {
      const mo = MONTHS.indexOf(m[2]!);
      const y = latestYear(t, mo);
      return m[1] === "since" ? [utc(y, mo, 1), t] : [utc(y, mo, 1), utc(y, mo + 1, 0)];
    },
  },
  {
    re: new RegExp(`\\b${MONTH} (\\d{1,2})(?:st|nd|rd|th)?\\b`, "g"),
    range: (m, t) => {
      const mo = MONTHS.indexOf(m[1]!);
      const d = +m[2]!;
      if (d < 1 || d > 31) return undefined;
      const at = utc(latestYear(t, mo, d), mo, d);
      return [at, at];
    },
  },
];

/** Every time phrase in the text, resolved against the reference day. */
export function timeRanges(text: string, today: number): DayRange[] {
  const lower = text.toLowerCase();
  const out: DayRange[] = [];
  for (const { re, range } of RULES) {
    for (const m of lower.matchAll(re)) {
      const r = range(m, today);
      if (r) out.push({ from: r[0], to: r[1], phrase: m[0] });
    }
  }
  return out;
}

export const overlaps = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from <= b.to && b.from <= a.to;
