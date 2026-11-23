import { FieldsType, ISummary, PouchDoc } from '../../shared/models';
import { fieldGroups, fieldText } from './pouch-fields';
import { fillDoc, usedFields } from './pouch-fill';
import { quillToHtml } from './quill-html';

const summary = (over: Partial<ISummary>): ISummary =>
  ({
    _id: 's1',
    title: 'כותרת',
    content: '<p>תוכן</p>',
    notes: '',
    department: '',
    user: { _id: 'u', username: 'u', fullName: 'דנה' },
    isDraft: false,
    creationDate: '2026-01-02T10:00:00Z',
    modifyDate: '2026-01-03T10:00:00Z',
    contentType: { _id: 't', name: 'lecture', displayName: 'הרצאה' },
    labels: [],
    comments: [],
    files: [],
    taggedUsers: [],
    taggedPermissions: [],
    folders: [],
    permissions: [],
    seenBy: [],
    color: '',
    isFavorite: false,
    canEdit: false,
    kind: 'summary',
    ...over,
  }) as ISummary;

const text = (t: string): PouchDoc => ({ type: 'text', text: t });
const field = (key: string): PouchDoc => ({ type: 'field', attrs: { key, label: key } });
const p = (...content: PouchDoc[]): PouchDoc => ({ type: 'paragraph', content });

/** Test stand-in for the browser parser: one paragraph per <p>. */
const htmlToBlocks = (html: string): PouchDoc[] =>
  [...html.matchAll(/<p>(.*?)<\/p>/g)].map((m) => (m[1] ? p(text(m[1])) : { type: 'paragraph' }));

const texts = (n: PouchDoc): string[] => (n.text ? [n.text] : (n.content ?? []).flatMap(texts));

describe('fillDoc', () => {
  const a = summary({ _id: 'a', title: 'אלף', content: '<p>שורה 1</p><p>שורה 2</p>' });
  const b = summary({ _id: 'b', title: 'בית', content: '<p>יחיד</p>' });

  it('repeats the repeat block per summary between the start and the end', () => {
    const doc: PouchDoc = {
      type: 'doc',
      content: [p(text('פתיחה')), { type: 'repeatBlock', content: [p(text('כותרת: '), field('title'))] }, p(text('סיום'))],
    };
    const out = fillDoc(doc, 'perSummary', [a, b], { htmlToBlocks });
    expect(out.content!.map((n) => texts(n).join(''))).toEqual(['פתיחה', 'כותרת: אלף', 'כותרת: בית', 'סיום']);
  });

  it('lists every value comma-separated outside the repeat block and in combined mode', () => {
    const doc: PouchDoc = { type: 'doc', content: [p(text('כותרות: '), field('title'))] };
    expect(texts(fillDoc(doc, 'perSummary', [a, b], { htmlToBlocks })).join('')).toBe('כותרות: אלף, בית');
    expect(texts(fillDoc(doc, 'combined', [a, b], { htmlToBlocks })).join('')).toBe('כותרות: אלף, בית');
  });

  it('combined mode drops the repeat block wrapper and skips blank values', () => {
    const c = summary({ _id: 'c', title: '' });
    const doc: PouchDoc = { type: 'doc', content: [{ type: 'repeatBlock', content: [p(field('title'))] }] };
    const out = fillDoc(doc, 'combined', [a, c, b], { htmlToBlocks });
    expect(out.content!.length).toBe(1);
    expect(texts(out).join('')).toBe('אלף, בית');
  });

  it('keeps rich content as blocks, splitting the paragraph around it', () => {
    const doc: PouchDoc = { type: 'doc', content: [{ type: 'repeatBlock', content: [p(text('לפני '), field('content'), text(' אחרי'))] }] };
    const out = fillDoc(doc, 'perSummary', [a], { htmlToBlocks });
    expect(out.content!.map((n) => texts(n).join(''))).toEqual(['לפני ', 'שורה 1', 'שורה 2', ' אחרי']);
  });

  it('puts a one-paragraph rich value inline', () => {
    const doc: PouchDoc = { type: 'doc', content: [{ type: 'repeatBlock', content: [p(text('תוכן: '), field('content'))] }] };
    const out = fillDoc(doc, 'perSummary', [b], { htmlToBlocks });
    expect(out.content!.length).toBe(1);
    expect(texts(out).join('')).toBe('תוכן: יחיד');
  });

  it('leaves a field blank when the summary has none, keeping the chip marks on filled ones', () => {
    const bold = [{ type: 'bold' }];
    const doc: PouchDoc = {
      type: 'doc',
      content: [{ type: 'repeatBlock', content: [p({ type: 'field', attrs: { key: 'field:x' }, marks: bold }), p({ type: 'field', attrs: { key: 'title' }, marks: bold })] }],
    };
    const out = fillDoc(doc, 'perSummary', [a], { htmlToBlocks });
    expect(out.content![0].content).toBeUndefined();
    expect(out.content![1].content).toEqual([{ type: 'text', text: 'אלף', marks: bold }]);
  });

  it('lays the chip formatting under rich content, its own formatting winning', () => {
    const blue = { type: 'textStyle', attrs: { color: '#0000ff', fontSize: '14pt' } };
    const rich = (html: string): PouchDoc[] => [p({ type: 'text', text: 'א', marks: [{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: null } }] }), p(text(html.length ? 'ב' : ''))];
    const doc: PouchDoc = { type: 'doc', content: [{ type: 'repeatBlock', content: [p({ type: 'field', attrs: { key: 'content' }, marks: [blue, { type: 'bold' }] })] }] };
    const out = fillDoc(doc, 'perSummary', [a], { htmlToBlocks: rich });
    expect(out.content![0].content![0].marks).toEqual([{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: '14pt' } }, { type: 'bold' }]);
    expect(out.content![1].content![0].marks).toEqual([blue, { type: 'bold' }]);
  });

  it('fills fields inside tables and lists', () => {
    const doc: PouchDoc = {
      type: 'doc',
      content: [
        {
          type: 'repeatBlock',
          content: [
            { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p(field('title'))] }] }] },
            { type: 'bulletList', content: [{ type: 'listItem', content: [p(field('author'))] }] },
          ],
        },
      ],
    };
    expect(texts(fillDoc(doc, 'perSummary', [a], { htmlToBlocks }))).toEqual(['אלף', 'דנה']);
  });

  it('fills a timeline with every summary by date, as a table', () => {
    const late = summary({ _id: 'l', title: 'מאוחרת', eventDate: '2026-06-01T10:00:00' });
    const early = summary({ _id: 'e', title: 'מוקדמת', eventDate: '2026-02-01T10:00:00', content: '<p>פרטים</p>' });
    const doc: PouchDoc = { type: 'doc', content: [{ type: 'timeline', attrs: { detail: 'content' } }] };
    const [table] = fillDoc(doc, 'combined', [late, early], { htmlToBlocks }).content!;
    expect(table.type).toBe('table');
    expect(table.content!.map((r) => texts(r))).toEqual([
      ['תאריך', 'תמצית'],
      ['01/02/2026', 'מוקדמת', 'פרטים'],
      ['01/06/2026', 'מאוחרת', 'תוכן'],
    ]);
  });

  it('lists the fields a document uses', () => {
    const doc: PouchDoc = { type: 'doc', content: [p(field('title'), field('author'), field('title'))] };
    expect(usedFields(doc)).toEqual(['title', 'author']);
  });
});

describe('fieldText', () => {
  it('formats dates, lists and custom fields', () => {
    const s = summary({
      eventDate: '2026-05-12T09:00:00',
      labels: [{ name: 'א' }, { name: 'ב' }],
      summaryFields: [
        { field: { _id: 'd', name: 'מועד', type: FieldsType.Date }, value: '2026-03-04T00:00:00' },
        { field: { _id: 'n', name: 'מספר', type: FieldsType.Number }, value: '7' },
      ],
    });
    expect(fieldText(s, 'eventDate')).toBe('12/05/2026');
    expect(fieldText(s, 'labels')).toBe('א, ב');
    expect(fieldText(s, 'field:d')).toBe('04/03/2026');
    expect(fieldText(s, 'field:n')).toBe('7');
    expect(fieldText(s, 'field:missing')).toBe('');
    expect(fieldText(s, 'content')).toBe('תוכן');
    expect(fieldText(s, 'link', 'https://summer.test')).toBe('https://summer.test/summaries/s1');
  });

  it('groups the sidebar: common fields, per intel type, then custom', () => {
    const fields = [
      { _id: 'f1', name: 'מרצה', type: FieldsType.String },
      { _id: 'f2', name: 'אורך', type: FieldsType.Number },
    ];
    const groups = fieldGroups([{ _id: 't', name: 'lecture', displayName: 'הרצאה', fields: [{ field: 'f1', required: false }] }], fields);
    expect(groups.map((g) => g.label)).toEqual(['שדות כלליים', 'הרצאה', 'שדות מותאמים']);
    expect(groups[1].fields.map((f) => f.key)).toEqual(['field:f1']);
    expect(groups[2].fields.map((f) => f.label)).toEqual(['אורך', 'מרצה']);
  });
});

describe('quillToHtml', () => {
  it('turns Quill lists into real lists, nesting by indent', () => {
    const html = quillToHtml(
      '<ol><li data-list="bullet"><span class="ql-ui"></span>א</li><li data-list="bullet" class="ql-indent-1">ב</li><li data-list="ordered">ג</li></ol>',
    );
    const doc = new DOMParser().parseFromString(html, 'text/html').body;
    expect(doc.querySelector(':scope > ul > li > ul > li')?.textContent).toBe('ב');
    expect(doc.querySelector(':scope > ol > li')?.textContent).toBe('ג');
    expect(doc.querySelector('.ql-ui')).toBeNull();
  });

  it('turns alignment and size classes into styles', () => {
    const html = quillToHtml('<p class="ql-align-center"><span class="ql-size-large">x</span></p>');
    expect(html).toContain('text-align: center');
    expect(html).toContain('font-size: 14pt');
    expect(html).not.toContain('class=');
  });
});
