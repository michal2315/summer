import { SearchType } from '../models';
import { highlightHtml, highlightText, matchSnippet, regexFor, searchRegex } from './highlight';

describe('highlight', () => {
  it('wraps each space-separated word', () => {
    expect(highlightText('תכנון דינמי ומסלולים', searchRegex('דינמי מסלול'))).toBe(
      'תכנון <span class="highlight">דינמי</span> ו<span class="highlight">מסלול</span>ים',
    );
  });

  it('treats "quoted text" as a whole-word match (Hebrew-aware)', () => {
    const re = searchRegex('"עץ"');
    expect(highlightText('עץ AVL', re)).toContain('<span class="highlight">עץ</span>');
    expect(highlightText('עצים', re)).not.toContain('highlight');
  });

  it('escapes HTML in plain text instead of trusting it', () => {
    expect(highlightText('<img src=x onerror=alert(1)>', null)).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('never touches tags or attributes in rich HTML', () => {
    const out = highlightHtml('<a href="class.html" class="class">a class act</a>', searchRegex('class'));
    expect(out).toBe('<a href="class.html" class="class">a <span class="highlight">class</span> act</a>');
  });

  it('only highlights fields whose search type is checked', () => {
    const search = { text: 'x', searchTypes: [SearchType.Title] };
    expect(regexFor(search, SearchType.Title)).not.toBeNull();
    expect(regexFor(search, SearchType.Content)).toBeNull();
    expect(regexFor({ text: 'x' }, SearchType.Content)).not.toBeNull();
  });

  it('treats #word that is not a known capsule as the plain word', () => {
    expect(highlightText('מועד א', searchRegex('#מועד'))).toContain('<span class="highlight">מועד</span>');
  });

  it('highlights a capsule as its must and optional words, never its mustNot ones', () => {
    const capsule = {
      _id: 'c',
      name: 'עצים',
      description: '',
      words: [
        { word: 'AVL', condition: 'optional' as const },
        { word: 'עץ', condition: 'must' as const },
        { word: 'גרף', condition: 'mustNot' as const },
      ],
    };
    const capsules = { byName: (n: string) => (n === 'עצים' ? capsule : undefined), byId: (id: string) => (id === 'c' ? capsule : undefined) };
    expect('עץ AVL גרף'.match(searchRegex('#עצים', [], capsules)!)).toEqual(['עץ', 'AVL']);
    expect('אחר'.match(searchRegex('#אחר', [], capsules)!)).toEqual(['אחר']); // unknown: the plain word
    const search = { query: { type: 'group' as const, op: 'AND' as const, children: [{ type: 'cond' as const, field: 'text' as const, op: 'any' as const, words: ['#cap:c'] }] } };
    expect('עץ'.match(regexFor(search, SearchType.Content, capsules)!)).toEqual(['עץ']);
  });

  it('cuts a snippet around the first hit, at spaces, with … where text was dropped', () => {
    const text = 'בהרצאה עברנו על ההגדרות הבסיסיות והדגמנו אותן על מספר דוגמאות. המרצה הדגיש שהנושא הזה מופיע כמעט בכל מבחן, בדרך כלל בשאלה הראשונה ובעוד מקומות רבים אחרים';
    const out = matchSnippet(text, searchRegex('מבחן'), 20, 20)!;
    expect(out).toContain('<span class="highlight">מבחן</span>');
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(matchSnippet('אין כאן כלום', searchRegex('מבחן'))).toBeNull();
    expect(matchSnippet('מבחן', searchRegex('מבחן'))).toBe('<span class="highlight">מבחן</span>');
  });
});
