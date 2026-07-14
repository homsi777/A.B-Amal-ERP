/**
 * Create a PostgreSQL custom-format dump for download to the client device.
 * Does not log DATABASE_URL or credentials.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PG_DUMP_CANDIDATES = [
  process.env.PG_DUMP_PATH,
  'pg_dump',
  '/usr/bin/pg_dump',
  '/usr/lib/postgresql/16/bin/pg_dump',
  '/usr/lib/postgresql/15/bin/pg_dump',
  'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
  'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
].filter(Boolean) as string[];

function resolveDatabaseUrl(): string {
  const url = String(process.env.DATABASE_URL || '').trim();
  if (!url) {
    throw Object.assign(new Error('DATABASE_URL غير مضبوط على الخادم'), { statusCode: 500 });
  }
  return url;
}

function resolvePgDump(): string {
  for (const candidate of PG_DUMP_CANDIDATES) {
    try {
      if (candidate === 'pg_dump') return candidate;
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return 'pg_dump';
}

export type DatabaseBackupFile = {
  filePath: string;
  fileName: string;
  sizeBytes: number;
};

export async function createDatabaseBackupFile(): Promise<DatabaseBackupFile> {
  const databaseUrl = resolveDatabaseUrl();
  const pgDump = resolvePgDump();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `clotex-backup-${stamp}.dump`;
  const filePath = path.join(os.tmpdir(), fileName);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      pgDump,
      ['-Fc', '--no-owner', '--no-privileges', '-f', filePath, databaseUrl],
      {
        env: process.env,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      },
    );

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    child.on('error', (err) => {
      reject(
        Object.assign(
          new Error(`تعذر تشغيل pg_dump: ${err.message}`),
          { statusCode: 500 },
        ),
      );
    });

    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(filePath)) {
        resolve();
        return;
      }
      const safeErr = stderr
        .replace(databaseUrl, '[DATABASE_URL]')
        .replace(/:[^:@/]+@/g, ':***@')
        .trim();
      reject(
        Object.assign(
          new Error(safeErr || `فشل إنشاء النسخة الاحتياطية (رمز ${code ?? 'unknown'})`),
          { statusCode: 500 },
        ),
      );
    });
  });

  const stat = fs.statSync(filePath);
  if (!stat.size) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
    throw Object.assign(new Error('ملف النسخة الاحتياطية فارغ'), { statusCode: 500 });
  }

  return { filePath, fileName, sizeBytes: stat.size };
}

export function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}
