import { pgRegex, regexProblem } from './sql';

const r = String.raw;

describe('pgRegex', () => {
  const src = (p: string) => {
    const out = pgRegex(p);
    if (!('source' in out)) throw new Error(out.problem);
    return out.source;
  };
  const WORD = '[:alnum:]א-ת_';

  it('keeps the common subset as is, folding final letters', () => {
    expect(src(r`^שלום (עולם|ים)\d+$`)).toBe(r`^שלומ (עולמ|ימ)\d+$`);
    expect(src(r`a\.b[^x-z]`)).toBe(r`a\.b[^x-z]`);
  });

  it('turns \b, \B, \w and \W into Hebrew-aware classes', () => {
    expect(src(r`\bמבוא\b`)).toBe(`(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))מבוא(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`);
    expect(src(r`a\B`)).toBe(`a(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`);
    expect(src(r`\w+`)).toBe(`[${WORD}]+`);
    expect(src(r`\W`)).toBe(`[^${WORD}]`);
    expect(src(r`[\w-]`)).toBe(`[${WORD}-]`);
    expect(src(r`[]\w]`)).toBe(`[]${WORD}]`);
    expect(src(r`[^]\w]x`)).toBe(`[^]${WORD}]x`);
  });

  it('reports invalid and unsupported patterns', () => {
    expect(regexProblem('(a')).toBeDefined();
    expect(regexProblem('(?<n>a)')).toBeDefined();
    expect(regexProblem(r`\p{L}`)).toBeDefined();
    expect(regexProblem(r`[\S]`)).toBeDefined();
    expect(regexProblem('x'.repeat(201))).toBeDefined();
    expect(regexProblem('(?<=a)b(?!c)')).toBeUndefined();
  });
});
