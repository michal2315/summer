import { dayRange, parseEventDate } from './time';
import { capsuleRefs, parseQuery } from '../summaries/summary-search';

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

describe('search query', () => {
  const terms = (text: string) => parseQuery(text).groups.map((g) => g.map((t) => (t.neg ? '-' : '') + t.term));

  it('keeps quoted phrases, splits words, drops the # of a word that is not a capsule', () => {
    expect(terms('"שאלה ממבחן" #חשוב  graph')).toEqual([['שאלה ממבחן', 'חשוב', 'graph']]);
  });

  it('reads and / or / not in English and Hebrew, AND binding tighter than OR', () => {
    expect(terms('a b OR c and not d')).toEqual([['a', 'b'], ['c', '-d']]);
    expect(terms('ביולוגיה או כימיה ולא מבחן')).toEqual([['ביולוגיה'], ['כימיה', '-מבחן']]);
    expect(terms('גרף לא מכוון')).toEqual([['גרף', '-מכוון']]);
  });

  it('drops operators that are not between terms, and searches quoted ones as words', () => {
    expect(terms('or a and')).toEqual([['a']]);
    expect(terms('a not')).toEqual([['a']]);
    expect(terms('"לא" ברור')).toEqual([['לא', 'ברור']]);
  });

  it('pulls out @user and :type filters wherever they appear', () => {
    const q = parseQuery('biology exam @Michal :lecture :שעת_קבלה or chemistry');
    expect(q.users).toEqual(['michal']);
    expect(q.contentTypes).toEqual(['lecture', 'שעת קבלה']);
    expect(terms('biology exam @Michal :lecture or chemistry')).toEqual([['biology', 'exam'], ['chemistry']]);
  });

  it('marks #name terms as capsule references, from the text and the advanced tree', () => {
    const q = parseQuery('#חשוב_למבחן או לא #עצים "#מצוטט"');
    expect(q.capsules).toEqual(['חשוב_למבחן', 'עצים']);
    expect(q.groups).toEqual([[{ term: 'חשוב_למבחן', neg: false, capsule: true }], [{ term: 'עצים', neg: true, capsule: true }, { term: '#מצוטט', neg: false }]]);
    const tree = { type: 'group' as const, op: 'AND' as const, children: [{ type: 'cond' as const, field: 'text' as const, op: 'any' as const, words: ['#cap:cap-trees', 'גרף'], values: [] }] };
    expect(capsuleRefs({ text: '#גרפים', query: tree })).toEqual({ ids: ['cap-trees'], names: ['גרפים'] });
  });
});
