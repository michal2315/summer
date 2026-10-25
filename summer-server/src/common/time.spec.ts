import { dayRange, parseEventDate } from './time';
import { searchTerms } from '../summaries/summary-search';

describe('time zone helpers', () => {
  const TZ = 'Asia/Jerusalem';

  it('interprets event wall-clock time in the app zone, across DST', () => {
    expect(parseEventDate('2026-01-15', '10:00', TZ)?.toISOString()).toBe('2026-01-15T08:00:00.000Z'); // UTC+2
    expect(parseEventDate('2026-07-15', '10:00', TZ)?.toISOString()).toBe('2026-07-15T07:00:00.000Z'); // UTC+3
    expect(parseEventDate('2026-02-30', undefined, TZ)).toBeNull();
    expect(parseEventDate('15/01/2026', undefined, TZ)).toBeNull();
  });

  it('turns client local-midnight instants into whole calendar days', () => {
    // The browser (Israel) sends 2026-03-01 00:00 local = 2026-02-28T22:00Z
    const [from, to] = dayRange('2026-02-28T22:00:00.000Z', '2026-03-01T22:00:00.000Z', TZ)!;
    expect(from.toISOString()).toBe('2026-02-28T22:00:00.000Z');
    expect(to.toISOString()).toBe('2026-03-02T21:59:59.999Z');
  });
});

describe('search terms', () => {
  it('keeps quoted phrases, splits words, drops hashtags marks and duplicates', () => {
    expect(searchTerms('"שאלה ממבחן" #חשוב  graph graph')).toEqual(['שאלה ממבחן', 'חשוב', 'graph']);
  });
});
