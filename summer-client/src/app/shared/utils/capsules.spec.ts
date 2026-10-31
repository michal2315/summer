import { ICapsule } from '../models';
import { capsuleMatchesText, matchedWords } from './capsules';

const capsule = (words: ICapsule['words']): ICapsule => ({ _id: 'c', name: 'c', description: '', words });

describe('capsule matching (same rule as the server)', () => {
  it('must words all appear, mustNot words none, and optional ones decide only without must words', () => {
    const exam = capsule([
      { word: 'מבחן', condition: 'must' },
      { word: 'חשוב', condition: 'optional' },
      { word: 'בוטל', condition: 'mustNot' },
    ]);
    expect(capsuleMatchesText(exam, 'שאלה ממבחן')).toBe(true);
    expect(capsuleMatchesText(exam, 'המבחן בוטל')).toBe(false);
    expect(capsuleMatchesText(capsule([{ word: 'AVL', condition: 'optional' }]), 'עצי avl')).toBe(true);
    expect(capsuleMatchesText(capsule([{ word: 'x', condition: 'mustNot' }]), 'abc')).toBe(false);
  });

  it('lists the must and optional words that hit', () => {
    const c = capsule([
      { word: 'עץ', condition: 'optional' },
      { word: 'AVL', condition: 'optional' },
      { word: 'גרף', condition: 'mustNot' },
    ]);
    expect(matchedWords(c, 'עץ AVL')).toEqual(['עץ', 'AVL']);
  });
});
