// Packs the extension into ../summer-extension-dist for summer-server to serve (EXTENSION_DIR).
//
//   node scripts/pack.mjs [summer-url]        e.g. node scripts/pack.mjs https://summer.university.local
//
// The URL (default http://localhost:81) becomes the extension's default server, gets host access without a
// prompt, and hosts the update manifest. Bump "version" in manifest.json before re-packing, or installed copies
// won't update. The signing key (summer-extension.pem) fixes the extension ID: keep it, don't commit it.
import { spawnSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, '../summer-extension-dist');
const key = join(dist, 'summer-extension.pem');
const summerUrl = (process.argv[2] || 'http://localhost:81').replace(/\/+$/, '');
const origin = new URL(summerUrl).origin;

function findChrome() {
  const candidates = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new Error('Chrome/Edge not found; set CHROME to its executable');
  return found;
}

/** Chrome's extension ID: the first 16 bytes of sha256(public key DER), hex digits mapped 0-f → a-p. */
function extensionId(pem) {
  const der = createPublicKey(pem).export({ type: 'spki', format: 'der' });
  return [...createHash('sha256').update(der).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

const staging = join(mkdtempSync(join(tmpdir(), 'summer-ext-')), 'summer-extension');
cpSync(root, staging, { recursive: true, filter: (src) => !src.startsWith(join(root, 'scripts')) });

const manifest = JSON.parse(readFileSync(join(staging, 'manifest.json'), 'utf8'));
manifest.update_url = `${summerUrl}/api/extension/updates.xml`;
manifest.host_permissions = [...new Set([...manifest.host_permissions, `${origin}/*`])];
writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(join(staging, 'config.js'), readFileSync(join(staging, 'config.js'), 'utf8').replace(/SUMMER_URL = '[^']*'/, `SUMMER_URL = '${summerUrl}'`));

mkdirSync(dist, { recursive: true });
const args = [`--pack-extension=${staging}`, '--no-message-box'];
if (existsSync(key)) args.push(`--pack-extension-key=${key}`);
const run = spawnSync(findChrome(), args, { stdio: 'inherit' });
if (run.status !== 0 || !existsSync(`${staging}.crx`)) throw new Error('Chrome failed to pack the extension');

renameSync(`${staging}.crx`, join(dist, 'summer-extension.crx'));
if (existsSync(`${staging}.pem`)) renameSync(`${staging}.pem`, key);
const id = extensionId(readFileSync(key, 'utf8'));
writeFileSync(join(dist, 'summer-extension.json'), JSON.stringify({ id, version: manifest.version, summerUrl }, null, 2) + '\n');
rmSync(dirname(staging), { recursive: true, force: true });

console.log(`Packed Summer extension ${manifest.version} (id ${id}) for ${summerUrl} → ${dist}`);
