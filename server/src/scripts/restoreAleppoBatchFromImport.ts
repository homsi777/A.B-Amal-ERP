/**
 * Restore roll ↔ fabric_item links to match Aleppo Excel (name + code only).
 * Uses exact Excel materialName — no business aliases.
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { cleanString } from '../utils/importColumnDetector.js';
import { buildAutoInternalCode } from '../utils/importItemCodes.js';
import {
  resolveStockImportItemCodes,
  type StockImportLayout,
} from '../utils/stockImportItemCodes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

function readArg(flag: string): string | undefined {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return undefined;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=').trim() || undefined;
  const idx = process.argv.indexOf(hit);
  return process.argv[idx + 1]?.trim() || undefined;
}

/** CLO1 / clo1 → CLO-1 for display consistency with Excel intent. */
function normalizeBusinessCode(raw: string): string {
  const code = raw.trim();
  if (!code) return '';
  const m = /^clo[\s-]?(\d+)$/i.exec(code.replace(/\s+/g, ''));
  if (m) return `CLO-${m[1]}`;
  return code;
}

function extractRowFields(payload: unknown): { materialName: string; materialCode: string } {
  const row =
    payload && typeof payload === 'object'
      ? { ...(payload as Record<string, unknown>) }
      : {};
  const materialName = cleanString(row.materialName) || cleanString(row.itemName);
  const materialCode = normalizeBusinessCode(
    cleanString(row.materialCode) || cleanString(row.itemCode) || cleanString(row.supplierMaterialCode),
  );
  return { materialName, materialCode };
}

function codesAlignWithExcel(
  itemName: string,
  itemInternal: string,
  itemSupplier: string | null,
  excelName: string,
  targetInternal: string,
  targetSupplier: string | null,
): boolean {
  if (itemName.trim().toLowerCase() !== excelName.trim().toLowerCase()) return false;
  if (itemInternal.trim().toLowerCase() === targetInternal.trim().toLowerCase()) return true;
  if (
    targetSupplier
    && itemInternal.startsWith('IMP-AUTO-')
    && itemSupplier?.trim().toLowerCase() === targetSupplier.trim().toLowerCase()
  ) {
    return true;
  }
  return false;
}

async function resolveCompanyId(pool: ReturnType<typeof getPool>): Promise<string> {
  const fromEnv = process.env.COMPANY_ID?.trim();
  if (fromEnv) return fromEnv;
  const c = await pool.query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
  if (!c.rows.length) throw new Error('لا توجد شركة');
  return c.rows[0].id;
}

function designSuffix(code: string): string {
  return code.replace(/[^A-Za-z0-9-]/g, '') || 'CODE';
}

async function resolveItemIdentity(
  client: PoolClient,
  companyId: string,
  materialName: string,
  materialCode: string,
  layout: StockImportLayout | string,
): Promise<{ internalCode: string; supplierCode: string | null }> {
  const codes = resolveStockImportItemCodes(materialName, materialCode, layout);
  let internalCode = codes.internalCode;
  let supplierCode = codes.supplierCode ?? codes.designLabel ?? null;
  const displayCode = materialCode || codes.matchByCode || supplierCode || '';

  if (codes.matchByCode) {
    const conflict = await client.query<{ id: string }>(
      `SELECT id FROM fabric_items
       WHERE company_id = $1 AND is_active = true
         AND lower(trim(internal_code)) = lower(trim($2))
         AND lower(trim(name)) <> lower(trim($3))
       LIMIT 1`,
      [companyId, codes.matchByCode, materialName],
    );
    if (conflict.rows.length) {
      internalCode = `${buildAutoInternalCode(materialName)}-${designSuffix(displayCode)}`;
      supplierCode = displayCode;
    } else {
      internalCode = codes.matchByCode;
      supplierCode = codes.matchByCode;
    }
  }

  return { internalCode, supplierCode };
}

async function findItemForExcelIdentity(
  client: PoolClient,
  companyId: string,
  materialName: string,
  internalCode: string,
  supplierCode: string | null,
): Promise<string | null> {
  const byPair = await client.query<{ id: string }>(
    `SELECT id FROM fabric_items
     WHERE company_id = $1 AND is_active = true
       AND lower(trim(name)) = lower(trim($2))
       AND lower(trim(internal_code)) = lower(trim($3))
     LIMIT 1`,
    [companyId, materialName, internalCode],
  );
  if (byPair.rows[0]?.id) return byPair.rows[0].id;

  if (supplierCode) {
    const bySupplier = await client.query<{ id: string }>(
      `SELECT id FROM fabric_items
       WHERE company_id = $1 AND is_active = true
         AND lower(trim(name)) = lower(trim($2))
         AND (
           lower(trim(coalesce(supplier_code, ''))) = lower(trim($3))
           OR lower(trim(internal_code)) = lower(trim($3))
         )
       LIMIT 1`,
      [companyId, materialName, supplierCode],
    );
    if (bySupplier.rows[0]?.id) return bySupplier.rows[0].id;
  }

  return null;
}

async function findOrCreateAleppoItem(
  client: PoolClient,
  companyId: string,
  supplierId: string | null,
  materialName: string,
  materialCode: string,
  layout: StockImportLayout | string,
  dryRun: boolean,
): Promise<{ id: string; internalCode: string; supplierCode: string | null; created: boolean }> {
  // Prefer an existing exact (name + material code) master before applying
  // import heuristics. Codes such as Y-192 can look like color references to
  // the heuristic, but an exact master is the stronger identity signal.
  const exactCode = normalizeBusinessCode(materialCode);
  if (exactCode) {
    const exactExistingId = await findItemForExcelIdentity(
      client,
      companyId,
      materialName,
      exactCode,
      exactCode,
    );
    if (exactExistingId) {
      return { id: exactExistingId, internalCode: exactCode, supplierCode: exactCode, created: false };
    }
  }

  const { internalCode, supplierCode } = await resolveItemIdentity(
    client,
    companyId,
    materialName,
    materialCode,
    layout,
  );

  const existingId = await findItemForExcelIdentity(
    client,
    companyId,
    materialName,
    internalCode,
    supplierCode,
  );
  if (existingId) {
    return { id: existingId, internalCode, supplierCode, created: false };
  }

  if (dryRun) {
    return { id: `dry:${materialName}:${internalCode}`, internalCode, supplierCode, created: true };
  }

  const ins = await client.query<{ id: string }>(
    `INSERT INTO fabric_items
       (company_id, supplier_id, internal_code, supplier_code, name, unit, notes, is_active)
     VALUES ($1,$2,$3,$4,$5,'meter',$6,true)
     RETURNING id`,
    [
      companyId,
      supplierId,
      internalCode,
      supplierCode,
      materialName,
      'إصلاح تطابق اسم/كود خامة — مستودعات حلب',
    ],
  );
  return { id: ins.rows[0].id, internalCode, supplierCode, created: true };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const batchId = readArg('--batch-id') ?? '2baf30aa-dae7-4d48-95f3-9d1778616256';

  const pool = getPool();
  const companyId = await resolveCompanyId(pool);

  const batchQ = await pool.query<{
    id: string;
    file_name: string;
    supplier_id: string | null;
    extracted_metadata: Record<string, unknown> | null;
  }>(
    `SELECT id, file_name, supplier_id, extracted_metadata
     FROM purchase_import_batches WHERE id = $1::uuid AND company_id = $2`,
    [batchId, companyId],
  );
  if (!batchQ.rows.length) throw new Error(`Batch not found: ${batchId}`);
  const batch = batchQ.rows[0];
  const layout =
    (typeof batch.extracted_metadata?.importLayout === 'string'
      ? batch.extracted_metadata.importLayout
      : 'aleppo_incoming_minimal') as StockImportLayout | string;

  const report = {
    dryRun: !apply,
    batchId: batch.id,
    fileName: batch.file_name,
    scanned: 0,
    fixed: 0,
    moved: 0,
    itemsCreated: 0,
    samples: [] as Array<Record<string, string>>,
  };

  const client = await pool.connect();
  try {
    if (apply) await client.query('BEGIN');

    const rows = await client.query<{
      row_no: number;
      created_roll_id: string;
      normalized_data: unknown;
    }>(
      `SELECT row_no, created_roll_id, normalized_data
       FROM purchase_import_rows
       WHERE company_id = $1 AND batch_id = $2 AND created_roll_id IS NOT NULL
       ORDER BY row_no`,
      [companyId, batchId],
    );

    for (const rowRec of rows.rows) {
      report.scanned += 1;
      const fields = extractRowFields(rowRec.normalized_data);
      if (!fields.materialName) continue;

      const rollQ = await client.query<{
        id: string;
        barcode: string | null;
        item_id: string;
        item_name: string;
        internal_code: string;
        supplier_code: string | null;
      }>(
        `SELECT fr.id, fr.barcode, fr.item_id, fi.name AS item_name,
                fi.internal_code, fi.supplier_code
         FROM fabric_rolls fr
         JOIN fabric_items fi ON fi.id = fr.item_id
         WHERE fr.id = $1 AND fr.company_id = $2`,
        [rowRec.created_roll_id, companyId],
      );
      if (!rollQ.rows.length) continue;
      const roll = rollQ.rows[0];

      const target = await findOrCreateAleppoItem(
        client,
        companyId,
        batch.supplier_id,
        fields.materialName,
        fields.materialCode,
        layout,
        !apply,
      );
      if (target.created) report.itemsCreated += 1;

      const aligned = codesAlignWithExcel(
        roll.item_name,
        roll.internal_code,
        roll.supplier_code,
        fields.materialName,
        target.internalCode,
        target.supplierCode,
      );
      const needsMove = roll.item_id !== target.id;
      if (aligned && !needsMove) continue;

      report.fixed += 1;
      if (report.samples.length < 35) {
        report.samples.push({
          row: String(rowRec.row_no),
          barcode: roll.barcode ?? '',
          from: `${roll.item_name} / ${roll.internal_code}`,
          to: `${fields.materialName} / ${target.internalCode}${target.supplierCode ? ` (${target.supplierCode})` : ''}`,
        });
      }

      if (!apply) {
        if (needsMove) report.moved += 1;
        continue;
      }

      if (target.id.startsWith('dry:')) continue;

      await client.query(
        `UPDATE fabric_items SET
           name = $3,
           internal_code = $4,
           supplier_code = COALESCE($5, supplier_code),
           updated_at = now()
         WHERE id = $1 AND company_id = $2`,
        [target.id, companyId, fields.materialName, target.internalCode, target.supplierCode],
      );

      if (needsMove) {
        await client.query(
          `UPDATE fabric_rolls SET item_id = $3, updated_at = now()
           WHERE id = $1 AND company_id = $2`,
          [roll.id, companyId, target.id],
        );
        report.moved += 1;
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
  console.error('[restore-aleppo-batch] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
