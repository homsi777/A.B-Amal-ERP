'use strict';

/**
 * Bundles server/src/index.ts → server-bundle/index.cjs (single CJS file for Electron ESM-free runtime).
 * Password hashing uses bcryptjs, which is bundled into this single CJS file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const srcEntry = path.join(repoRoot, 'server', 'src', 'index.ts');
const outFile = path.join(repoRoot, 'server-bundle', 'index.cjs');
const migrationsSrc = path.join(repoRoot, 'server', 'src', 'db', 'migrations');
const migrationsDst = path.join(repoRoot, 'server-bundle', 'db', 'migrations');

function copyDirFlatSql() {
  if (!fs.existsSync(migrationsSrc)) {
    console.warn('[server:bundle] no migrations folder:', migrationsSrc);
    return;
  }
  fs.mkdirSync(migrationsDst, { recursive: true });
  for (const name of fs.readdirSync(migrationsSrc)) {
    const full = path.join(migrationsSrc, name);
    if (!fs.statSync(full).isFile()) continue;
    if (!name.endsWith('.sql')) continue;
    fs.copyFileSync(full, path.join(migrationsDst, name));
  }
  console.log('[server:bundle] synced SQL migrations →', migrationsDst);
}

await esbuild.build({
  entryPoints: [srcEntry],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  logLevel: 'info',
  /** CJS bundle: shim import.meta.url for env.ts (dotenv path in non-embedded runs) */
  banner: {
    js: `var __importMetaUrl=require('url').pathToFileURL(__filename).href;`,
  },
  define: {
    'import.meta.url': '__importMetaUrl',
  },
});

copyDirFlatSql();
console.log('[server:bundle] wrote', outFile);
