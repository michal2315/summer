import { PouchDoc, PouchMode } from '../../shared/models';

const text = (t: string, bold = false): PouchDoc => ({ type: 'text', text: t, ...(bold ? { marks: [{ type: 'bold' }] } : {}) });
const field = (key: string, label: string): PouchDoc => ({ type: 'field', attrs: { key, label } });
const p = (...content: PouchDoc[]): PouchDoc => ({ type: 'paragraph', ...(content.length ? { content } : {}) });

/** A new format's first page, so the idea is clear at a glance: a title, then a block per summary. */
export function starterDoc(mode: PouchMode): PouchDoc {
  if (mode === 'combined') {
    return {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('ריכוז תמציות')] },
        p(text('כותרות: ', true), field('title', 'כותרת')),
        p(text('תאריכים: ', true), field('eventDate', 'תאריך האירוע')),
        p(),
      ],
    };
  }
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [text('ריכוז תמציות')] },
      p(text('מסמך זה כולל את התמציות שנבחרו.')),
      {
        type: 'repeatBlock',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [field('title', 'כותרת')] },
          p(text('תאריך: ', true), field('eventDate', 'תאריך האירוע'), text(' · '), text('מחבר: ', true), field('author', 'מחבר')),
          p(field('content', 'תוכן')),
        ],
      },
      p(),
    ],
  };
}
