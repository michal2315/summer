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

/** Boolean operator words, Hebrew and English. Quote one ("לא") to search for the word itself. */
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

export interface QueryTerm {
  term: string;
  neg: boolean;
  /** Written as `#name`: a capsule when one has that name, otherwise the plain word. */
  capsule?: boolean;
}

export interface ParsedQuery {
  /** OR of AND-groups (AND binds tighter): `a b or not c` → [[a, b], [¬c]] */
  groups: QueryTerm[][];
  /** `@username` → summaries by these users (any of) */
  users: string[];
  /** `:lecture` / `:שיעור` → content type name or display name, `_` for spaces (any of) */
  contentTypes: string[];
  /** names of the `#name` terms, to look up as capsules */
  capsules: string[];
}

/**
 * Query text, kept in sync with the client's search-syntax.ts: "quoted phrases" stay whole, other words split on
 * whitespace, `#name` names a capsule (`_` for spaces) or else is the plain word, adjacent terms are ANDed. Operators that don't sit between terms
 * (leading `or`, trailing `not`) are dropped. Matching is case-insensitive substring.
 */
export function parseQuery(text: string): ParsedQuery {
  const groups: QueryTerm[][] = [[]];
  const users: string[] = [];
  const types: string[] = [];
  let pendingOr = false;
  let neg = false;
  let count = 0;

  for (const m of text.matchAll(/"([^"]*)"?|\S+/g)) {
    const word = m[0];
    const op = m[1] === undefined ? OPERATORS[word.toLowerCase()] : undefined;
    if (m[1] === undefined && /^@\S/.test(word)) users.push(word.slice(1).toLowerCase());
    else if (m[1] === undefined && /^:\S/.test(word)) types.push(word.slice(1).replace(/_/g, ' '));
    else if (op === 'or') pendingOr = groups[groups.length - 1].length > 0;
    else if (op === 'not') neg = true;
    else if (op !== 'and') {
      const capsule = m[1] === undefined && /^#\S/.test(word);
      const term = (m[1] ?? word.replace(/^#/, '')).trim();
      if (!term || count >= MAX_TERMS) continue;
      if (pendingOr) groups.push([]);
      groups[groups.length - 1].push(capsule ? { term, neg, capsule } : { term, neg });
      pendingOr = neg = false;
      count++;
    }
  }
  const live = groups.filter((g) => g.length);
  const capsules = live.flat().flatMap((t) => (t.capsule ? [t.term] : []));
  return { groups: live, users: [...new Set(users)], contentTypes: [...new Set(types)], capsules: [...new Set(capsules)] };
}

/** Capsules a search refers to: `#name` in the text and `#cap:<id>` words in the advanced tree. */
export function capsuleRefs(f: Pick<SummarySearch, 'text' | 'query'>): { ids: string[]; names: string[] } {
  const ids: string[] = [];
  const walk = (g: QueryGroup) =>
    g.children.forEach((c) => (c.type === 'group' ? walk(c) : c.words.filter(isCapsuleToken).forEach((w) => ids.push(capsuleTokenId(w)))));
  if (f.query) walk(f.query);
  return { ids, names: parseQuery(f.text).capsules };
}

