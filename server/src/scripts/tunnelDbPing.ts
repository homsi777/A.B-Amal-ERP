/**
 * اختبار اتصال آمن: يطبع current_database / current_user / inet_server_port فقط.
 * تشغيل: npx tsx server/src/scripts/tunnelDbPing.ts
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('MISSING_DATABASE_URL');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const r = await pool.query(
      `SELECT current_database() AS db, current_user AS u, inet_server_port()::text AS server_port`,
    );
    console.log(JSON.stringify(r.rows[0], null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('CONNECTION_FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
