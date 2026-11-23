import { MARK as M, badRegexes, markTyped, parseQuery, querySegments, regexProblem, regexSource, shortcutAt } from './search-syntax';
import { searchRegex } from '../pipes/highlight';

const r = String.raw;

describe('search regex', () => {
  it('reads a marked /regex/ (spaces and \\/ allowed, unclosed to the end); unmarked it is a word', () => {
    expect(parseQuery(M + r`/שיעור \d+/ ` + M + 'or ' + M + r`/a\/b c`).groups).toEqual([
      [{ term: r`שיעור \d+`, exact: false, regex: true, neg: false }],
      [{ term: r`a\/b c`, exact: false, regex: true, neg: false }],
    ]);
    expect(parseQuery('/x/').groups).toEqual([[{ term: '/x/', exact: false, neg: false }]]);
  });

  it('reads :field:/regex/ with its underscores and spaces as typed', () => {
    expect(parseQuery(`${M}:כותרת:/^a_b c/`).groups).toEqual([[{ term: '^a_b c', exact: false, regex: true, field: 'title', neg: false }]]);
  });

  it('marks a typed / that starts a word, but not inside a regex, a phrase or a field value', () => {
    expect(markTyped('a /', 3)).toEqual({ text: `a ${M}/`, caret: 4 });
    expect(markTyped(`${M}/a /`, 5)).toBeNull();
    expect(markTyped('"a /', 4)).toBeNull();
    expect(markTyped(`${M}:title:/`, 9)).toBeNull();
    expect(markTyped('a/', 2)).toBeNull();
  });

  it('leaves operator words and sigils inside a regex alone', () => {
    expect(markTyped(`${M}/a or`, 6)).toBeNull();
    expect(shortcutAt(`${M}/a @b`, 6)).toBeNull();
    expect(markTyped(`${M}/a/ or`, 7)).toEqual({ text: `${M}/a/ ${M}or`, caret: 8 });
  });

  it('colors regexes, and the ones the search would reject apart', () => {
    expect(querySegments(`x ${M}/a+/`).map((s) => s.kind)).toEqual([null, 'regex']);
    expect(querySegments(`${M}/(a/`).map((s) => s.kind)).toEqual(['regex-bad']);
    expect(querySegments(`${M}:כותרת:/a_b/`).map((s) => s.kind)).toEqual(['field-regex']);
    expect(badRegexes(`${M}/ok/ ${M}:title:/[\\W]/`)).toEqual([{ pattern: r`[\W]`, problem: jasmine.any(String) as unknown as string }]);
  });

  it('accepts what the server takes and rejects what Postgres lacks', () => {
    expect(regexProblem(r`^(a|b)\d{2}$`)).toBeUndefined();
    expect(regexProblem('(?<=a)b')).toBeUndefined();
    expect(regexProblem('(a')).toBeDefined();
    expect(regexProblem('(?<n>a)')).toBeDefined();
    expect(regexProblem(r`\p{L}`)).toBeDefined();
    expect(regexProblem(r`[\S]`)).toBeDefined();
  });

  it('highlights with Hebrew-aware \\b and \\w', () => {
    const source = regexSource(r`\bמבוא\b`)!;
    expect(new RegExp(source, 'u').test('על מבוא לביולוגיה')).toBeTrue();
    expect(new RegExp(source, 'u').test('המבואות')).toBeFalse();
    expect(new RegExp(regexSource(r`^\w+$`)!, 'u').test('שלום')).toBeTrue();
    expect(regexSource('(a')).toBeNull();
    const re = searchRegex(`גרף ${M}/שיעור \\d+/`)!;
    expect('בשיעור 12 על גרף'.match(re)).toEqual(['שיעור 12', 'גרף']);
  });
});
