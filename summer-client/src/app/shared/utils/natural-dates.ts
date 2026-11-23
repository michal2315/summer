import {
  addDays,
  endOfMonth,
  endOfWeek,
  endOfYear,
  isValid,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from 'date-fns';

/** Calendar days, both included (local midnight). */
export interface DaySpan {
  from: Date;
  to: Date;
}

/** Where an open start ("until March") begins. */
export const EARLIEST = new Date(2000, 0, 1);

type Unit = 'day' | 'week' | 'month' | 'year';

const MONTHS: Record<string, number> = {
  ינואר: 0,
  פברואר: 1,
  מרץ: 2,
  מרס: 2,
  אפריל: 3,
  מאי: 4,
  יוני: 5,
  יולי: 6,
  אוגוסט: 7,
  ספטמבר: 8,
  אוקטובר: 9,
  נובמבר: 10,
  דצמבר: 11,
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

/** Hebrew unit words (singular, plural, dual) and English ones → unit and the count a dual implies. */
const UNITS: Record<string, [Unit, number?]> = {
  יום: ['day'],
  ימים: ['day'],
  יומיים: ['day', 2],
  שבוע: ['week'],
  שבועות: ['week'],
  שבועיים: ['week', 2],
  חודש: ['month'],
  חודשים: ['month'],
  חודשיים: ['month', 2],
  שנה: ['year'],
  שנים: ['year'],
  שנתיים: ['year', 2],
  day: ['day'],
  days: ['day'],
  week: ['week'],
  weeks: ['week'],
  month: ['month'],
  months: ['month'],
  year: ['year'],
  years: ['year'],
};
const UNIT_WORDS = Object.keys(UNITS).join('|');

const sub = (d: Date, unit: Unit, n: number) =>
  unit === 'day' ? subDays(d, n) : unit === 'week' ? subWeeks(d, n) : unit === 'month' ? subMonths(d, n) : subYears(d, n);
const span = (from: Date, to: Date): DaySpan => ({ from: startOfDay(from), to: startOfDay(to) });
/** Sunday-first weeks, as in Israel. */
const WEEK = { weekStartsOn: 0 } as const;

function calendar(unit: Exclude<Unit, 'day'>, today: Date, back: number): DaySpan {
  if (unit === 'week') {
    const d = subWeeks(today, back);
    return span(startOfWeek(d, WEEK), endOfWeek(d, WEEK));
  }
  if (unit === 'month') {
    const d = subMonths(today, back);
    return span(startOfMonth(d), endOfMonth(d));
  }
  const d = subYears(today, back);
  return span(startOfYear(d), endOfYear(d));
}

/** The last `n` units up to today: 7 days = today and the 6 before it; a month = since this day last month. */
const rolling = (unit: Unit, n: number, today: Date) => span(unit === 'day' ? subDays(today, n - 1) : sub(today, unit, n), today);

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** One day or period in words or digits; undefined when it isn't one. */
function point(s: string, today: Date): DaySpan | undefined {
  if (/^(היום|today)$/.test(s)) return span(today, today);
  if (/^(אתמול|yesterday)$/.test(s)) return span(subDays(today, 1), subDays(today, 1));
  if (/^שלשום$/.test(s)) return span(subDays(today, 2), subDays(today, 2));

  // this / last calendar week, month, year
  const thisHe = /^ה(שבוע|חודש|שנה)( ה?נוכחי(ת)?)?$/.exec(s);
  if (thisHe) return calendar(UNITS[thisHe[1]][0] as Exclude<Unit, 'day'>, today, 0);
  const lastHe = /^ה?(שבוע|חודש|שנה) ה?(שעבר|שעברה|הקודם|הקודמת)$/.exec(s);
  if (lastHe) return calendar(UNITS[lastHe[1]][0] as Exclude<Unit, 'day'>, today, 1);
  if (s === 'אשתקד') return calendar('year', today, 1);
  const thisEn = /^this (week|month|year)$/.exec(s);
  if (thisEn) return calendar(thisEn[1] as Exclude<Unit, 'day'>, today, 0);
  const lastEn = /^(?:last|previous) (week|month|year)$/.exec(s);
  if (lastEn) return calendar(lastEn[1] as Exclude<Unit, 'day'>, today, 1);

  // the last N units (rolling, up to today)
  const lastN = new RegExp(`^(?:ב-?)?(?:ה-?)?(\\d+ )?(?:ה)?(${UNIT_WORDS}) ה?אחרו(?:ן|נה|נים|נות)$`).exec(s);
  if (lastN) {
    const [unit, dual] = UNITS[lastN[2]];
    return rolling(unit, lastN[1] ? Number(lastN[1]) : (dual ?? 1), today);
  }
  const lastNEn = new RegExp(`^(?:in )?(?:the )?(?:last|past) (\\d+ )?(${UNIT_WORDS})$`).exec(s);
  if (lastNEn) return rolling(UNITS[lastNEn[2]][0], lastNEn[1] ? Number(lastNEn[1]) : 1, today);

  // N units ago: that one day
  const agoHe = new RegExp(`^לפני (\\d+ )?(${UNIT_WORDS})$`).exec(s);
  const agoEn = new RegExp(`^(\\d+|an?) (${UNIT_WORDS}) ago$`).exec(s);
  const ago = agoHe ? { n: agoHe[1], word: agoHe[2] } : agoEn ? { n: /^\d/.test(agoEn[1]) ? agoEn[1] : undefined, word: agoEn[2] } : undefined;
  if (ago) {
    const [unit, dual] = UNITS[ago.word];
    const d = sub(today, unit, ago.n ? Number(ago.n) : (dual ?? 1));
    return span(d, d);
  }

  // a month, with or without its year (without: the latest one that has begun)
  const month = /^(?:ב-?)?([a-zא-ת]+)(?:,? (\d{4}|\d{2}))?$/.exec(s);
  if (month && month[1] in MONTHS) {
    const m = MONTHS[month[1]];
    const y = month[2] ? fullYear(month[2]) : m > today.getMonth() ? today.getFullYear() - 1 : today.getFullYear();
    const d = new Date(y, m, 1);
    return span(d, endOfMonth(d));
  }

  // a year
  const year = /^(?:ב-?)?(?:שנת )?(\d{4})$/.exec(s);
  if (year) return span(new Date(Number(year[1]), 0, 1), new Date(Number(year[1]), 11, 31));

  // a date: d/m/yyyy, d.m.yy, d-m-yyyy, d/m (this year), yyyy-mm-dd
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/.exec(s);
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : dmy ? [dmy[3] ? fullYear(dmy[3]) : today.getFullYear(), Number(dmy[2]), Number(dmy[1])] : null;
  if (parts) {
    const [y, m, d] = parts;
    const date = new Date(y, m - 1, d);
    if (isValid(date) && date.getMonth() === m - 1 && date.getDate() === d) return span(date, date);
  }
  return undefined;
}

/** point(), also with a Hebrew prefix letter attached (במרץ, מינואר, ל-5/4, וב2024). */
function pointWithPrefix(s: string, today: Date): DaySpan | undefined {
  const direct = point(s, today);
  if (direct) return direct;
  const m = /^(?:וב|ומ|ול|מה|ב|מ|ל|ו|ה)-?(.+)$/.exec(s);
  return m ? point(m[1], today) : undefined;
}

/**
 * A time range in Hebrew or English words → calendar days (both included), or null when it can't be read:
 * - one day or period: היום, אתמול, השבוע, החודש שעבר, השנה, מרץ, מרץ 2025, 2024, 15/3, 15.3.25, 2025-03-15, last week
 * - the last N: 7 ימים אחרונים, שבועיים אחרונים, בחודש האחרון, השנה האחרונה, last 3 months, past year
 * - N ago (one day): לפני 3 ימים, לפני שבוע, 2 weeks ago
 * - from … to: 1/3 עד 15/4, בין מרץ למאי, ממרץ עד היום, from march to may, 1/3 - 15/4
 * - since / until: מאז ינואר, החל מ-1/3, since 2024; עד מרץ, until march (from the start of the archive)
 */
export function parseDateRange(input: string, today = new Date()): DaySpan | null {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[״"׳']/g, '')
    .replace(/[־–—]/g, '-')
    .replace(/\s+/g, ' ');
  if (!s) return null;

  const pair = (a: string, b: string): DaySpan | null => {
    const from = pointWithPrefix(a.trim(), today);
    const to = pointWithPrefix(b.trim(), today);
    if (!from || !to) return null;
    return from.from <= to.to ? span(from.from, to.to) : span(to.from, from.to);
  };

  const between = /^(?:בין|between) (.+?) (?:ל-?|ו-?|and )(.+)$/.exec(s);
  if (between) {
    const r = pair(between[1], between[2]);
    if (r) return r;
  }
  const fromTo = /^(?:from |מ-?)?(.+?)(?: - | עד | עד ל-?| to | until | through | till )(.+)$/.exec(s);
  if (fromTo) {
    const r = pair(fromTo[1], fromTo[2]) ?? pair(s.split(/ - | עד | to | until | through | till /)[0], fromTo[2]);
    if (r) return r;
  }
  const since = /^(?:מאז|since|after|החל מ-?|starting) ?(.+)$/.exec(s);
  if (since) {
    const p = pointWithPrefix(since[1], today);
    if (p) return span(p.from, today);
  }
  const until = /^(?:עד|until|till|before|up to) ?(.+)$/.exec(s);
  if (until) {
    const p = pointWithPrefix(until[1], today);
    if (p) return span(EARLIEST, p.to);
  }
  return pointWithPrefix(s, today) ?? null;
}

/** For the preview: how many days a span covers. */
export const spanDays = (r: DaySpan) => Math.round((addDays(r.to, 1).getTime() - r.from.getTime()) / 86_400_000);
