'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const from = path.join(repoRoot, 'server', 'src', 'db', 'migrations');
const to = path.join(repoRoot, 'server-dist', 'db', 'migrations');

if (!fs.existsSync(from)) {
  console.warn('[copy-server-migrations] no migrations folder at', from);
  process.exit(0);
}

fs.mkdirSync(to, { recursive: true });

for (const name of fs.readdirSync(from)) {
  const full = path.join(from, name);
  if (!fs.statSync(full).isFile()) continue;
  fs.copyFileSync(full, path.join(to, name));
}

console.log('[copy-server-migrations] synced SQL →', to);
