import { ISummary, PouchDoc, PouchMode } from '../../shared/models';
import { fieldHtml, fieldText, isRichField } from './pouch-fields';

/** What fills a chip: text (inheriting the chip's marks), or blocks for a rich field in per-summary mode. */
type Value = { text: string } | { blocks: PouchDoc[] };
type ValueOf = (key: string) => Value;

export interface FillOptions {
  /** Rich text (Quill HTML) → block nodes in the editor's schema. */
  htmlToBlocks: (html: string) => PouchDoc[];
  /** Base for the summary link field (defaults to this page's origin). */
  origin?: string;
}

const TEXTBLOCKS = new Set(['paragraph', 'heading']);

const isField = (n: PouchDoc) => n.type === 'field';
const keyOf = (n: PouchDoc) => String(n.attrs?.['key'] ?? '');

/** Every summary's value of a field, comma-separated; summaries without one are skipped (repeats are kept). */
function combined(summaries: ISummary[], key: string, origin?: string): string {
  return summaries
    .map((s) => fieldText(s, key, origin))
    .filter(Boolean)
    .join(', ');
}

function textNode(text: string, chip: PouchDoc): PouchDoc[] {
  return text ? [{ type: 'text', text, ...(chip.marks?.length ? { marks: chip.marks } : {}) }] : [];
}

/** Inline content with each chip replaced by its text. */
function fillInline(nodes: PouchDoc[], valueOf: ValueOf): PouchDoc[] {
  return nodes.flatMap((n) => {
    if (!isField(n)) return [n];
    const v = valueOf(keyOf(n));
    return 'text' in v ? textNode(v.text, n) : textNode(v.blocks.map(blockText).join(' '), n);
  });
}

type Mark = NonNullable<PouchDoc['marks']>[number];

/**
 * The chip's formatting laid under rich content: each text gets the chip's marks it doesn't have itself, and the chip's
 * text style (font, size, colour) where its own doesn't set one. So a blue 14pt content chip fills in blue 14pt, while
 * the summary's own bold, links and colours stay.
 */
function underlay(nodes: PouchDoc[], chipMarks: Mark[] | undefined): PouchDoc[] {
  if (!chipMarks?.length) return nodes;
  const merge = (own: Mark[] = []): Mark[] => {
    const out = [...own];
    for (const m of chipMarks) {
      const i = out.findIndex((x) => x.type === m.type);
      if (i < 0) out.push(m);
      else if (m.type === 'textStyle') {
        const attrs = { ...m.attrs };
        for (const [k, v] of Object.entries(out[i].attrs ?? {})) if (v !== null && v !== undefined && v !== '') attrs[k] = v;
        out[i] = { type: 'textStyle', attrs };
      }
    }
    return out;
  };
  return nodes.map((n) =>
    n.type === 'text' ? { ...n, marks: merge(n.marks) } : n.content ? { ...n, content: underlay(n.content, chipMarks) } : n,
  );
}

const blockText = (n: PouchDoc): string => (n.text ?? '') + (n.content ?? []).map(blockText).join(n.type === 'paragraph' ? '' : ' ');

/**
 * A paragraph or heading. A rich chip in it splits it: the text before the chip, the field's own blocks, the text after
 * (each part keeping the paragraph's type and alignment, empty parts dropped). A single-paragraph value stays inline.
 */
function fillTextblock(node: PouchDoc, valueOf: ValueOf): PouchDoc[] {
  const content = node.content ?? [];
  const out: PouchDoc[] = [];
  let run: PouchDoc[] = [];
  let split = false;
  const flush = (keepEmpty: boolean) => {
    if (run.length || keepEmpty) out.push({ ...node, content: run });
    run = [];
  };
  for (const child of content) {
    if (!isField(child)) {
      run.push(child);
      continue;
    }
    const v = valueOf(keyOf(child));
    if ('text' in v) {
      run.push(...textNode(v.text, child));
    } else if (v.blocks.length === 1 && v.blocks[0].type === 'paragraph') {
      run.push(...underlay(v.blocks[0].content ?? [], child.marks));
    } else if (v.blocks.length) {
      flush(false);
      out.push(...underlay(v.blocks, child.marks));
      split = true;
    }
  }
  flush(!split);
  return out.map((n) => (n.content && !n.content.length ? { ...n, content: undefined } : n));
}

/** A timeline block's filling (all the summaries, by date), given its `detail`. */
type TimelineOf = (detail: string) => PouchDoc[];

function fillBlocks(nodes: PouchDoc[], valueOf: ValueOf, timeline: TimelineOf): PouchDoc[] {
  return nodes.flatMap((n) => {
    if (n.type === 'timeline') return timeline(String(n.attrs?.['detail'] ?? 'title'));
    if (TEXTBLOCKS.has(n.type)) return fillTextblock(n, valueOf);
    if (!n.content) return [n];
    // Inline containers other than paragraphs/headings don't exist in the schema, but be safe.
    const inline = n.content.some((c) => c.type === 'text' || isField(c));
    return [{ ...n, content: inline ? fillInline(n.content, valueOf) : fillBlocks(n.content, valueOf, timeline) }];
  });
}

const TIMELINE_EXCERPT = 240;

/**
 * The timeline: every summary by event date (undated ones by when they were written, at the end), as a two-column
 * table — the date, shaded, then the title in bold with (for `detail: 'content'`) the start of its content under it.
 */
function timelineTable(summaries: ISummary[], detail: string, origin?: string): PouchDoc[] {
  const when = (s: ISummary) => (s.eventDate ? 0 : 1) * 1e15 + new Date(s.eventDate ?? s.creationDate).getTime();
  const rows = [...summaries]
    .sort((a, b) => when(a) - when(b))
    .map((s): PouchDoc => {
      const date = fieldText(s, 'eventDate', origin) || fieldText(s, 'creationDate', origin);
      const body = detail === 'content' ? fieldText(s, 'content', origin) : '';
      const excerpt = body.length > TIMELINE_EXCERPT ? `${body.slice(0, TIMELINE_EXCERPT).trimEnd()}…` : body;
      const title: PouchDoc = { type: 'paragraph', content: textNode(s.title || '(ללא כותרת)', { type: 'field', marks: [{ type: 'bold' }] }) };
      const cells: PouchDoc[] = [title, ...(excerpt ? [{ type: 'paragraph', content: textNode(excerpt, { type: 'field' }) }] : [])];
      return {
        type: 'tableRow',
        content: [
          { type: 'tableCell', attrs: { backgroundColor: '#fff5ee' }, content: [{ type: 'paragraph', content: textNode(date, { type: 'field', marks: [{ type: 'bold' }] }) }] },
          { type: 'tableCell', content: cells },
        ],
      };
    });
  if (!rows.length) return [];
  return [{ type: 'table', content: [{ type: 'tableRow', content: [header('תאריך'), header('תמצית')] }, ...rows] }];
}

const header = (t: string): PouchDoc => ({ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

/**
 * Fill a format with summaries. Per summary: the repeat block's content once for each summary, in order, between the
 * start and the end; chips in the start and end (and every chip in combined mode) list all the summaries' values,
 * comma-separated, as plain text. A rich field (content, notes) keeps its formatting inside the repeat block.
 * Fields a summary doesn't have come out blank. A timeline, wherever it is, lists all the summaries by date.
 */
export function fillDoc(doc: PouchDoc, mode: PouchMode, summaries: ISummary[], o: FillOptions): PouchDoc {
  const all: ValueOf = (key) => ({ text: combined(summaries, key, o.origin) });
  const timeline: TimelineOf = (detail) => timelineTable(summaries, detail, o.origin);
  const top = doc.content ?? [];
  if (mode === 'combined') return { type: 'doc', content: fillBlocks(top.flatMap(unwrap), all, timeline) };

  const one =
    (s: ISummary): ValueOf =>
    (key) => {
      if (!isRichField(key)) return { text: fieldText(s, key, o.origin) };
      const html = fieldHtml(s, key);
      return { blocks: html ? o.htmlToBlocks(html) : [] };
    };
  const content = top.flatMap((n) => (n.type === 'repeatBlock' ? summaries.flatMap((s) => fillBlocks(n.content ?? [], one(s), timeline)) : fillBlocks([n], all, timeline)));
  return { type: 'doc', content };
}

const unwrap = (n: PouchDoc): PouchDoc[] => (n.type === 'repeatBlock' ? (n.content ?? []) : [n]);

/** Field keys a document uses, in order of first use. */
export function usedFields(doc: PouchDoc): string[] {
  const keys: string[] = [];
  const walk = (n: PouchDoc) => {
    if (isField(n) && !keys.includes(keyOf(n))) keys.push(keyOf(n));
    n.content?.forEach(walk);
  };
  walk(doc);
  return keys;
}
