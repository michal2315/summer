/**
 * Search-box syntax, kept in sync with the server's parseQuery (summary-search.ts):
 * - and / or / not (וגם / או / לא, ולא, בלי) between terms; AND binds tighter, adjacent terms are ANDed
 * - @username filters by author, :lecture or :שיעור by content type (`_` for spaces)
 * - #name is a capsule (`_` for spaces) and joins and / or / not like a word; when no capsule has that name it is the plain word
 * - "quoted phrases" stay whole (and are how to search for an operator word itself)
 */
export type TokenKind = 'term' | 'and' | 'or' | 'not' | 'user' | 'type' | 'capsule';

export interface QueryToken {
  kind: TokenKind;
  start: number;
  end: number;
  /** For operators: it actually joins terms (a leading `or` or trailing `not` is dropped). */
  active?: boolean;
}

export interface QueryTerm {
  term: string;
  neg: boolean;
  /** Came from "quotes" */
  exact: boolean;
  /** Written #name: `term` is the name, to resolve with the capsules service */
  capsule?: boolean;
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

export function parseQuery(text: string): ParsedQuery {
  const tokens: QueryToken[] = [];
  const groups: QueryTerm[][] = [[]];
  let pending: QueryToken[] = [];
  let pendingOr = false;
  let neg = false;

  for (const m of text.matchAll(/"([^"]*)"?|\S+/g)) {
    const word = m[0];
    const quoted = m[1] !== undefined;
    const op = quoted ? undefined : OPERATORS[word.toLowerCase()];
    const kind: TokenKind = quoted ? 'term' : /^@\S/.test(word) ? 'user' : /^:\S/.test(word) ? 'type' : /^#\S/.test(word) ? 'capsule' : (op ?? 'term');
    const token: QueryToken = { kind, start: m.index!, end: m.index! + word.length };
    tokens.push(token);

    if (kind === 'or') pendingOr = groups[groups.length - 1].length > 0;
    else if (kind === 'not') neg = true;
    if (op) pending.push(token);
    if (kind !== 'term' && kind !== 'capsule') continue;

    const term = (quoted ? m[1] : word.replace(/^#/, '')).trim();
    if (!term) continue;
    const hasPrev = groups[groups.length - 1].length > 0;
    for (const p of pending) p.active = p.kind === 'not' ? neg : hasPrev && (p.kind === 'and' || pendingOr);
    if (pendingOr) groups.push([]);
    groups[groups.length - 1].push(kind === 'capsule' ? { term, neg, exact: false, capsule: true } : { term, neg, exact: quoted });
    pending = [];
    pendingOr = neg = false;
  }
  return { tokens, groups: groups.filter((g) => g.length) };
}

export interface QuerySegment {
  text: string;
  kind: TokenKind | null;
}

/** Is `name` (from #name) a known capsule? */
export type IsCapsule = (name: string) => boolean;

/**
 * The text split for display: active operators, @users, :types and #capsules get a kind, the rest is plain.
 * With `isCapsule`, only known capsules are marked; without it every #name is (examples).
 */
export function querySegments(text: string, isCapsule?: IsCapsule): QuerySegment[] {
  const out: QuerySegment[] = [];
  let last = 0;
  for (const t of parseQuery(text).tokens) {
    const capsule = t.kind === 'capsule' && (!isCapsule || isCapsule(text.slice(t.start + 1, t.end)));
    const marked = t.kind === 'user' || t.kind === 'type' || t.active || capsule;
    if (!marked) continue;
    if (t.start > last) out.push({ text: text.slice(last, t.start), kind: null });
    out.push({ text: text.slice(t.start, t.end), kind: t.kind });
    last = t.end;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: null });
  return out;
}

export interface ShortcutContext {
  kind: 'user' | 'type' | 'capsule';
  /** What was typed after the @ / : / # up to the caret */
  query: string;
  start: number;
  end: number;
}

const SIGILS: Record<string, ShortcutContext['kind']> = { '@': 'user', ':': 'type', '#': 'capsule' };

/** The @user / :type / #capsule word the caret is in, if any. */
export function shortcutAt(text: string, caret: number): ShortcutContext | null {
  const m = /(^|\s)([@:#])(\S*)$/.exec(text.slice(0, caret));
  if (!m) return null;
  let end = caret;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return { kind: SIGILS[m[2]], query: m[3], start: m.index + m[1].length, end };
}

/** Replace the shortcut word with `token` and a trailing space; returns the new text and caret. */
export function replaceShortcut(text: string, ctx: ShortcutContext, token: string): { text: string; caret: number } {
  const rest = text.slice(ctx.end).replace(/^\s*/, '');
  const head = text.slice(0, ctx.start) + token + ' ';
  return { text: head + rest, caret: head.length };
}

// ---------------------------------------------------------------- capsules are atomic in the search box

export interface TextRange {
  start: number;
  end: number;
}

/** Where the known capsules sit in the text. */
export function capsuleRanges(text: string, isCapsule: IsCapsule): TextRange[] {
  return parseQuery(text)
    .tokens.filter((t) => t.kind === 'capsule' && isCapsule(text.slice(t.start + 1, t.end)))
    .map(({ start, end }) => ({ start, end }));
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
