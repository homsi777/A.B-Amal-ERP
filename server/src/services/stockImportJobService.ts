import type { FastifyBaseLogger } from 'fastify';
import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { resolveFabricColorForImport } from '../utils/importColorResolver.js';
import { cleanString } from '../utils/importColumnDetector.js';
import {
  applyPurchaseImportMaterialCodes,
  ensureFabricCategoryChainFromImport,
} from '../utils/purchaseImportMaterialCodes.js';
import { buildAutoInternalCode } from '../utils/importItemCodes.js';
import { calcWeight, generateBarcode } from '../utils/rollHelpers.js';

export type StockImportSourceType =
  | 'OPENING_STOCK'
  | 'DIRECT_STOCK_IMPORT'
  | 'PURCHASE_INVOICE'
  | 'STOCK_IMPORT';

export interface StockImportJobRow {
  itemName: string;
  itemCode?: string;
  barcode?: string;
  colorName?: string;
  colorNameTr?: string;
  colorCode?: string;
  unit?: string;
  quantity: number;
  price?: number;
  costPrice?: number;
  widthCm?: number;
  gsm?: number;
  actualWeightKg?: number;
  date?: string;
  purchaseInvoiceNo?: string;
}

export interface StartStockImportBatchParams {
  companyId: string;
  userId: string;
  warehouseId?: string;
  supplierId?: string | null;
  sourceType: StockImportSourceType;
  fileName?: string;
  sheetName?: string;
  detectedColumns?: Array<Record<string, unknown>>;
  extractedMetadata?: Record<string, unknown>;
  sourceLabel?: string;
  rows: StockImportJobRow[];
}

export interface StockImportBatchStatus {
  batchId: string;
  status: string;
  warehouseId: string;
  warehouseName: string;
  supplierId: string | null;
  supplierName: string | null;
  sourceType: string;
  batchTag: string;
  totalRows: number;
  createdRolls: number;
  createdItems: number;
  createdColors: number;
  createdCategories: number;
  skippedRows: number;
  clampedValues: number;
  errorCount: number;
  errors: Array<{ rowIndex: number; reason: string }>;
  elapsedMs: number;
  startedAt: string | null;
  confirmedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
}

const MAX_LEN_M = 999_999.999;
const MAX_WIDTH_CM = 9_999.99;
const MAX_GSM = 9_999.99;
const MAX_WEIGHT_KG = 999_999.999;
const PROCESS_CHUNK_SIZE = 10;

const norm = (s: string) => String(s || '').trim().toLowerCase();

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value > max ? max : value;
}

type SqlParam = string | number | boolean | null;
function buildBulkValues(rows: SqlParam[][], startParamIndex = 1): { sql: string; params: SqlParam[] } {
  if (rows.length === 0) return { sql: '', params: [] };
  const cols = rows[0].length;
  const placeholders: string[] = [];
  const params: SqlParam[] = [];
  let p = startParamIndex;
  for (const row of rows) {
    const slot = Array.from({ length: cols }, () => `$${p++}`).join(',');
    placeholders.push(`(${slot})`);
    for (const v of row) params.push(v);
  }
  return { sql: placeholders.join(','), params };
}

function buildBatchTag(sourceLabel?: string): string {
  const fallback = `IMPORT-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
  return (sourceLabel?.trim() || fallback).slice(0, 60);
}

async function resolveWarehouse(
  client: PoolClient,
  companyId: string,
  requestedWarehouseId?: string,
): Promise<{ warehouseId: string; warehouseName: string }> {
  if (!requestedWarehouseId) {
    const wh = await client.query<{ id: string; name: string }>(
      `SELECT id, name
       FROM warehouses
       WHERE company_id = $1
       ORDER BY CASE WHEN code = 'MAIN' THEN 0 ELSE 1 END, created_at
       LIMIT 1`,
      [companyId],
    );
    if (!wh.rows.length) throw new Error('لا يوجد مستودع متاح لربط الاستيراد');
    return { warehouseId: wh.rows[0].id, warehouseName: wh.rows[0].name };
  }

  const wh = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM warehouses WHERE id = $1 AND company_id = $2`,
    [requestedWarehouseId, companyId],
  );
  if (!wh.rows.length) throw new Error('المستودع المحدد غير موجود');
  return { warehouseId: wh.rows[0].id, warehouseName: wh.rows[0].name };
}

async function resolveSupplier(
  client: PoolClient,
  companyId: string,
  requestedSupplierId?: string | null,
): Promise<{ supplierId: string | null; supplierName: string | null }> {
  if (!requestedSupplierId) return { supplierId: null, supplierName: null };
  const supplier = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM suppliers
     WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [requestedSupplierId, companyId],
  );
  if (!supplier.rows.length) throw new Error('المورد المحدد غير موجود أو غير فعال');
  return { supplierId: supplier.rows[0].id, supplierName: supplier.rows[0].name };
}

export async function startStockImportBatch(params: StartStockImportBatchParams): Promise<{
  batchId: string;
  batchTag: string;
  warehouseId: string;
  warehouseName: string;
  supplierId: string | null;
  supplierName: string | null;
}> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    await client.query(`SET LOCAL statement_timeout = '60s'`);

    const { warehouseId, warehouseName } = await resolveWarehouse(client, params.companyId, params.warehouseId);
    const { supplierId, supplierName } = await resolveSupplier(client, params.companyId, params.supplierId);
    const batchTag = buildBatchTag(params.sourceLabel);
    const extractedMetadata = {
      ...(params.extractedMetadata ?? {}),
      batchTag,
      importStrategy: 'BACKGROUND_STAGED',
    };

    const batchResult = await client.query<{ id: string }>(
      `INSERT INTO purchase_import_batches
         (company_id, supplier_id, warehouse_id, source_type,
          file_name, sheet_name, status, row_count, valid_count, warning_count, error_count,
          total_length_m, total_actual_weight_kg, total_calculated_weight_kg,
          currency_code, import_mode, notes, extracted_metadata, detected_columns,
          started_at, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,'VALIDATED',$7,$7,0,0,0,0,0,'USD','CREATE_MISSING_MASTER_DATA',$8,$9,$10,now(),$11)
       RETURNING id`,
      [
        params.companyId,
        supplierId,
        warehouseId,
        params.sourceType,
        params.fileName?.trim() || 'Excel import',
        params.sheetName?.trim() || null,
        params.rows.length,
        params.sourceLabel?.trim() || null,
        JSON.stringify(extractedMetadata),
        JSON.stringify(params.detectedColumns ?? []),
        params.userId,
      ],
    );

    const batchId = batchResult.rows[0].id;
    if (params.rows.length > 0) {
      const rowValues: SqlParam[][] = params.rows.map((row, index) => [
        params.companyId,
        batchId,
        index + 1,
        JSON.stringify(row),
        JSON.stringify(row),
        'PENDING',
        JSON.stringify([]),
        JSON.stringify([]),
      ]);
      const ROW_CHUNK = 500;
      for (let offset = 0; offset < rowValues.length; offset += ROW_CHUNK) {
        const slice = rowValues.slice(offset, offset + ROW_CHUNK);
        const { sql, params: sqlParams } = buildBulkValues(slice);
        await client.query(
          `INSERT INTO purchase_import_rows
             (company_id, batch_id, row_no, raw_data, normalized_data, status, errors, warnings)
           VALUES ${sql}`,
          sqlParams,
        );
      }
    }

    await client.query('COMMIT');
    return { batchId, batchTag, warehouseId, warehouseName, supplierId, supplierName };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function queueStockImportBatchJob(
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>,
  params: StartStockImportBatchParams & {
    batchId: string;
    batchTag: string;
    warehouseId: string;
    warehouseName: string;
    supplierId: string | null;
    supplierName: string | null;
  },
): void {
  logger.info({ batchId: params.batchId }, 'stock-import batch queued for polling-driven processing');
}

function errorReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'فشل غير محدد');
}

function parseRowPayload(payload: unknown): StockImportJobRow {
  if (!payload || typeof payload !== 'object') return { itemName: '', quantity: 0 };
  const row = payload as Record<string, unknown>;
  return {
    itemName: String(row.itemName ?? '').trim(),
    itemCode: String(row.itemCode ?? '').trim(),
    barcode: String(row.barcode ?? '').trim(),
    colorName: String(row.colorName ?? '').trim(),
    colorNameTr: String(row.colorNameTr ?? '').trim(),
    colorCode: String(row.colorCode ?? '').trim(),
    unit: String(row.unit ?? '').trim(),
    quantity: Number(row.quantity ?? 0) || 0,
    price: Number(row.price ?? 0) || 0,
    costPrice: Number(row.costPrice ?? 0) || 0,
    widthCm: Number(row.widthCm ?? 0) || 0,
    gsm: Number(row.gsm ?? 0) || 0,
    actualWeightKg: Number(row.actualWeightKg ?? 0) || 0,
    date: String(row.date ?? '').trim(),
    purchaseInvoiceNo: String(row.purchaseInvoiceNo ?? '').trim(),
  };
}

interface PreparedRow {
  materialName: string;
  materialCode: string;
  colorName: string;
  colorNameTr: string;
  colorCode: string;
  unit: string;
  lengthM: number;
  unitCost: number | null;
  widthCm: number | null;
  gsm: number | null;
  actualWeightKg: number | null;
  calculatedWeightKg: number | null;
  date: string;
  purchaseInvoiceNo: string;
  wasClamped: boolean;
}

function prepareRow(row: StockImportJobRow, rowNo: number): PreparedRow {
  const materialName = String(row.itemName || '').trim();
  if (!materialName) throw new Error(`الصف ${rowNo}: اسم الخامة مطلوب`);

  const safeLengthM = clamp(Number(row.quantity) || 0, MAX_LEN_M);
  if (safeLengthM <= 0) throw new Error(`الصف ${rowNo}: الطول يجب أن يكون أكبر من صفر`);

  const safeUnitCost = clamp(Number(row.costPrice ?? row.price ?? 0), MAX_LEN_M);
  const safeWidthCm = clamp(Number(row.widthCm ?? 0), MAX_WIDTH_CM);
  const safeGsm = clamp(Number(row.gsm ?? 0), MAX_GSM);
  const safeActualWeightKg = clamp(Number(row.actualWeightKg ?? 0), MAX_WEIGHT_KG);
  const safeCalculatedWeightKg = clamp(calcWeight(safeLengthM, safeWidthCm, safeGsm) ?? 0, MAX_WEIGHT_KG);

  const colorName = String(row.colorName || '').trim();
  const colorNameTr = String(row.colorNameTr || '').trim();

  return {
    materialName,
    materialCode: String(row.itemCode || '').trim(),
    colorName,
    colorNameTr,
    colorCode: String(row.colorCode || '').trim(),
    unit: String(row.unit || '').trim(),
    lengthM: safeLengthM,
    unitCost: safeUnitCost > 0 ? safeUnitCost : null,
    widthCm: safeWidthCm > 0 ? safeWidthCm : null,
    gsm: safeGsm > 0 ? safeGsm : null,
    actualWeightKg: safeActualWeightKg > 0 ? safeActualWeightKg : null,
    calculatedWeightKg: safeCalculatedWeightKg > 0 ? safeCalculatedWeightKg : null,
    date: String(row.date || '').trim(),
    purchaseInvoiceNo: String(row.purchaseInvoiceNo || '').trim(),
    wasClamped:
      safeLengthM !== (Number(row.quantity) || 0)
      || safeUnitCost !== (Number(row.costPrice ?? row.price ?? 0) || 0)
      || safeWidthCm !== (Number(row.widthCm ?? 0) || 0)
      || safeGsm !== (Number(row.gsm ?? 0) || 0)
      || safeActualWeightKg !== (Number(row.actualWeightKg ?? 0) || 0),
  };
}

async function ensureItem(
  client: PoolClient,
  companyId: string,
  supplierId: string | null,
  prepared: PreparedRow,
  _rowNo: number,
): Promise<{ id: string; created: boolean }> {
  const matCode = prepared.materialCode;

  if (matCode) {
    const existingByCode = await client.query<{ id: string }>(
      `SELECT id FROM fabric_items
       WHERE company_id = $1
         AND (
           lower(btrim(internal_code)) = lower(btrim($2))
           OR lower(btrim(coalesce(supplier_code, ''))) = lower(btrim($2))
         )
       LIMIT 1`,
      [companyId, matCode],
    );
    if (existingByCode.rows[0]?.id) return { id: existingByCode.rows[0].id, created: false };
  }

  const existingByName = await client.query<{ id: string }>(
    `SELECT id FROM fabric_items
     WHERE company_id = $1 AND lower(btrim(name)) = lower(btrim($2))
     ORDER BY created_at
     LIMIT 1`,
    [companyId, prepared.materialName],
  );
  if (existingByName.rows[0]?.id) return { id: existingByName.rows[0].id, created: false };

  const internalCode = matCode || buildAutoInternalCode(prepared.materialName);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO fabric_items
       (company_id, supplier_id, internal_code, supplier_code, name, unit, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      companyId,
      supplierId,
      internalCode,
      matCode || null,
      prepared.materialName,
      prepared.unit || 'meter',
      'تم إنشاؤه تلقائياً عبر استيراد وارد Excel',
    ],
  );
  return { id: inserted.rows[0].id, created: true };
}

async function finalizeBatchIfDone(client: PoolClient, companyId: string, batchId: string): Promise<void> {
  const pending = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM purchase_import_rows
     WHERE company_id = $1 AND batch_id = $2 AND status = 'PENDING'`,
    [companyId, batchId],
  );
  if (Number(pending.rows[0]?.n ?? '0') > 0) return;

  const counts = await client.query<{
    imported_count: number;
    failed_count: number;
  }>(
    `SELECT imported_count, failed_count
     FROM purchase_import_batches
     WHERE company_id = $1 AND id = $2`,
    [companyId, batchId],
  );
  const row = counts.rows[0];
  await client.query(
    `UPDATE purchase_import_batches
     SET status = $3,
         confirmed_at = COALESCE(confirmed_at, now()),
         updated_at = now()
     WHERE company_id = $1 AND id = $2`,
    [companyId, batchId, Number(row?.failed_count ?? 0) > 0 ? 'PARTIALLY_CONFIRMED' : 'CONFIRMED'],
  );
}

export async function advanceStockImportBatch(
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>,
  companyId: string,
  batchId: string,
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    await client.query(`SET LOCAL statement_timeout = '10s'`);

    const batchResult = await client.query<{
      id: string;
      warehouse_id: string;
      supplier_id: string | null;
      source_type: string;
      notes: string | null;
      extracted_metadata: Record<string, unknown> | null;
      created_by_user_id: string;
      status: string;
    }>(
      `SELECT id, warehouse_id, supplier_id, source_type, notes, extracted_metadata, created_by_user_id, status
       FROM purchase_import_batches
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [batchId, companyId],
    );
    if (!batchResult.rows.length) {
      await client.query('ROLLBACK');
      return;
    }
    const batch = batchResult.rows[0];
    if (['CONFIRMED', 'PARTIALLY_CONFIRMED', 'FAILED', 'CANCELLED'].includes(batch.status)) {
      await client.query('COMMIT');
      return;
    }

    await client.query(
      `UPDATE purchase_import_batches
       SET status = 'CONFIRMING',
           started_at = COALESCE(started_at, now()),
           error_message = NULL,
           updated_at = now()
       WHERE id = $1 AND company_id = $2`,
      [batchId, companyId],
    );

    const rowsResult = await client.query<{
      id: string;
      row_no: number;
      normalized_data: Record<string, unknown> | null;
      raw_data: Record<string, unknown> | null;
    }>(
      `SELECT id, row_no, normalized_data, raw_data
       FROM purchase_import_rows
       WHERE company_id = $1 AND batch_id = $2 AND status = 'PENDING'
       ORDER BY row_no
       LIMIT $3
       FOR UPDATE SKIP LOCKED`,
      [companyId, batchId, PROCESS_CHUNK_SIZE],
    );

    if (!rowsResult.rows.length) {
      await finalizeBatchIfDone(client, companyId, batchId);
      await client.query('COMMIT');
      return;
    }

    const extracted = batch.extracted_metadata ?? {};
    const batchTag = typeof extracted.batchTag === 'string' ? extracted.batchTag : buildBatchTag(batch.notes ?? '');
    let createdRolls = 0;
    let createdItems = 0;
    let createdColors = 0;
    let createdCategories = 0;
    let skippedRows = 0;
    let clampedValues = 0;
    let errorCount = 0;
    let totalLength = 0;
    let totalWeight = 0;

    for (const rowRec of rowsResult.rows) {
      try {
        const original = parseRowPayload(rowRec.normalized_data ?? rowRec.raw_data);
        const prepared = prepareRow(original, rowRec.row_no);
        if (prepared.wasClamped) clampedValues += 1;

        const item = await ensureItem(client, companyId, batch.supplier_id ?? null, prepared, rowRec.row_no);
        if (item.created) createdItems += 1;

        const importNd = {
          materialName: prepared.materialName,
          supplierMaterialCode: prepared.materialCode,
          colorName: prepared.colorName,
          colorNameTr: prepared.colorNameTr,
          colorCode: prepared.colorCode,
        };
        await applyPurchaseImportMaterialCodes(client, companyId, item.id, importNd);
        createdCategories += await ensureFabricCategoryChainFromImport(client, companyId, importNd);

        const color = await resolveFabricColorForImport(
          client,
          companyId,
          {
            colorName: prepared.colorName,
            colorNameTr: prepared.colorNameTr,
            colorCode: prepared.colorCode,
          },
          { createIfMissing: true, rowNo: rowRec.row_no },
        );
        if (color.created) createdColors += 1;

        let barcode = cleanString(original.barcode);
        if (barcode) {
          const dup = await client.query<{ id: string }>(
            `SELECT id FROM fabric_rolls WHERE company_id=$1 AND barcode=$2 LIMIT 1`,
            [companyId, barcode],
          );
          if (dup.rows.length) barcode = '';
        }
        if (!barcode) barcode = await generateBarcode(client, companyId);
        const notes = [
          `استيراد Excel — صف #${rowRec.row_no}`,
          prepared.date ? `التاريخ: ${prepared.date}` : '',
          prepared.purchaseInvoiceNo ? `المرجع: ${prepared.purchaseInvoiceNo}` : '',
          batchTag ? `الدفعة: ${batchTag}` : '',
        ].filter(Boolean).join(' · ');

        const roll = await client.query<{ id: string }>(
          `INSERT INTO fabric_rolls
             (company_id, barcode, item_id, color_id, supplier_id, warehouse_id,
              length_m, width_cm, gsm, calculated_weight_kg, actual_weight_kg,
              unit_cost, batch_no, purchase_invoice_no, import_batch_id, notes,
              created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           RETURNING id`,
          [
            companyId,
            barcode,
            item.id,
            color.id,
            batch.supplier_id ?? null,
            batch.warehouse_id,
            prepared.lengthM,
            prepared.widthCm,
            prepared.gsm,
            prepared.calculatedWeightKg,
            prepared.actualWeightKg,
            prepared.unitCost,
            batchTag,
            prepared.purchaseInvoiceNo || null,
            batchId,
            notes || null,
            batch.created_by_user_id,
          ],
        );

        const movement = await client.query<{ id: string }>(
          `INSERT INTO inventory_movements
             (company_id, roll_id, movement_type, to_warehouse_id, new_status,
              notes, reference_type, reference_no, length_delta_m, weight_delta_kg, created_by_user_id)
           VALUES ($1,$2,'OPENING',$3,'AVAILABLE',$4,'STOCK_IMPORT',$5,$6,$7,$8)
           RETURNING id`,
          [
            companyId,
            roll.rows[0].id,
            batch.warehouse_id,
            `استيراد وارد Excel — ${batchTag}`,
            batchTag,
            prepared.lengthM,
            prepared.actualWeightKg ?? prepared.calculatedWeightKg,
            batch.created_by_user_id,
          ],
        );

        await client.query(
          `UPDATE purchase_import_rows
           SET status = 'IMPORTED',
               normalized_data = $3::jsonb,
               created_roll_id = $4,
               created_inventory_movement_id = $5,
               updated_at = now()
           WHERE id = $1 AND company_id = $2`,
          [
            rowRec.id,
            companyId,
            JSON.stringify({
              materialName: prepared.materialName,
              materialCode: prepared.materialCode,
              colorName: prepared.colorName,
              colorCode: prepared.colorCode,
              lengthM: prepared.lengthM,
            }),
            roll.rows[0].id,
            movement.rows[0].id,
          ],
        );

        createdRolls += 1;
        totalLength += prepared.lengthM;
        totalWeight += prepared.actualWeightKg ?? prepared.calculatedWeightKg ?? 0;
      } catch (error) {
        errorCount += 1;
        await client.query(
          `UPDATE purchase_import_rows
           SET status = 'ERROR',
               errors = $3::jsonb,
               updated_at = now()
           WHERE id = $1 AND company_id = $2`,
          [rowRec.id, companyId, JSON.stringify([errorReason(error)])],
        );
      }
    }

    await client.query(
      `UPDATE purchase_import_batches
       SET imported_count = imported_count + $3,
           failed_count = failed_count + $4,
           created_roll_count = created_roll_count + $3,
           created_item_count = created_item_count + $5,
           created_color_count = created_color_count + $6,
           total_length_m = COALESCE(total_length_m, 0) + $7,
           total_actual_weight_kg = COALESCE(total_actual_weight_kg, 0) + $8,
           extracted_metadata = COALESCE(extracted_metadata, '{}'::jsonb) || jsonb_build_object(
             'createdCategories',
             COALESCE((extracted_metadata->>'createdCategories')::int, 0) + $9
           ),
           updated_at = now()
       WHERE id = $1 AND company_id = $2`,
      [batchId, companyId, createdRolls, errorCount, createdItems, createdColors, totalLength, totalWeight, createdCategories],
    );

    await finalizeBatchIfDone(client, companyId, batchId);
    await client.query('COMMIT');
    logger.info({ batchId, processedRows: rowsResult.rows.length, createdRolls, errorCount, skippedRows, clampedValues }, 'stock-import chunk processed');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const message = errorReason(error);
    logger.error({ err: error, batchId }, 'stock-import chunk failed');
    await client.query(
      `UPDATE purchase_import_batches
       SET status = 'FAILED',
           failed_at = now(),
           error_message = $3,
           updated_at = now()
       WHERE id = $1 AND company_id = $2`,
      [batchId, companyId, message],
    ).catch(() => undefined);
  } finally {
    client.release();
  }
}

export async function getStockImportBatchStatus(
  companyId: string,
  batchId: string,
): Promise<StockImportBatchStatus | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const batch = await client.query<{
      id: string;
      status: string;
      warehouse_id: string | null;
      warehouse_name: string | null;
      supplier_id: string | null;
      supplier_name: string | null;
      source_type: string;
      row_count: number;
      created_roll_count: number;
      created_item_count: number;
      created_color_count: number;
      notes: string | null;
      extracted_metadata: Record<string, unknown> | null;
      imported_count: number;
      failed_count: number;
      started_at: string | null;
      confirmed_at: string | null;
      failed_at: string | null;
      error_message: string | null;
    }>(
      `SELECT b.id,
              b.status,
              b.warehouse_id,
              w.name AS warehouse_name,
              b.supplier_id,
              s.name AS supplier_name,
              b.source_type,
              b.row_count,
              b.created_roll_count,
              b.created_item_count,
              b.created_color_count,
              b.notes,
              b.extracted_metadata,
              b.imported_count,
              b.failed_count,
              b.started_at,
              b.confirmed_at,
              b.failed_at,
              b.error_message
       FROM purchase_import_batches b
       LEFT JOIN warehouses w ON w.id = b.warehouse_id
       LEFT JOIN suppliers s ON s.id = b.supplier_id
       WHERE b.id = $1 AND b.company_id = $2`,
      [batchId, companyId],
    );
    if (!batch.rows.length) return null;

    const errors = await client.query<{ row_no: number; errors: string[] }>(
      `SELECT row_no, errors
       FROM purchase_import_rows
       WHERE batch_id = $1 AND company_id = $2 AND status = 'ERROR'
       ORDER BY row_no
       LIMIT 50`,
      [batchId, companyId],
    );

    const row = batch.rows[0];
    const extracted = row.extracted_metadata ?? {};
    const batchTag = typeof extracted.batchTag === 'string'
      ? extracted.batchTag
      : buildBatchTag(row.notes ?? '');

    return {
      batchId: row.id,
      status: row.status,
      warehouseId: row.warehouse_id ?? '',
      warehouseName: row.warehouse_name ?? '',
      supplierId: row.supplier_id ?? null,
      supplierName: row.supplier_name ?? null,
      sourceType: row.source_type,
      batchTag,
      totalRows: Number(row.row_count ?? 0),
      createdRolls: Number(row.created_roll_count ?? 0),
      createdItems: Number(row.created_item_count ?? 0),
      createdColors: Number(row.created_color_count ?? 0),
      createdCategories: Number(extracted.createdCategories ?? 0),
      skippedRows: 0,
      clampedValues: 0,
      errorCount: Number(row.failed_count ?? 0),
      errors: errors.rows.map((error) => ({
        rowIndex: Number(error.row_no),
        reason: Array.isArray(error.errors) && error.errors.length > 0 ? String(error.errors[0]) : 'فشل غير محدد',
      })),
      elapsedMs: 0,
      startedAt: row.started_at,
      confirmedAt: row.confirmed_at,
      failedAt: row.failed_at,
      errorMessage: row.error_message,
    };
  } finally {
    client.release();
  }
}
