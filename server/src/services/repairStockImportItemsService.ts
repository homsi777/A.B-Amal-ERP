import type { Pool, PoolClient } from 'pg';
import { cleanString } from '../utils/importColumnDetector.js';
import { resolveFabricColorForImport } from '../utils/importColorResolver.js';
import { buildAutoInternalCode } from '../utils/importItemCodes.js';
import {
  applyPurchaseImportMaterialCodes,
  ensureFabricCategoryChainFromImport,
} from '../utils/purchaseImportMaterialCodes.js';
import {
  resolveStockImportItemCodes,
  type StockImportLayout,
} from '../utils/stockImportItemCodes.js';

export interface StockImportBatchSummary {
  id: string;
  fileName: string;
  sheetName: string | null;
  sourceType: string;
  status: string;
  rowCount: number;
  createdRolls: number;
  createdAt: string;
  notes: string | null;
}

export interface RepairStockImportItemsOptions {
  companyId: string;
  batchId?: string | null;
  fileNameContains?: string | null;
  dryRun?: boolean;
  fixColors?: boolean;
  purgeOrphanItems?: boolean;
}

export interface RepairStockImportRowResult {
  rowNo: number;
  rollId: string;
  barcode: string | null;
  excelItemName: string;
  excelItemCode: string;
  fromItemId: string;
  fromItemName: string;
  fromItemCode: string;
  toItemId: string;
  toItemName: string;
  toItemCode: string;
  action: 'ok' | 'relocated' | 'skipped';
  note?: string;
}

export interface RepairStockImportItemsReport {
  companyId: string;
  batchIds: string[];
  dryRun: boolean;
  scannedRows: number;
  alreadyOk: number;
  relocated: number;
  skipped: number;
  itemsCreated: number;
  colorsFixed: number;
  categoriesCreated: number;
  orphansPurged: number;
  rows: RepairStockImportRowResult[];
}

function resolveStockImportLayout(
  extracted: Record<string, unknown> | null | undefined,
  sheetName: string | null | undefined,
): StockImportLayout | string {
  const fromMeta = typeof extracted?.importLayout === 'string' ? extracted.importLayout : '';
  if (fromMeta && fromMeta !== 'unknown') return fromMeta;
  const sheet = String(sheetName ?? '').trim().toLowerCase();
  if (sheet.includes('وارد') || sheet === 'incoming') return 'aleppo_incoming_minimal';
  return fromMeta || 'unknown';
}

function parseImportRowPayload(payload: unknown): {
  itemName: string;
  itemCode: string;
  colorName: string;
  colorNameTr: string;
  colorCode: string;
  unit: string;
} {
  if (!payload || typeof payload !== 'object') {
    return { itemName: '', itemCode: '', colorName: '', colorNameTr: '', colorCode: '', unit: '' };
  }
  const row = payload as Record<string, unknown>;
  return {
    itemName: String(row.itemName ?? '').trim(),
    itemCode: String(row.itemCode ?? '').trim(),
    colorName: String(row.colorName ?? '').trim(),
    colorNameTr: String(row.colorNameTr ?? '').trim(),
    colorCode: String(row.colorCode ?? '').trim(),
    unit: String(row.unit ?? '').trim(),
  };
}

async function ensureCorrectItem(
  client: PoolClient,
  companyId: string,
  supplierId: string | null,
  materialName: string,
  rawItemCode: string,
  importLayout: string,
  dryRun: boolean,
): Promise<{ id: string; name: string; internalCode: string; created: boolean }> {
  const codes = resolveStockImportItemCodes(materialName, rawItemCode, importLayout);

  if (codes.matchByCode) {
    const byCode = await client.query<{ id: string; name: string; internal_code: string }>(
      `SELECT id, name, internal_code
       FROM fabric_items
       WHERE company_id = $1
         AND (
           lower(btrim(internal_code)) = lower(btrim($2))
           OR lower(btrim(coalesce(supplier_code, ''))) = lower(btrim($2))
         )
       LIMIT 1`,
      [companyId, codes.matchByCode],
    );
    if (byCode.rows[0]?.id) {
      return {
        id: byCode.rows[0].id,
        name: byCode.rows[0].name,
        internalCode: byCode.rows[0].internal_code,
        created: false,
      };
    }
  } else {
    const byName = await client.query<{ id: string; name: string; internal_code: string }>(
      `SELECT id, name, internal_code
       FROM fabric_items
       WHERE company_id = $1 AND lower(btrim(name)) = lower(btrim($2))
       ORDER BY created_at
       LIMIT 1`,
      [companyId, materialName],
    );
    if (byName.rows[0]?.id) {
      return {
        id: byName.rows[0].id,
        name: byName.rows[0].name,
        internalCode: byName.rows[0].internal_code,
        created: false,
      };
    }
  }

  if (dryRun) {
    return {
      id: `dry-run-${materialName}-${codes.internalCode}`,
      name: materialName,
      internalCode: codes.internalCode,
      created: true,
    };
  }

  const inserted = await client.query<{ id: string; name: string; internal_code: string }>(
    `INSERT INTO fabric_items
       (company_id, supplier_id, internal_code, supplier_code, name, unit, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, name, internal_code`,
    [
      companyId,
      supplierId,
      codes.internalCode,
      codes.supplierCode,
      materialName,
      'meter',
      'تم إنشاؤه تلقائياً عبر إصلاح استيراد وارد Excel',
    ],
  );
  return {
    id: inserted.rows[0].id,
    name: inserted.rows[0].name,
    internalCode: inserted.rows[0].internal_code,
    created: true,
  };
}

export async function listStockImportBatches(
  pool: Pool,
  companyId: string,
  fileNameContains?: string | null,
): Promise<StockImportBatchSummary[]> {
  const filter = cleanString(fileNameContains);
  const result = await pool.query<{
    id: string;
    file_name: string;
    sheet_name: string | null;
    source_type: string;
    status: string;
    row_count: number;
    created_roll_count: number;
    created_at: string;
    notes: string | null;
  }>(
    `SELECT id, file_name, sheet_name, source_type, status, row_count,
            created_roll_count, created_at::text, notes
     FROM purchase_import_batches
     WHERE company_id = $1
       AND source_type IN ('OPENING_STOCK', 'DIRECT_STOCK_IMPORT', 'STOCK_IMPORT')
       AND ($2::text IS NULL OR file_name ILIKE '%' || $2 || '%' OR coalesce(notes, '') ILIKE '%' || $2 || '%')
     ORDER BY created_at DESC
     LIMIT 50`,
    [companyId, filter || null],
  );
  return result.rows.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    sheetName: row.sheet_name,
    sourceType: row.source_type,
    status: row.status,
    rowCount: row.row_count,
    createdRolls: row.created_roll_count,
    createdAt: row.created_at,
    notes: row.notes,
  }));
}

async function resolveBatchIds(
  pool: Pool,
  companyId: string,
  batchId: string | null | undefined,
  fileNameContains: string | null | undefined,
): Promise<string[]> {
  if (batchId) return [batchId];
  const batches = await listStockImportBatches(pool, companyId, fileNameContains);
  return batches.map((b) => b.id);
}

export async function repairStockImportItems(
  pool: Pool,
  options: RepairStockImportItemsOptions,
): Promise<RepairStockImportItemsReport> {
  const dryRun = options.dryRun !== false;
  const batchIds = await resolveBatchIds(pool, options.companyId, options.batchId, options.fileNameContains);
  const report: RepairStockImportItemsReport = {
    companyId: options.companyId,
    batchIds,
    dryRun,
    scannedRows: 0,
    alreadyOk: 0,
    relocated: 0,
    skipped: 0,
    itemsCreated: 0,
    colorsFixed: 0,
    categoriesCreated: 0,
    orphansPurged: 0,
    rows: [],
  };

  if (!batchIds.length) return report;

  const client = await pool.connect();
  try {
    if (!dryRun) await client.query('BEGIN');

    for (const batchId of batchIds) {
      const batch = await client.query<{
        supplier_id: string | null;
        sheet_name: string | null;
        extracted_metadata: Record<string, unknown> | null;
      }>(
        `SELECT supplier_id, sheet_name, extracted_metadata
         FROM purchase_import_batches
         WHERE id = $1 AND company_id = $2`,
        [batchId, options.companyId],
      );
      if (!batch.rows.length) continue;

      const importLayout = resolveStockImportLayout(
        batch.rows[0].extracted_metadata,
        batch.rows[0].sheet_name,
      );
      const supplierId = batch.rows[0].supplier_id;

      const rows = await client.query<{
        id: string;
        row_no: number;
        created_roll_id: string | null;
        normalized_data: unknown;
        raw_data: unknown;
        status: string;
      }>(
        `SELECT id, row_no, created_roll_id, normalized_data, raw_data, status
         FROM purchase_import_rows
         WHERE company_id = $1 AND batch_id = $2 AND created_roll_id IS NOT NULL
         ORDER BY row_no`,
        [options.companyId, batchId],
      );

      for (const rowRec of rows.rows) {
        report.scannedRows += 1;
        const payload = parseImportRowPayload(rowRec.normalized_data ?? rowRec.raw_data);
        if (!payload.itemName) {
          report.skipped += 1;
          report.rows.push({
            rowNo: rowRec.row_no,
            rollId: rowRec.created_roll_id ?? '',
            barcode: null,
            excelItemName: '',
            excelItemCode: payload.itemCode,
            fromItemId: '',
            fromItemName: '',
            fromItemCode: '',
            toItemId: '',
            toItemName: '',
            toItemCode: '',
            action: 'skipped',
            note: 'لا يوجد اسم صنف في بيانات الصف',
          });
          continue;
        }

        const rollQ = await client.query<{
          id: string;
          barcode: string | null;
          item_id: string;
          color_id: string | null;
          status: string;
          item_name: string;
          internal_code: string;
        }>(
          `SELECT fr.id, fr.barcode, fr.item_id, fr.color_id, fr.status,
                  fi.name AS item_name, fi.internal_code
           FROM fabric_rolls fr
           JOIN fabric_items fi ON fi.id = fr.item_id
           WHERE fr.id = $1 AND fr.company_id = $2`,
          [rowRec.created_roll_id, options.companyId],
        );
        if (!rollQ.rows.length) {
          report.skipped += 1;
          continue;
        }
        const roll = rollQ.rows[0];

        const target = await ensureCorrectItem(
          client,
          options.companyId,
          supplierId,
          payload.itemName,
          payload.itemCode,
          importLayout,
          dryRun,
        );
        if (target.created) report.itemsCreated += 1;

        const importNd = {
          materialName: payload.itemName,
          internalMaterialCode: resolveStockImportItemCodes(payload.itemName, payload.itemCode, importLayout).internalCode,
          supplierMaterialCode: resolveStockImportItemCodes(payload.itemName, payload.itemCode, importLayout).supplierCode,
          colorName: payload.colorName || (options.fixColors ? 'غير محدد' : ''),
          colorNameTr: payload.colorNameTr,
          colorCode: payload.colorCode,
        };

        if (!dryRun && !target.id.startsWith('dry-run')) {
          await applyPurchaseImportMaterialCodes(client, options.companyId, target.id, importNd);
          const cat = await ensureFabricCategoryChainFromImport(client, options.companyId, importNd);
          report.categoriesCreated += cat;

          if (options.fixColors) {
            let colorName = payload.colorName;
            if (!colorName && !payload.colorNameTr && !payload.colorCode) colorName = 'غير محدد';
            const color = await resolveFabricColorForImport(
              client,
              options.companyId,
              {
                colorName,
                colorNameTr: payload.colorNameTr,
                colorCode: payload.colorCode,
              },
              { createIfMissing: true, rowNo: rowRec.row_no },
            );
            if (color.id && color.id !== roll.color_id) {
              await client.query(
                `UPDATE fabric_rolls SET color_id = $3, updated_at = now()
                 WHERE id = $1 AND company_id = $2`,
                [roll.id, options.companyId, color.id],
              );
              report.colorsFixed += 1;
            }
          }
        }

        const needsRelocate = roll.item_id !== target.id;
        if (needsRelocate && !dryRun && !target.id.startsWith('dry-run')) {
          await client.query(
            `UPDATE fabric_rolls SET item_id = $3, updated_at = now()
             WHERE id = $1 AND company_id = $2`,
            [roll.id, options.companyId, target.id],
          );
          await client.query(
            `UPDATE purchase_import_rows
             SET matched_item_id = $3, updated_at = now()
             WHERE id = $1 AND company_id = $2`,
            [rowRec.id, options.companyId, target.id],
          );
          report.relocated += 1;
        } else if (!needsRelocate) {
          report.alreadyOk += 1;
        }

        report.rows.push({
          rowNo: rowRec.row_no,
          rollId: roll.id,
          barcode: roll.barcode,
          excelItemName: payload.itemName,
          excelItemCode: payload.itemCode,
          fromItemId: roll.item_id,
          fromItemName: roll.item_name,
          fromItemCode: roll.internal_code,
          toItemId: target.id,
          toItemName: target.name,
          toItemCode: target.internalCode,
          action: needsRelocate ? 'relocated' : 'ok',
        });
      }
    }

    if (options.purgeOrphanItems && !dryRun) {
      const orphans = await client.query<{ id: string; name: string; internal_code: string }>(
        `SELECT fi.id, fi.name, fi.internal_code
         FROM fabric_items fi
         WHERE fi.company_id = $1
           AND NOT EXISTS (SELECT 1 FROM fabric_rolls fr WHERE fr.item_id = fi.id)
           AND (
             fi.notes ILIKE '%استيراد%Excel%'
             OR fi.notes ILIKE '%إصلاح استيراد%'
           )
           AND fi.created_at >= now() - interval '180 days'`,
        [options.companyId],
      );
      for (const orphan of orphans.rows) {
        await client.query(`DELETE FROM fabric_items WHERE id = $1 AND company_id = $2`, [
          orphan.id,
          options.companyId,
        ]);
        report.orphansPurged += 1;
      }
    }

    if (!dryRun) await client.query('COMMIT');
  } catch (error) {
    if (!dryRun) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  return report;
}

export interface RollbackStockImportBatchOptions {
  companyId: string;
  batchId: string;
  dryRun?: boolean;
}

export interface RollbackStockImportBatchReport {
  batchId: string;
  dryRun: boolean;
  rollsDeleted: number;
  rollsSkippedSold: number;
}

/** يحذف أثواب دفعة استيراد المتاحة فقط (AVAILABLE) لإعادة الاستيراد من الصفر. */
export async function rollbackStockImportBatch(
  pool: Pool,
  options: RollbackStockImportBatchOptions,
): Promise<RollbackStockImportBatchReport> {
  const dryRun = options.dryRun !== false;
  const report: RollbackStockImportBatchReport = {
    batchId: options.batchId,
    dryRun,
    rollsDeleted: 0,
    rollsSkippedSold: 0,
  };

  const client = await pool.connect();
  try {
    if (!dryRun) await client.query('BEGIN');

    const rolls = await client.query<{ id: string; status: string }>(
      `SELECT id, status
       FROM fabric_rolls
       WHERE company_id = $1 AND import_batch_id = $2`,
      [options.companyId, options.batchId],
    );

    for (const roll of rolls.rows) {
      if (roll.status !== 'AVAILABLE') {
        report.rollsSkippedSold += 1;
        continue;
      }
      if (!dryRun) {
        await client.query(
          `UPDATE purchase_import_rows
           SET status = 'PENDING',
               created_roll_id = NULL,
               matched_item_id = NULL,
               matched_color_id = NULL,
               updated_at = now()
           WHERE company_id = $1 AND created_roll_id = $2`,
          [options.companyId, roll.id],
        );
        await client.query(`DELETE FROM fabric_rolls WHERE id = $1 AND company_id = $2`, [
          roll.id,
          options.companyId,
        ]);
      }
      report.rollsDeleted += 1;
    }

    if (!dryRun) {
      await client.query(
        `UPDATE purchase_import_batches
         SET status = 'CANCELLED',
             updated_at = now()
         WHERE id = $1 AND company_id = $2`,
        [options.batchId, options.companyId],
      );
    }

    if (!dryRun) await client.query('COMMIT');
  } catch (error) {
    if (!dryRun) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  return report;
}
