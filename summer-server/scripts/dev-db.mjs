// Dev-only: runs an embedded PostgreSQL 17 (binaries come from the embedded-postgres npm package; nothing to install).
// Data persists in .data/pg. Stop with Ctrl+C. Connection details come from DATABASE_URL in .env.
import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const url = new URL(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/summer');
const database = url.pathname.slice(1);
const dataDir = resolve(process.env.DEV_DB_DIR ?? '.data/pg');

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port: Number(url.port || 5432),
  persistent: true,
  // ICU gives Unicode-aware case folding (ILIKE) on every OS; Windows has no C.UTF-8 libc locale.
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--locale-provider=icu', '--icu-locale=und'],
  onLog: () => {},
});

if (!existsSync(dataDir)) {
  console.log(`[db] initialising ${dataDir}`);
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase(database);
  console.log(`[db] created database "${database}"`);
} catch {
  // already exists
}
console.log(`[db] PostgreSQL ready on ${url.hostname}:${url.port}/${database} — Ctrl+C to stop`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  console.log('\n[db] stopping…');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// Keep the process alive.
setInterval(() => {}, 1 << 30);
