import 'dotenv/config';
import { Pool } from 'pg';
import { loadConfig } from '../../config/app-config';
import { createDb, runMigrations } from '../client';
import { DEFAULT_LOAD, LoadOptions, seedLoad } from '../seed/load';
import { loadDatabaseUrl } from './load-db-url';

/**
 * Fills a separate `summer_load` database (same PostgreSQL server as DATABASE_URL) with bulk random data.
 * Usage: npm run db:seed:load [-- --summaries=4000 --running=40 --seed=7]
 * Then run the server against it with `npm run start:load`.
 */
function parseArgs(argv: string[]): LoadOptions {
  const opts = { ...DEFAULT_LOAD };
  const keys: Record<string, keyof LoadOptions> = { summaries: 'summaries', running: 'runningSummaries', seed: 'seed' };
  for (const arg of argv) {
    const m = /^--(\w+)=(\d+)$/.exec(arg);
    if (!m || !keys[m[1]]) throw new Error(`unknown argument "${arg}" (expected --summaries=N --running=N --seed=N)`);
    opts[keys[m[1]]] = Number(m[2]);
  }
  return opts;
}

async function ensureDatabase(url: string) {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const pool = new Pool({ connectionString: admin.toString(), max: 1 });
  try {
    const { rowCount } = await pool.query('select 1 from pg_database where datname = $1', [name]);
    if (!rowCount) {
      await pool.query(`create database "${name.replace(/"/g, '""')}"`);
      console.log(`[seed:load] created database "${name}"`);
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  const config = loadConfig();
  if (config.env === 'production') throw new Error('refusing to seed load data when NODE_ENV=production');
  const opts = parseArgs(process.argv.slice(2));
  const url = loadDatabaseUrl(config.db.url);
  await ensureDatabase(url);
  const { pool, db } = createDb(url, 1);
  try {
    const started = Date.now();
    await runMigrations(db);
    console.log(`[seed:load] generating into ${new URL(url).pathname.slice(1)}…`);
    const counts = await seedLoad(db, opts);
    console.table(counts);
    console.log(`[seed:load] done in ${((Date.now() - started) / 1000).toFixed(1)}s — start the server on it with: npm run start:load`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
