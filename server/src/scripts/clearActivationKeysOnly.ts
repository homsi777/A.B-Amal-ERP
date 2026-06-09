/**
 * يُفرّغ جداول التفعيل فقط (أحداث ثم مفاتيح) — استخدام قبل إعادة توليد CLI.
 * لا يطبع أسراراً.
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query('DELETE FROM activation_events');
    await pool.query('DELETE FROM activation_keys');
    console.log(JSON.stringify({ cleared: true }));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
