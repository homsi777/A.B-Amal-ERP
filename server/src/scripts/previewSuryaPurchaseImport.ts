/**
 * Simulate safe purchase-import matching for SURYA file (read-only).
 * npx tsx server/src/scripts/previewSuryaPurchaseImport.ts
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from '../db/pool.js';
import { cleanString } from '../utils/importColumnDetector.js';
import {
  findFabricItemForPurchaseImport,
  resolveImportMaterialCode,
} from '../utils/purchaseImportMaterialCodes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const CANCELLED = '52d9c5e6-6ad4-41fa-a015-be0ee9c4307f';

async function main() {
  const pool = getPool();
  const company = await pool.query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at LIMIT 1`);
  const companyId = company.rows[0].id;

  const rows = await pool.query<{
    row_no: number;
    normalized_data: Record<string, unknown>;
    old_matched: string | null;
  }>(
    `SELECT pir.row_no, pir.normalized_data, pir.matched_item_id AS old_matched
     FROM purchase_import_rows pir
     WHERE pir.batch_id = $1 AND pir.company_id = $2
     ORDER BY pir.row_no`,
    [CANCELLED, companyId],
  );

  const report = {
    totalRows: rows.rows.length,
    wouldMatch: 0,
    wouldCreate: 0,
    safeFromHoneycomb: 0,
    risks: [] as string[],
    samples: [] as Record<string, string>,
  };

  for (const row of rows.rows) {
    const nd = row.normalized_data;
    const name = cleanString(nd.materialName as string);
    const code = resolveImportMaterialCode(nd);
    const itemId = await findFabricItemForPurchaseImport(pool, companyId, name, code);

    if (itemId) {
      report.wouldMatch += 1;
      const fi = await pool.query<{ name: string; internal_code: string }>(
        `SELECT name, internal_code FROM fabric_items WHERE id=$1`,
        [itemId],
      );
      const hit = fi.rows[0];
      if (name.toLowerCase() === 'astrlı ekose' || name.toLowerCase() === 'astrli ekose') {
        if (hit?.name.toLowerCase() === 'honeycomb') {
          report.risks.push(`row ${row.row_no}: ASTRLI would hit HONEYCOMB!`);
        } else {
          report.safeFromHoneycomb += 1;
        }
      }
      if (report.samples.length < 12) {
        report.samples[`row${row.row_no}`] = `${name}/${code} → ${hit?.name}/${hit?.internal_code}`;
      }
    } else {
      report.wouldCreate += 1;
      if (report.samples.length < 12) {
        report.samples[`row${row.row_no}`] = `${name}/${code} → NEW ITEM`;
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
