/**
 * Search-box syntax, kept in sync with the server's parseQuery (summary-search.ts):
 * - and / or / not (וגם / או / לא, ולא, בלי) between terms; AND binds tighter, adjacent terms are ANDed
 * - @username filters by author, :lecture or :שיעור by content type (`_` for spaces)
 * - "quoted phrases" stay whole (and are how to search for an operator word itself), a leading # is ignored
 */
export type TokenKind = 'term' | 'and' | 'or' | 'not' | 'user' | 'type';

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
    const kind: TokenKind = quoted ? 'term' : /^@\S/.test(word) ? 'user' : /^:\S/.test(word) ? 'type' : (op ?? 'term');
    const token: QueryToken = { kind, start: m.index!, end: m.index! + word.length };
    tokens.push(token);

    if (kind === 'or') pendingOr = groups[groups.length - 1].length > 0;
    else if (kind === 'not') neg = true;
    if (op) pending.push(token);
    if (kind !== 'term') continue;

    const term = (quoted ? m[1] : word.replace(/^#/, '')).trim();
    if (!term) continue;
    const hasPrev = groups[groups.length - 1].length > 0;
    for (const p of pending) p.active = p.kind === 'not' ? neg : hasPrev && (p.kind === 'and' || pendingOr);
    if (pendingOr) groups.push([]);
    groups[groups.length - 1].push({ term, neg, exact: quoted });
    pending = [];
    pendingOr = neg = false;
  }
  return { tokens, groups: groups.filter((g) => g.length) };
}

export interface QuerySegment {
  text: string;
  kind: TokenKind | null;
}

/** The text split for display: active operators, @users and :types get a kind, the rest is plain. */
export function querySegments(text: string): QuerySegment[] {
  const out: QuerySegment[] = [];
  let last = 0;
  for (const t of parseQuery(text).tokens) {
    const marked = t.kind === 'user' || t.kind === 'type' || t.active;
    if (!marked) continue;
    if (t.start > last) out.push({ text: text.slice(last, t.start), kind: null });
    out.push({ text: text.slice(t.start, t.end), kind: t.kind });
    last = t.end;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: null });
  return out;
}

export interface ShortcutContext {
  kind: 'user' | 'type';
  /** What was typed after the @ / : up to the caret */
  query: string;
  start: number;
  end: number;
}

/** The @user / :type word the caret is in, if any. */
export function shortcutAt(text: string, caret: number): ShortcutContext | null {
  const m = /(^|\s)([@:])(\S*)$/.exec(text.slice(0, caret));
  if (!m) return null;
  let end = caret;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return { kind: m[2] === '@' ? 'user' : 'type', query: m[3], start: m.index + m[1].length, end };
}

/** Replace the shortcut word with `token` and a trailing space; returns the new text and caret. */
export function replaceShortcut(text: string, ctx: ShortcutContext, token: string): { text: string; caret: number } {
  const rest = text.slice(ctx.end).replace(/^\s*/, '');
  const head = text.slice(0, ctx.start) + token + ' ';
  return { text: head + rest, caret: head.length };
}
