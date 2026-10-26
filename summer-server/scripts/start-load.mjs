// Dev-only: runs the server in watch mode against the load-test database (`npm run db:seed:load` fills it).
// Uses LOAD_DATABASE_URL, or DATABASE_URL with the database renamed to summer_load.
import 'dotenv/config';
import { spawn } from 'node:child_process';

const url = new URL(process.env.LOAD_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/summer');
if (!process.env.LOAD_DATABASE_URL) url.pathname = '/summer_load';
console.log(`[start:load] DATABASE_URL → ${url.host}${url.pathname}`);

const child = spawn('npx nest start --watch', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: url.toString() },
});
child.on('exit', (code) => process.exit(code ?? 0));
