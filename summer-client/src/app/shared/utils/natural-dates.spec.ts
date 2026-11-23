import { EARLIEST, parseDateRange } from './natural-dates';

describe('natural dates', () => {
  // Sunday 22 Nov 2026
  const today = new Date(2026, 10, 22, 15, 30);
  const read = (s: string) => {
    const r = parseDateRange(s, today);
    return r && [r.from.toDateString(), r.to.toDateString()];
  };
  const days = (a: Date, b: Date) => [a.toDateString(), b.toDateString()];
  const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

  it('reads single days and calendar periods', () => {
    expect(read('היום')).toEqual(days(d(2026, 11, 22), d(2026, 11, 22)));
    expect(read('אתמול')).toEqual(days(d(2026, 11, 21), d(2026, 11, 21)));
    expect(read('השבוע')).toEqual(days(d(2026, 11, 22), d(2026, 11, 28)));
    expect(read('השבוע שעבר')).toEqual(days(d(2026, 11, 15), d(2026, 11, 21)));
    expect(read('החודש שעבר')).toEqual(days(d(2026, 10, 1), d(2026, 10, 31)));
    expect(read('last month')).toEqual(days(d(2026, 10, 1), d(2026, 10, 31)));
    expect(read('השנה')).toEqual(days(d(2026, 1, 1), d(2026, 12, 31)));
  });

  it('reads the last N units up to today', () => {
    expect(read('7 ימים אחרונים')).toEqual(days(d(2026, 11, 16), d(2026, 11, 22)));
    expect(read('ב-30 הימים האחרונים')).toEqual(days(d(2026, 10, 24), d(2026, 11, 22)));
    expect(read('שבועיים אחרונים')).toEqual(days(d(2026, 11, 8), d(2026, 11, 22)));
    expect(read('בחודש האחרון')).toEqual(days(d(2026, 10, 22), d(2026, 11, 22)));
    expect(read('3 חודשים אחרונים')).toEqual(days(d(2026, 8, 22), d(2026, 11, 22)));
    expect(read('השנה האחרונה')).toEqual(days(d(2025, 11, 22), d(2026, 11, 22)));
    expect(read('past 2 weeks')).toEqual(days(d(2026, 11, 8), d(2026, 11, 22)));
  });

  it('reads months, years and dates', () => {
    expect(read('מרץ')).toEqual(days(d(2026, 3, 1), d(2026, 3, 31)));
    expect(read('בדצמבר')).toEqual(days(d(2025, 12, 1), d(2025, 12, 31)));
    expect(read('מאי 2024')).toEqual(days(d(2024, 5, 1), d(2024, 5, 31)));
    expect(read('2025')).toEqual(days(d(2025, 1, 1), d(2025, 12, 31)));
    expect(read('15/3')).toEqual(days(d(2026, 3, 15), d(2026, 3, 15)));
    expect(read('15.3.25')).toEqual(days(d(2025, 3, 15), d(2025, 3, 15)));
    expect(read('2025-03-15')).toEqual(days(d(2025, 3, 15), d(2025, 3, 15)));
    expect(read('31/2')).toBeNull();
    expect(read('לפני שבועיים')).toEqual(days(d(2026, 11, 8), d(2026, 11, 8)));
  });

  it('reads from … to, since and until', () => {
    expect(read('1/3 עד 15/4')).toEqual(days(d(2026, 3, 1), d(2026, 4, 15)));
    expect(read('בין מרץ למאי')).toEqual(days(d(2026, 3, 1), d(2026, 5, 31)));
    expect(read('ממרץ עד היום')).toEqual(days(d(2026, 3, 1), d(2026, 11, 22)));
    expect(read('מאי עד יוני')).toEqual(days(d(2026, 5, 1), d(2026, 6, 30)));
    expect(read('from march to may')).toEqual(days(d(2026, 3, 1), d(2026, 5, 31)));
    expect(read('15/4 - 1/3')).toEqual(days(d(2026, 3, 1), d(2026, 4, 15)));
    expect(read('מאז ינואר')).toEqual(days(d(2026, 1, 1), d(2026, 11, 22)));
    expect(read('since 2024')).toEqual(days(d(2024, 1, 1), d(2026, 11, 22)));
    expect(read('עד מרץ')).toEqual(days(EARLIEST, d(2026, 3, 31)));
  });

  it('does not read nonsense', () => {
    expect(read('')).toBeNull();
    expect(read('מחר בבוקר אולי')).toBeNull();
    expect(read('banana')).toBeNull();
  });
});
