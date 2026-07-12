/**
 * Split HONEYCOMB into CLO-1 and CLO-3 fabric items (Aleppo rows 134-152).
 *   npx tsx server/src/scripts/fixHoneycombNameCode.ts
 *   npx tsx server/src/scripts/fixHoneycombNameCode.ts --apply
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from '../db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const ALEPPO_BATCH = '2baf30aa-dae7-4d48-95f3-9d1778616256';

function normalizeCode(raw: string): string {
  const code = raw.trim();
  const m = /^clo[\s-]?(\d+)$/i.exec(code.replace(/\s+/g, ''));
  if (m) return `CLO-${m[1]}`;
  return code;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const pool = getPool();
  const company = await pool.query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at LIMIT 1`);
  const companyId = company.rows[0].id;

  const rows = await pool.query<{
    roll_id: string;
    barcode: string;
    row_no: number;
    excel_code: string;
    item_id: string;
    item_name: string;
    internal_code: string;
    supplier_code: string | null;
  }>(
    `SELECT r.id AS roll_id, r.barcode, pir.row_no,
            coalesce(pir.normalized_data->>'materialCode', '') AS excel_code,
            fi.id AS item_id, fi.name AS item_name, fi.internal_code, fi.supplier_code
     FROM purchase_import_rows pir
     JOIN fabric_rolls r ON r.id = pir.created_roll_id
     JOIN fabric_items fi ON fi.id = r.item_id
     WHERE pir.batch_id = $1 AND pir.company_id = $2
       AND pir.normalized_data->>'materialName' ILIKE 'honeycomb'
     ORDER BY pir.row_no`,
    [ALEPPO_BATCH, companyId],
  );

  const report = { dryRun: !apply, scanned: rows.rows.length, fixed: 0, itemsCreated: 0, samples: [] as string[] };
  const itemCache = new Map<string, string>();

  const client = await pool.connect();
  try {
    if (apply) await client.query('BEGIN');

    for (const row of rows.rows) {
      const code = normalizeCode(row.excel_code);
      const targetInternal = code === 'CLO-3' ? 'IMP-AUTO-HONEYCOMB-CLO-3' : 'IMP-AUTO-HONEYCOMB-CLO-1';
      const cacheKey = targetInternal;
      let targetId = itemCache.get(cacheKey);

      if (!targetId) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM fabric_items
           WHERE company_id=$1 AND name ILIKE 'HONEYCOMB' AND internal_code=$2 LIMIT 1`,
          [companyId, targetInternal],
        );
        if (existing.rows[0]?.id) {
          targetId = existing.rows[0].id;
        } else if (apply) {
          const ins = await client.query<{ id: string }>(
            `INSERT INTO fabric_items (company_id, name, internal_code, supplier_code, unit, is_active)
             VALUES ($1,'HONEYCOMB',$2,$3,'meter',true) RETURNING id`,
            [companyId, targetInternal, code],
          );
          targetId = ins.rows[0].id;
          report.itemsCreated += 1;
        } else {
          targetId = `dry-${targetInternal}`;
        }
        itemCache.set(cacheKey, targetId);
      }

      const ok =
        row.item_name.toLowerCase() === 'honeycomb'
        && row.supplier_code?.toLowerCase() === code.toLowerCase()
        && row.internal_code === targetInternal;

      if (ok) continue;
      report.fixed += 1;
      if (report.samples.length < 15) {
        report.samples.push(`${row.barcode}: ${row.item_name}/${row.supplier_code ?? row.internal_code} → HONEYCOMB/${code}`);
      }

      if (apply && !targetId.startsWith('dry-')) {
        await client.query(
          `UPDATE fabric_rolls SET item_id=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
          [row.roll_id, companyId, targetId],
        );
        await client.query(
          `UPDATE fabric_items SET name='HONEYCOMB', supplier_code=$3, updated_at=now()
           WHERE id=$1 AND company_id=$2`,
          [targetId, companyId, code],
        );
      }
    }

    if (apply) await client.query('COMMIT');
  } catch (e) {
    if (apply) await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
