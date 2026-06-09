import type { Pool, PoolClient } from 'pg';
import { cleanString } from '../utils/importColumnDetector.js';
import { resolveFabricColorForImport } from '../utils/importColorResolver.js';

export interface RepairImportColorsOptions {
  companyId: string;
  batchId?: string | null;
  barcodes?: string[];
  dryRun?: boolean;
}

export interface RepairImportColorsRowResult {
  rollId: string;
  barcode: string | null;
  rowNo: number;
  batchId: string | null;
  matchVia: string;
  fromColor: string | null;
  toColor: string | null;
  colorLabel: string;
  skipped?: string;
}

export interface RepairImportColorsReport {
  companyId: string;
  batchId: string | null;
  dryRun: boolean;
  scanned: number;
  updated: number;
  skipped: number;
  createdColors: number;
  rows: RepairImportColorsRowResult[];
  diagnosis?: RepairDiagnosis;
}

export interface RepairDiagnosis {
  rollsWithImportBatch: number;
  importRowsTotal: number;
  importRowsLinked: number;
  rollsWithInvoiceLine: number;
}

interface RepairCandidate {
  rollId: string;
  barcode: string | null;
  batchId: string | null;
  rowNo: number;
  matchVia: string;
  normalizedData: unknown;
  rawData: unknown;
  invoiceMetadata: unknown;
  currentColorId: string | null;
  currentNameAr: string | null;
  currentNameTr: string | null;
  currentColorCode: string | null;
}

function normalizeHeaderKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s\-_\/\.]+/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

function parseRowNoFromNotes(notes: string | null): number | null {
  if (!notes) return null;
  const m = /صف\s*#(\d+)/.exec(notes);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function barcodeFromJson(obj: Record<string, unknown>): string {
  const direct = cleanString(obj.barcode ?? obj.Barkod ?? obj.barkod ?? obj['باركود'] ?? obj['باركورد']);
  return direct;
}

function lengthFromJson(obj: Record<string, unknown>): number | null {
  for (const key of ['lengthM', 'length_m', 'quantity', 'Metre', 'metre', 'الطول']) {
    const v = obj[key];
    if (v === null || v === undefined || v === '') continue;
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function extractColorFields(
  normalized: unknown,
  raw: unknown,
  invoiceMetadata?: unknown,
): {
  colorName?: string;
  colorNameTr?: string;
  colorCode?: string;
  supplierColorCode?: string;
} {
  const nd =
    normalized && typeof normalized === 'object'
      ? (normalized as Record<string, unknown>)
      : {};
  const rawObj =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const meta =
    invoiceMetadata && typeof invoiceMetadata === 'object'
      ? (invoiceMetadata as Record<string, unknown>)
      : {};

  let colorName = cleanString(nd.colorName ?? nd.color_name ?? meta.colorName ?? meta.fabricColor);
  let colorNameTr = cleanString(nd.colorNameTr ?? nd.color_name_tr);
  let colorCode = cleanString(nd.colorCode ?? nd.color_code ?? meta.colorCode);
  const supplierColorCode = cleanString(nd.supplierColorCode ?? nd.supplier_color_code);

  for (const [header, value] of Object.entries(rawObj)) {
    const key = normalizeHeaderKey(header);
    const text = cleanString(value);
    if (!text) continue;
    if (['zeminrenk', 'renk', 'renkadi', 'renkadı', 'اللون', 'color', 'colour', 'colorname'].includes(key)) {
      if (!colorNameTr) colorNameTr = text;
      if (!colorName) colorName = text;
    }
    if (['كوداللون', 'renkkodu', 'colorcode', 'colourcode', 'رمزاللون'].includes(key)) {
      if (!colorCode) colorCode = text;
    }
  }

  return {
    colorName: colorName || undefined,
    colorNameTr: colorNameTr || undefined,
    colorCode: colorCode || undefined,
    supplierColorCode: supplierColorCode || undefined,
  };
}

function colorLabel(nameAr: string | null, nameTr: string | null, code: string | null): string {
  return [nameAr, nameTr, code].filter(Boolean).join(' / ') || '—';
}

async function loadImportRowsForBatches(
  db: Pool | PoolClient,
  companyId: string,
  batchIds: string[],
): Promise<
  Array<{
    id: string;
    batch_id: string;
    row_no: number;
    created_roll_id: string | null;
    normalized_data: unknown;
    raw_data: unknown;
    status: string;
  }>
> {
  if (!batchIds.length) return [];
  const r = await db.query<{
    id: string;
    batch_id: string;
    row_no: number;
    created_roll_id: string | null;
    normalized_data: unknown;
    raw_data: unknown;
    status: string;
  }>(
    `SELECT id, batch_id, row_no, created_roll_id, normalized_data, raw_data, status
     FROM purchase_import_rows
     WHERE company_id = $1 AND batch_id = ANY($2::uuid[])
     ORDER BY batch_id, row_no`,
    [companyId, batchIds],
  );
  return r.rows;
}

function matchImportRowInSet(
  roll: {
    id: string;
    barcode: string | null;
    length_m: string | number;
    notes: string | null;
  },
  rows: Array<{
    id: string;
    batch_id: string;
    row_no: number;
    created_roll_id: string | null;
    normalized_data: unknown;
    raw_data: unknown;
  }>,
  viaPrefix: string,
): { row: (typeof rows)[number]; via: string } | null {
  const rollBarcode = cleanString(roll.barcode);
  if (rollBarcode) {
    const byBarcode = rows.find((r) => {
      const nd = (r.normalized_data ?? {}) as Record<string, unknown>;
      const raw = (r.raw_data ?? {}) as Record<string, unknown>;
      return barcodeFromJson(nd) === rollBarcode || barcodeFromJson(raw) === rollBarcode;
    });
    if (byBarcode) return { row: byBarcode, via: `${viaPrefix}barcode` };
  }

  const rollLen = Number(roll.length_m);
  if (Number.isFinite(rollLen)) {
    const byLength = rows.find((r) => {
      const nd = (r.normalized_data ?? {}) as Record<string, unknown>;
      const len = lengthFromJson(nd);
      return len != null && Math.abs(len - rollLen) < 0.06;
    });
    if (byLength) return { row: byLength, via: `${viaPrefix}length_m` };
  }

  const rowNoFromNotes = parseRowNoFromNotes(roll.notes);
  if (rowNoFromNotes != null) {
    const byNotes = rows.find((r) => r.row_no === rowNoFromNotes);
    if (byNotes) return { row: byNotes, via: `${viaPrefix}notes_row_no` };
  }

  return null;
}

function pickImportRow(
  roll: {
    id: string;
    barcode: string | null;
    import_batch_id: string | null;
    length_m: string | number;
    notes: string | null;
  },
  importRows: Array<{
    id: string;
    batch_id: string;
    row_no: number;
    created_roll_id: string | null;
    normalized_data: unknown;
    raw_data: unknown;
  }>,
): { row: (typeof importRows)[number]; via: string } | null {
  const byCreated = importRows.find((r) => r.created_roll_id === roll.id);
  if (byCreated) return { row: byCreated, via: 'created_roll_id' };

  const batchId = roll.import_batch_id;
  if (batchId) {
    const batchRows = importRows.filter((r) => r.batch_id === batchId);
    const inBatch = matchImportRowInSet(roll, batchRows, '');
    if (inBatch) return inBatch;
  }

  return matchImportRowInSet(roll, importRows, 'global_');
}

async function discoverCandidates(
  db: Pool | PoolClient,
  companyId: string,
  batchFilter: string | null,
  barcodes: string[],
): Promise<{ candidates: RepairCandidate[]; diagnosis: RepairDiagnosis }> {
  const barcodeFilter = barcodes.map((b) => cleanString(b)).filter(Boolean);

  const rollsQ = await db.query<{
    id: string;
    barcode: string | null;
    import_batch_id: string | null;
    length_m: string;
    notes: string | null;
    color_id: string | null;
    current_name_ar: string | null;
    current_name_tr: string | null;
    current_color_code: string | null;
    pil_metadata: unknown;
  }>(
    `SELECT
       fr.id,
       fr.barcode,
       fr.import_batch_id,
       fr.length_m::text,
       fr.notes,
       fr.color_id,
       fc.name_ar AS current_name_ar,
       fc.name_tr AS current_name_tr,
       fc.color_code AS current_color_code,
       pil.metadata AS pil_metadata
     FROM fabric_rolls fr
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     LEFT JOIN purchase_invoice_lines pil
       ON pil.fabric_roll_id = fr.id AND pil.company_id = fr.company_id
     WHERE fr.company_id = $1
       AND ($2::uuid IS NULL OR fr.import_batch_id = $2::uuid)
       AND (
         cardinality($3::text[]) = 0
         OR fr.barcode = ANY($3::text[])
       )
       AND (
         cardinality($3::text[]) > 0
         OR fr.import_batch_id IS NOT NULL
         OR pil.id IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM purchase_import_rows pir
           WHERE pir.company_id = fr.company_id AND pir.created_roll_id = fr.id
         )
         OR COALESCE(fr.notes, '') ILIKE '%استيراد Excel%'
       )
     ORDER BY fr.created_at`,
    [companyId, batchFilter, barcodeFilter],
  );

  const diagRolls = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM fabric_rolls WHERE company_id=$1 AND import_batch_id IS NOT NULL`,
    [companyId],
  );
  const diagRows = await db.query<{ total: string; linked: string }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE created_roll_id IS NOT NULL)::text AS linked
     FROM purchase_import_rows WHERE company_id=$1`,
    [companyId],
  );
  const diagInv = await db.query<{ n: string }>(
    `SELECT COUNT(DISTINCT fabric_roll_id)::text AS n
     FROM purchase_invoice_lines WHERE company_id=$1 AND fabric_roll_id IS NOT NULL`,
    [companyId],
  );

  let batchIds = [
    ...new Set(
      rollsQ.rows.map((r) => r.import_batch_id).filter((id): id is string => Boolean(id)),
    ),
  ];
  if (!batchIds.length && rollsQ.rows.length > 0) {
    const recent = await db.query<{ id: string }>(
      `SELECT id FROM purchase_import_batches
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [companyId],
    );
    batchIds = recent.rows.map((r) => r.id);
  }
  let importRows = await loadImportRowsForBatches(db, companyId, batchIds);
  if (!importRows.length) {
    const allRows = await db.query<{
      id: string;
      batch_id: string;
      row_no: number;
      created_roll_id: string | null;
      normalized_data: unknown;
      raw_data: unknown;
      status: string;
    }>(
      `SELECT id, batch_id, row_no, created_roll_id, normalized_data, raw_data, status
       FROM purchase_import_rows
       WHERE company_id = $1
       ORDER BY batch_id, row_no`,
      [companyId],
    );
    importRows = allRows.rows;
  }

  const candidates: RepairCandidate[] = [];
  const seenRolls = new Set<string>();

  for (const roll of rollsQ.rows) {
    if (seenRolls.has(roll.id)) continue;
    seenRolls.add(roll.id);

    const picked = pickImportRow(roll, importRows);
    candidates.push({
      rollId: roll.id,
      barcode: roll.barcode,
      batchId: picked?.row.batch_id ?? roll.import_batch_id,
      rowNo: picked?.row.row_no ?? 0,
      matchVia: picked?.via ?? (roll.pil_metadata ? 'invoice_line_metadata' : 'none'),
      normalizedData: picked?.row.normalized_data ?? {},
      rawData: picked?.row.raw_data ?? {},
      invoiceMetadata: roll.pil_metadata ?? {},
      currentColorId: roll.color_id,
      currentNameAr: roll.current_name_ar,
      currentNameTr: roll.current_name_tr,
      currentColorCode: roll.current_color_code,
    });
  }

  return {
    candidates,
    diagnosis: {
      rollsWithImportBatch: Number(diagRolls.rows[0]?.n ?? 0),
      importRowsTotal: Number(diagRows.rows[0]?.total ?? 0),
      importRowsLinked: Number(diagRows.rows[0]?.linked ?? 0),
      rollsWithInvoiceLine: Number(diagInv.rows[0]?.n ?? 0),
    },
  };
}

export async function repairImportRollColors(
  db: Pool | PoolClient,
  opts: RepairImportColorsOptions,
): Promise<RepairImportColorsReport> {
  const dryRun = opts.dryRun !== false;
  const batchFilter = opts.batchId?.trim() || null;
  const barcodes = opts.barcodes ?? [];

  const { candidates, diagnosis } = await discoverCandidates(db, opts.companyId, batchFilter, barcodes);

  const report: RepairImportColorsReport = {
    companyId: opts.companyId,
    batchId: batchFilter,
    dryRun,
    scanned: candidates.length,
    updated: 0,
    skipped: 0,
    createdColors: 0,
    rows: [],
    diagnosis,
  };

  const useClient = 'connect' in db;
  const client = useClient ? await (db as Pool).connect() : (db as PoolClient);
  try {
    if (useClient) await client.query('BEGIN');

    for (const row of candidates) {
      const colorFields = extractColorFields(row.normalizedData, row.rawData, row.invoiceMetadata);
      const label = colorLabel(colorFields.colorName ?? null, colorFields.colorNameTr ?? null, colorFields.colorCode ?? null);

      if (!colorFields.colorName && !colorFields.colorNameTr && !colorFields.colorCode && !colorFields.supplierColorCode) {
        report.skipped += 1;
        report.rows.push({
          rollId: row.rollId,
          barcode: row.barcode,
          rowNo: row.rowNo,
          batchId: row.batchId,
          matchVia: row.matchVia,
          fromColor: colorLabel(row.currentNameAr, row.currentNameTr, row.currentColorCode),
          toColor: null,
          colorLabel: label,
          skipped: row.matchVia === 'none' ? 'لا يوجد صف استيراد مرتبط' : 'لا يوجد لون في بيانات المصدر',
        });
        continue;
      }

      const resolved = await resolveFabricColorForImport(client, opts.companyId, colorFields, {
        createIfMissing: true,
        rowNo: row.rowNo || undefined,
      });

      if (!resolved.id) {
        report.skipped += 1;
        report.rows.push({
          rollId: row.rollId,
          barcode: row.barcode,
          rowNo: row.rowNo,
          batchId: row.batchId,
          matchVia: row.matchVia,
          fromColor: colorLabel(row.currentNameAr, row.currentNameTr, row.currentColorCode),
          toColor: null,
          colorLabel: label,
          skipped: 'تعذر إيجاد أو إنشاء اللون',
        });
        continue;
      }

      if (resolved.created) report.createdColors += 1;

      const newColor = await client.query<{
        name_ar: string | null;
        name_tr: string | null;
        color_code: string | null;
      }>(`SELECT name_ar, name_tr, color_code FROM fabric_colors WHERE id = $1`, [resolved.id]);
      const nc = newColor.rows[0];
      const toColor = colorLabel(nc?.name_ar ?? null, nc?.name_tr ?? null, nc?.color_code ?? null);
      const fromColor = colorLabel(row.currentNameAr, row.currentNameTr, row.currentColorCode);

      if (row.currentColorId === resolved.id) {
        report.skipped += 1;
        report.rows.push({
          rollId: row.rollId,
          barcode: row.barcode,
          rowNo: row.rowNo,
          batchId: row.batchId,
          matchVia: row.matchVia,
          fromColor,
          toColor,
          colorLabel: label,
          skipped: 'اللون صحيح مسبقاً',
        });
        continue;
      }

      if (!dryRun) {
        await client.query(
          `UPDATE fabric_rolls
           SET color_id = $3, variant_id = NULL, updated_at = now()
           WHERE id = $1 AND company_id = $2`,
          [row.rollId, opts.companyId, resolved.id],
        );
      }

      report.updated += 1;
      report.rows.push({
        rollId: row.rollId,
        barcode: row.barcode,
        rowNo: row.rowNo,
        batchId: row.batchId,
        matchVia: row.matchVia,
        fromColor,
        toColor,
        colorLabel: label,
      });
    }

    if (useClient) await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
  } catch (e) {
    if (useClient) await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    if (useClient) client.release();
  }

  return report;
}
