// Starts a throwaway PostgreSQL for the test run (separate port and data dir from the dev database).
import EmbeddedPostgres from 'embedded-postgres';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.TEST_DB_PORT ?? 5434);
const dir = resolve('.data/pg-test');

export default async function globalSetup() {
  rmSync(dir, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C', '--locale-provider=icu', '--icu-locale=und'],
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('summer_test');
  globalThis.__SUMMER_TEST_PG__ = pg;
  process.env.DATABASE_URL = `postgres://postgres:postgres@localhost:${PORT}/summer_test`;
}
