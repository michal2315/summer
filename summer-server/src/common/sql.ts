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

/** A literal uuid[] — built element by element because drizzle expands JS arrays into `($1, $2)` lists. */
export function uuidArray(ids: string[]): SQL {
  if (!ids.length) return sql`ARRAY[]::uuid[]`;
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;
}
