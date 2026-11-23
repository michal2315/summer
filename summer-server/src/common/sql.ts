import { SQL, SQLWrapper, and, ilike, inArray, sql } from 'drizzle-orm';
import { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '../database/client';

/** The subset of `ids` whose row in `table` passes `predicate` (for "may the caller see/edit these?" checks). */
export async function idsWhere(db: Db, table: PgTable, id: PgColumn, ids: string[], predicate: SQL): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id })
    .from(table)
    .where(and(inArray(id, ids), predicate));
  return new Set(rows.map((r) => r.id as string));
}

/** Escape LIKE wildcards so user text matches literally (Postgres' default escape character is backslash). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function likePattern(text: string, mode: 'contains' | 'prefix' = 'contains'): string {
  const e = escapeLike(text);
  return mode === 'prefix' ? `${e}%` : `%${e}%`;
}

/**
 * Characters search treats as the same: Hebrew final letters → regular forms, geresh / gershayim and typographic
 * quotes → ' and ". One-to-one, so the client can highlight with character classes (shared/utils/fold.ts).
 */
const FOLD_FROM = 'ךםןףץ׳״‘’“”';
const FOLD_TO = `כמנפצ'"''""`;

export const foldText = (text: string) => text.replace(/[ךםןףץ׳״‘’“”]/g, (c) => FOLD_TO[FOLD_FROM.indexOf(c)]);

/** For matching in JS the way textLike matches in SQL: `searchKey(hay).includes(searchKey(needle))`. */
export const searchKey = (text: string) => foldText(text).toLowerCase();

/** Case-insensitive `text` in `col`, ignoring the differences foldText removes. */
export function textLike(col: SQLWrapper, text: string, mode: 'contains' | 'prefix' = 'contains'): SQL {
  return ilike(sql`translate(${col}, ${FOLD_FROM}, ${FOLD_TO})`, likePattern(foldText(text), mode));
}

/** Not a letter or digit (Hebrew spelled out: the database's ctype may not class it as alphanumeric). */
const NON_WORD = '[^[:alnum:]א-ת_]';

/** `text` in `col` as whole words only (not inside a longer word), case-insensitive, folded like textLike. */
export function textWholeWord(col: SQLWrapper, text: string): SQL {
  const escaped = foldText(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sql`translate(${col}, ${FOLD_FROM}, ${FOLD_TO}) ~* ${`(^|${NON_WORD})${escaped}(${NON_WORD}|$)`}`;
}

// ---------------------------------------------------------------- regex search (`/pattern/`)

/** Letters, digits and _ (Hebrew spelled out, like NON_WORD), as bracket-expression content. */
const WORD_CHARS = '[:alnum:]א-ת_';
/** \b / \B: Postgres' own (\y / \Y) follow the database's ctype, which may not class Hebrew as letters. */
const BOUNDARY = `(?:(?<=[${WORD_CHARS}])(?![${WORD_CHARS}])|(?<![${WORD_CHARS}])(?=[${WORD_CHARS}]))`;
const NON_BOUNDARY = `(?:(?<=[${WORD_CHARS}])(?=[${WORD_CHARS}])|(?<![${WORD_CHARS}])(?![${WORD_CHARS}]))`;

export const MAX_REGEX = 200;

/**
 * A search regex as typed (JavaScript-style, the common subset) → Postgres ARE, folded like textLike. `\b`, `\B`, `\w`
 * and `\W` become Hebrew-aware classes (in Postgres `\b` is a backspace). Returns the problem instead when the pattern
 * isn't valid or uses what Postgres lacks (named groups, \p{…}, \W / \S / \D inside […]).
 */
export function pgRegex(pattern: string): { source: string } | { problem: string } {
  if (pattern.length > MAX_REGEX) return { problem: `ביטוי רגולרי ארוך מ-${MAX_REGEX} תווים` };
  try {
    new RegExp(pattern);
  } catch {
    return { problem: 'ביטוי רגולרי לא תקין' };
  }
  if (/\(\?<(?![=!])|\\k<|\\[pP]\{/.test(pattern)) return { problem: 'קבוצות עם שם ו-\\p{…} אינם נתמכים' };
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
        if (n === 'W' || n === 'S' || n === 'D') return { problem: `\\${n} בתוך […] אינו נתמך` };
        out += n === 'w' ? WORD_CHARS : `\\${n}`;
      } else out += n === 'b' ? BOUNDARY : n === 'B' ? NON_BOUNDARY : n === 'w' ? `[${WORD_CHARS}]` : n === 'W' ? `[^${WORD_CHARS}]` : `\\${foldText(n)}`;
      continue;
    }
    if (!inClass && c === '[') {
      inClass = classStart = true;
      if (pattern[i + 1] === '^') out += '[' + pattern[++i];
      else out += '[';
      continue;
    }
    if (inClass && c === ']' && !wasStart) inClass = false;
    out += foldText(c);
  }
  return { source: out };
}

/** The problem with a search regex, if any (see pgRegex). */
export const regexProblem = (pattern: string): string | undefined => {
  const r = pgRegex(pattern);
  return 'problem' in r ? r.problem : undefined;
};

/** `pattern` (a search regex, see pgRegex) matches somewhere in `col`, case-insensitive, folded like textLike. Invalid → no match. */
export function textRegex(col: SQLWrapper, pattern: string): SQL {
  const r = pgRegex(pattern);
  return 'source' in r ? sql`translate(${col}, ${FOLD_FROM}, ${FOLD_TO}) ~* ${r.source}` : sql`false`;
}

/** A literal uuid[] — built element by element because drizzle expands JS arrays into `($1, $2)` lists. */
export function uuidArray(ids: string[]): SQL {
  if (!ids.length) return sql`ARRAY[]::uuid[]`;
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;
}
