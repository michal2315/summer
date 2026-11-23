import { QueryTextField } from '../models';
import { SUMMARY_COLORS } from '../models/colors';

/**
 * Search-box syntax, kept in sync with the server's parseQuery (summary-search.ts). Every word is plain text (matched
 * anywhere; "quoted" = whole words only) unless it starts with MARK, which the box puts there as soon as the word or sigil
 * is typed (Backspace right after it takes the mark off, leaving plain text):
 * - and / or / not (וגם, גם / או / לא, ולא, בלי, ובלי) between terms; AND binds tighter, adjacent terms are ANDed
 * - @username filters by author; #name is a capsule (`_` for spaces) and joins and / or / not like a word
 * - $name picks one of the user's saved searches (the box runs it); only on its own in the box, otherwise plain text
 * - :field:value searches one field; the value is one word (`_` for spaces: `:author:Michal_Golan`), so a space ends
 *   it, a "phrase" (whole words only, spaces allowed) or a /regex/
 * - /regex/ is a regular expression, case-insensitive (spaces allowed, `\/` for a slash; unclosed it runs to the end)
 */
export const MARK = '\u2063';

/**
 * A :field:value token (MARK, `:name:`, then a "phrase", a /regex/ or a word), a marked /regex/, a "phrase", or a word.
 */
const TOKEN_RE = /(?<!\S)\u2063:[^\s:]*(?::(?:"[^"]*"?|\/(?:\\.?|[^\\/])*\/?|\S*))?|(?<!\S)\u2063\/(?:\\.?|[^\\/])*\/?|"([^"]*)"?|\S+/g;
/** A /regex/, its pattern in group 1. */
const REGEX_RE = /^\/((?:\\.?|[^\\/])*)\/?$/;

export const MAX_REGEX = 200;

/**
 * The problem with a search regex, if any. Kept in sync with the server's pgRegex (common/sql.ts): JavaScript syntax,
 * minus what Postgres lacks.
 */
export function regexProblem(pattern: string): string | undefined {
  const r = translateRegex(pattern);
  return 'problem' in r ? r.problem : undefined;
}

const WORD = String.raw`\p{L}\p{N}_`;
const BOUNDARY = `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`;
const NON_BOUNDARY = `(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`;

/** The same walk as the server's pgRegex, to a JavaScript Unicode-mode source where \b, \B, \w and \W know Hebrew. */
function translateRegex(pattern: string): { source: string } | { problem: string } {
  if (pattern.length > MAX_REGEX) return { problem: `\u05d1\u05d9\u05d8\u05d5\u05d9 \u05e8\u05d2\u05d5\u05dc\u05e8\u05d9 \u05d0\u05e8\u05d5\u05da \u05de-${MAX_REGEX} \u05ea\u05d5\u05d5\u05d9\u05dd` };
  try {
    new RegExp(pattern);
  } catch {
    return { problem: '\u05d1\u05d9\u05d8\u05d5\u05d9 \u05e8\u05d2\u05d5\u05dc\u05e8\u05d9 \u05dc\u05d0 \u05ea\u05e7\u05d9\u05df' };
  }
  if (/\(\?<(?![=!])|\\k<|\\[pP]\{/.test(pattern)) return { problem: '\u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05e2\u05dd \u05e9\u05dd \u05d5-\\p{\u2026} \u05d0\u05d9\u05e0\u05dd \u05e0\u05ea\u05de\u05db\u05d9\u05dd' };
  let out = '';
  let inClass = false;
  /** Just after `[` or `[^`, where a `]` is literal. */
  let classStart = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    const wasStart = classStart;
    classStart = false;
    if (c === '\\' && i + 1 < pattern.length) {
      const n = pattern[++i];
      if (inClass) {
        if (n === 'W' || n === 'S' || n === 'D') return { problem: `\\${n} \u05d1\u05ea\u05d5\u05da [\u2026] \u05d0\u05d9\u05e0\u05d5 \u05e0\u05ea\u05de\u05da` };
        out += n === 'w' ? WORD : `\\${n}`;
      } else out += n === 'b' ? BOUNDARY : n === 'B' ? NON_BOUNDARY : n === 'w' ? `[${WORD}]` : n === 'W' ? `[^${WORD}]` : `\\${n}`;
      continue;
    }
    if (!inClass && c === '[') {
      inClass = classStart = true;
      out += pattern[i + 1] === '^' ? '[' + pattern[++i] : '[';
      continue;
    }
    if (inClass && c === ']' && !wasStart) inClass = false;
    out += inClass && c === ']' ? '\\]' : c;
  }
  return { source: out };
}

/**
 * A search regex as a JavaScript source for highlighting, matching like the server's (Unicode mode, Hebrew-aware \b
 * and \w); null when it isn't valid or Unicode mode rejects it (a bare `{`, say): highlighting then skips it.
 */
export function regexSource(pattern: string): string | null {
  const r = translateRegex(pattern);
  if (!('source' in r)) return null;
  try {
    new RegExp(r.source, 'u');
    return r.source;
  } catch {
    return null;
  }
}

export type TokenKind = 'term' | 'and' | 'or' | 'not' | 'user' | 'field' | 'capsule' | 'saved' | 'regex';

export interface QueryToken {
  kind: TokenKind;
  start: number;
  end: number;
  /** For operators: it actually joins terms (a leading `or` or trailing `not` is dropped). */
  active?: boolean;
}

export type SearchFieldKey = Exclude<QueryTextField, 'text'> | 'author' | 'type' | 'color';

export interface SearchField {
  key: SearchFieldKey;
  /** As written in the box: `:name:value` */
  name: string;
  label: string;
  /** Other names the field may be written with */
  aliases: string[];
  /** What the value suggestions are */
  values: 'text' | 'users' | 'types' | 'colors' | 'labels';
}

/** `:field:value` fields. Kept in sync with the server's FIELD_NAMES. */
export const SEARCH_FIELDS: SearchField[] = [
  { key: 'title', name: 'כותרת', label: 'כותרת', aliases: ['title'], values: 'text' },
  { key: 'type', name: 'סוג', label: 'סוג תוכן', aliases: ['type'], values: 'types' },
  { key: 'author', name: 'כותב', label: 'כותב', aliases: ['author', 'user'], values: 'users' },
  { key: 'labels', name: 'תווית', label: 'תווית', aliases: ['label', 'labels'], values: 'labels' },
  { key: 'color', name: 'צבע', label: 'צבע', aliases: ['color'], values: 'colors' },
  { key: 'content', name: 'תוכן', label: 'תוכן', aliases: ['content'], values: 'text' },
  { key: 'notes', name: 'הערות', label: 'הערות', aliases: ['notes'], values: 'text' },
  { key: 'comments', name: 'תגובות', label: 'תגובות', aliases: ['comments'], values: 'text' },
];

export const fieldByName = (name: string) => {
  const n = name.trim().toLowerCase();
  return SEARCH_FIELDS.find((f) => f.name === n || f.aliases.includes(n));
};

/** `:color:<name>` names, in palette order. Kept in sync with the server's COLOR_NAMES. */
export const COLOR_NAMES: { name: string; hex: string }[] = ['ורוד', 'אדום', 'כתום', 'ירוק', 'טורקיז', 'כחול', 'סגול', 'אפור'].map((name, i) => ({
  name,
  hex: SUMMARY_COLORS[i],
}));

export interface QueryTerm {
  term: string;
  neg: boolean;
  /** Came from "quotes": whole words only */
  exact: boolean;
  /** Written /pattern/: `term` is a search regex (regexProblem / regexSource) */
  regex?: boolean;
  /** Written #name: `term` is the name, to resolve with the capsules service */
  capsule?: boolean;
  /** `@user` (author) or `:field:value`: the term applies to this field only */
  field?: SearchFieldKey;
}

export interface ParsedQuery {
  tokens: QueryToken[];
  /** OR of AND-groups */
  groups: QueryTerm[][];
}

const OPERATORS: Record<string, 'and' | 'or' | 'not'> = {
  and: 'and',
  וגם: 'and',
  גם: 'and',
  or: 'or',
  או: 'or',
  not: 'not',
  לא: 'not',
  ולא: 'not',
  בלי: 'not',
  ובלי: 'not',
};

/** The operator a word would be once marked. */
export const operatorOf = (word: string) => OPERATORS[word.toLowerCase()];

const strip = (s: string) => s.replaceAll(MARK, '');

const isOperator = (t: QueryToken) => t.kind === 'and' || t.kind === 'or' || t.kind === 'not';

/** OR of AND-groups. */
type Terms = QueryTerm[][];

const andTerms = (a: Terms, b: Terms): Terms => a.flatMap((x) => b.map((y) => [...x, ...y]));
/** ¬(g1 ∨ g2 …) = ¬g1 ∧ ¬g2 …, and each ¬(t1 ∧ t2 …) = ¬t1 ∨ ¬t2 … */
const notTerms = (d: Terms): Terms => d.reduce<Terms>((acc, g) => andTerms(acc, g.map((t) => [{ ...t, neg: !t.neg }])), [[]]);
const leaf = (t: Omit<QueryTerm, 'neg'> | undefined): Terms | undefined => (t?.term ? [[{ ...t, neg: false }]] : undefined);

/** An operator token, or something that matches. */
type Item = { op: QueryToken } | { terms?: Terms };

/**
 * Items joined: adjacent ones are ANDed, AND binds tighter than OR, `not` negates the next item. Operators that don't
 * join anything (a leading `or`, a trailing `not`) are dropped; each operator token's `active` says which is which.
 */
function combine(items: Item[]): Terms {
  const out: Terms = [];
  let current: Terms | null = null;
  let pending: QueryToken[] = [];
  let pendingOr = false;
  let neg = false;
  for (const item of items) {
    if ('op' in item) {
      if (item.op.kind === 'or') pendingOr = current !== null;
      else if (item.op.kind === 'not') neg = true;
      pending.push(item.op);
      continue;
    }
    if (!item.terms?.length) continue;
    for (const p of pending) p.active = p.kind === 'not' ? neg : current !== null && (p.kind === 'and' || pendingOr);
    const terms = neg ? notTerms(item.terms) : item.terms;
    if (pendingOr && current) {
      out.push(...current);
      current = null;
    }
    current = current ? andTerms(current, terms) : terms;
    pending = [];
    pendingOr = neg = false;
  }
  if (current) out.push(...current);
  return out;
}

/** Where a :field:value token's value starts (after `MARK:name:`), and its field; no field for an unknown name. */
function fieldHead(text: string, start: number): { field?: SearchField; from: number } {
  const head = /^\u2063:([^:\s]+):/.exec(text.slice(start));
  return head ? { field: fieldByName(head[1]), from: start + head[0].length } : { from: start };
}

/** A :field:value token (text[start, end)): its field's term, a "phrase" (whole words) or a word (`_` for spaces). */
function fieldValue(text: string, start: number, end: number): Terms | undefined {
  const { field, from } = fieldHead(text, start);
  if (!field || from > end) return undefined;
  const value = strip(text.slice(from, end));
  const phrase = /^"([^"]*)"?$/.exec(value);
  const regex = REGEX_RE.exec(value);
  if (regex) return leaf({ term: regex[1], exact: false, regex: true, field: field.key });
  return leaf(phrase ? { term: phrase[1].trim(), exact: true, field: field.key } : { term: value.replace(/_/g, ' ').trim(), exact: false, field: field.key });
}

/** A marked word (without its mark): its token kind and, for a complete one, its term. */
function markedWord(word: string): { kind: TokenKind; term?: Omit<QueryTerm, 'neg'> } {
  const op = operatorOf(word);
  if (op) return { kind: op };
  if (word.startsWith('@')) return { kind: 'user', term: word.length > 1 ? { term: word.slice(1).replace(/_/g, ' '), exact: false, field: 'author' } : undefined };
  if (word.startsWith('#')) return { kind: 'capsule', term: word.length > 1 ? { term: word.slice(1), exact: false, capsule: true } : undefined };
  // Only a picked saved search means anything (the box runs it); left in the text it is searched as typed, like the server does.
  if (word.startsWith('$')) return { kind: 'saved', term: { term: word, exact: false } };
  return { kind: 'term', term: { term: word, exact: false } };
}

export function parseQuery(text: string): ParsedQuery {
  const tokens: QueryToken[] = [];
  const items: Item[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0];
    const token: QueryToken = { kind: 'term', start: m.index!, end: m.index! + raw.length };
    let terms: Terms | undefined;
    if (raw.startsWith(MARK + ':')) {
      token.kind = 'field';
      terms = fieldValue(text, token.start, token.end);
    } else if (raw.startsWith(MARK + '/')) {
      token.kind = 'regex';
      terms = leaf({ term: REGEX_RE.exec(strip(raw))?.[1] ?? '', exact: false, regex: true });
    } else if (m[1] !== undefined) {
      terms = leaf({ term: strip(m[1]).trim(), exact: true });
    } else if (raw.startsWith(MARK)) {
      const parsed = markedWord(strip(raw));
      token.kind = parsed.kind;
      terms = leaf(parsed.term);
    } else {
      terms = leaf({ term: strip(raw), exact: false });
    }
    tokens.push(token);
    items.push(isOperator(token) ? { op: token } : { terms });
  }
  // A saved search replaces the whole search, so $name is one only on its own.
  if (tokens.length > 1) for (const t of tokens) if (t.kind === 'saved') t.kind = 'term';
  return { tokens, groups: combine(items) };
}

export interface QuerySegment {
  text: string;
  /**
   * 'phrase': a "quoted phrase" term; 'regex-bad': a /regex/ the search would reject; 'field-regex' (/ 'field-regex-bad'):
   * a :field:/regex/, whose `_` are literal.
   */
  kind: TokenKind | 'phrase' | 'regex-bad' | 'field-regex' | 'field-regex-bad' | null;
}

/** A marked token's display kind: /regex/ ones (alone or as a field's value) say whether the search would take them. */
function segmentKind(text: string, t: QueryToken): QuerySegment['kind'] {
  const from = t.kind === 'regex' ? t.start + 1 : t.kind === 'field' ? fieldHead(text, t.start).from : -1;
  const regex = from >= 0 && from < t.end ? REGEX_RE.exec(strip(text.slice(from, t.end))) : null;
  if (!regex) return t.kind;
  const bad = !!regexProblem(regex[1]);
  return t.kind === 'regex' ? (bad ? 'regex-bad' : 'regex') : bad ? 'field-regex-bad' : 'field-regex';
}

/** The /regex/ terms in the text (marked ones and :field:/regex/ values) that the search would reject, with why. */
export function badRegexes(text: string): { pattern: string; problem: string }[] {
  return parseQuery(text).groups.flat().flatMap((t) => {
    const problem = t.regex ? regexProblem(t.term) : undefined;
    return problem ? [{ pattern: t.term, problem }] : [];
  });
}

/** Is `name` (from #name) a known capsule? */
export type IsCapsule = (name: string) => boolean;

/** A marked #capsule token's name. */
const capsuleName = (text: string, t: QueryToken) => text.slice(t.start + 2, t.end);

/**
 * The text split for display: marked operators, @users, :fields, #capsules and "phrases" get a kind, the rest is plain.
 * With `isCapsule`, only known capsules are marked; without it every #name is (examples).
 */
export function querySegments(text: string, isCapsule?: IsCapsule): QuerySegment[] {
  const out: QuerySegment[] = [];
  let last = 0;
  for (const t of parseQuery(text).tokens) {
    const capsule = t.kind === 'capsule' && (!isCapsule || isCapsule(capsuleName(text, t)));
    const phrase = t.kind === 'term' && text[t.start] === '"';
    const marked = t.kind === 'user' || t.kind === 'field' || t.kind === 'saved' || t.kind === 'regex' || isOperator(t) || capsule || phrase;
    if (!marked) continue;
    if (t.start > last) out.push({ text: text.slice(last, t.start), kind: null });
    out.push({ text: text.slice(t.start, t.end), kind: phrase ? 'phrase' : segmentKind(text, t) });
    last = t.end;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: null });
  return out;
}

export interface ShortcutContext {
  /** 'field': choosing the field (`:ti`); 'value': typing a field's value (`:title:gr`) */
  kind: 'user' | 'field' | 'value' | 'capsule' | 'saved';
  /** It has its MARK (put on when the sigil is typed; Backspace right after the sigil takes it off, leaving plain text) */
  marked: boolean;
  /** What was typed after the sigil (for 'value': after the field name's `:`) up to the caret */
  query: string;
  /** For 'value' */
  field?: SearchField;
  /** For 'value': the field name as written */
  fieldName?: string;
  /** For saved: there is other text in the box, so it can't be one (stays plain text) */
  blocked?: boolean;
  /** For 'value': where the value sits, which a picked value replaces */
  segment?: TextRange;
  start: number;
  end: number;
}

const SIGILS: Record<string, 'user' | 'field' | 'capsule' | 'saved'> = { '@': 'user', ':': 'field', '#': 'capsule', '$': 'saved' };

/** The caret is past the opening `/` of a marked /regex/ (or a :field:/regex/ value) and before its end. */
function inRegex(text: string, tokens: QueryToken[], caret: number): boolean {
  return tokens.some((t) => {
    const from = t.kind === 'regex' ? t.start + 1 : t.kind === 'field' ? fieldHead(text, t.start).from : -1;
    return from >= 0 && text[from] === '/' && caret > from && caret <= t.end;
  });
}

/** The @user / :field:value / #capsule / $saved search the caret is in, marked or not (none inside a /regex/). */
export function shortcutAt(text: string, caret: number): ShortcutContext | null {
  if (inRegex(text, parseQuery(text).tokens, caret)) return null;
  const ft = parseQuery(text).tokens.find((t) => t.kind === 'field' && caret > t.start && caret <= t.end);
  if (ft) {
    const body = strip(text.slice(ft.start, caret)).slice(1);
    const colon = body.indexOf(':');
    const field = colon >= 0 ? fieldByName(body.slice(0, colon)) : undefined;
    if (!field) {
      // Choosing the field: a picked one replaces the name up to its `:` (the value after it stays).
      let end = caret;
      while (end < ft.end && text[end] !== ':') end++;
      return { kind: 'field', marked: true, query: body, start: ft.start, end: Math.min(end + 1, ft.end) };
    }
    const from = fieldHead(text, ft.start).from;
    return {
      kind: 'value',
      marked: true,
      query: strip(text.slice(from, caret)),
      field,
      fieldName: body.slice(0, colon),
      segment: { start: from, end: ft.end },
      start: ft.start,
      end: ft.end,
    };
  }
  const m = /(^|\s)(\u2063?)([@:#$])(\S*)$/.exec(text.slice(0, caret));
  if (!m || m[4].includes(MARK)) return null;
  let end = caret;
  while (end < text.length && !/\s/.test(text[end])) end++;
  const start = m.index + m[1].length;
  const kind = SIGILS[m[3]];
  // A saved search replaces the whole search: with other text in the box it is plain text.
  if (kind === 'saved' && (text.slice(0, start) + text.slice(end)).trim()) return { kind, marked: false, blocked: true, query: m[4], start, end };
  return { kind, marked: !!m[2], query: m[4], start, end };
}

/** Where the unmarked operator word that ends at the caret starts, if there is one. */
function operatorWordAt(text: string, caret: number): number | null {
  if (caret < text.length && !/\s/.test(text[caret])) return null;
  const m = /(^|\s)([^\s"\u2063]+)$/.exec(text.slice(0, caret));
  return m && operatorOf(m[2]) ? m.index + m[1].length : null;
}

/**
 * What was just typed at the caret gets its MARK: an operator word it completes, or an @ / : / # / $ starting a word.
 * Only the keystroke that makes one marks it, so one unmarked with Backspace stays plain.
 */
export function markTyped(text: string, caret: number): { text: string; caret: number } | null {
  const typed = caret - 1;
  const tokens = parseQuery(text).tokens;
  // Inside a /regex/ everything is the pattern (spaces, operator words, sigils).
  if (inRegex(text, tokens, caret)) return null;
  // A `/` starting a word opens a /regex/ (not one inside a "phrase" or :field:value).
  if (text[typed] === '/' && (typed === 0 || /\s/.test(text[typed - 1])) && !tokens.some((t) => t.start < typed && typed < t.end))
    return { text: text.slice(0, typed) + MARK + text.slice(typed), caret: caret + 1 };
  const ctx = shortcutAt(text, caret);
  const at = ctx ? (ctx.marked || ctx.blocked || ctx.start !== caret - 1 ? null : ctx.start) : operatorWordAt(text, caret);
  return at === null ? null : { text: text.slice(0, at) + MARK + text.slice(at), caret: caret + 1 };
}

/** Backspace right after a marked operator word, or right after a marked sigil: takes the mark off, leaving the text. */
export function unmarkBefore(text: string, caret: number): { text: string; caret: number } | null {
  const t = parseQuery(text).tokens.find((t) => text[t.start] === MARK && (isOperator(t) ? t.end === caret : t.kind !== 'term' && caret === t.start + 2));
  return t ? { text: text.slice(0, t.start) + text.slice(t.start + 1), caret: caret - 1 } : null;
}

/** Replace the shortcut with `token` (and a trailing space unless `space` is false); returns the new text and caret. */
export function replaceShortcut(text: string, ctx: ShortcutContext, token: string, space = true): { text: string; caret: number } {
  const rest = text.slice(ctx.end);
  const head = text.slice(0, ctx.start) + token + (space ? ' ' : '');
  return { text: head + (space ? rest.replace(/^\s*/, '') : rest), caret: head.length };
}

/**
 * MARKs that no longer mark anything (an edit cut a token, or left a word that is no longer an operator or sigil) are
 * dropped, keeping the caret in place.
 */
export function cleanMarks(text: string, caret: number): { text: string; caret: number } | null {
  const keep = new Set<number>();
  for (const t of parseQuery(text).tokens) if (text[t.start] === MARK && t.kind !== 'term') keep.add(t.start);
  let out = '';
  let at = caret;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== MARK || keep.has(i)) out += c;
    else if (i < caret) at--;
  }
  return out === text ? null : { text: out, caret: at };
}

// ---------------------------------------------------------------- capsules are atomic in the search box

export interface TextRange {
  start: number;
  end: number;
}

/** Where the known capsules sit in the text: they behave as one unit. */
export function capsuleRanges(text: string, isCapsule: IsCapsule): TextRange[] {
  return parseQuery(text)
    .tokens.filter((t) => t.kind === 'capsule' && isCapsule(capsuleName(text, t)))
    .map(({ start, end }) => ({ start, end }));
}

/**
 * The mark and first character of marked tokens (@users / :fields / #names / $searches / operators): the caret can't
 * sit between the two (the mark is invisible).
 */
export function markHeads(text: string): TextRange[] {
  return parseQuery(text)
    .tokens.filter((t) => t.kind !== 'term' && text[t.start] === MARK)
    .map(({ start }) => ({ start, end: start + 2 }));
}

/**
 * Keep the caret / selection off the inside of a capsule. A caret that lands inside jumps to the edge it was moving
 * towards (`prev` is the last caret); a selection grows to cover whole capsules.
 */
export function snapSelection(ranges: TextRange[], a: number, b: number, prev: number): [number, number] {
  for (const r of ranges) {
    if (a === b) {
      if (a > r.start && a < r.end) a = b = prev <= r.start ? r.end : prev >= r.end ? r.start : a - r.start < r.end - a ? r.start : r.end;
    } else {
      if (a > r.start && a < r.end) a = r.start;
      if (b > r.start && b < r.end) b = r.end;
    }
  }
  return [a, b];
}

/**
 * An edit that touches part of a capsule removes the whole capsule; typing inside one is ignored.
 * `caret` is set when the result differs from what the input holds.
 */
export function guardEdit(prev: string, next: string, ranges: TextRange[]): { text: string; caret?: number } {
  if (!ranges.length || prev === next) return { text: next };
  const max = Math.min(prev.length, next.length);
  let p = 0;
  while (p < max && prev[p] === next[p]) p++;
  let sf = 0;
  while (sf < max - p && prev[prev.length - 1 - sf] === next[next.length - 1 - sf]) sf++;
  let a = p;
  let b = prev.length - sf;
  const inserted = next.slice(p, next.length - sf);
  let hit = false;
  for (const r of ranges) {
    const touches = a === b ? a > r.start && a < r.end : a < r.end && b > r.start && (a > r.start || b < r.end);
    if (!touches) continue;
    if (a === b) return { text: prev, caret: r.end };
    hit = true;
    a = Math.min(a, r.start);
    b = Math.max(b, r.end);
  }
  if (!hit) return { text: next };
  return { text: prev.slice(0, a) + inserted + prev.slice(b), caret: a + inserted.length };
}

/** Backspace right after / Delete right before a capsule removes all of it, with one neighbouring space. */
export function deleteCapsule(text: string, caret: number, key: 'Backspace' | 'Delete', ranges: TextRange[]): { text: string; caret: number } | null {
  const r = ranges.find((x) => (key === 'Backspace' ? caret === x.end : caret === x.start));
  if (!r) return null;
  let { start, end } = r;
  if (text[end] === ' ') end++;
  else if (start > 0 && text[start - 1] === ' ') start--;
  return { text: text.slice(0, start) + text.slice(end), caret: start };
}

/** A character typed against a capsule's edge goes in with a space, so it doesn't become part of the name. */
export function typeBesideCapsule(text: string, caret: number, char: string, ranges: TextRange[]): { text: string; caret: number } | null {
  const r = ranges.find((x) => caret === x.end || caret === x.start);
  if (!r) return null;
  const after = caret === r.end;
  return { text: text.slice(0, caret) + (after ? ' ' + char : char + ' ') + text.slice(caret), caret: caret + (after ? 2 : 1) };
}
