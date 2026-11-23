import { NO_CAPSULES, capsuleLookup } from '../capsules/capsule';
import { foldText } from '../common/sql';
import { MARK, summarySearchSchema } from '../summaries/summary-search';
import { describeSearch, excerptAround, foundLabels, jsRegex, markHtml, searchHighlights } from './alert-explain';

const search = (s: Record<string, unknown>) => summarySearchSchema.parse(s);
const names = { users: new Map([['00000000-0000-0000-0000-000000000001', 'מיכל גולן']]), folders: new Map(), contentTypes: new Map([['lecture', 'הרצאה']]), fields: new Map(), capsules: NO_CAPSULES };
const TZ = 'Asia/Jerusalem';

describe('alert explain', () => {
  it('says what a search asks for', () => {
    const s = search({ text: `רמב"ם ${MARK}או "שיעור כללי" ${MARK}לא טיוטה`, contentTypes: 'lecture', users: '00000000-0000-0000-0000-000000000001', labels: 'הלכה' });
    expect(describeSearch(s, names, TZ)).toEqual([
      'תואמות לחיפוש "רמב"ם" או "שיעור כללי" וגם בלי "טיוטה"',
      'מסוג הרצאה',
      'עם התגית #הלכה',
      'שנכתבו על ידי מיכל גולן',
    ]);
  });

  it('says what an advanced tree asks for', () => {
    const s = search({
      query: JSON.stringify({
        type: 'group',
        op: 'AND',
        children: [
          { type: 'cond', field: 'title', op: 'any', words: ['ינשוף', 'עורב'] },
          { type: 'cond', field: 'contentType', op: 'isNot', values: ['lecture'] },
        ],
      }),
    });
    expect(describeSearch(s, names, TZ)).toEqual(['מכילות אחת מ־"ינשוף" / "עורב" בכותרת וגם שאינן מסוג הרצאה']);
  });

  it('finds and marks the words it looks for, folded and case-insensitive', () => {
    const s = search({ text: `שלום ${MARK}/\\bapp\\w*/ ${MARK}לא בננה` });
    const hs = searchHighlights(s, NO_CAPSULES);
    expect(hs.map((h) => h.label)).toEqual(['שלום', '/\\bapp\\w*/']);
    expect(foundLabels(hs, { title: 'שלום עולם', content: 'Apples and pears', labels: [] })).toEqual(['שלום', '/\\bapp\\w*/']);
    expect(markHtml('אמר שלומ <b>', hs, 'content')).toBe('אמר <mark style="background-color:#fff1a8;color:#01004f;border-radius:3px;padding:0 2px;">שלומ</mark> &lt;b&gt;');
  });

  it('keeps field terms to their field and expands capsules', () => {
    const capsules = capsuleLookup([{ id: 'c1', name: 'עופות', description: '', words: [{ word: 'ינשוף', condition: 'optional' }, { word: 'חתול', condition: 'mustNot' }] }]);
    const s = search({ text: `${MARK}:כותרת:ציפור ${MARK}#עופות` });
    const hs = searchHighlights(s, capsules);
    expect(hs.map((h) => [h.label, h.where])).toEqual([
      ['ציפור', 'title'],
      ['ינשוף', 'any'],
    ]);
    expect(foundLabels(hs, { title: 'אין', content: 'ציפור וינשוף', labels: [] })).toEqual(['ינשוף']);
  });

  it('starts the excerpt near the first match', () => {
    const hs = searchHighlights(search({ text: 'מטרה' }), NO_CAPSULES);
    const text = `${'מילה '.repeat(100)}הנה המטרה כאן ${'סוף '.repeat(50)}`;
    const ex = excerptAround(text, hs, 80);
    expect(ex.startsWith('…')).toBe(true);
    expect(ex).toContain('המטרה');
    expect(excerptAround('קצר', hs, 80)).toBe('קצר');
  });

  it('translates search regexes for JavaScript', () => {
    expect(new RegExp(jsRegex('\\bשלום\\b')!, 'u').test(foldText('אמר שלום לכולם'))).toBe(true);
    expect(new RegExp(jsRegex('\\bשלום\\b')!, 'u').test(foldText('ושלום'))).toBe(false);
    expect(jsRegex('(?<x>a)')).toBeNull();
  });
});
