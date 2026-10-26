import { capsuleRanges, deleteCapsule, guardEdit, parseQuery, querySegments, replaceShortcut, shortcutAt, snapSelection, typeBesideCapsule } from './search-syntax';
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

  describe('capsules', () => {
    const known = (name: string) => name === 'עצים' || name === 'חשוב_למבחן';
    const text = 'a #עצים or #חשוב_למבחן';
    const ranges = capsuleRanges(text, known);

    it('reads #name as a capsule term that joins and / or / not', () => {
      expect(parseQuery('#עצים או לא #גרפים').groups).toEqual([
        [{ term: 'עצים', neg: false, exact: false, capsule: true }],
        [{ term: 'גרפים', neg: true, exact: false, capsule: true }],
      ]);
    });

    it('marks only known capsules, and opens the # shortcut', () => {
      expect(querySegments('#עצים #אחר', known).map((s) => s.kind)).toEqual(['capsule', null]);
      expect(querySegments('#אחר').map((s) => s.kind)).toEqual(['capsule']);
      expect(shortcutAt('x #עצ', 5)).toEqual({ kind: 'capsule', query: 'עצ', start: 2, end: 5 });
    });

    it('keeps the caret off the inside of a capsule', () => {
      expect(ranges).toEqual([
        { start: 2, end: 7 },
        { start: 11, end: 22 },
      ]);
      expect(snapSelection(ranges, 4, 4, 2)).toEqual([7, 7]); // moving forward → after it
      expect(snapSelection(ranges, 4, 4, 7)).toEqual([2, 2]); // moving back → before it
      expect(snapSelection(ranges, 0, 4, 0)).toEqual([0, 7]); // a selection covers whole capsules
    });

    it('removes a capsule as a whole', () => {
      expect(deleteCapsule(text, 7, 'Backspace', ranges)).toEqual({ text: 'a or #חשוב_למבחן', caret: 2 });
      expect(deleteCapsule(text, 11, 'Delete', ranges)).toEqual({ text: 'a #עצים or', caret: 10 });
      expect(deleteCapsule(text, 1, 'Backspace', ranges)).toBeNull();
      // typing inside is ignored; cutting part of it removes all of it
      expect(guardEdit(text, 'a #עxצים or #חשוב_למבחן', ranges)).toEqual({ text, caret: 7 });
      expect(guardEdit(text, 'a #עים or #חשוב_למבחן', ranges)).toEqual({ text: 'a  or #חשוב_למבחן', caret: 2 });
      expect(guardEdit(text, text + ' x', ranges)).toEqual({ text: text + ' x' });
    });

    it('separates a letter typed against a capsule with a space', () => {
      expect(typeBesideCapsule(text, 7, 'b', ranges)).toEqual({ text: 'a #עצים b or #חשוב_למבחן', caret: 9 });
    });
  });
});
