/**
 * تشغيل ترحيلات SQL بنُسخة تتبع schema_migrations
 * متغيرات البيئة: DATABASE_URL فقط (ملف server/.env)
 */
import { config as loadDotenv } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadDotenv({ path: path.resolve(__dirname, '../../.env') });

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[migrate] DATABASE_URL غير معرّف في server/.env');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const migrationsDir = path.resolve(__dirname, 'migrations');

  let files: string[];
  try {
    files = (await fs.readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));
  } catch (e) {
    console.error('[migrate] تعذر قراءة مجلد migrations');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query(BOOTSTRAP_SQL);

    for (const filename of files) {
      const done = await client.query<{ filename: string }>(
        'SELECT filename FROM schema_migrations WHERE filename = $1',
        [filename],
      );
      if (done.rows.length > 0) {
        console.log(`[migrate] تخطّي (مُطبَّق مسبقاً): ${filename}`);
        continue;
      }

      const fullPath = path.join(migrationsDir, filename);
      const sql = await fs.readFile(fullPath, 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log(`[migrate] تم تطبيق: ${filename}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('[migrate] اكتمل بنجاح.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[migrate] فشل:', err instanceof Error ? err.message : err);
  process.exit(1);
});
