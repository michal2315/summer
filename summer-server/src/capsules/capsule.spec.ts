import { Capsule, capsuleLookup, capsuleMatchesText } from './capsule';
import { MockCapsuleProvider } from './mock-capsule.provider';

const cap = (words: Capsule['words']): Capsule => ({ id: 'c', name: 'כמוסה לדוגמה', description: '', words });

describe('capsules', () => {
  it('optional words: any one is enough when there are no must words', () => {
    const c = cap([
      { word: 'עץ', condition: 'optional' },
      { word: 'AVL', condition: 'optional' },
    ]);
    expect(capsuleMatchesText(c, 'סיבובים בעצי avl')).toBe(true);
    expect(capsuleMatchesText(c, 'טבלאות גיבוב')).toBe(false);
  });

  it('must words all have to appear, then optional words no longer filter', () => {
    const c = cap([
      { word: 'מבחן', condition: 'must' },
      { word: 'חשוב', condition: 'optional' },
    ]);
    expect(capsuleMatchesText(c, 'שאלה ממבחן')).toBe(true);
    expect(capsuleMatchesText(c, 'חשוב מאוד')).toBe(false);
  });

  it('a mustNot word rules the text out', () => {
    const c = cap([
      { word: 'זיכרון', condition: 'optional' },
      { word: 'וירטואלי', condition: 'mustNot' },
    ]);
    expect(capsuleMatchesText(c, 'זיכרון לטווח קצר')).toBe(true);
    expect(capsuleMatchesText(c, 'זיכרון וירטואלי')).toBe(false);
  });

  it('a capsule with only mustNot words matches nothing', () => {
    expect(capsuleMatchesText(cap([{ word: 'x', condition: 'mustNot' }]), 'abc')).toBe(false);
  });

  it('looks capsules up by id and by name, `_` for spaces, ignoring case', () => {
    const lookup = capsuleLookup([cap([])]);
    expect(lookup.byId('c')?.name).toBe('כמוסה לדוגמה');
    expect(lookup.byName('כמוסה_לדוגמה')?.id).toBe('c');
    expect(lookup.byName('אחרת')).toBeUndefined();
  });

  it('the mock searches names: prefix matches before contains', async () => {
    const provider = new MockCapsuleProvider(0);
    const names = (await provider.search('עצ', 10)).map((c) => c.name);
    expect(names[0]).toBe('עצים');
    expect(names).toContain('מבני נתונים בלי עצים');
    expect((await provider.byNames(['חשוב_למבחן'])).map((c) => c.id)).toEqual(['cap-exam-important']);
  });
});
