import { ExtractTablesWithRelations } from 'drizzle-orm';
import { NodePgDatabase, NodePgQueryResultHKT, drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PgDatabase } from 'drizzle-orm/pg-core';
import { join } from 'node:path';
import { Pool } from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
/** Either the pooled database or a transaction: repositories accept both. */
export type Db = PgDatabase<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type RootDb = NodePgDatabase<Schema>;

/** The only place a PostgreSQL connection is created (server, CLI scripts and tests all go through here). */
export function createDb(url: string, poolMax = 10): { pool: Pool; db: RootDb } {
  const pool = new Pool({ connectionString: url, max: poolMax, application_name: 'summer-server' });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  return { pool, db };
}

/** Works from both src/database (ts-node) and dist/database (build): the folder sits at the project root. */
export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'drizzle');

export function runMigrations(db: RootDb): Promise<void> {
  return migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
