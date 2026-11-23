import { BadRequestException } from '@nestjs/common';

/** A Tiptap (ProseMirror) JSON node, as the client's Pouch editor writes it. */
export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: PmMark[];
}

export interface PmMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** The node and mark types the Pouch editor has; anything else is refused. */
export const NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'text',
  'hardBreak',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'horizontalRule',
  'pageBreak',
  'timeline',
  'image',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'repeatBlock',
  'field',
]);

export const MARK_TYPES = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'subscript', 'superscript', 'link', 'textStyle']);

const MAX_DEPTH = 40;
const MAX_NODES = 100_000;
const MAX_TEXT = 200_000;
/** Inline images arrive as data URLs. */
const MAX_IMAGE_SRC = 10 * 1024 * 1024;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Attribute values are plain: strings, numbers, booleans, null, or arrays of numbers (table column widths). */
function validAttrs(v: unknown, path: string, maxString: number): Record<string, unknown> | undefined {
  if (v === undefined) return undefined;
  if (!isRecord(v)) throw invalid(path, 'attrs must be an object');
  for (const [k, value] of Object.entries(v)) {
    const ok =
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= maxString) ||
      (Array.isArray(value) && value.length <= 100 && value.every((n) => n === null || (typeof n === 'number' && Number.isFinite(n))));
    if (!ok) throw invalid(`${path}.attrs.${k}`, 'unsupported attribute value');
  }
  return v;
}

const invalid = (path: string, message: string) => new BadRequestException({ message: 'Invalid document', issues: [{ path, message }] });

/**
 * Check that `value` is a Pouch document: known node and mark types, plain attributes, bounded depth and size. Returns
 * it typed; throws a 400 otherwise. Structure beyond that (what may contain what) is the editor's schema's business; the
 * Word renderer copes with any nesting.
 */
export function checkDoc(value: unknown): PmNode {
  let count = 0;
  const walk = (v: unknown, path: string, depth: number): PmNode => {
    if (depth > MAX_DEPTH) throw invalid(path, 'nested too deeply');
    if (++count > MAX_NODES) throw invalid(path, 'document too large');
    if (!isRecord(v) || typeof v.type !== 'string') throw invalid(path, 'not a node');
    if (!NODE_TYPES.has(v.type)) throw invalid(path, `unknown node type "${v.type}"`);
    if (v.text !== undefined && (typeof v.text !== 'string' || v.text.length > MAX_TEXT)) throw invalid(path, 'bad text');
    validAttrs(v.attrs, path, v.type === 'image' ? MAX_IMAGE_SRC : MAX_TEXT);
    if (v.marks !== undefined) {
      if (!Array.isArray(v.marks) || v.marks.length > 20) throw invalid(path, 'bad marks');
      v.marks.forEach((m, i) => {
        if (!isRecord(m) || typeof m.type !== 'string' || !MARK_TYPES.has(m.type)) throw invalid(`${path}.marks.${i}`, 'unknown mark');
        validAttrs(m.attrs, `${path}.marks.${i}`, 4000);
      });
    }
    if (v.content !== undefined) {
      if (!Array.isArray(v.content)) throw invalid(path, 'content must be a list');
      v.content.forEach((c, i) => walk(c, `${path}.content.${i}`, depth + 1));
    }
    return v as unknown as PmNode;
  };
  const doc = walk(value, 'doc', 0);
  if (doc.type !== 'doc') throw invalid('doc', 'the top node must be a doc');
  return doc;
}
