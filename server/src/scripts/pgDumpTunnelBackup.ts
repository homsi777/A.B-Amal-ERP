/**
 * نسخ احتياطي عبر نفق 5433 — لا يطبع كلمة المرور.
 * تشغيل: npx tsx server/src/scripts/pgDumpTunnelBackup.ts [مسار_اختياري]
 */
import { config } from 'dotenv';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env') });

const pgDumpCandidates = [
  'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
  'pg_dump',
];

function parseConn(raw: string): { host: string; port: string; user: string; password: string; db: string } {
  const u = new URL(raw.replace(/^postgres:/, 'postgresql:'));
  const db = u.pathname.replace(/^\//, '').split('?')[0];
  const user = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  return { host: u.hostname, port: u.port || '5432', user, password, db };
}

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error('MISSING_DATABASE_URL');
    process.exit(1);
  }
  const c = parseConn(raw);
  if (c.host !== '127.0.0.1' || c.port !== '5433') {
    console.error('REFUSED: DATABASE_URL must target 127.0.0.1:5433 for tunnel backup.');
    process.exit(1);
  }

  const root = path.resolve(__dirname, '../../..');
  const backupsDir = path.join(root, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const outPath =
    process.argv[2] || path.join(backupsDir, `fabric_erp_before_clean_${stamp}.dump`);

  let pgDump = pgDumpCandidates.find((p) => {
    if (p === 'pg_dump') return true;
    return fs.existsSync(p);
  });
  if (!pgDump) pgDump = 'pg_dump';

  const env = { ...process.env, PGPASSWORD: c.password };
  const args = ['-h', c.host, '-p', c.port, '-U', c.user, '-d', c.db, '-F', 'c', '-f', outPath];

  const r = spawnSync(pgDump, args, { env, encoding: 'utf-8', shell: pgDump === 'pg_dump' });

  if (r.status !== 0) {
    console.error('PG_DUMP_FAILED');
    if (r.stderr) console.error(r.stderr.slice(0, 2000));
    process.exit(1);
  }

  const stat = fs.statSync(outPath);
  console.log(JSON.stringify({ ok: true, path: outPath, bytes: stat.size }));
}

main();
