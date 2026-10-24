import 'dotenv/config';
import { loadConfig } from '../../config/app-config';
import { createDb, runMigrations } from '../client';
import { seed } from '../seed/seed';

async function main() {
  const config = loadConfig();
  if (config.env === 'production') throw new Error('refusing to seed (wipes all data) when NODE_ENV=production');
  const { pool, db } = createDb(config.db.url, 1);
  try {
    await runMigrations(db);
    await seed(db);
    console.log('[seed] done — dev users: see src/database/seed/identities.ts');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
