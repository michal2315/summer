import { IQueryCondition, IQueryGroup, QueryField, QueryOp } from '../../../shared/models';

/** Query builder vocabulary and tree helpers. The server (summary-search.ts) validates the same fields and operators. */
export type FieldKind = 'text' | 'value' | 'date';

export const FIELDS: Record<QueryField, { label: string; kind: FieldKind; icon: string }> = {
  text: { label: 'כל מקום', kind: 'text', icon: 'search' },
  title: { label: 'כותרת', kind: 'text', icon: 'file-text' },
  content: { label: 'תוכן התמצית', kind: 'text', icon: 'read' },
  notes: { label: 'הערות', kind: 'text', icon: 'edit' },
  comments: { label: 'תגובות', kind: 'text', icon: 'message' },
  labels: { label: 'תגיות', kind: 'text', icon: 'highlight' },
  author: { label: 'כותב/ת', kind: 'value', icon: 'team' },
  contentType: { label: 'סוג תוכן', kind: 'value', icon: 'appstore' },
  collection: { label: 'לקט', kind: 'value', icon: 'book' },
  color: { label: 'צבע', kind: 'value', icon: 'star' },
  eventDate: { label: 'תאריך האירוע', kind: 'date', icon: 'calendar' },
  createdDate: { label: 'תאריך יצירה', kind: 'date', icon: 'field-time' },
};
export const FIELD_KEYS = Object.keys(FIELDS) as QueryField[];

export const OPS: Record<QueryOp, string> = {
  all: 'מכיל את כל המילים',
  any: 'מכיל לפחות אחת',
  none: 'לא מכיל אף אחת',
  isOneOf: 'הוא אחד מ־',
  isNot: 'אינו',
  after: 'אחרי',
  before: 'לפני',
  between: 'בין',
};
export const OPS_BY_KIND: Record<FieldKind, QueryOp[]> = {
  text: ['all', 'any', 'none'],
  value: ['isOneOf', 'isNot'],
  date: ['after', 'before', 'between'],
};
/** must / optional / exclusion — colors the operator in the row */
export const opTone = (op: QueryOp) => (op === 'none' || op === 'isNot' ? 'not' : op === 'any' ? 'opt' : 'must');

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

export function isEmptyCondition(c: IQueryCondition): boolean {
  const kind = FIELDS[c.field].kind;
  if (kind === 'text') return !c.words?.some((w) => w.trim());
  if (kind === 'value') return !c.values?.length;
  return !(c.op !== 'before' && c.from) && !(c.op !== 'after' && c.to);
}

/** Editable tree → what is sent: no ids, no empty conditions or groups, only the keys each field uses. Undefined if nothing is left. */
export function toQuery(g: EditGroup): IQueryGroup | undefined {
  const children = g.children
    .map((c): IQueryGroup | IQueryCondition | undefined => {
      if (c.type === 'group') return toQuery(c);
      if (isEmptyCondition(c)) return undefined;
      const kind = FIELDS[c.field].kind;
      const base = { type: 'cond' as const, field: c.field, op: c.op };
      if (kind === 'text') return { ...base, words: c.words.map((w) => w.trim()).filter(Boolean) };
      if (kind === 'value') return { ...base, values: c.values };
      return { ...base, ...(c.op !== 'before' && c.from ? { from: c.from } : {}), ...(c.op !== 'after' && c.to ? { to: c.to } : {}) };
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

export type SentenceClass = 'lead' | 'not' | 'term' | 'join-and' | 'join-or' | 'paren' | 'dim';
export interface SentencePart {
  text: string;
  cls: SentenceClass;
  /** a color swatch for color values */
  color?: string;
}

/** Display names for ids and names held in conditions. */
export type ValueName = (field: QueryField, value: string) => string;

const LEADS: Partial<Record<QueryOp, [string, SentenceClass]>> = {
  all: ['מכילות את', 'lead'],
  any: ['מכילות אחת מ־', 'lead'],
  none: ['לא מכילות', 'not'],
};
const VALUE_LEADS: Record<string, [string, string]> = {
  author: ['נכתבו על ידי', 'לא נכתבו על ידי'],
  contentType: ['מסוג', 'לא מסוג'],
  collection: ['בלקט', 'לא בלקט'],
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
  const kind = FIELDS[c.field].kind;

  if (kind === 'text') {
    const [lead, cls] = LEADS[c.op]!;
    out.push({ text: lead, cls });
    list(
      c.words!.filter(Boolean).map((w) => ({ text: `"${w}"`, cls: 'term' })),
      c.op === 'all' ? '+' : '/',
    );
    if (c.field !== 'text') out.push({ text: `ב${FIELDS[c.field].label}`, cls: 'dim' });
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
