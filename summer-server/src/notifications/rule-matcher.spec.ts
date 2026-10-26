import { RuleCondition } from '../database/schema';
import { capsuleLookup } from '../capsules/capsule';
import { matchCondition, matchRule, ruleCapsuleIds } from './rule-matcher';

const c = (funcName: string, content: (string | number | null)[], type = 'string'): RuleCondition => ({ field: { _id: 'f', name: 'f', type }, funcName, content });

describe('notification rule matching', () => {
  it('strings', () => {
    expect(matchCondition(c('stringContains', ['מבני']), 'מבני נתונים')).toBe(true);
    expect(matchCondition(c('stringNotContains', ['מבני']), 'חדו"א')).toBe(true);
    expect(matchCondition(c('stringContains', ['x']), undefined)).toBe(false);
  });

  it('numbers, with open-ended between (null = ∞)', () => {
    expect(matchCondition(c('numberBigger', [3]), '4')).toBe(true);
    expect(matchCondition(c('numberEqual', ['4']), '4')).toBe(true);
    expect(matchCondition(c('numberBetween', [3, null]), '100')).toBe(true);
    expect(matchCondition(c('numberBetween', [3, 5]), '6')).toBe(false);
    expect(matchCondition(c('numberSmaller', [3]), 'abc')).toBe(false);
  });

  it('dates and arrays', () => {
    expect(matchCondition(c('dateAfter', ['2026-01-01']), '2026-02-01T00:00:00Z')).toBe(true);
    expect(matchCondition(c('dateBetween', [null, '2026-01-01']), '2025-06-01')).toBe(true);
    expect(matchCondition(c('arrayContains', ['b']), 'a, b')).toBe(true);
    expect(matchCondition(c('arrayNotContains', ['b']), '["a"]')).toBe(true);
  });

  it('capsules: matches / does not match, and a missing capsule never matches', () => {
    const capsules = capsuleLookup([{ id: 'k', name: 'עצים', description: '', words: [{ word: 'AVL', condition: 'optional' }] }]);
    expect(matchCondition(c('capsuleMatches', ['k', 'עצים']), 'עצי AVL', capsules)).toBe(true);
    expect(matchCondition(c('capsuleNotMatches', ['k', 'עצים']), 'עצי AVL', capsules)).toBe(false);
    expect(matchCondition(c('capsuleNotMatches', ['k', 'עצים']), 'ערימות', capsules)).toBe(true);
    expect(matchCondition(c('capsuleNotMatches', ['gone']), 'ערימות', capsules)).toBe(false);
    expect(ruleCapsuleIds([c('capsuleMatches', ['k', 'עצים']), c('stringContains', ['k'])])).toEqual(['k']);
  });

  it('a rule needs every condition', () => {
    const values = new Map([['f', '5']]);
    expect(matchRule([c('numberBigger', [1]), c('numberSmaller', [10])], values)).toBe(true);
    expect(matchRule([c('numberBigger', [1]), c('numberSmaller', [2])], values)).toBe(false);
    expect(matchRule([], values)).toBe(false);
  });
});
