/**
 * تحقق بعد إعادة التهيئة: أعداد وجداول حرجة — لا أسرار.
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env') });

const TABLES = [
  'activation_keys',
  'activation_events',
  'activation_devices',
  'companies',
  'users',
  'roles',
  'permissions',
  'warehouses',
  'suppliers',
  'customers',
  'fabric_categories',
  'fabric_items',
  'fabric_colors',
  'fabric_item_variants',
  'fabric_rolls',
  'inventory_movements',
  'purchase_import_batches',
  'purchase_import_rows',
  'label_templates',
  'print_jobs',
  'printed_labels',
];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const exists: Record<string, string | null> = {};
    for (const t of TABLES) {
      const r = await pool.query<{ reg: string | null }>(
        `SELECT to_regclass($1)::text AS reg`,
        [`public.${t}`],
      );
      exists[t] = r.rows[0]?.reg ?? null;
    }

    const counts = await pool.query(`
      SELECT 'users' AS table_name, COUNT(*)::text AS n FROM users
      UNION ALL SELECT 'companies', COUNT(*)::text FROM companies
      UNION ALL SELECT 'warehouses', COUNT(*)::text FROM warehouses
      UNION ALL SELECT 'customers', COUNT(*)::text FROM customers
      UNION ALL SELECT 'suppliers', COUNT(*)::text FROM suppliers
      UNION ALL SELECT 'fabric_items', COUNT(*)::text FROM fabric_items
      UNION ALL SELECT 'fabric_rolls', COUNT(*)::text FROM fabric_rolls
      UNION ALL SELECT 'activation_keys', COUNT(*)::text FROM activation_keys
    `);

    const admin = await pool.query<{ username: string; role: string; is_active: boolean; hash_len: string; prefix: string }>(
      `SELECT username, role, is_active,
              length(password_hash)::text AS hash_len,
              left(password_hash, 4) AS prefix
       FROM users WHERE username = 'admin'`,
    );

    console.log(JSON.stringify({ exists, counts: counts.rows, admin: admin.rows[0] ?? null }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
