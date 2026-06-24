import type { FastifyBaseLogger } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import {
  rollbackStockImportBatch,
  type RollbackStockImportBatchReport,
} from './repairStockImportItemsService.js';
import {
  runStockImportBatchToCompletion,
  startStockImportBatch,
  type StockImportBatchStatus,
  type StockImportJobRow,
  type StockImportSourceType,
} from './stockImportJobService.js';

export interface StockImportPayload {
  fileName: string;
  sheetName: string;
  sheetKind: string;
  importLayout: string;
  headerRowIndex: number;
  rawHeaders: string[];
  rows: StockImportJobRow[];
}

export interface ResetAndReimportStockOptions {
  companyId: string;
  userId: string;
  importPayload?: StockImportPayload | null;
  batchId?: string | null;
  warehouseId?: string | null;
  supplierId?: string | null;
  sourceType?: StockImportSourceType;
  dryRun?: boolean;
  cleanOnly?: boolean;
  force?: boolean;
}

export interface ResetAndReimportStockReport {
  dryRun: boolean;
  cleanOnly: boolean;
  cleanedBatchId: string | null;
  cleanedBatchFileName: string | null;
  rollback: RollbackStockImportBatchReport | null;
  orphansPurged: number;
  importFile: string | null;
  importSheet: string | null;
  importRows: number;
  newBatchId: string | null;
  importResult: StockImportBatchStatus | null;
  blockedReason: string | null;
}

interface LatestBatchRow {
  id: string;
  file_name: string;
  sheet_name: string | null;
  warehouse_id: string | null;
  supplier_id: string | null;
  source_type: string;
  status: string;
  created_roll_count: number;
}

async function findLatestStockImportBatch(
  pool: Pool,
  companyId: string,
  batchId?: string | null,
): Promise<LatestBatchRow | null> {
  if (batchId) {
    const one = await pool.query<LatestBatchRow>(
      `SELECT id, file_name, sheet_name, warehouse_id, supplier_id, source_type, status, created_roll_count
       FROM purchase_import_batches
       WHERE id = $1 AND company_id = $2
         AND source_type IN ('OPENING_STOCK', 'DIRECT_STOCK_IMPORT', 'STOCK_IMPORT')`,
      [batchId, companyId],
    );
    return one.rows[0] ?? null;
  }

  const latest = await pool.query<LatestBatchRow>(
    `SELECT id, file_name, sheet_name, warehouse_id, supplier_id, source_type, status, created_roll_count
     FROM purchase_import_batches
     WHERE company_id = $1
       AND source_type IN ('OPENING_STOCK', 'DIRECT_STOCK_IMPORT', 'STOCK_IMPORT')
       AND status IN ('CONFIRMED', 'PARTIALLY_CONFIRMED', 'VALIDATED', 'CONFIRMING', 'FAILED')
     ORDER BY created_at DESC
     LIMIT 1`,
    [companyId],
  );
  return latest.rows[0] ?? null;
}

async function countNonAvailableBatchRolls(
  pool: Pool,
  companyId: string,
  batchId: string,
): Promise<number> {
  const result = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM fabric_rolls
     WHERE company_id = $1 AND import_batch_id = $2 AND status <> 'AVAILABLE'`,
    [companyId, batchId],
  );
  return Number(result.rows[0]?.n ?? '0');
}

async function purgeImportOrphanItems(client: PoolClient, companyId: string): Promise<number> {
  const deleted = await client.query<{ id: string }>(
    `DELETE FROM fabric_items fi
     WHERE fi.company_id = $1
       AND NOT EXISTS (SELECT 1 FROM fabric_rolls fr WHERE fr.item_id = fi.id)
       AND (
         fi.notes ILIKE '%استيراد%Excel%'
         OR fi.notes ILIKE '%إصلاح استيراد%'
         OR fi.internal_code LIKE 'IMP-AUTO-%'
       )
     RETURNING fi.id`,
    [companyId],
  );
  return deleted.rowCount ?? 0;
}

export async function resetAndReimportStock(
  pool: Pool,
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>,
  options: ResetAndReimportStockOptions,
): Promise<ResetAndReimportStockReport> {
  const dryRun = options.dryRun !== false;
  const cleanOnly = options.cleanOnly === true;
  const report: ResetAndReimportStockReport = {
    dryRun,
    cleanOnly,
    cleanedBatchId: null,
    cleanedBatchFileName: null,
    rollback: null,
    orphansPurged: 0,
    importFile: null,
    importSheet: null,
    importRows: 0,
    newBatchId: null,
    importResult: null,
    blockedReason: null,
  };

  const latest = await findLatestStockImportBatch(
    pool,
    options.companyId,
    options.batchId ?? null,
  );
  if (!latest) {
    report.blockedReason = 'لا توجد دفعة استيراد مخزون للتنظيف.';
    return report;
  }

  report.cleanedBatchId = latest.id;
  report.cleanedBatchFileName = latest.file_name;

  const blockedRolls = await countNonAvailableBatchRolls(pool, options.companyId, latest.id);
  if (blockedRolls > 0 && !options.force) {
    report.blockedReason =
      `توجد ${blockedRolls} ثوباً مباعاً/محجوزاً من هذه الدفعة — لا يمكن تنظيف كامل. أضف --force للمتابعة (يُحذف المتاح فقط).`;
    return report;
  }

  const payload = options.importPayload ?? null;
  if (!cleanOnly) {
    if (!payload?.rows.length) {
      report.blockedReason = 'حدّد مسار ملف Excel: --file=path/to/file.xlsx';
      return report;
    }
    if (payload.sheetKind !== 'incoming') {
      report.blockedReason = `ورقة «${payload.sheetName}» ليست «وارد» — الاستيراد يجب أن يكون من ورقة الوارد فقط.`;
      return report;
    }
    report.importFile = payload.fileName;
    report.importSheet = payload.sheetName;
    report.importRows = payload.rows.length;
  }

  if (dryRun) {
    report.rollback = {
      batchId: latest.id,
      dryRun: true,
      rollsDeleted: latest.created_roll_count,
      rollsSkippedSold: blockedRolls,
    };
    return report;
  }

  report.rollback = await rollbackStockImportBatch(pool, {
    companyId: options.companyId,
    batchId: latest.id,
    dryRun: false,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    report.orphansPurged = await purgeImportOrphanItems(client, options.companyId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (cleanOnly || !payload) return report;

  const sourceLabel = `${payload.fileName} · ${payload.sheetName}`.slice(0, 110);
  const started = await startStockImportBatch({
    companyId: options.companyId,
    userId: options.userId,
    warehouseId: options.warehouseId ?? latest.warehouse_id ?? undefined,
    supplierId: options.supplierId ?? latest.supplier_id ?? null,
    sourceType: options.sourceType ?? (latest.source_type as StockImportSourceType) ?? 'OPENING_STOCK',
    fileName: payload.fileName,
    sheetName: payload.sheetName,
    detectedColumns: payload.rawHeaders.map((col, colIndex) => ({ col, colIndex })),
    extractedMetadata: {
      headerRowIndex: payload.headerRowIndex,
      sheetKind: payload.sheetKind,
      importLayout: payload.importLayout,
      resetFromBatchId: latest.id,
    },
    sourceLabel,
    rows: payload.rows,
  });

  report.newBatchId = started.batchId;
  report.importResult = await runStockImportBatchToCompletion(
    logger,
    options.companyId,
    started.batchId,
  );

  return report;
}
