import { parseQuery, querySegments, replaceShortcut, shortcutAt } from './search-syntax';
import { searchRegex } from '../pipes/highlight';

describe('search syntax', () => {
  const terms = (text: string) => parseQuery(text).groups.map((g) => g.map((t) => (t.neg ? '-' : '') + t.term));

  it('reads and / or / not in English and Hebrew, AND binding tighter than OR', () => {
    expect(terms('a b OR c and not d')).toEqual([['a', 'b'], ['c', '-d']]);
    expect(terms('ביולוגיה או כימיה ולא מבחן')).toEqual([['ביולוגיה'], ['כימיה', '-מבחן']]);
  });

  it('drops operators that are not between terms, and searches quoted ones as words', () => {
    expect(terms('or a and')).toEqual([['a']]);
    expect(terms('"לא" ברור')).toEqual([['לא', 'ברור']]);
  });

  it('keeps @user and :type out of the text terms', () => {
    expect(terms('biology exam @michal :lecture')).toEqual([['biology', 'exam']]);
  });

  it('marks only the operators that take effect, plus @users and :types', () => {
    expect(querySegments('or a או b @dan')).toEqual([
      { text: 'or a ', kind: null },
      { text: 'או', kind: 'or' },
      { text: ' b ', kind: null },
      { text: '@dan', kind: 'user' },
    ]);
  });

  it('finds the @ / : word under the caret and replaces it', () => {
    const text = 'exam @mi :lec';
    expect(shortcutAt(text, 8)).toEqual({ kind: 'user', query: 'mi', start: 5, end: 8 });
    expect(shortcutAt(text, 13)?.kind).toBe('type');
    expect(shortcutAt(text, 3)).toBeNull();
    expect(replaceShortcut(text, shortcutAt(text, 8)!, '@michal')).toEqual({ text: 'exam @michal :lec', caret: 13 });
  });

  it('highlights only terms that must appear', () => {
    const re = searchRegex('גרף לא מכוון @dan :lecture')!;
    expect('גרף מכוון @dan lecture'.match(re)).toEqual(['גרף']);
  });
});
