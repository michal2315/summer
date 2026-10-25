import { SQL, and, inArray, sql } from 'drizzle-orm';
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

/** A literal uuid[] — built element by element because drizzle expands JS arrays into `($1, $2)` lists. */
export function uuidArray(ids: string[]): SQL {
  if (!ids.length) return sql`ARRAY[]::uuid[]`;
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;
}
