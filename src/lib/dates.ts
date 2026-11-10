/**
 * Date handling in the seller's time zone (Asia/Kolkata).
 *
 * The model is bad at calendar arithmetic ("next Monday" on Tue 10 Nov 2026
 * became "Monday 14 November"), so tools take the seller's own words
 * ("next Monday", "in a week", "20 November", "bees tareekh") and resolve
 * them here, against the real current date. Priya then speaks the returned
 * date exactly.
 */
export const TIME_ZONE = "Asia/Kolkata";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Calendar day as a UTC-midnight Date (pure date arithmetic, no DST issues). */
function dayUtc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

/** Today's calendar date in Asia/Kolkata, as a UTC-midnight Date. */
export function todayInIndia(nowIso: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(nowIso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return dayUtc(get("year"), get("month") - 1, get("day"));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

export const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** "Monday, 16 November" */
export function spokenDate(d: Date): string {
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Today's IST date as YYYY-MM-DD. */
export function todayIso(nowIso: string): string {
  return toIsoDate(todayInIndia(nowIso));
}

export interface ResolvedDate {
  /** YYYY-MM-DD */
  iso: string;
  weekday: string;
  /** e.g. "Monday, 16 November", what Priya should say */
  spoken: string;
  days_from_today: number;
}

function resolved(d: Date, today: Date): ResolvedDate {
  return {
    iso: toIsoDate(d),
    weekday: WEEKDAYS[d.getUTCDay()],
    spoken: spokenDate(d),
    days_from_today: Math.round((d.getTime() - today.getTime()) / 86_400_000),
  };
}

// Weekday names: English, short English, Hindi (Latin + Devanagari).
const WEEKDAY_WORDS: [RegExp, number][] = [
  [/\b(sunday|ravivar|raviwar|itvaar|itwar|etwaar)\b|रविवार|इतवार/, 0],
  [/\b(monday|mon|somvar|somwar|somvaar)\b|सोमवार/, 1],
  [/\b(tuesday|tue|tues|mangalvar|mangalwar)\b|मंगलवार/, 2],
  [/\b(wednesday|wed|budhvar|budhwar)\b|बुधवार/, 3],
  [/\b(thursday|thu|thurs|guruvar|guruwar|brihaspativar|veervar|virvar)\b|गुरुवार|बृहस्पतिवार/, 4],
  [/\b(friday|fri|shukravar|shukrawar)\b|शुक्रवार/, 5],
  [/\b(saturday|sat|shanivar|shaniwar)\b|शनिवार/, 6],
];

const MONTH_WORDS: [RegExp, number][] = MONTHS.map((m, i) => [new RegExp(`\\b${m.slice(0, 3).toLowerCase()}[a-z]*\\b`), i]);

// Hindi/Hinglish number words seen in dates ("bees tareekh").
const HINDI_NUMBERS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8, nau: 9, das: 10,
  gyarah: 11, barah: 12, baarah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnis: 19,
  bees: 20, bis: 20, ikkis: 21, baees: 22, bais: 22, teis: 23, chaubis: 24, pachis: 25, pachchis: 25, chhabbis: 26,
  sattais: 27, satais: 27, atthais: 28, unatis: 29, tees: 30, ikattis: 31, ektees: 31,
};
const ENGLISH_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
};

function numberWord(w: string): number | null {
  if (/^\d+$/.test(w)) return Number(w);
  return HINDI_NUMBERS[w] ?? ENGLISH_NUMBERS[w] ?? null;
}

/** Next date (strictly after today) with this day-of-month, in this or next month(s). */
function nextDayOfMonth(today: Date, day: number, month?: number): Date | null {
  if (day < 1 || day > 31) return null;
  const y = today.getUTCFullYear();
  if (month !== undefined) {
    if (month < 0 || month > 11) return null;
    for (const year of [y, y + 1]) {
      const c = dayUtc(year, month, day);
      if (c.getUTCDate() !== day) return null; // e.g. 31 November
      if (c.getTime() >= today.getTime()) return c;
    }
    return null;
  }
  for (let i = 0; i < 13; i++) {
    const c = dayUtc(y, today.getUTCMonth() + i, day); // Date.UTC rolls months over into next year
    if (c.getUTCDate() === day && c.getTime() >= today.getTime()) return c;
  }
  return null;
}

/**
 * Resolve a date the way the seller said it. Returns null if it can't be
 * understood, so the caller can ask the seller instead of guessing.
 * Supports: YYYY-MM-DD, "today/aaj", "tomorrow/kal", "parso", "in N days",
 * "N din baad", "in a week / ek hafte", "next week", weekday names with or
 * without "next/agle/coming/is", "20 November", "Nov 20", "20th", "20 tareekh",
 * "bees tareekh", "20/11".
 */
export function resolveDate(input: string, nowIso: string): ResolvedDate | null {
  const today = todayInIndia(nowIso);
  const text = (input ?? "").toLowerCase().replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  // ISO date
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const d = dayUtc(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : resolved(d, today);
  }

  if (/\b(today|aaj)\b|आज/.test(text)) return resolved(today, today);
  if (/\b(day after tomorrow|parso|parson)\b|परसों/.test(text)) return resolved(addDays(today, 2), today);
  if (/\b(tomorrow|kal)\b|कल/.test(text)) return resolved(addDays(today, 1), today);

  // "in 3 days", "3 din baad", "teen din mein"
  const nDays = text.match(/\b(\w+) (days?|din)\b/);
  if (nDays) {
    const n = numberWord(nDays[1]);
    if (n !== null && n > 0 && n < 120) return resolved(addDays(today, n), today);
  }
  // "in two weeks", "do hafte"
  const nWeeks = text.match(/\b(\w+) (weeks?|hafte|hafta|haftey)\b/);
  if (nWeeks) {
    const n = nWeeks[1] === "a" || nWeeks[1] === "next" || nWeeks[1] === "agle" || nWeeks[1] === "agla" ? 1 : numberWord(nWeeks[1]);
    if (n !== null && n > 0 && n < 20) return resolved(addDays(today, n * 7), today);
  }
  if (/\b(next week|agle hafte|agla hafta|ek hafte|one week|a week)\b/.test(text)) return resolved(addDays(today, 7), today);

  // Weekday ("next Monday", "agle somvar", "Monday"): the next one strictly after today.
  for (const [re, dow] of WEEKDAY_WORDS) {
    if (re.test(text)) {
      const diff = (dow - today.getUTCDay() + 7) % 7 || 7;
      return resolved(addDays(today, diff), today);
    }
  }

  // Month name with a day ("20 November", "Nov 20th", "20th of nov")
  for (const [re, month] of MONTH_WORDS) {
    if (re.test(text)) {
      const day = text.match(/\b(\d{1,2})(st|nd|rd|th)?\b/);
      if (!day) return null;
      const d = nextDayOfMonth(today, Number(day[1]), month);
      return d ? resolved(d, today) : null;
    }
  }

  // "20/11" or "20-11" (Indian day/month order)
  const dm = text.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
  if (dm) {
    const d = nextDayOfMonth(today, Number(dm[1]), Number(dm[2]) - 1);
    return d ? resolved(d, today) : null;
  }

  // "the 20th", "20 tareekh", "bees tareekh"
  const dom = text.match(/\b(\w+?)(st|nd|rd|th)?\s*(tareekh|tarikh|tarik|taarikh)\b/) ?? text.match(/\b(\d{1,2})(st|nd|rd|th)\b/);
  if (dom) {
    const n = numberWord(dom[1]);
    if (n !== null) {
      const d = nextDayOfMonth(today, n);
      return d ? resolved(d, today) : null;
    }
  }
  return null;
}

/** The next 14 days, one per line, for the system prompt ("Mon 16 Nov 2026 = 2026-11-16"). */
export function upcomingCalendar(nowIso: string, days = 14): string {
  const today = todayInIndia(nowIso);
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(today, i + 1);
    return `${i === 0 ? "tomorrow" : i === 6 ? "in a week" : ""} ${spokenDate(d)} ${d.getUTCFullYear()} = ${toIsoDate(d)}`.trim();
  }).join("\n");
}
