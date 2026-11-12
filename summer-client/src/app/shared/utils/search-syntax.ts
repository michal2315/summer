import { QueryTextField } from '../models';
import { SUMMARY_COLORS } from '../models/colors';

/**
 * Search-box syntax, kept in sync with the server's parseQuery (summary-search.ts). Every word is plain text (matched
 * anywhere; "quoted" = whole words only) unless it starts with MARK, which the box puts there when the user presses ←:
 * - and / or / not (וגם / או / לא, ולא, בלי) between terms; AND binds tighter, adjacent terms are ANDed
 * - @username filters by author; #name is a capsule (`_` for spaces) and joins and / or / not like a word
 * - $name picks one of the user's saved searches (the box runs it); not picked, it stays plain text
 * - :field:value searches one field; the value may have spaces and runs up to END (← again), or the end of the text
 */
export const MARK = '\u2063';
export const END = '\u2064';

/** A :field:value token (from its MARK up to END), a "phrase", or a word. */
const TOKEN_RE = /(?<!\S)\u2063:[^\u2064]*\u2064?|"([^"]*)"?|\S+/g;

export type TokenKind = 'term' | 'and' | 'or' | 'not' | 'user' | 'field' | 'capsule' | 'saved';

export interface QueryToken {
  kind: TokenKind;
  start: number;
  end: number;
  /** For operators: it actually joins terms (a leading `or` or trailing `not` is dropped). */
  active?: boolean;
  /** For :field: tokens: closed with END */
  closed?: boolean;
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
  or: 'or',
  או: 'or',
  not: 'not',
  לא: 'not',
  ולא: 'not',
  בלי: 'not',
};

/** The operator a word would be once marked. */
export const operatorOf = (word: string) => OPERATORS[word.toLowerCase()];

const strip = (s: string) => s.replace(/[\u2063\u2064]/g, '');

/** A :field:value token's text (without MARK / END) → its term, if complete. */
function fieldTerm(body: string): Omit<QueryTerm, 'neg'> | undefined {
  const m = /^:([^:\s]+):([\s\S]*)$/.exec(body);
  const field = m ? fieldByName(m[1]) : undefined;
  if (!field) return undefined;
  const raw = m![2].trim();
  const quoted = /^"(.*)"?$/.exec(raw);
  const value = (quoted ? quoted[1].replace(/"$/, '') : raw).trim();
  return value ? { term: value, exact: !!quoted, field: field.key } : undefined;
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
  const groups: QueryTerm[][] = [[]];
  let pending: QueryToken[] = [];
  let pendingOr = false;
  let neg = false;

  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0];
    const token: QueryToken = { kind: 'term', start: m.index!, end: m.index! + raw.length };
    let term: Omit<QueryTerm, 'neg'> | undefined;
    if (raw.startsWith(MARK + ':')) {
      token.kind = 'field';
      token.closed = raw.endsWith(END);
      term = fieldTerm(strip(raw));
    } else if (m[1] !== undefined) {
      term = { term: strip(m[1]).trim(), exact: true };
    } else if (raw.startsWith(MARK)) {
      const parsed = markedWord(strip(raw));
      token.kind = parsed.kind;
      term = parsed.term;
    } else {
      term = { term: strip(raw), exact: false };
    }
    tokens.push(token);

    if (token.kind === 'or') pendingOr = groups[groups.length - 1].length > 0;
    else if (token.kind === 'not') neg = true;
    if (token.kind === 'and' || token.kind === 'or' || token.kind === 'not') {
      pending.push(token);
      continue;
    }
    if (!term?.term) continue;
    const hasPrev = groups[groups.length - 1].length > 0;
    for (const p of pending) p.active = p.kind === 'not' ? neg : hasPrev && (p.kind === 'and' || pendingOr);
    if (pendingOr) groups.push([]);
    groups[groups.length - 1].push({ ...term, neg });
    pending = [];
    pendingOr = neg = false;
  }
  return { tokens, groups: groups.filter((g) => g.length) };
}

export interface QuerySegment {
  text: string;
  /** 'phrase': a "quoted phrase" term */
  kind: TokenKind | 'phrase' | null;
}

/** Is `name` (from #name) a known capsule? */
export type IsCapsule = (name: string) => boolean;

/** A marked #capsule token's name. */
const capsuleName = (text: string, t: QueryToken) => text.slice(t.start + 2, t.end);

const isOperator = (t: QueryToken) => t.kind === 'and' || t.kind === 'or' || t.kind === 'not';

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
    const marked = t.kind === 'user' || t.kind === 'field' || t.kind === 'saved' || t.active || capsule || phrase;
    if (!marked) continue;
    if (t.start > last) out.push({ text: text.slice(last, t.start), kind: null });
    out.push({ text: text.slice(t.start, t.end), kind: phrase ? 'phrase' : t.kind });
    last = t.end;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: null });
  return out;
}

export interface ShortcutContext {
  /** 'field': choosing the field (`:ti`); 'value': typing a field's value (`:title:gr`) */
  kind: 'user' | 'field' | 'value' | 'capsule' | 'saved';
  /** It has its MARK (← was pressed): until then it is plain text and only a hint shows */
  marked: boolean;
  /** What was typed after the sigil (for 'value': after the field name's `:`) up to the caret */
  query: string;
  /** For 'value' */
  field?: SearchField;
  /** For 'value': the field name as written */
  fieldName?: string;
  /** For :field: tokens: closed with END (`end` is then after it) */
  closed?: boolean;
  start: number;
  end: number;
}

const SIGILS: Record<string, 'user' | 'field' | 'capsule' | 'saved'> = { '@': 'user', ':': 'field', '#': 'capsule', '$': 'saved' };

/** The :field:value token the caret is in (up to its END), if any. */
export function fieldTokenAt(text: string, caret: number): QueryToken | undefined {
  return parseQuery(text).tokens.find((t) => t.kind === 'field' && caret > t.start && caret <= (t.closed ? t.end - 1 : t.end));
}

/** The @user / :field:value / #capsule / $saved search the caret is in, marked or not. */
export function shortcutAt(text: string, caret: number): ShortcutContext | null {
  const ft = fieldTokenAt(text, caret);
  if (ft) {
    const body = strip(text.slice(ft.start, caret)).slice(1);
    const base = { marked: true, start: ft.start, end: ft.closed ? ft.end : caret, closed: ft.closed };
    const colon = body.indexOf(':');
    const field = colon >= 0 ? fieldByName(body.slice(0, colon)) : undefined;
    if (field) return { ...base, kind: 'value', query: body.slice(colon + 1), field, fieldName: body.slice(0, colon) };
    return { ...base, kind: 'field', query: body };
  }
  const m = /(^|\s)(\u2063?)([@:#$])(\S*)$/.exec(text.slice(0, caret));
  if (!m || /[\u2063\u2064]/.test(m[4])) return null;
  let end = caret;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return { kind: SIGILS[m[3]], marked: !!m[2], query: m[4], start: m.index + m[1].length, end };
}

/** The unmarked operator word that ends at the caret (← makes it an operator). */
export function operatorWordAt(text: string, caret: number): { op: 'and' | 'or' | 'not'; word: string; start: number } | null {
  if (caret < text.length && !/\s/.test(text[caret])) return null;
  const m = /(^|\s)([^\s"\u2063\u2064]+)$/.exec(text.slice(0, caret));
  const op = m ? operatorOf(m[2]) : undefined;
  return op ? { op, word: m![2], start: m!.index + m![1].length } : null;
}

/** Replace the shortcut with `token` (and a trailing space unless `space` is false); returns the new text and caret. */
export function replaceShortcut(text: string, ctx: ShortcutContext, token: string, space = true): { text: string; caret: number } {
  const rest = text.slice(ctx.end);
  const head = text.slice(0, ctx.start) + token + (space ? ' ' : '');
  return { text: head + (space ? rest.replace(/^\s*/, '') : rest), caret: head.length };
}

/**
 * MARKs and ENDs that no longer mark anything (an edit cut a token, or left a word that is no longer an operator or
 * sigil) are dropped, keeping the caret in place.
 */
export function cleanMarks(text: string, caret: number): { text: string; caret: number } | null {
  const keep = new Set<number>();
  for (const t of parseQuery(text).tokens) {
    if (text[t.start] !== MARK || t.kind === 'term') continue;
    keep.add(t.start);
    if (t.kind === 'field' && t.closed) keep.add(t.end - 1);
  }
  let out = '';
  let at = caret;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ((c !== MARK && c !== END) || keep.has(i)) out += c;
    else if (i < caret) at--;
  }
  return out === text ? null : { text: out, caret: at };
}

// ---------------------------------------------------------------- capsules are atomic in the search box

export interface TextRange {
  start: number;
  end: number;
}

/** Where the known capsules and the marked operators sit in the text: they behave as one unit. */
export function capsuleRanges(text: string, isCapsule: IsCapsule): TextRange[] {
  return parseQuery(text)
    .tokens.filter((t) => (t.kind === 'capsule' && isCapsule(capsuleName(text, t))) || (isOperator(t) && text[t.start] === MARK))
    .map(({ start, end }) => ({ start, end }));
}

/** The mark and sigil of marked @users / :fields / #names / $searches: the caret can't sit between the two (the mark is invisible). */
export function markHeads(text: string): TextRange[] {
  return parseQuery(text)
    .tokens.filter((t) => (t.kind === 'user' || t.kind === 'field' || t.kind === 'capsule' || t.kind === 'saved') && text[t.start] === MARK)
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
