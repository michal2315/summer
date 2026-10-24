import { SearchType } from '../models';
import { highlightHtml, highlightText, regexFor, searchRegex } from './highlight';

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

  it('strips a leading # so "#label" matches the label text', () => {
    expect(highlightText('מועד א', searchRegex('#מועד'))).toContain('<span class="highlight">מועד</span>');
  });
});
