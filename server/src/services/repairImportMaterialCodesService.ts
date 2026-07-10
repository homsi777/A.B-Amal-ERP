import type { Pool, PoolClient } from 'pg';
import { cleanString } from '../utils/importColumnDetector.js';
import { resolveFabricColorForImport } from '../utils/importColorResolver.js';
import {
  internalCodeLooksLikeImportedColorMistake,
  materialCodeFieldsLookLikeColorMistake,
  readImportRowMaterialAndColor,
  reconcileImportMaterialAndColorCodes,
  resolveDisplayedMaterialCode,
  sanitizeNormalizedImportRow,
  sanitizeStockImportRow,
} from '../utils/importMaterialCodeResolver.js';
import { buildAutoInternalCode } from '../utils/importItemCodes.js';
import {
  applyPurchaseImportMaterialCodes,
  ensureFabricCategoryChainFromImport,
} from '../utils/purchaseImportMaterialCodes.js';
import {
  resolveStockImportItemCodes,
  type StockImportLayout,
} from '../utils/stockImportItemCodes.js';

export interface RepairMaterialCodeBatchSummary {
  id: string;
  fileName: string;
  sheetName: string | null;
  sourceType: string;
  status: string;
  rowCount: number;
  createdRolls: number;
  createdAt: string;
}

export interface RepairMaterialCodeRowResult {
  rowNo: number;
  rollId: string;
  barcode: string | null;
  materialName: string;
  wrongMaterialCode: string;
  correctedMaterialCode: string;
  correctedColorCode: string;
  fromItemId: string;
  fromItemCode: string;
  toItemId: string;
  toItemCode: string;
  action: 'fixed' | 'ok' | 'skipped';
  note?: string;
}

export interface RepairImportMaterialCodesReport {
  companyId: string;
  batchIds: string[];
  dryRun: boolean;
  scannedRows: number;
  fixedRows: number;
  alreadyOk: number;
  skipped: number;
  itemsCreated: number;
  itemsCorrected: number;
  colorsFixed: number;
  rows: RepairMaterialCodeRowResult[];
}

export interface RepairImportMaterialCodesOptions {
  companyId: string;
  batchId?: string | null;
  fileNameContains?: string | null;
  materialNameContains?: string | null;
  dryRun?: boolean;
  fixColors?: boolean;
  /** Also scan fabric_items/rolls directly (not only import rows). Default true. */
  scanInventory?: boolean;
}

function parseImportPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  return payload as Record<string, unknown>;
}

function extractCorrectedFields(payload: unknown): {
  materialName: string;
  materialCode: string;
  colorCode: string;
  colorName: string;
  colorNameTr: string;
  swapped: boolean;
} {
  const row = { ...parseImportPayload(payload) };
  sanitizeNormalizedImportRow(row);
  sanitizeStockImportRow(row);

  const read = readImportRowMaterialAndColor(row);
  const reconciled = reconcileImportMaterialAndColorCodes({
    internalMaterialCode: read.internalMaterialCode,
    supplierMaterialCode: read.supplierMaterialCode,
    colorCode: read.colorCode,
  });

  return {
    materialName: read.materialName,
    materialCode: reconciled.materialCode,
    colorCode: reconciled.colorCode,
    colorName: read.colorName,
    colorNameTr: read.colorNameTr,
    swapped: reconciled.swappedColorFromMaterial,
  };
}

async function ensureTargetItem(
  client: PoolClient,
  companyId: string,
  supplierId: string | null,
  materialName: string,
  materialCode: string,
  importLayout: StockImportLayout | string,
  dryRun: boolean,
): Promise<{ id: string; internalCode: string; created: boolean }> {
  const codes = resolveStockImportItemCodes(materialName, materialCode, importLayout);

  if (codes.matchByCode) {
    const byCode = await client.query<{ id: string; internal_code: string }>(
      `SELECT id, internal_code
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
      return { id: byCode.rows[0].id, internalCode: byCode.rows[0].internal_code, created: false };
    }
  }

  const byName = await client.query<{ id: string; internal_code: string }>(
    `SELECT id, internal_code
     FROM fabric_items
     WHERE company_id = $1 AND lower(btrim(name)) = lower(btrim($2))
     ORDER BY
       CASE WHEN internal_code LIKE 'IMP-AUTO-%' THEN 1 ELSE 0 END,
       created_at
     LIMIT 1`,
    [companyId, materialName],
  );
  if (byName.rows[0]?.id) {
    const item = byName.rows[0];
    if (internalCodeLooksLikeImportedColorMistake(item.internal_code, materialName)) {
      if (!dryRun) {
        await client.query(
          `UPDATE fabric_items
           SET internal_code = $3, supplier_code = NULL, updated_at = now()
           WHERE id = $1 AND company_id = $2`,
          [item.id, companyId, codes.internalCode],
        );
      }
      return { id: item.id, internalCode: codes.internalCode, created: false };
    }
    return { id: item.id, internalCode: item.internal_code, created: false };
  }

  if (dryRun) {
    return { id: `dry-run-${materialName}`, internalCode: codes.internalCode, created: true };
  }

  const inserted = await client.query<{ id: string; internal_code: string }>(
    `INSERT INTO fabric_items
       (company_id, supplier_id, internal_code, supplier_code, name, unit, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, internal_code`,
    [
      companyId,
      supplierId,
      codes.internalCode,
      codes.supplierCode,
      materialName,
      'meter',
      'تم إنشاؤه تلقائياً عبر إصلاح كود الخامة المستورد خطأً',
    ],
  );
  return { id: inserted.rows[0].id, internalCode: inserted.rows[0].internal_code, created: true };
}

async function fixFabricItemColorMistake(
  client: PoolClient,
  companyId: string,
  itemId: string,
  itemName: string,
  internalCode: string,
  supplierCode: string | null,
  dryRun: boolean,
): Promise<{ corrected: boolean; nextInternalCode: string; colorCodeCandidate: string }> {
  const check = materialCodeFieldsLookLikeColorMistake({
    internalCode,
    supplierCode,
    itemName,
  });
  if (!check.needsFix) {
    return { corrected: false, nextInternalCode: internalCode, colorCodeCandidate: '' };
  }

  const internalBad = internalCodeLooksLikeImportedColorMistake(internalCode, itemName);
  const nextInternal =
    internalBad || check.displayedBad
      ? buildAutoInternalCode(itemName)
      : internalCode.startsWith('IMP-AUTO-') || internalCode.startsWith('AUTO-')
        ? internalCode
        : buildAutoInternalCode(itemName);

  if (!dryRun) {
    await client.query(
      `UPDATE fabric_items
       SET internal_code = $3,
           supplier_code = NULL,
           updated_at = now()
       WHERE id = $1 AND company_id = $2`,
      [itemId, companyId, nextInternal],
    );
  }

  return {
    corrected: true,
    nextInternalCode: nextInternal,
    colorCodeCandidate: check.colorCodeCandidate,
  };
}

async function repairInventoryItemsDirect(
  client: PoolClient,
  options: RepairImportMaterialCodesOptions,
  report: RepairImportMaterialCodesReport,
  dryRun: boolean,
): Promise<void> {
  const materialFilter = cleanString(options.materialNameContains)?.toLowerCase() ?? '';
  const params: string[] = [options.companyId];
  let materialClause = '';
  if (materialFilter) {
    params.push(`%${materialFilter}%`);
    const p = `$${params.length}`;
    materialClause = `AND (
      lower(fi.name) LIKE ${p}
      OR lower(coalesce(fi.supplier_code, '')) LIKE ${p}
      OR lower(regexp_replace(fi.internal_code, '^L[1-4]_', '', 'i')) LIKE ${p}
      OR EXISTS (
        SELECT 1 FROM purchase_import_rows pir
        JOIN fabric_rolls fr2 ON fr2.id = pir.created_roll_id AND fr2.company_id = pir.company_id
        WHERE pir.company_id = fi.company_id
          AND fr2.item_id = fi.id
          AND (
            coalesce(pir.normalized_data->>'materialName', '') ILIKE ${p}
            OR coalesce(pir.normalized_data->>'itemName', '') ILIKE ${p}
            OR coalesce(pir.raw_data->>'materialName', '') ILIKE ${p}
            OR coalesce(pir.raw_data->>'itemName', '') ILIKE ${p}
          )
      )
    )`;
  }

  const items = await client.query<{
    id: string;
    name: string;
    internal_code: string;
    supplier_code: string | null;
    roll_count: string;
  }>(
    `SELECT fi.id, fi.name, fi.internal_code, fi.supplier_code,
            COUNT(fr.id)::text AS roll_count
     FROM fabric_items fi
     JOIN fabric_rolls fr ON fr.item_id = fi.id AND fr.company_id = fi.company_id
     WHERE fi.company_id = $1
       ${materialClause}
     GROUP BY fi.id, fi.name, fi.internal_code, fi.supplier_code`,
    params,
  );

  const seenItemIds = new Set<string>();

  for (const item of items.rows) {
    if (seenItemIds.has(item.id)) continue;
    seenItemIds.add(item.id);

    const check = materialCodeFieldsLookLikeColorMistake({
      internalCode: item.internal_code,
      supplierCode: item.supplier_code,
      itemName: item.name,
    });
    if (!check.needsFix) continue;

    report.scannedRows += 1;
    const fixed = await fixFabricItemColorMistake(
      client,
      options.companyId,
      item.id,
      item.name,
      item.internal_code,
      item.supplier_code,
      dryRun,
    );
    if (!fixed.corrected) continue;

    report.itemsCorrected += 1;
    report.fixedRows += Number(item.roll_count) || 0;

    if (!dryRun && options.fixColors && fixed.colorCodeCandidate) {
      const rolls = await client.query<{ id: string; color_id: string | null }>(
        `SELECT id, color_id FROM fabric_rolls WHERE company_id = $1 AND item_id = $2`,
        [options.companyId, item.id],
      );
      for (const roll of rolls.rows) {
        const color = await resolveFabricColorForImport(
          client,
          options.companyId,
          {
            colorCode: fixed.colorCodeCandidate,
            colorName: fixed.colorCodeCandidate,
          },
          { createIfMissing: true },
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

      await ensureFabricCategoryChainFromImport(client, options.companyId, {
        materialName: item.name,
        colorCode: fixed.colorCodeCandidate,
      });
    }

    report.rows.push({
      rowNo: 0,
      rollId: '',
      barcode: null,
      materialName: item.name,
      wrongMaterialCode: check.displayedCode,
      correctedMaterialCode: fixed.nextInternalCode,
      correctedColorCode: fixed.colorCodeCandidate,
      fromItemId: item.id,
      fromItemCode: check.displayedCode,
      toItemId: item.id,
      toItemCode: fixed.nextInternalCode,
      action: 'fixed',
      note: `إصلاح مباشر على fabric_items (${item.roll_count} ثوب)`,
    });
  }
}

export async function listMaterialCodeRepairBatches(
  pool: Pool,
  companyId: string,
  fileNameContains?: string | null,
): Promise<RepairMaterialCodeBatchSummary[]> {
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
  }>(
    `SELECT b.id, b.file_name, b.sheet_name, b.source_type, b.status,
            b.row_count,
            (SELECT COUNT(*)::int FROM purchase_import_rows r
              WHERE r.batch_id = b.id AND r.created_roll_id IS NOT NULL) AS created_roll_count,
            b.created_at
     FROM purchase_import_batches b
     WHERE b.company_id = $1
       AND ($2::text IS NULL OR b.file_name ILIKE '%' || $2 || '%')
     ORDER BY b.created_at DESC
     LIMIT 100`,
    [companyId, filter || null],
  );
  return result.rows.map((b) => ({
    id: b.id,
    fileName: b.file_name,
    sheetName: b.sheet_name,
    sourceType: b.source_type,
    status: b.status,
    rowCount: b.row_count,
    createdRolls: b.created_roll_count,
    createdAt: b.created_at,
  }));
}

export async function repairImportMaterialCodes(
  pool: Pool,
  options: RepairImportMaterialCodesOptions,
): Promise<RepairImportMaterialCodesReport> {
  const dryRun = options.dryRun !== false;
  const report: RepairImportMaterialCodesReport = {
    companyId: options.companyId,
    batchIds: [],
    dryRun,
    scannedRows: 0,
    fixedRows: 0,
    alreadyOk: 0,
    skipped: 0,
    itemsCreated: 0,
    itemsCorrected: 0,
    colorsFixed: 0,
    rows: [],
  };

  let batchIds: string[] = [];
  if (options.batchId) {
    batchIds = [options.batchId];
  } else {
    const batches = await listMaterialCodeRepairBatches(
      pool,
      options.companyId,
      options.fileNameContains,
    );
    batchIds = batches.map((b) => b.id);
  }
  report.batchIds = batchIds;
  if (!batchIds.length) return report;

  const materialFilter = cleanString(options.materialNameContains)?.toLowerCase() ?? '';
  const client = await pool.connect();

  try {
    if (!dryRun) await client.query('BEGIN');

    for (const batchId of batchIds) {
      const batch = await client.query<{
        supplier_id: string | null;
        extracted_metadata: Record<string, unknown> | null;
      }>(
        `SELECT supplier_id, extracted_metadata
         FROM purchase_import_batches
         WHERE id = $1 AND company_id = $2`,
        [batchId, options.companyId],
      );
      if (!batch.rows.length) continue;

      const supplierId = batch.rows[0].supplier_id;
      const importLayout =
        (typeof batch.rows[0].extracted_metadata?.importLayout === 'string'
          ? batch.rows[0].extracted_metadata.importLayout
          : 'supplier_invoice') as StockImportLayout | string;

      const rows = await client.query<{
        id: string;
        row_no: number;
        created_roll_id: string | null;
        normalized_data: unknown;
        raw_data: unknown;
      }>(
        `SELECT id, row_no, created_roll_id, normalized_data, raw_data
         FROM purchase_import_rows
         WHERE company_id = $1 AND batch_id = $2 AND created_roll_id IS NOT NULL
         ORDER BY row_no`,
        [options.companyId, batchId],
      );

      for (const rowRec of rows.rows) {
        report.scannedRows += 1;
        const corrected = extractCorrectedFields(rowRec.normalized_data ?? rowRec.raw_data);
        if (!corrected.materialName) {
          report.skipped += 1;
          report.rows.push({
            rowNo: rowRec.row_no,
            rollId: rowRec.created_roll_id ?? '',
            barcode: null,
            materialName: '',
            wrongMaterialCode: '',
            correctedMaterialCode: '',
            correctedColorCode: corrected.colorCode,
            fromItemId: '',
            fromItemCode: '',
            toItemId: '',
            toItemCode: '',
            action: 'skipped',
            note: 'لا يوجد اسم خامة في بيانات الصف',
          });
          continue;
        }

        if (materialFilter && !corrected.materialName.toLowerCase().includes(materialFilter)) {
          report.skipped += 1;
          continue;
        }

        const rollQ = await client.query<{
          id: string;
          barcode: string | null;
          item_id: string;
          color_id: string | null;
          internal_code: string;
          supplier_code: string | null;
          item_name: string;
        }>(
          `SELECT fr.id, fr.barcode, fr.item_id, fr.color_id,
                  fi.internal_code, fi.supplier_code, fi.name AS item_name
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

        const itemName = roll.item_name || corrected.materialName;
        const itemCheck = materialCodeFieldsLookLikeColorMistake({
          internalCode: roll.internal_code,
          supplierCode: roll.supplier_code,
          itemName,
        });
        const wrongCode = resolveDisplayedMaterialCode(roll.internal_code, roll.supplier_code);
        const effectiveColorCode = corrected.colorCode || itemCheck.colorCodeCandidate;
        const needsFix =
          corrected.swapped
          || itemCheck.needsFix
          || internalCodeLooksLikeImportedColorMistake(roll.internal_code, itemName);

        if (!needsFix) {
          report.alreadyOk += 1;
          report.rows.push({
            rowNo: rowRec.row_no,
            rollId: roll.id,
            barcode: roll.barcode,
            materialName: corrected.materialName,
            wrongMaterialCode: wrongCode,
            correctedMaterialCode: corrected.materialCode,
            correctedColorCode: effectiveColorCode,
            fromItemId: roll.item_id,
            fromItemCode: wrongCode,
            toItemId: roll.item_id,
            toItemCode: wrongCode,
            action: 'ok',
          });
          continue;
        }

        const target = await ensureTargetItem(
          client,
          options.companyId,
          supplierId,
          corrected.materialName,
          corrected.materialCode,
          importLayout,
          dryRun,
        );
        if (target.created) report.itemsCreated += 1;
        else if (target.internalCode !== wrongCode) report.itemsCorrected += 1;

        if (!dryRun && !target.id.startsWith('dry-run')) {
          await fixFabricItemColorMistake(
            client,
            options.companyId,
            target.id,
            itemName,
            roll.internal_code,
            roll.supplier_code,
            false,
          );

          if (roll.item_id !== target.id) {
            await client.query(
              `UPDATE fabric_rolls SET item_id = $3, updated_at = now()
               WHERE id = $1 AND company_id = $2`,
              [roll.id, options.companyId, target.id],
            );
          }

          const importNd = {
            materialName: corrected.materialName,
            supplierMaterialCode: corrected.materialCode || null,
            colorCode: effectiveColorCode || null,
            colorName: corrected.colorName || effectiveColorCode || null,
            colorNameTr: corrected.colorNameTr || null,
          };
          await applyPurchaseImportMaterialCodes(client, options.companyId, target.id, importNd);
          await ensureFabricCategoryChainFromImport(client, options.companyId, importNd);

          const patched = { ...parseImportPayload(rowRec.normalized_data) };
          sanitizeNormalizedImportRow(patched);
          sanitizeStockImportRow(patched);
          if (effectiveColorCode) patched.colorCode = effectiveColorCode;
          if (!corrected.materialCode) {
            patched.supplierMaterialCode = null;
            patched.itemCode = '';
          } else {
            patched.supplierMaterialCode = corrected.materialCode;
            patched.itemCode = corrected.materialCode;
          }
          await client.query(
            `UPDATE purchase_import_rows
             SET normalized_data = $3
             WHERE id = $1 AND company_id = $2`,
            [rowRec.id, options.companyId, JSON.stringify(patched)],
          );

          if (options.fixColors) {
            const color = await resolveFabricColorForImport(
              client,
              options.companyId,
              importNd,
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

        report.fixedRows += 1;
        report.rows.push({
          rowNo: rowRec.row_no,
          rollId: roll.id,
          barcode: roll.barcode,
          materialName: corrected.materialName,
          wrongMaterialCode: wrongCode,
          correctedMaterialCode: target.internalCode,
          correctedColorCode: effectiveColorCode,
          fromItemId: roll.item_id,
          fromItemCode: wrongCode,
          toItemId: target.id,
          toItemCode: target.internalCode,
          action: 'fixed',
        });
      }
    }

    if (options.scanInventory !== false) {
      await repairInventoryItemsDirect(client, options, report, dryRun);
    }

    if (!dryRun) await client.query('COMMIT');
  } catch (err) {
    if (!dryRun) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return report;
}

/** Print candidate rows/items for debugging zero-fix repair runs. */
export async function diagnoseImportMaterialCodes(
  pool: Pool,
  companyId: string,
  materialNameContains?: string | null,
): Promise<void> {
  const materialFilter = cleanString(materialNameContains)?.toLowerCase() ?? '';
  const like = materialFilter ? `%${materialFilter}%` : '%';

  const items = await pool.query<{
    name: string;
    internal_code: string;
    supplier_code: string | null;
    roll_count: string;
    displayed: string;
    needs_fix: boolean;
  }>(
    `SELECT fi.name, fi.internal_code, fi.supplier_code,
            COUNT(fr.id)::text AS roll_count,
            regexp_replace(btrim(fi.internal_code), '^L[1-4]_', '', 'i') AS displayed,
            (
              regexp_replace(btrim(fi.internal_code), '^L[1-4]_', '', 'i') ~ '^\\d{1,3}$'
              OR btrim(coalesce(fi.supplier_code, '')) ~ '^\\d{1,3}$'
            ) AS needs_fix
     FROM fabric_items fi
     JOIN fabric_rolls fr ON fr.item_id = fi.id AND fr.company_id = fi.company_id
     WHERE fi.company_id = $1
       AND lower(fi.name) LIKE $2
     GROUP BY fi.id, fi.name, fi.internal_code, fi.supplier_code
     ORDER BY COUNT(fr.id) DESC
     LIMIT 30`,
    [companyId, like],
  );

  console.log(`[diagnose] fabric_items matching name LIKE ${like}:`);
  if (!items.rows.length) console.log('  (none)');
  for (const row of items.rows) {
    console.log(
      `  name="${row.name}" internal="${row.internal_code}" supplier="${row.supplier_code ?? ''}" rolls=${row.roll_count} displayed~="${row.displayed}" numericLike=${row.needs_fix}`,
    );
  }

  const importRows = await pool.query<{
    row_no: number;
    material_name: string;
    sup_code: string;
    item_code: string;
    color_code: string;
    roll_internal: string;
    roll_supplier: string | null;
    barcode: string | null;
  }>(
    `SELECT pir.row_no,
            coalesce(pir.normalized_data->>'materialName', pir.normalized_data->>'itemName', '') AS material_name,
            coalesce(pir.normalized_data->>'supplierMaterialCode', '') AS sup_code,
            coalesce(pir.normalized_data->>'itemCode', '') AS item_code,
            coalesce(pir.normalized_data->>'colorCode', '') AS color_code,
            fi.internal_code AS roll_internal,
            fi.supplier_code AS roll_supplier,
            fr.barcode
     FROM purchase_import_rows pir
     JOIN fabric_rolls fr ON fr.id = pir.created_roll_id AND fr.company_id = pir.company_id
     JOIN fabric_items fi ON fi.id = fr.item_id
     WHERE pir.company_id = $1
       AND (
         coalesce(pir.normalized_data->>'materialName', '') ILIKE $2
         OR coalesce(pir.normalized_data->>'itemName', '') ILIKE $2
       )
     ORDER BY pir.row_no
     LIMIT 20`,
    [companyId, like],
  );

  console.log(`[diagnose] sample import rows:`);
  if (!importRows.rows.length) console.log('  (none)');
  for (const row of importRows.rows) {
    console.log(
      `  row=${row.row_no} barcode=${row.barcode ?? '—'} excel="${row.material_name}" sup="${row.sup_code}" itemCode="${row.item_code}" color="${row.color_code}" dbInternal="${row.roll_internal}" dbSupplier="${row.roll_supplier ?? ''}"`,
    );
  }

  const rollSample = await pool.query<{
    barcode: string | null;
    item_name: string;
    internal_code: string;
    supplier_code: string | null;
    color_name: string | null;
    color_code: string | null;
    status: string;
  }>(
    `SELECT fr.barcode, fi.name AS item_name, fi.internal_code, fi.supplier_code,
            fc.name_ar AS color_name, fc.color_code, fr.status
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     WHERE fr.company_id = $1
       AND lower(fi.name) LIKE $2
       AND fr.status = 'AVAILABLE'
     ORDER BY fi.name, fr.barcode
     LIMIT 15`,
    [companyId, like],
  );

  console.log(`[diagnose] sample AVAILABLE rolls (what inventory UI shows):`);
  if (!rollSample.rows.length) console.log('  (none)');
  for (const row of rollSample.rows) {
    const internal = String(row.internal_code ?? '').trim();
    const supplier = String(row.supplier_code ?? '').trim();
    const shownMaterial =
      internal && !internal.startsWith('IMP-AUTO-')
        ? internal
        : supplier || '(فارغ — يظهر —)';
    console.log(
      `  barcode=${row.barcode ?? '—'} item="${row.item_name}" كود_خامة_معروض="${shownMaterial}" internal="${internal}" supplier="${supplier}" color="${row.color_name ?? ''}" colorCode="${row.color_code ?? ''}"`,
    );
  }

  const codeEight = await pool.query<{
    name: string;
    internal_code: string;
    supplier_code: string | null;
    roll_count: string;
  }>(
    `SELECT fi.name, fi.internal_code, fi.supplier_code, COUNT(fr.id)::text AS roll_count
     FROM fabric_items fi
     JOIN fabric_rolls fr ON fr.item_id = fi.id AND fr.company_id = fi.company_id
     WHERE fi.company_id = $1
       AND (
         regexp_replace(btrim(fi.internal_code), '^L[1-4]_', '', 'i') = '8'
         OR btrim(coalesce(fi.supplier_code, '')) = '8'
       )
     GROUP BY fi.id, fi.name, fi.internal_code, fi.supplier_code
     ORDER BY COUNT(fr.id) DESC
     LIMIT 20`,
    [companyId],
  );

  console.log(`[diagnose] fabric_items where material code is exactly "8":`);
  if (!codeEight.rows.length) console.log('  (none — لا يوجد كود خامة = 8 في قاعدة البيانات)');
  for (const row of codeEight.rows) {
    console.log(
      `  name="${row.name}" internal="${row.internal_code}" supplier="${row.supplier_code ?? ''}" rolls=${row.roll_count}`,
    );
  }

  const colorEight = await pool.query<{
    item_name: string;
    roll_count: string;
  }>(
    `SELECT fi.name AS item_name, COUNT(fr.id)::text AS roll_count
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id
     JOIN fabric_colors fc ON fc.id = fr.color_id
     WHERE fr.company_id = $1
       AND btrim(fc.color_code) = '8'
     GROUP BY fi.name
     ORDER BY COUNT(fr.id) DESC
     LIMIT 15`,
    [companyId],
  );

  console.log(`[diagnose] rolls with color_code = "8" (كود اللون — ليس كود الخامة):`);
  if (!colorEight.rows.length) console.log('  (none)');
  for (const row of colorEight.rows) {
    console.log(`  item="${row.item_name}" rolls=${row.roll_count}`);
  }
}
