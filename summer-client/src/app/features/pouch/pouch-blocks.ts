import { PouchDoc } from '../../shared/models';

/** A ready-made piece of a format, dragged (or clicked) in from the sidebar. */
export interface PouchBlock {
  key: string;
  label: string;
  /** A glyph for the tile. */
  glyph: string;
  hint: string;
  content: PouchDoc[];
}

const text = (t: string, bold = false): PouchDoc => ({ type: 'text', text: t, ...(bold ? { marks: [{ type: 'bold' }] } : {}) });
const field = (key: string, label: string): PouchDoc => ({ type: 'field', attrs: { key, label } });
const p = (...content: PouchDoc[]): PouchDoc => ({ type: 'paragraph', ...(content.length ? { content } : {}) });
const cell = (type: 'tableCell' | 'tableHeader', ...content: PouchDoc[]): PouchDoc => ({ type, content: [p(...content)] });
const row = (label: string, f: PouchDoc): PouchDoc => ({ type: 'tableRow', content: [cell('tableHeader', text(label)), cell('tableCell', f)] });

export const POUCH_BLOCKS: PouchBlock[] = [
  {
    key: 'heading',
    label: 'כותרת ופרטים',
    glyph: 'H',
    hint: 'כותרת התמצית, ותחתיה תאריך ומחבר',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [field('title', 'כותרת')] },
      p(text('תאריך: ', true), field('eventDate', 'תאריך האירוע'), text(' · '), text('מחבר: ', true), field('author', 'מחבר')),
    ],
  },
  {
    key: 'details',
    label: 'טבלת פרטים',
    glyph: '▦',
    hint: 'טבלה של שם שדה וערכו',
    content: [
      {
        type: 'table',
        content: [
          row('כותרת', field('title', 'כותרת')),
          row('תאריך', field('eventDate', 'תאריך האירוע')),
          row('מחבר', field('author', 'מחבר')),
          row('סוג', field('contentType', 'סוג תוכן')),
          row('תגיות', field('labels', 'תגיות')),
        ],
      },
      p(),
    ],
  },
  {
    key: 'content',
    label: 'תוכן התמצית',
    glyph: '¶',
    hint: 'התוכן המלא, עם העיצוב שלו',
    content: [p(field('content', 'תוכן'))],
  },
  {
    key: 'timeline',
    label: 'ציר זמן',
    glyph: '⟟',
    hint: 'כל התמציות לפי תאריך',
    content: [{ type: 'timeline', attrs: { detail: 'title' } }, p()],
  },
  {
    key: 'timeline-content',
    label: 'ציר זמן עם תוכן',
    glyph: '⟟',
    hint: 'כל התמציות לפי תאריך, עם תחילת התוכן',
    content: [{ type: 'timeline', attrs: { detail: 'content' } }, p()],
  },
  {
    key: 'rule',
    label: 'קו מפריד',
    glyph: '—',
    hint: 'קו לרוחב העמוד',
    content: [{ type: 'horizontalRule' }],
  },
  {
    key: 'pageBreak',
    label: 'מעבר עמוד',
    glyph: '⤓',
    hint: 'מה שאחריו מתחיל בעמוד חדש',
    content: [{ type: 'pageBreak' }],
  },
];
