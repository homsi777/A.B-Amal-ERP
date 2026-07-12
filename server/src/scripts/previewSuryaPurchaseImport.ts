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

type RowHit = {
  rowNo: number;
  suryaName: string;
  suryaCode: string;
  action: 'MATCH' | 'CREATE';
  targetName: string | null;
  targetCode: string | null;
  liveRolls: number;
  oldCodeOnlyHit: string | null;
};

async function oldCodeOnlyHit(
  pool: ReturnType<typeof getPool>,
  companyId: string,
  code: string,
  suryaName: string,
): Promise<string | null> {
  if (!code) return null;
  const r = await pool.query<{ name: string; internal_code: string }>(
    `SELECT name, internal_code FROM fabric_items
     WHERE company_id=$1 AND is_active=true
       AND (lower(trim(internal_code))=lower(trim($2)) OR lower(trim(coalesce(supplier_code,'')))=lower(trim($2)))
     LIMIT 1`,
    [companyId, code],
  );
  const hit = r.rows[0];
  if (!hit) return null;
  if (hit.name.trim().toLowerCase() === suryaName.trim().toLowerCase()) return null;
  return `${hit.name}/${hit.internal_code}`;
}

async function main() {
  const pool = getPool();
  const company = await pool.query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at LIMIT 1`);
  const companyId = company.rows[0].id;

  const rows = await pool.query<{
    row_no: number;
    normalized_data: Record<string, unknown>;
  }>(
    `SELECT pir.row_no, pir.normalized_data
     FROM purchase_import_rows pir
     WHERE pir.batch_id = $1 AND pir.company_id = $2
     ORDER BY pir.row_no`,
    [CANCELLED, companyId],
  );

  const hits: RowHit[] = [];
  const materialSummary = new Map<string, { match: number; create: number; riskyOld: number }>();

  for (const row of rows.rows) {
    const nd = row.normalized_data;
    const name = cleanString(nd.materialName as string);
    const code = resolveImportMaterialCode(nd);
    const itemId = await findFabricItemForPurchaseImport(pool, companyId, name, code);
    const oldRisk = await oldCodeOnlyHit(pool, companyId, code, name);

    const key = `${name}::${code}`;
    const cur = materialSummary.get(key) ?? { match: 0, create: 0, riskyOld: 0 };
    if (itemId) {
      cur.match += 1;
      const fi = await pool.query<{ name: string; internal_code: string }>(
        `SELECT name, internal_code FROM fabric_items WHERE id=$1`,
        [itemId],
      );
      const live = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM fabric_rolls
         WHERE item_id=$1 AND status IN ('AVAILABLE','RESERVED')`,
        [itemId],
      );
      hits.push({
        rowNo: row.row_no,
        suryaName: name,
        suryaCode: code,
        action: 'MATCH',
        targetName: fi.rows[0]?.name ?? null,
        targetCode: fi.rows[0]?.internal_code ?? null,
        liveRolls: parseInt(live.rows[0]?.n ?? '0', 10),
        oldCodeOnlyHit: oldRisk,
      });
    } else {
      cur.create += 1;
      hits.push({
        rowNo: row.row_no,
        suryaName: name,
        suryaCode: code,
        action: 'CREATE',
        targetName: null,
        targetCode: null,
        liveRolls: 0,
        oldCodeOnlyHit: oldRisk,
      });
    }
    if (oldRisk && !itemId) cur.riskyOld += 1;
    materialSummary.set(key, cur);
  }

  const risks = hits.filter(
    (h) => h.oldCodeOnlyHit && h.action === 'CREATE' && h.oldCodeOnlyHit.toLowerCase().includes('honeycomb'),
  );
  const honeycombTouches = hits.filter(
    (h) => h.action === 'MATCH' && (h.targetName?.toLowerCase() === 'honeycomb'),
  );
  const liveItemTouches = hits.filter((h) => h.action === 'MATCH' && h.liveRolls > 0);

  const distinctMaterials = [...materialSummary.entries()].map(([k, v]) => {
    const [name, code] = k.split('::');
    return { name, code, ...v };
  });

  console.log(
    JSON.stringify(
      {
        totalRows: rows.rows.length,
        wouldMatch: hits.filter((h) => h.action === 'MATCH').length,
        wouldCreate: hits.filter((h) => h.action === 'CREATE').length,
        honeycombWrongMatch: honeycombTouches.length,
        liveInventoryTouches: liveItemTouches.length,
        codeOnlyRisksAvoided: hits.filter((h) => h.oldCodeOnlyHit && h.action === 'CREATE').length,
        risks,
        distinctMaterials,
        liveTouches: liveItemTouches.map((h) => ({
          row: h.rowNo,
          surya: `${h.suryaName}/${h.suryaCode}`,
          db: `${h.targetName}/${h.targetCode}`,
          liveRolls: h.liveRolls,
        })),
        creates: hits.filter((h) => h.action === 'CREATE').map((h) => ({
          row: h.rowNo,
          surya: `${h.suryaName}/${h.suryaCode}`,
          oldWouldHit: h.oldCodeOnlyHit,
        })),
      },
      null,
      2,
    ),
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
