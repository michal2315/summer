import { z } from 'zod';
import { zBoolString, zId, zList } from '../common/validation';
import { capsuleTokenId, isCapsuleToken } from '../capsules/capsule';
import { SUMMARY_KINDS } from '../database/schema';

export const SEARCH_TYPES = ['TITLE', 'LABEL', 'CONTENT', 'NOTES', 'COMMENTS', 'COLOR'] as const;
export const BUCKETS = ['SUMMARY', 'DRAFT', 'TAGGED', 'FAVORITE'] as const;
export const SORT_KEYS = ['eventDate', '-eventDate', 'creationDate', '-creationDate', 'modifyDate', '-modifyDate', 'title', '-title'] as const;

export const MAX_PAGE = 100;

// ---------------------------------------------------------------- advanced search (query builder tree)

export const TEXT_FIELDS = ['text', 'title', 'content', 'notes', 'comments', 'labels'] as const;
export const VALUE_FIELDS = ['author', 'contentType', 'folder', 'color'] as const;
export const DATE_FIELDS = ['eventDate', 'createdDate'] as const;
const OPS_BY_KIND = { text: ['all', 'any', 'none'], value: ['isOneOf', 'isNot'], date: ['after', 'before', 'between'] } as const;
const MAX_QUERY_DEPTH = 4;
const MAX_QUERY_CONDITIONS = 30;

export type TextField = (typeof TEXT_FIELDS)[number];
export type QueryField = TextField | (typeof VALUE_FIELDS)[number] | (typeof DATE_FIELDS)[number];

const fieldKind = (f: QueryField): keyof typeof OPS_BY_KIND =>
  (TEXT_FIELDS as readonly string[]).includes(f) ? 'text' : (VALUE_FIELDS as readonly string[]).includes(f) ? 'value' : 'date';

const conditionSchema = z
  .object({
    type: z.literal('cond'),
    field: z.enum([...TEXT_FIELDS, ...VALUE_FIELDS, ...DATE_FIELDS]),
    op: z.enum([...OPS_BY_KIND.text, ...OPS_BY_KIND.value, ...OPS_BY_KIND.date]),
    words: z.array(z.string().trim().max(100)).max(20).default([]),
    values: z.array(z.string().max(100)).max(50).default([]),
    /** ISO instants of the client's local midnight, like `dates` */
    from: z.string().max(40).optional(),
    to: z.string().max(40).optional(),
  })
  .superRefine((c, ctx) => {
    if (!(OPS_BY_KIND[fieldKind(c.field)] as readonly string[]).includes(c.op)) ctx.addIssue({ code: 'custom', message: `"${c.op}" does not apply to ${c.field}` });
    if ((c.field === 'author' || c.field === 'folder') && !c.values.every((v) => zId.safeParse(v).success))
      ctx.addIssue({ code: 'custom', message: `${c.field} values must be ids` });
  });

export type QueryCondition = z.output<typeof conditionSchema>;
export interface QueryGroup {
  type: 'group';
  op: 'AND' | 'OR';
  children: (QueryGroup | QueryCondition)[];
}

const groupSchema: z.ZodType<QueryGroup> = z.lazy(() =>
  z.object({
    type: z.literal('group'),
    op: z.enum(['AND', 'OR']),
    children: z.array(z.union([groupSchema, conditionSchema])).max(MAX_QUERY_CONDITIONS),
  }),
);

const treeSize = (g: QueryGroup, depth = 1): { depth: number; conditions: number } =>
  g.children.reduce(
    (acc, c) => {
      const s = c.type === 'group' ? treeSize(c, depth + 1) : { depth, conditions: 1 };
      return { depth: Math.max(acc.depth, s.depth), conditions: acc.conditions + s.conditions };
    },
    { depth, conditions: 0 },
  );

/** The tree arrives as a JSON string in query params (feed, count) or as an object in JSON bodies (Excel export). */
const querySchema = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v;
    if (!v.trim()) return undefined;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  },
  groupSchema.optional().refine((g) => {
    if (!g) return true;
    const s = treeSize(g);
    return s.depth <= MAX_QUERY_DEPTH && s.conditions <= MAX_QUERY_CONDITIONS;
  }, `query is limited to ${MAX_QUERY_DEPTH} levels and ${MAX_QUERY_CONDITIONS} conditions`),
);

/** ISummarySearch from the client, as query params (feed) or JSON (Excel export). Unknown keys are dropped. */
export const summarySearchSchema = z.object({
  text: z.string().max(200).default(''),
  searchTypes: zList.pipe(z.array(z.enum(SEARCH_TYPES))),
  dates: zList,
  createdDates: zList,
  sort: z.enum(SORT_KEYS).default('-eventDate'),
  skip: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(20),
  users: zList.pipe(z.array(zId)),
  department: z.string().max(200).optional(),
  summarySearch: z.enum(BUCKETS).default('SUMMARY'),
  isProfile: zBoolString,
  contentTypes: zList,
  colors: zList,
  labels: zList,
  /** placed in one of these folders or their subfolders */
  folders: zList.pipe(z.array(zId)),
  /** only summaries in no folder (a sumaroon: whose running summary is in none) */
  noFolder: zBoolString,
  /** only these kinds (summary | running | sumaroon); empty = all */
  kinds: zList.pipe(z.array(z.enum(SUMMARY_KINDS))),
  /** the sumaroons of this running summary */
  parentId: zId.optional(),
  /** advanced search tree, ANDed with everything else */
  query: querySchema,
});

export type SummarySearch = z.output<typeof summarySearchSchema>;
export type Bucket = (typeof BUCKETS)[number];

const MAX_TERMS = 10;

/**
 * Marks a word as syntax: an operator (and / or / not), @user, #capsule or :field:value. The search box puts it there
 * when the user presses ← on such a word; without it the word is plain text ("או", "#1", "a:b" are searched as typed).
 */
export const MARK = '\u2063';

/** Boolean operator words, Hebrew and English. */
const OPERATORS: Record<string, 'and' | 'or' | 'not'> = {
  and: 'and',
  וגם: 'and',
  or: 'or',
  או: 'or',
  not: 'not',
  לא: 'not',
  ולא: 'not',
  בלי: 'not',
};

export type TermField = TextField | 'author' | 'type' | 'color';

/** `:field:value` field names, Hebrew and English. Kept in sync with the client's SEARCH_FIELDS. */
const FIELD_NAMES: Record<string, Exclude<TermField, 'text'>> = {
  title: 'title',
  כותרת: 'title',
  content: 'content',
  תוכן: 'content',
  notes: 'notes',
  הערות: 'notes',
  comments: 'comments',
  תגובות: 'comments',
  label: 'labels',
  labels: 'labels',
  תווית: 'labels',
  type: 'type',
  סוג: 'type',
  author: 'author',
  user: 'author',
  כותב: 'author',
  color: 'color',
  צבע: 'color',
};

/** `:color:<name>` names of the summary palette, Hebrew and English. Kept in sync with the client's COLOR_NAMES. */
const COLOR_NAMES: Record<string, string> = {
  ורוד: '#fe9eae',
  pink: '#fe9eae',
  אדום: '#ff0000',
  red: '#ff0000',
  כתום: '#ffa500',
  orange: '#ffa500',
  ירוק: '#008000',
  green: '#008000',
  טורקיז: '#00b2b2',
  teal: '#00b2b2',
  כחול: '#0000c9',
  blue: '#0000c9',
  סגול: '#800080',
  purple: '#800080',
  אפור: '#808080',
  gray: '#808080',
};

/** A `:color:` value as the stored hex, or undefined when it names no color. */
export function colorValue(v: string): string | undefined {
  const k = v.trim().toLowerCase();
  if (COLOR_NAMES[k]) return COLOR_NAMES[k];
  return /^#?[0-9a-f]{6}$/.test(k) ? (k.startsWith('#') ? k : `#${k}`) : undefined;
}

export interface QueryTerm {
  term: string;
  neg: boolean;
  /** Came from "quotes": whole words only (otherwise matched anywhere, also inside words). */
  exact?: boolean;
  /** Written as `#name`: a capsule when one has that name, otherwise the plain word. */
  capsule?: boolean;
  /** `@user` (author) or `:field:value`: the term applies to this field only. */
  field?: Exclude<TermField, 'text'>;
}

export interface ParsedQuery {
  /** OR of AND-groups (AND binds tighter): `a b or not c` → [[a, b], [¬c]] */
  groups: QueryTerm[][];
  /** names of the `#name` terms, to look up as capsules */
  capsules: string[];
}

/** Closes a `:field:value` token, whose value may have spaces. */
export const END = '\u2064';

/** A :field:value token (from its MARK up to END, or the end of the text), a "phrase", or a word. */
const TOKEN_RE = /(?<!\S)\u2063:[^\u2064]*\u2064?|"([^"]*)"?|\S+/g;

const strip = (s: string) => s.replace(/[\u2063\u2064]/g, '');

/** A :field:value token's text (without MARK / END) → its term; undefined while unfinished (ignored). */
function fieldTerm(body: string): Omit<QueryTerm, 'neg'> | undefined {
  const m = /^:([^:\s]+):([\s\S]*)$/.exec(body);
  const field = m ? FIELD_NAMES[m[1].toLowerCase()] : undefined;
  if (!field) return undefined;
  const raw = m![2].trim();
  const quoted = /^"(.*)"?$/.exec(raw);
  const value = (quoted ? quoted[1].replace(/"$/, '') : raw).trim();
  return value ? { term: value, exact: !!quoted, field } : undefined;
}

/** A marked word (without its mark) → operator or term; undefined for a bare `@` / `#` (ignored). */
function markedWord(word: string): { op: 'and' | 'or' | 'not' } | { term: Omit<QueryTerm, 'neg'> | undefined } {
  const op = OPERATORS[word.toLowerCase()];
  if (op) return { op };
  if (word.startsWith('@')) return { term: word.length > 1 ? { term: word.slice(1).replace(/_/g, ' '), field: 'author' } : undefined };
  if (word.startsWith('#')) return { term: word.length > 1 ? { term: word.slice(1), capsule: true } : undefined };
  return { term: { term: word } };
}

/**
 * Query text, kept in sync with the client's search-syntax.ts: "quoted phrases" stay whole and match whole words, other
 * words split on whitespace and match anywhere, adjacent terms are ANDed. Only words that start with MARK are syntax
 * (see MARK). Operators that don't sit between terms (leading `or`, trailing `not`) are dropped. Case-insensitive.
 */
export function parseQuery(text: string): ParsedQuery {
  const groups: QueryTerm[][] = [[]];
  let pendingOr = false;
  let neg = false;
  let count = 0;

  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0];
    let term: Omit<QueryTerm, 'neg'> | undefined;
    if (raw.startsWith(MARK + ':')) term = fieldTerm(strip(raw));
    else if (m[1] !== undefined) term = { term: strip(m[1]).trim(), exact: true };
    else if (raw.startsWith(MARK)) {
      const parsed = markedWord(strip(raw));
      if ('op' in parsed) {
        if (parsed.op === 'or') pendingOr = groups[groups.length - 1].length > 0;
        else if (parsed.op === 'not') neg = true;
        continue;
      }
      term = parsed.term;
    } else term = { term: strip(raw) };

    if (!term?.term || count >= MAX_TERMS) continue;
    if (pendingOr) groups.push([]);
    groups[groups.length - 1].push({ ...term, neg });
    pendingOr = neg = false;
    count++;
  }
  const live = groups.filter((g) => g.length);
  const capsules = live.flat().flatMap((t) => (t.capsule ? [t.term] : []));
  return { groups: live, capsules: [...new Set(capsules)] };
}

/** Capsules a search refers to: `#name` in the text and `#cap:<id>` words in the advanced tree. */
export function capsuleRefs(f: Pick<SummarySearch, 'text' | 'query'>): { ids: string[]; names: string[] } {
  const ids: string[] = [];
  const walk = (g: QueryGroup) =>
    g.children.forEach((c) => (c.type === 'group' ? walk(c) : c.words.filter(isCapsuleToken).forEach((w) => ids.push(capsuleTokenId(w)))));
  if (f.query) walk(f.query);
  return { ids, names: parseQuery(f.text).capsules };
}

