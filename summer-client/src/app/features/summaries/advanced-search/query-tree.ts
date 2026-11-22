import { FieldsType, IQueryCondition, IQueryGroup, QueryField, QueryOp } from '../../../shared/models';
import { isCapsuleToken } from '../../../shared/utils/capsules';

/**
 * Query builder vocabulary and tree helpers. The server (summary-search.ts) validates the same fields and operators.
 * number and list are catalog fields only (a content type's number / array fields).
 */
export type FieldKind = 'text' | 'value' | 'date' | 'number' | 'list';

/** `field` is a catalog field: its label and kind come from the field itself (catalogKind). */
export const FIELDS: Record<QueryField, { label: string; kind: FieldKind; icon: string }> = {
  text: { label: 'כל מקום', kind: 'text', icon: 'search' },
  title: { label: 'כותרת', kind: 'text', icon: 'file-text' },
  content: { label: 'תוכן התמצית', kind: 'text', icon: 'read' },
  notes: { label: 'הערות', kind: 'text', icon: 'edit' },
  comments: { label: 'תגובות', kind: 'text', icon: 'message' },
  labels: { label: 'תגיות', kind: 'text', icon: 'highlight' },
  author: { label: 'כותב/ת', kind: 'value', icon: 'team' },
  contentType: { label: 'סוג תוכן', kind: 'value', icon: 'appstore' },
  folder: { label: 'תיקייה', kind: 'value', icon: 'folder' },
  color: { label: 'צבע', kind: 'value', icon: 'star' },
  eventDate: { label: 'תאריך האירוע', kind: 'date', icon: 'calendar' },
  createdDate: { label: 'תאריך יצירה', kind: 'date', icon: 'field-time' },
  field: { label: 'שדה', kind: 'text', icon: 'profile' },
};
/** The built-in fields, in picker order (catalog fields are listed after them). */
export const FIELD_KEYS = (Object.keys(FIELDS) as QueryField[]).filter((f) => f !== 'field');

export const OPS: Record<QueryOp, string> = {
  all: 'מכיל את כל המילים',
  any: 'מכיל לפחות אחת',
  none: 'לא מכיל אף אחת',
  isOneOf: 'הוא אחד מ־',
  isNot: 'אינו',
  after: 'אחרי',
  before: 'לפני',
  between: 'בין',
  eq: 'שווה ל־',
  gt: 'גדול מ־',
  lt: 'קטן מ־',
  range: 'בין',
};
/** List fields read their two operators differently. */
const LIST_OPS: Partial<Record<QueryOp, string>> = { isOneOf: 'כולל אחד מ־', isNot: 'לא כולל אף אחד מ־' };
export const opLabel = (op: QueryOp, kind: FieldKind) => (kind === 'list' ? LIST_OPS[op] : undefined) ?? OPS[op];

export const OPS_BY_KIND: Record<FieldKind, QueryOp[]> = {
  text: ['all', 'any', 'none'],
  value: ['isOneOf', 'isNot'],
  date: ['after', 'before', 'between'],
  number: ['eq', 'gt', 'lt', 'range'],
  list: ['isOneOf', 'isNot'],
};
/** must / optional / exclusion — colors the operator in the row */
export const opTone = (op: QueryOp) => (op === 'none' || op === 'isNot' ? 'not' : op === 'any' ? 'opt' : 'must');

/** How a catalog field of this type is searched (hour fields read as text). */
export function catalogKind(type: FieldsType): FieldKind {
  if (type === FieldsType.Number) return 'number';
  if (type === FieldsType.Date) return 'date';
  if (type === FieldsType.Array) return 'list';
  return 'text';
}

const OP_KIND: Record<QueryOp, FieldKind> = {
  all: 'text',
  any: 'text',
  none: 'text',
  eq: 'number',
  gt: 'number',
  lt: 'number',
  range: 'number',
  after: 'date',
  before: 'date',
  between: 'date',
  isOneOf: 'list',
  isNot: 'list',
};

/** A condition's kind: a built-in field's own; a catalog field's follows from its operator (each kind has its own). */
export const kindOf = (c: Pick<IQueryCondition, 'field' | 'op'>): FieldKind => (c.field === 'field' ? OP_KIND[c.op] : FIELDS[c.field].kind);

/** Which bounds an operator reads: eq / gt / after read `from`, lt / before read `to`, range / between both. */
export const readsFrom = (op: QueryOp) => op !== 'lt' && op !== 'before';
export const readsTo = (op: QueryOp) => op !== 'eq' && op !== 'gt' && op !== 'after';

// ---------------------------------------------------------------- editable tree (nodes carry ids for tracking)

export interface EditCondition extends IQueryCondition {
  id: string;
  words: string[];
  values: string[];
}
export interface EditGroup {
  id: string;
  type: 'group';
  op: 'AND' | 'OR';
  children: EditNode[];
}
export type EditNode = EditCondition | EditGroup;

let nextId = 0;
const newId = () => `q${++nextId}`;

export const newCondition = (field: QueryField = 'text'): EditCondition => ({
  id: newId(),
  type: 'cond',
  field,
  op: OPS_BY_KIND[FIELDS[field].kind][0],
  words: [],
  values: [],
});
export const newGroup = (op: 'AND' | 'OR' = 'AND'): EditGroup => ({ id: newId(), type: 'group', op, children: [newCondition()] });

export function toEditable(q: IQueryGroup | undefined): EditGroup {
  if (!q?.children.length) return newGroup();
  const walk = (n: IQueryGroup | IQueryCondition): EditNode =>
    n.type === 'group'
      ? { id: newId(), type: 'group', op: n.op, children: n.children.map(walk) }
      : { ...n, id: newId(), words: n.words ?? [], values: n.values ?? [] };
  return walk(q) as EditGroup;
}

/** A condition on a catalog field, starting with the first operator of its kind. */
export const newCatalogCondition = (fieldId: string, type: FieldsType): EditCondition => ({
  ...newCondition('field'),
  fieldId,
  op: OPS_BY_KIND[catalogKind(type)][0],
});

const filled = (v: string | undefined) => !!v && v.trim() !== '';

export function isEmptyCondition(c: IQueryCondition): boolean {
  if (c.field === 'field' && !c.fieldId) return true;
  const kind = kindOf(c);
  if (kind === 'text') return !c.words?.some((w) => w.trim());
  if (kind === 'value' || kind === 'list') return !c.values?.length;
  return !(readsFrom(c.op) && filled(c.from)) && !(readsTo(c.op) && filled(c.to));
}

/** Editable tree → what is sent: no ids, no empty conditions or groups, only the keys each field uses. Undefined if nothing is left. */
export function toQuery(g: EditGroup): IQueryGroup | undefined {
  const children = g.children
    .map((c): IQueryGroup | IQueryCondition | undefined => {
      if (c.type === 'group') return toQuery(c);
      if (isEmptyCondition(c)) return undefined;
      const kind = kindOf(c);
      const base = { type: 'cond' as const, field: c.field, ...(c.field === 'field' ? { fieldId: c.fieldId } : {}), op: c.op };
      if (kind === 'text') return { ...base, words: c.words.map((w) => w.trim()).filter(Boolean) };
      if (kind === 'value' || kind === 'list') return { ...base, values: c.values };
      return { ...base, ...(readsFrom(c.op) && filled(c.from) ? { from: c.from!.trim() } : {}), ...(readsTo(c.op) && filled(c.to) ? { to: c.to!.trim() } : {}) };
    })
    .filter((c) => !!c);
  return children.length ? { type: 'group', op: g.op, children } : undefined;
}

export function countConditions(g: IQueryGroup): number {
  return g.children.reduce((n, c) => n + (c.type === 'group' ? countConditions(c) : isEmptyCondition(c) ? 0 : 1), 0);
}

export function updateNode(root: EditGroup, id: string, patch: Partial<EditCondition> | Partial<EditGroup>): EditGroup {
  const walk = (n: EditNode): EditNode => {
    if (n.id === id) return { ...n, ...patch } as EditNode;
    return n.type === 'group' ? { ...n, children: n.children.map(walk) } : n;
  };
  return walk(root) as EditGroup;
}

export function removeNode(root: EditGroup, id: string): EditGroup {
  const walk = (g: EditGroup): EditGroup => ({ ...g, children: g.children.filter((c) => c.id !== id).map((c) => (c.type === 'group' ? walk(c) : c)) });
  return walk(root);
}

export function addChild(root: EditGroup, groupId: string, child: EditNode): EditGroup {
  const walk = (g: EditGroup): EditGroup =>
    g.id === groupId ? { ...g, children: [...g.children, child] } : { ...g, children: g.children.map((c) => (c.type === 'group' ? walk(c) : c)) };
  return walk(root);
}

// ---------------------------------------------------------------- the query as a Hebrew sentence

export type SentenceClass = 'lead' | 'not' | 'term' | 'capsule' | 'join-and' | 'join-or' | 'paren' | 'dim';
export interface SentencePart {
  text: string;
  cls: SentenceClass;
  /** a color swatch for color values */
  color?: string;
}

/** Display names for ids and names held in conditions (and for `#cap:<id>` words); `('field', fieldId)` names a catalog field. */
export type ValueName = (field: QueryField, value: string) => string;

const LEADS: Partial<Record<QueryOp, [string, SentenceClass]>> = {
  all: ['מכילות את', 'lead'],
  any: ['מכילות אחת מ־', 'lead'],
  none: ['לא מכילות', 'not'],
};
const VALUE_LEADS: Record<string, [string, string]> = {
  author: ['נכתבו על ידי', 'לא נכתבו על ידי'],
  contentType: ['מסוג', 'לא מסוג'],
  folder: ['בתיקייה', 'לא בתיקייה'],
  color: ['בצבע', 'לא בצבע'],
};
const fmtDate = (iso: string | undefined) => (iso ? new Date(iso).toLocaleDateString('he-IL') : '…');

export function conditionSentence(c: IQueryCondition, name: ValueName): SentencePart[] {
  if (isEmptyCondition(c)) return [{ text: 'תנאי ריק', cls: 'dim' }];
  const out: SentencePart[] = [];
  const list = (items: SentencePart[], sep: string) =>
    items.forEach((p, i) => {
      if (i) out.push({ text: sep, cls: 'dim' });
      out.push(p);
    });
  const kind = kindOf(c);
  const fieldName = c.field === 'field' ? name('field', c.fieldId ?? '') : FIELDS[c.field].label;

  if (kind === 'text') {
    const [lead, cls] = LEADS[c.op]!;
    out.push({ text: lead, cls });
    list(
      c.words!.filter(Boolean).map((w): SentencePart => (isCapsuleToken(w) ? { text: `#${name(c.field, w)}`, cls: 'capsule' } : { text: `"${w}"`, cls: 'term' })),
      c.op === 'all' ? '+' : '/',
    );
    if (c.field !== 'text') out.push({ text: `ב${fieldName}`, cls: 'dim' });
  } else if (c.field === 'field') {
    // A catalog field: «ש־<field> <op> <value>».
    out.push({ text: `ש־${fieldName}`, cls: 'dim' });
    if (kind === 'list') {
      out.push({ text: opLabel(c.op, kind), cls: c.op === 'isNot' ? 'not' : 'lead' });
      list(
        c.values!.map((v) => ({ text: `"${v}"`, cls: 'term' })),
        '/',
      );
    } else {
      const fmt = kind === 'date' ? fmtDate : (v: string | undefined) => v?.trim() || '…';
      if (c.op === 'range' || c.op === 'between') {
        if (filled(c.from) && filled(c.to)) out.push({ text: 'בין', cls: 'lead' }, { text: fmt(c.from), cls: 'term' }, { text: 'ל־', cls: 'lead' }, { text: fmt(c.to), cls: 'term' });
        else if (filled(c.from)) out.push({ text: kind === 'date' ? 'מ־' : 'לפחות', cls: 'lead' }, { text: fmt(c.from), cls: 'term' });
        else out.push({ text: kind === 'date' ? 'עד' : 'לכל היותר', cls: 'lead' }, { text: fmt(c.to), cls: 'term' });
      } else out.push({ text: OPS[c.op], cls: 'lead' }, { text: fmt(readsFrom(c.op) ? c.from : c.to), cls: 'term' });
    }
  } else if (kind === 'value') {
    const [yes, no] = VALUE_LEADS[c.field];
    out.push({ text: c.op === 'isNot' ? no : yes, cls: c.op === 'isNot' ? 'not' : 'lead' });
    list(
      c.values!.map((v) => ({ text: name(c.field, v), cls: 'term', color: c.field === 'color' ? v : undefined })),
      '/',
    );
  } else {
    out.push({ text: c.field === 'eventDate' ? 'שהאירוע שלהן' : 'שנוצרו', cls: 'lead' });
    if (c.op === 'between') out.push({ text: 'בין', cls: 'lead' }, { text: fmtDate(c.from), cls: 'term' }, { text: 'ל־', cls: 'lead' }, { text: fmtDate(c.to), cls: 'term' });
    else out.push({ text: OPS[c.op], cls: 'lead' }, { text: fmtDate(c.op === 'after' ? c.from : c.to), cls: 'term' });
  }
  return out;
}

export function querySentence(g: IQueryGroup | EditGroup, name: ValueName, depth = 0): SentencePart[] {
  const kids = g.children as (IQueryGroup | IQueryCondition)[];
  if (!kids.length) return [{ text: 'ללא תנאים', cls: 'dim' }];
  const out: SentencePart[] = [];
  const wrap = depth > 0 && kids.length > 1;
  if (wrap) out.push({ text: '(', cls: 'paren' });
  kids.forEach((k, i) => {
    if (i) out.push(g.op === 'AND' ? { text: 'וגם', cls: 'join-and' } : { text: 'או', cls: 'join-or' });
    out.push(...(k.type === 'group' ? querySentence(k, name, depth + 1) : conditionSentence(k, name)));
  });
  if (wrap) out.push({ text: ')', cls: 'paren' });
  return out;
}
