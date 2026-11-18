import {
  MARK as M,
  capsuleRanges,
  cleanMarks,
  deleteCapsule,
  guardEdit,
  markHeads,
  markTyped,
  parseQuery,
  querySegments,
  replaceShortcut,
  shortcutAt,
  snapSelection,
  typeBesideCapsule,
  unmarkBefore,
} from './search-syntax';
import { searchRegex } from '../pipes/highlight';

describe('search syntax', () => {
  const terms = (text: string) => parseQuery(text).groups.map((g) => g.map((t) => (t.neg ? '-' : '') + t.term));

  it('reads marked and / or / not in English and Hebrew, AND binding tighter than OR', () => {
    expect(terms(`a b ${M}OR c ${M}and ${M}not d`)).toEqual([['a', 'b'], ['c', '-d']]);
    expect(terms(`ביולוגיה ${M}או כימיה ${M}ולא מבחן`)).toEqual([['ביולוגיה'], ['כימיה', '-מבחן']]);
  });

  it('searches unmarked operator words and quoted ones as words', () => {
    expect(terms('a or b')).toEqual([['a', 'or', 'b']]);
    expect(terms('"לא" ברור')).toEqual([['לא', 'ברור']]);
  });

  it('drops operators that are not between terms', () => {
    expect(terms(`${M}or a ${M}and`)).toEqual([['a']]);
    expect(terms(`a ${M}not`)).toEqual([['a']]);
  });

  it('reads @user and :field:value as terms of their field, `_` for spaces, a space ending the value', () => {
    expect(parseQuery(`${M}@Michal_Golan ${M}:כותרת:מבוא_לביולוגיה x`).groups).toEqual([
      [
        { term: 'Michal Golan', neg: false, exact: false, field: 'author' },
        { term: 'מבוא לביולוגיה', neg: false, exact: false, field: 'title' },
        { term: 'x', neg: false, exact: false },
      ],
    ]);
    expect(parseQuery(`${M}:title:"intro bio" y`).groups).toEqual([
      [
        { term: 'intro bio', neg: false, exact: true, field: 'title' },
        { term: 'y', neg: false, exact: false },
      ],
    ]);
  });

  it('marks only the marked operators, @users and :fields', () => {
    expect(querySegments(`or a ${M}או b ${M}@dan ${M}:סוג:שיעור`)).toEqual([
      { text: 'or a ', kind: null },
      { text: `${M}או`, kind: 'or' },
      { text: ' b ', kind: null },
      { text: `${M}@dan`, kind: 'user' },
      { text: ' ', kind: null },
      { text: `${M}:סוג:שיעור`, kind: 'field' },
    ]);
  });

  it('finds the shortcut under the caret and replaces it', () => {
    const text = `exam ${M}@mi`;
    expect(shortcutAt(text, 9)).toEqual({ kind: 'user', marked: true, query: 'mi', start: 5, end: 9 });
    expect(shortcutAt('exam @mi', 8)).toEqual({ kind: 'user', marked: false, query: 'mi', start: 5, end: 8 });
    expect(shortcutAt(text, 3)).toBeNull();
    expect(replaceShortcut(text, shortcutAt(text, 9)!, `${M}@michal`)).toEqual({ text: `exam ${M}@michal `, caret: 14 });
  });

  it('finds the field value under the caret, which a picked value replaces', () => {
    const ctx = shortcutAt(`${M}:title:gr x`, 10)!;
    expect(ctx).toEqual(jasmine.objectContaining({ kind: 'value', query: 'gr', fieldName: 'title', segment: { start: 8, end: 10 } }));
    expect(ctx.field?.key).toBe('title');
    expect(shortcutAt(`${M}:title:gr x`, 12)).toBeNull();
  });

  it('says which operators actually join terms', () => {
    const ops = parseQuery(`${M}or a ${M}and b ${M}not`).tokens.filter((t) => t.kind !== 'term');
    expect(ops.map((t) => [t.kind, !!t.active])).toEqual([
      ['or', false],
      ['and', true],
      ['not', false],
    ]);
  });

  it('reads $name as a saved search only on its own in the box', () => {
    expect(parseQuery(`${M}$מבחנים`).tokens.map((t) => t.kind)).toEqual(['saved']);
    expect(parseQuery(`x ${M}$מבחנים`).tokens.map((t) => t.kind)).toEqual(['term', 'term']);
    expect(terms(`x ${M}$מבחנים`)).toEqual([['x', '$מבחנים']]);
    expect(shortcutAt('$מב', 3)).toEqual({ kind: 'saved', marked: false, query: 'מב', start: 0, end: 3 });
    expect(shortcutAt('x $מב', 5)).toEqual({ kind: 'saved', marked: false, blocked: true, query: 'מב', start: 2, end: 5 });
  });

  it('finds the field being chosen, which a picked field replaces up to its `:`', () => {
    expect(shortcutAt(`${M}:ti`, 4)).toEqual({ kind: 'field', marked: true, query: 'ti', start: 0, end: 4 });
    expect(shortcutAt(`${M}:ti:x`, 3)).toEqual({ kind: 'field', marked: true, query: 't', start: 0, end: 5 });
    expect(shortcutAt(`${M}:nofield:x`, 11)).toEqual(jasmine.objectContaining({ kind: 'field', query: 'nofield:x' }));
  });

  it('marks "phrases" for display, and skips unknown or unfinished fields when searching', () => {
    expect(querySegments('"a b" c')).toEqual([
      { text: '"a b"', kind: 'phrase' },
      { text: ' c', kind: null },
    ]);
    expect(terms(`${M}:nofield:x ${M}:title: ${M}@ y`)).toEqual([['y']]);
  });

  it('highlights only terms that must appear', () => {
    const re = searchRegex(`גרף ${M}לא מכוון ${M}@dan`)!;
    expect('גרף מכוון dan'.match(re)).toEqual(['גרף']);
  });

  describe('marks', () => {
    it('marks an operator word or a sigil as it is typed', () => {
      expect(markTyped('a or', 4)).toEqual({ text: `a ${M}or`, caret: 5 });
      expect(markTyped('a @', 3)).toEqual({ text: `a ${M}@`, caret: 4 });
      expect(markTyped('a orb', 5)).toBeNull();
      expect(markTyped('a @m', 4)).toBeNull(); // only the keystroke that types the sigil marks it
      expect(markTyped('x $', 3)).toBeNull(); // a saved search only on its own in the box
      expect(markTyped(`${M}:title:or`, 10)).toBeNull(); // a field value is one term
    });

    it('takes the mark off with Backspace right after an operator or a sigil, keeping the text', () => {
      expect(unmarkBefore(`a ${M}or`, 5)).toEqual({ text: 'a or', caret: 4 });
      expect(unmarkBefore(`${M}@`, 2)).toEqual({ text: '@', caret: 1 });
      expect(unmarkBefore(`${M}@dan`, 5)).toBeNull();
      expect(unmarkBefore(`a ${M}or b`, 7)).toBeNull();
    });

    it('drops marks that no longer mark anything', () => {
      expect(cleanMarks(`${M}orb`, 4)).toEqual({ text: 'orb', caret: 3 });
      expect(cleanMarks(`a ${M}or`, 5)).toBeNull();
    });

    it('keeps the caret between a mark and its first character out', () => {
      expect(markHeads(`a ${M}or ${M}@d`)).toEqual([
        { start: 2, end: 4 },
        { start: 6, end: 8 },
      ]);
    });
  });

  describe('capsules', () => {
    const known = (name: string) => name === 'עצים' || name === 'חשוב_למבחן';
    const text = `a ${M}#עצים ${M}or ${M}#חשוב_למבחן`;
    const ranges = capsuleRanges(text, known);

    it('reads #name as a capsule term that joins and / or / not', () => {
      expect(parseQuery(`${M}#עצים ${M}או ${M}לא ${M}#גרפים`).groups).toEqual([
        [{ term: 'עצים', neg: false, exact: false, capsule: true }],
        [{ term: 'גרפים', neg: true, exact: false, capsule: true }],
      ]);
    });

    it('marks only known capsules, and opens the # shortcut', () => {
      expect(querySegments(`${M}#עצים ${M}#אחר`, known).map((s) => s.kind)).toEqual(['capsule', null]);
      expect(querySegments(`${M}#אחר`).map((s) => s.kind)).toEqual(['capsule']);
      expect(shortcutAt(`x ${M}#עצ`, 6)).toEqual({ kind: 'capsule', marked: true, query: 'עצ', start: 2, end: 6 });
    });

    it('keeps the caret off the inside of a capsule', () => {
      expect(ranges).toEqual([
        { start: 2, end: 8 },
        { start: 13, end: 25 },
      ]);
      expect(snapSelection(ranges, 5, 5, 2)).toEqual([8, 8]); // moving forward → after it
      expect(snapSelection(ranges, 5, 5, 8)).toEqual([2, 2]); // moving back → before it
      expect(snapSelection(ranges, 0, 5, 0)).toEqual([0, 8]); // a selection covers whole capsules
    });

    it('removes a capsule as a whole', () => {
      expect(deleteCapsule(text, 8, 'Backspace', ranges)).toEqual({ text: `a ${M}or ${M}#חשוב_למבחן`, caret: 2 });
      expect(deleteCapsule(text, 13, 'Delete', ranges)).toEqual({ text: `a ${M}#עצים ${M}or`, caret: 12 });
      expect(deleteCapsule(text, 1, 'Backspace', ranges)).toBeNull();
      // typing inside is ignored; cutting part of it removes all of it
      expect(guardEdit(text, text.slice(0, 5) + 'x' + text.slice(5), ranges)).toEqual({ text, caret: 8 });
      expect(guardEdit(text, text.slice(0, 5) + text.slice(6), ranges)).toEqual({ text: `a  ${M}or ${M}#חשוב_למבחן`, caret: 2 });
      expect(guardEdit(text, text + ' x', ranges)).toEqual({ text: text + ' x' });
    });

    it('separates a letter typed against a capsule with a space', () => {
      expect(typeBesideCapsule(text, 8, 'b', ranges)).toEqual({ text: `a ${M}#עצים b ${M}or ${M}#חשוב_למבחן`, caret: 10 });
    });
  });
});
