import 'dotenv/config';
import { loadConfig } from '../../config/app-config';
import { createDb, runMigrations } from '../client';

async function main() {
  const config = loadConfig();
  const { pool, db } = createDb(config.db.url, 1);
  try {
    await runMigrations(db);
    console.log('[migrate] up to date');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
