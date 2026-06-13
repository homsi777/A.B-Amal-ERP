import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { calcWeight, generateBarcode } from '../utils/rollHelpers.js';
import { generateDocumentNo } from '../utils/documentNumbers.js';
import {
  cleanNumber,
  cleanString,
  coerceNormalizedRowNumbers,
  detectColumnMap,
  normalizeRow,
  normalizeDigitsToLatin,
  type NormalizedField,
} from '../utils/importColumnDetector.js';
import { getExchangeRateToUsdTx } from '../services/exchangeRateService.js';
import { confirmPurchaseInvoice, createPurchaseInvoice } from '../services/purchaseInvoiceService.js';
import { postImportLandingCostsToGl } from '../services/glPostingService.js';
import {
  isPlaceholderColorCode,
  resolveFabricColorForImport,
} from '../utils/importColorResolver.js';
import {
  applyPurchaseImportMaterialCodes,
  buildPurchaseLineMetadataFromImport,
  ensureFabricCategoryChainFromImport,
  resolveImportMaterialCode,
} from '../utils/purchaseImportMaterialCodes.js';
import { expandChinaPackingListIfNeeded } from '../utils/chinaPackingListExpand.js';
import {
  isImportSummaryRow,
  mergeSheetTotalsMetadata,
  stripTrailingSummaryRows,
} from '../utils/importSheetMetadata.js';
import { applyImportAutoRepairs } from '../utils/importAutoRepair.js';

// ─── Zod schemas ────────────────────────────────────────────────────────────

const previewSchema = z.object({
  fileName: z.string().min(1),
  sheetName: z.string().optional(),
  fileSizeBytes: z.number().optional(),
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  defaultLocationId: z.string().uuid().nullable().optional(),
  invoiceDate: z.string().min(1),
  purchaseInvoiceNo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  currencyCode: z.string().nullable().optional(),
  exchangeRateToUsd: z.coerce.number().optional(),
  importMode: z.enum(['MATCH_ONLY', 'CREATE_MISSING_MASTER_DATA']).default('MATCH_ONLY'),
  headerRowIndex: z.number().int().min(0).optional(),
  preTableRows: z.array(z.array(z.unknown())).optional().default([]),
  extractedMetadata: z.record(z.string(), z.unknown()).optional().default({}),
  // headers[]: first row of the Excel (raw strings)
  headers: z.array(z.string()),
  // rows[][]: array of row arrays (each row is array of cell values)
  rows: z.array(z.array(z.unknown())).max(5000, 'الملف يحتوي على أكثر من 5000 صف'),
  autoRepair: z.boolean().optional().default(false),
});

const confirmSchema = z.object({
  allowWarnings: z.boolean().default(false),
  ignoreErrors: z.boolean().default(false),
});

const scanVerifySchema = z.object({
  barcode: z.string().min(1),
});

const pricingSchema = z.object({
  purchaseBaseUnitPrice: z.coerce.number().nonnegative(),
  priceUnit: z.enum(['meter', 'yard']).default('meter'),
  freightCost: z.coerce.number().nonnegative().default(0),
  customsCost: z.coerce.number().nonnegative().default(0),
  clearanceCost: z.coerce.number().nonnegative().default(0),
  internalShippingCost: z.coerce.number().nonnegative().default(0),
  otherCost: z.coerce.number().nonnegative().default(0),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface NormalizedRowData extends Partial<Record<NormalizedField, string | number | null>> {}

interface RowValidationResult {
  status: 'VALID' | 'WARNING' | 'ERROR';
  errors: string[];
  warnings: string[];
  matchedItemId: string | null;
  matchedColorId: string | null;
  matchedVariantId: string | null;
  normalizedData: NormalizedRowData;
  willCreateItem: boolean;
  willCreateColor: boolean;
  willCreateVariant: boolean;
}

function normalizeInvoiceDate(input: string): string | null {
  const s0 = normalizeDigitsToLatin(String(input || '')).trim();
  if (!s0) return null;
  const s = s0.includes('T') ? s0.split('T')[0] : s0;
  const cleaned = s.replace(/[\.\/]/g, '-').replace(/\s+/g, '');
  const m1 = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(cleaned);
  const m2 = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(cleaned);
  const yyyy = m1 ? Number(m1[1]) : m2 ? Number(m2[3]) : NaN;
  const mm = m1 ? Number(m1[2]) : m2 ? Number(m2[2]) : NaN;
  const dd = m1 ? Number(m1[3]) : m2 ? Number(m2[1]) : NaN;
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  if (yyyy < 2000 || yyyy > 2100) return null;
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const out = `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
  const dt = new Date(`${out}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  return out;
}

function generateImportCode(prefix: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${ts}-${rnd}`;
}

function detectLengthUnit(headers: string[], colMap: Map<number, NormalizedField>): 'meter' | 'yard' {
  const yardKeys = new Set(['yard', 'yards', 'yd', 'y', 'يارد', 'اليارد', 'ياردات']);
  for (const [idx, field] of colMap.entries()) {
    if (field !== 'lengthM') continue;
    const h = (headers[idx] ?? '').toString().trim().toLowerCase();
    const hNoWs = h.replace(/\s+/g, '');
    if (yardKeys.has(hNoWs) || hNoWs.includes('yard') || hNoWs.includes('يارد')) return 'yard';
  }
  return 'meter';
}

function inferColumnMapFromData(
  headers: string[],
  rows: unknown[][],
  existing: Map<number, NormalizedField>,
): Map<number, NormalizedField> {
  const out = new Map(existing);
  const usedFields = new Set<NormalizedField>(Array.from(out.values()));
  const ensure = (idx: number | null, field: NormalizedField) => {
    if (idx == null) return;
    if (idx < 0) return;
    if (usedFields.has(field)) return;
    if (Array.from(out.values()).includes(field)) return;
    out.set(idx, field);
    usedFields.add(field);
  };

  const maxCols = Math.max(
    headers.length,
    ...rows.map(r => (Array.isArray(r) ? r.length : 0)),
  );
  if (!Number.isFinite(maxCols) || maxCols <= 0) return out;

  const sample = rows.slice(0, 120).filter(r => Array.isArray(r));

  const colStats = Array.from({ length: maxCols }, (_, idx) => {
    const vals = sample
      .map(r => (r as unknown[])[idx])
      .filter(v => v !== null && v !== undefined && String(v).trim() !== '');
    const sVals = vals.map(v => String(v).trim());
    const nonEmpty = sVals.length;
    const numericCount = sVals.filter(v => cleanNumber(v) != null).length;
    const digitOnlyCount = sVals.filter(v => /^\d{6,20}$/.test(normalizeDigitsToLatin(v))).length;
    const uniq = new Set(sVals.map(v => normalizeDigitsToLatin(v)));
    const uniqRatio = nonEmpty ? uniq.size / nonEmpty : 0;
    const numericRatio = nonEmpty ? numericCount / nonEmpty : 0;
    const digitOnlyRatio = nonEmpty ? digitOnlyCount / nonEmpty : 0;
    const avgNum = (() => {
      const nums = sVals.map(v => cleanNumber(v)).filter((n): n is number => n != null);
      if (!nums.length) return NaN;
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    })();
    const codeLikeCount = sVals.filter(v => /[A-Z]{1,6}[-_ ]?\d+/i.test(v) || /[-_]/.test(v)).length;
    const codeLikeRatio = nonEmpty ? codeLikeCount / nonEmpty : 0;
    const textRatio = nonEmpty ? (nonEmpty - numericCount) / nonEmpty : 0;
    return {
      idx,
      nonEmpty,
      uniqRatio,
      numericRatio,
      digitOnlyRatio,
      avgNum,
      codeLikeRatio,
      textRatio,
    };
  }).filter(s => s.nonEmpty > 0);

  const hasAnyKeyField =
    Array.from(out.values()).includes('barcode') ||
    Array.from(out.values()).includes('lengthM') ||
    Array.from(out.values()).includes('materialName') ||
    Array.from(out.values()).includes('supplierMaterialCode') ||
    Array.from(out.values()).includes('internalMaterialCode');

  if (hasAnyKeyField) return out;

  const sortedByBarcode = [...colStats].sort((a, b) => {
    const sa = a.digitOnlyRatio * a.uniqRatio;
    const sb = b.digitOnlyRatio * b.uniqRatio;
    return sb - sa;
  });
  const barcodeIdx = sortedByBarcode[0]?.digitOnlyRatio >= 0.7 ? sortedByBarcode[0].idx : null;

  const sortedByLength = [...colStats]
    .filter(s => s.idx !== barcodeIdx)
    .sort((a, b) => {
      const sa = a.numericRatio * (Number.isFinite(a.avgNum) && a.avgNum > 0 ? 1 : 0);
      const sb = b.numericRatio * (Number.isFinite(b.avgNum) && b.avgNum > 0 ? 1 : 0);
      return sb - sa;
    });
  const lengthIdx =
    sortedByLength[0] && sortedByLength[0].numericRatio >= 0.7
      ? sortedByLength[0].idx
      : null;

  if (maxCols === 5 && barcodeIdx === 0 && lengthIdx === 4) {
    ensure(0, 'barcode');
    ensure(1, 'materialName');
    ensure(2, 'supplierMaterialCode');
    ensure(3, 'colorNameTr');
    ensure(4, 'lengthM');
    return out;
  }

  ensure(barcodeIdx, 'barcode');
  ensure(lengthIdx, 'lengthM');

  const remaining = colStats
    .filter(s => s.idx !== barcodeIdx && s.idx !== lengthIdx)
    .sort((a, b) => b.textRatio - a.textRatio);

  const matIdx = remaining[0]?.textRatio >= 0.6 ? remaining[0].idx : null;
  ensure(matIdx, 'materialName');

  const codeIdx = colStats
    .filter(s => s.idx !== barcodeIdx && s.idx !== lengthIdx && s.idx !== matIdx)
    .sort((a, b) => b.codeLikeRatio - a.codeLikeRatio)[0];
  ensure(codeIdx?.codeLikeRatio >= 0.4 ? codeIdx.idx : null, 'supplierMaterialCode');

  const colorIdx = colStats
    .filter(s => s.idx !== barcodeIdx && s.idx !== lengthIdx && s.idx !== matIdx && s.idx !== codeIdx?.idx)
    .sort((a, b) => b.textRatio - a.textRatio)[0];
  ensure(colorIdx?.textRatio >= 0.5 ? colorIdx.idx : null, 'colorNameTr');

  return out;
}

async function validateAndMatchRow(
  nd: NormalizedRowData,
  companyId: string,
  warehouseId: string,
  defaultLocationId: string | null,
  supplierId: string | null,
  importMode: string,
  barcodesInFile: Set<string>,
  pool: import('pg').Pool,
): Promise<RowValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let matchedItemId: string | null = null;
  let matchedColorId: string | null = null;
  let matchedVariantId: string | null = null;
  let willCreateItem = false;
  let willCreateColor = false;
  let willCreateVariant = false;

  // ── Item matching ──────────────────────────────────────────────────────────
  const matName = cleanString(nd.materialName);
  const intCode = cleanString(nd.internalMaterialCode);
  const supCode = cleanString(nd.supplierMaterialCode);

  if (!matName && !intCode && !supCode) {
    errors.push('اسم الخامة أو كودها مطلوب.');
  } else {
    // Try matching by priority
    let itemRow: { id: string } | null = null;

    if (intCode) {
      const r = await pool.query<{ id: string }>(
        `SELECT id FROM fabric_items WHERE company_id=$1 AND lower(trim(internal_code))=lower(trim($2)) AND is_active=true LIMIT 1`,
        [companyId, intCode],
      );
      if (r.rows.length) itemRow = r.rows[0];
    }
    if (!itemRow && supCode) {
      const r = await pool.query<{ id: string }>(
        `SELECT id FROM fabric_items WHERE company_id=$1 AND lower(trim(supplier_code))=lower(trim($2)) AND is_active=true LIMIT 1`,
        [companyId, supCode],
      );
      if (r.rows.length) itemRow = r.rows[0];
    }
    if (!itemRow && matName) {
      const r = await pool.query<{ id: string }>(
        `SELECT id FROM fabric_items WHERE company_id=$1 AND lower(trim(name))=lower(trim($2)) AND is_active=true LIMIT 1`,
        [companyId, matName],
      );
      if (r.rows.length) itemRow = r.rows[0];
    }

    if (itemRow) {
      matchedItemId = itemRow.id;
    } else if (importMode === 'CREATE_MISSING_MASTER_DATA' && matName) {
      willCreateItem = true;
      warnings.push(`سيتم إنشاء خامة جديدة: "${matName}"`);
    } else {
      if (importMode === 'MATCH_ONLY') {
        errors.push(`الخامة "${matName || intCode || supCode}" غير موجودة في النظام.`);
      } else {
        errors.push('اسم الخامة مطلوب لإنشاء خامة جديدة.');
      }
    }
  }

  // ── Color matching ────────────────────────────────────────────────────────
  const colorCode = cleanString(nd.colorCode);
  const supColorCode = cleanString(nd.supplierColorCode);
  const colorNameAr = cleanString(nd.colorName);
  const colorNameTr = cleanString(nd.colorNameTr);

  if (colorCode || supColorCode || colorNameAr || colorNameTr) {
    let colorRow: { id: string } | null = null;

    if (colorCode && !isPlaceholderColorCode(colorCode)) {
      const r = await pool.query<{ id: string }>(
        `SELECT id FROM fabric_colors WHERE lower(trim(color_code))=lower(trim($1)) AND (company_id=$2 OR company_id IS NULL) AND is_active=true LIMIT 1`,
        [colorCode, companyId],
      );
      if (r.rows.length) colorRow = r.rows[0];
    }
    if (!colorRow && supColorCode) {
      const r = await pool.query<{ id: string }>(
        `SELECT id FROM fabric_colors WHERE lower(trim(supplier_color_code))=lower(trim($1)) AND (company_id=$2 OR company_id IS NULL) AND is_active=true LIMIT 1`,
        [supColorCode, companyId],
      );
      if (r.rows.length) colorRow = r.rows[0];
    }
    if (!colorRow && colorNameAr) {
      const r = await pool.query<{ id: string }>(
        `SELECT id FROM fabric_colors WHERE lower(trim(name_ar))=lower(trim($1)) AND (company_id=$2 OR company_id IS NULL) AND is_active=true LIMIT 1`,
        [colorNameAr, companyId],
      );
      if (r.rows.length) colorRow = r.rows[0];
    }
    if (!colorRow && colorNameTr) {
      const r = await pool.query<{ id: string }>(
        `SELECT id FROM fabric_colors WHERE lower(trim(name_tr))=lower(trim($1)) AND (company_id=$2 OR company_id IS NULL) AND is_active=true LIMIT 1`,
        [colorNameTr, companyId],
      );
      if (r.rows.length) colorRow = r.rows[0];
    }

    if (colorRow) {
      matchedColorId = colorRow.id;
    } else if (importMode === 'CREATE_MISSING_MASTER_DATA') {
      willCreateColor = true;
      warnings.push(`سيتم إنشاء لون جديد: "${colorNameAr || colorCode || colorNameTr}"`);
    } else {
      warnings.push(`اللون "${colorNameAr || colorCode || colorNameTr}" غير موجود — سيُستورد بدون لون.`);
    }
  } else {
    warnings.push('لم يتم تحديد اللون — سيُستورد بدون لون.');
  }

  // ── Variant matching ─────────────────────────────────────────────────────
  if (matchedItemId && matchedColorId) {
    const widthForVariant = cleanNumber(nd.widthCm);
    const gsmForVariant = cleanNumber(nd.gsm);

    if (widthForVariant && gsmForVariant) {
      const r = await pool.query<{ id: string }>(
        `SELECT id FROM fabric_item_variants
         WHERE item_id=$1 AND color_id=$2
           AND company_id=$3
           AND ABS(COALESCE(width_cm,0)-$4)<0.1
           AND ABS(COALESCE(gsm,0)-$5)<0.5
           AND is_active=true
         LIMIT 1`,
        [matchedItemId, matchedColorId, companyId, widthForVariant, gsmForVariant],
      );
      if (r.rows.length) {
        matchedVariantId = r.rows[0].id;
      } else if (importMode === 'CREATE_MISSING_MASTER_DATA') {
        willCreateVariant = true;
        warnings.push(`سيتم إنشاء متغير جديد (عرض ${widthForVariant} سم، GSM ${gsmForVariant}).`);
      }
    }
  }

  // ── Numeric validations ──────────────────────────────────────────────────
  const lengthM = cleanNumber(nd.lengthM);
  if (nd.lengthM !== undefined && nd.lengthM !== null) {
    if (lengthM === null) {
      errors.push('الطول غير صالح — يجب أن يكون رقماً موجباً أو صفراً.');
    } else if (lengthM < 0) {
      errors.push('الطول يجب أن يكون صفراً أو أكبر.');
    }
  } else {
    warnings.push('الطول غير محدد — سيُسجَّل بصفر.');
  }

  const widthCm = cleanNumber(nd.widthCm);
  if (nd.widthCm !== null && nd.widthCm !== undefined && nd.widthCm !== '') {
    if (widthCm === null || widthCm <= 0) {
      errors.push('العرض غير صالح — يجب أن يكون أكبر من صفر.');
    }
  }

  const gsm = cleanNumber(nd.gsm);
  if (nd.gsm !== null && nd.gsm !== undefined && nd.gsm !== '') {
    if (gsm === null || gsm <= 0) {
      errors.push('GSM غير صالح — يجب أن يكون أكبر من صفر.');
    }
  }

  const actualWeight = cleanNumber(nd.actualWeightKg);
  if (nd.actualWeightKg !== null && nd.actualWeightKg !== undefined && nd.actualWeightKg !== '') {
    if (actualWeight === null || actualWeight < 0) {
      errors.push('الوزن الفعلي غير صالح — يجب أن يكون صفراً أو أكبر.');
    }
  }

  // ── Weight variance warning ───────────────────────────────────────────────
  const calcWt = calcWeight(lengthM, widthCm, gsm);
  if (calcWt !== null && actualWeight !== null && actualWeight > 0) {
    const variance = Math.abs(actualWeight - calcWt) / calcWt * 100;
    if (variance > 10) {
      warnings.push(`فرق الوزن الفعلي عن المحسوب أكبر من 10% (فعلي: ${actualWeight.toFixed(2)} كجم، محسوب: ${calcWt.toFixed(2)} كجم).`);
    }
  }
  if (calcWt !== null && (!actualWeight)) {
    warnings.push(`الوزن المحسوب: ${calcWt.toFixed(3)} كجم.`);
  }

  // ── Barcode validations ───────────────────────────────────────────────────
  const barcode = cleanString(nd.barcode);
  if (!barcode) {
    warnings.push('لا يوجد باركود — سيُولَّد تلقائياً عند التأكيد.');
  } else {
    // Check duplicate within file
    if (barcodesInFile.has(barcode)) {
      errors.push(`باركود مكرر داخل الملف: ${barcode}`);
    } else {
      barcodesInFile.add(barcode);
      // Check duplicate in DB
      const dbCheck = await pool.query<{ id: string }>(
        'SELECT id FROM fabric_rolls WHERE company_id=$1 AND barcode=$2',
        [companyId, barcode],
      );
      if (dbCheck.rows.length) {
        errors.push(`باركود موجود مسبقاً في قاعدة البيانات: ${barcode}`);
      }
    }
  }

  // ── Missing optional fields (warnings only) ───────────────────────────────
  if (!cleanString(nd.rollNo)) warnings.push('رقم الثوب غير محدد.');
  if (!cleanString(nd.containerNo)) warnings.push('رقم الحاوية غير محدد.');

  const hasErrors = errors.length > 0;
  const status: RowValidationResult['status'] = hasErrors ? 'ERROR' : warnings.length > 0 ? 'WARNING' : 'VALID';

  return { status, errors, warnings, matchedItemId, matchedColorId, matchedVariantId, normalizedData: nd, willCreateItem, willCreateColor, willCreateVariant };
}

function inferFabricFamilyFromFileName(fileName: string): string {
  const upper = String(fileName || '').toUpperCase();
  if (upper.includes('DENIM') || upper.includes('جينز')) return 'DENIM';
  if (upper.includes('COTTON') || upper.includes('قطن')) return 'COTTON';
  if (upper.includes('LINEN') || upper.includes('كتان')) return 'LINEN';
  return 'مستورد';
}

function extractRepairMetadata(
  metadata: Record<string, unknown>,
  fileName?: string,
): { fileMaterialName?: string; fileDesignCode?: string; fileWidthCmAvg?: number } {
  const fabricFamily =
    cleanString(metadata.fabricFamily) ||
    (fileName ? inferFabricFamilyFromFileName(fileName) : '') ||
    undefined;
  const designCode = cleanString(metadata.materialName);
  const widthCmAvg = Number(metadata.widthCmAvg);
  return {
    fileMaterialName: fabricFamily || designCode,
    fileDesignCode: designCode || undefined,
    fileWidthCmAvg: Number.isFinite(widthCmAvg) && widthCmAvg > 0 ? widthCmAvg : undefined,
  };
}

function applyChinaImportMetadata(
  nd: NormalizedRowData,
  metadata: Record<string, unknown>,
  fileName?: string,
): void {
  /** من رأس الملف: Amelia-19 = كود التصميم (المستوى 2) */
  const designCode = cleanString(metadata.materialName);
  /** من اسم الملف أو افتراضي: DENIM = اسم الخامة (المستوى 1) */
  const fabricFamily =
    cleanString(metadata.fabricFamily) ||
    (fileName ? inferFabricFamilyFromFileName(fileName) : '') ||
    'مستورد';

  (nd as Record<string, unknown>).materialName = fabricFamily;
  if (designCode) {
    (nd as Record<string, unknown>).supplierMaterialCode = designCode;
    (nd as Record<string, unknown>).internalMaterialCode = designCode;
  }
  const widthAvg = Number(metadata.widthCmAvg);
  if (Number.isFinite(widthAvg) && widthAvg > 0 && cleanNumber(nd.widthCm) == null) {
    (nd as Record<string, unknown>).widthCm = widthAvg;
  }
  const lot = cleanString(nd.batchNo);
  if (lot && !cleanString(nd.colorNameTr) && /^[A-Z]$/i.test(lot)) {
    (nd as Record<string, unknown>).colorNameTr = `LOT-${lot.toUpperCase()}`;
    (nd as Record<string, unknown>).colorCode = lot.toUpperCase();
  }
}

function importAmountToUsd(amount: number, currencyCode: string, exchangeRateToUsd: number): number {
  const ccy = String(currencyCode || 'USD').trim().toUpperCase();
  const rate = ccy === 'USD' ? 1 : exchangeRateToUsd;
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round((amount / rate) * 100) / 100;
}

function parseJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return value.trim() ? [value] : [];
    }
  }
  return [];
}

type ImportRowIssueDetail = {
  rowNo: number;
  rollNo: string | null;
  barcode: string | null;
  lengthM: number | null;
  errors: string[];
  warnings: string[];
};

async function fetchImportRowIssues(
  pool: ReturnType<typeof getPool>,
  batchId: string,
  companyId: string,
  status: 'ERROR' | 'WARNING',
  limit = 40,
): Promise<ImportRowIssueDetail[]> {
  const r = await pool.query<{
    row_no: number;
    errors: unknown;
    warnings: unknown;
    normalized_data: NormalizedRowData;
  }>(
    `SELECT row_no, errors, warnings, normalized_data
     FROM purchase_import_rows
     WHERE batch_id=$1 AND company_id=$2 AND status=$3
     ORDER BY row_no ASC
     LIMIT $4`,
    [batchId, companyId, status, limit],
  );
  return r.rows.map((row) => ({
    rowNo: row.row_no,
    rollNo: cleanString(row.normalized_data?.rollNo) || cleanString(row.normalized_data?.supplierRollRef),
    barcode: cleanString(row.normalized_data?.barcode),
    lengthM: cleanNumber(row.normalized_data?.lengthM),
    errors: parseJsonStringArray(row.errors),
    warnings: parseJsonStringArray(row.warnings),
  }));
}

function buildImportIssuesMessage(
  totalCount: number,
  kind: 'أخطاء' | 'تحذيرات',
  samples: ImportRowIssueDetail[],
): string {
  const head = `يوجد ${totalCount} صف${totalCount === 1 ? '' : 'وف'} بها ${kind}.`;
  const examples = samples
    .slice(0, 10)
    .map((s) => {
      const id = s.rollNo || s.barcode || '—';
      const msgs = kind === 'أخطاء' ? s.errors : s.warnings;
      return `سطر ${s.rowNo} (${id}): ${msgs.join(' — ')}`;
    })
    .join(' | ');
  return examples ? `${head} ${examples}` : head;
}

type BatchRepairResult = {
  validCount: number;
  warnCount: number;
  errorCount: number;
  repairedRows: number;
  repairSummary: string[];
  totalLengthM: number;
  totalActualWt: number;
  totalCalcWt: number;
  verificationTotal: number;
};

async function repairAndRevalidateImportBatch(
  pool: import('pg').Pool,
  batch: {
    id: string;
    company_id: string;
    supplier_id: string;
    warehouse_id: string;
    default_location_id: string | null;
    import_mode: string;
    file_name: string;
    extracted_metadata: unknown;
  },
): Promise<BatchRepairResult> {
  const meta =
    typeof batch.extracted_metadata === 'object' && batch.extracted_metadata
      ? (batch.extracted_metadata as Record<string, unknown>)
      : {};
  const repairMeta = extractRepairMetadata(meta, batch.file_name);

  const rowsResult = await pool.query<{
    id: string;
    row_no: number;
    normalized_data: NormalizedRowData;
  }>(
    `SELECT id, row_no, normalized_data
     FROM purchase_import_rows
     WHERE batch_id=$1 AND company_id=$2
     ORDER BY row_no ASC`,
    [batch.id, batch.company_id],
  );

  const barcodesInFile = new Set<string>();
  let repairedRows = 0;
  const repairSummary: string[] = [];
  const updates: Array<{
    id: string;
    nd: NormalizedRowData;
    result: RowValidationResult;
  }> = [];

  for (const row of rowsResult.rows) {
    let nd = (row.normalized_data ?? {}) as NormalizedRowData;
    const { nd: repairedNd, notes } = await applyImportAutoRepairs(nd, {
      rowNo: row.row_no,
      companyId: batch.company_id,
      batchId: batch.id,
      ...repairMeta,
      barcodesInFile,
      pool,
    });
    nd = repairedNd;
    if (notes.length) {
      repairedRows++;
      for (const n of notes) {
        const msg = `سطر ${row.row_no}: ${n.message}`;
        if (repairSummary.length < 40) repairSummary.push(msg);
      }
    }

    const result = await validateAndMatchRow(
      nd,
      batch.company_id,
      batch.warehouse_id,
      batch.default_location_id,
      batch.supplier_id,
      batch.import_mode,
      barcodesInFile,
      pool,
    );
    if (notes.length) {
      result.warnings.push(...notes.map((n) => `[إصلاح تلقائي] ${n.message}`));
      if (result.status === 'VALID' && notes.length) result.status = 'WARNING';
    }
    updates.push({ id: row.id, nd, result });
  }

  const validCount = updates.filter((u) => u.result.status === 'VALID').length;
  const warnCount = updates.filter((u) => u.result.status === 'WARNING').length;
  const errorCount = updates.filter((u) => u.result.status === 'ERROR').length;
  const totalLengthM = updates.reduce((s, u) => s + (cleanNumber(u.nd.lengthM) ?? 0), 0);
  const totalActualWt = updates.reduce((s, u) => s + (cleanNumber(u.nd.actualWeightKg) ?? 0), 0);
  const totalCalcWt = updates.reduce((s, u) => {
    const lm = cleanNumber(u.nd.lengthM);
    const wc = cleanNumber(u.nd.widthCm);
    const gs = cleanNumber(u.nd.gsm);
    return s + (calcWeight(lm, wc, gs) ?? 0);
  }, 0);
  const verificationTotal = updates.filter(
    (u) => u.result.status !== 'ERROR' && !!cleanString(u.nd.barcode),
  ).length;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { id, nd, result } of updates) {
      await client.query(
        `UPDATE purchase_import_rows
         SET normalized_data=$1, status=$2, errors=$3, warnings=$4,
             matched_item_id=$5, matched_color_id=$6, matched_variant_id=$7
         WHERE id=$8 AND company_id=$9`,
        [
          JSON.stringify(nd),
          result.status,
          JSON.stringify(result.errors),
          JSON.stringify(result.warnings),
          result.matchedItemId,
          result.matchedColorId,
          result.matchedVariantId,
          id,
          batch.company_id,
        ],
      );
    }
    await client.query(
      `UPDATE purchase_import_batches
       SET valid_count=$1, warning_count=$2, error_count=$3,
           total_length_m=$4, total_actual_weight_kg=$5, total_calculated_weight_kg=$6
       WHERE id=$7 AND company_id=$8`,
      [
        validCount,
        warnCount,
        errorCount,
        totalLengthM,
        totalActualWt,
        totalCalcWt,
        batch.id,
        batch.company_id,
      ],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return {
    validCount,
    warnCount,
    errorCount,
    repairedRows,
    repairSummary,
    totalLengthM,
    totalActualWt,
    totalCalcWt,
    verificationTotal,
  };
}

async function resolveImportRollBarcode(
  client: import('pg').PoolClient,
  companyId: string,
  nd: NormalizedRowData,
): Promise<string> {
  const serial =
    cleanString(nd.barcode) ||
    cleanString(nd.supplierRollRef) ||
    cleanString(nd.rollNo);
  if (serial) {
    const dup = await client.query<{ id: string }>(
      `SELECT id FROM fabric_rolls WHERE company_id=$1 AND barcode=$2 LIMIT 1`,
      [companyId, serial],
    );
    if (!dup.rows.length) return serial;
  }
  return generateBarcode(client, companyId);
}

function buildLandingCostNotes(
  baseUnitPrice: number,
  extras: {
    freight: number;
    customs: number;
    clearance: number;
    internalShipping: number;
    other: number;
  },
  finalUnitCost: number,
  totalLengthM: number,
): string {
  const extraTotal =
    extras.freight + extras.customs + extras.clearance + extras.internalShipping + extras.other;
  return [
    'استيراد قائمة تعبئة صينية',
    `سعر الشراء: ${baseUnitPrice.toFixed(4)} /م`,
    `شحن: ${extras.freight.toFixed(2)} | جمارك: ${extras.customs.toFixed(2)} | تخليص: ${extras.clearance.toFixed(2)}`,
    `شحن داخلي: ${extras.internalShipping.toFixed(2)} | أجور أخرى: ${extras.other.toFixed(2)}`,
    `تكاليف إضافية: ${extraTotal.toFixed(2)} على ${totalLengthM.toFixed(2)} م`,
    `تكلفة نهائية: ${finalUnitCost.toFixed(4)} /م`,
  ].join(' | ');
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const purchaseImportRoutes: FastifyPluginAsync = async (app) => {

  // ── A. Preview upload ─────────────────────────────────────────────────────
  app.post('/preview', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? ArabicErrors.validation;
      return sendError(reply, 400, msg, 'VALIDATION');
    }
    const {
      fileName,
      sheetName,
      fileSizeBytes,
      supplierId,
      warehouseId,
      defaultLocationId,
      invoiceDate,
      purchaseInvoiceNo,
      notes,
      currencyCode,
      exchangeRateToUsd: exchangeRateToUsdInput,
      importMode,
      headerRowIndex,
      preTableRows,
      extractedMetadata,
      headers,
      rows,
      autoRepair,
    } = parsed.data;

    const pool = getPool();

    // Validate warehouse
    const whCheck = await pool.query('SELECT id FROM warehouses WHERE id=$1 AND company_id=$2', [warehouseId, companyId]);
    if (!whCheck.rows.length) return sendError(reply, 404, 'المستودع غير موجود', 'NOT_FOUND');

    const sc = await pool.query('SELECT id FROM suppliers WHERE id=$1 AND company_id=$2', [supplierId, companyId]);
    if (!sc.rows.length) return sendError(reply, 404, 'المورد غير موجود', 'NOT_FOUND');

    const invNoTrim = normalizeDigitsToLatin(purchaseInvoiceNo?.trim() || '');
    if (invNoTrim) {
      const dupInv = await pool.query(
        `SELECT id FROM purchase_invoices WHERE company_id=$1 AND invoice_no=$2 LIMIT 1`,
        [companyId, invNoTrim],
      );
      if (dupInv.rows.length) return sendError(reply, 409, 'رقم فاتورة مشتريات مكرر', 'DUPLICATE');
    }

    const invoiceDateNorm = normalizeInvoiceDate(invoiceDate);
    if (!invoiceDateNorm) return sendError(reply, 400, 'تاريخ الفاتورة غير صالح', 'VALIDATION');

    // Validate location
    if (defaultLocationId) {
      const lc = await pool.query('SELECT id FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2', [defaultLocationId, warehouseId]);
      if (!lc.rows.length) return sendError(reply, 400, 'الموقع لا يتبع المستودع المحدد', 'VALIDATION');
    }

    const ccy = String(currencyCode || 'USD').trim().toUpperCase();
    let exchangeRateToUsd = exchangeRateToUsdInput != null ? Number(exchangeRateToUsdInput) : NaN;
    if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
      if (ccy === 'USD') {
        exchangeRateToUsd = 1;
      } else {
        const fromDb = await getExchangeRateToUsdTx(pool, companyId, ccy);
        exchangeRateToUsd = fromDb ?? NaN;
      }
    }
    if (ccy === 'USD') exchangeRateToUsd = 1;
    if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
      return sendError(reply, 400, 'لا يمكن تنفيذ العملية بدون سعر صرف', 'VALIDATION');
    }

    // توسيع قوائم التعبئة الصينية (أعمدة متوازية ROLL | LENGTH | LOT)
    const sheetTotals = mergeSheetTotalsMetadata(preTableRows as unknown[][], rows as unknown[][]);
    const mergedExtractedMetadata = {
      ...(extractedMetadata as Record<string, unknown>),
      ...sheetTotals,
      declaredTotalLength:
        sheetTotals.declaredTotalLength ??
        (extractedMetadata as { declaredTotalLength?: number }).declaredTotalLength,
      declaredRollCount:
        sheetTotals.declaredRollCount ??
        (extractedMetadata as { declaredRollCount?: number }).declaredRollCount,
      declaredLengthUnit:
        sheetTotals.declaredLengthUnit ??
        (extractedMetadata as { declaredLengthUnit?: string }).declaredLengthUnit,
    };

    let workHeaders = headers;
    let workRows = stripTrailingSummaryRows(rows as unknown[][]);
    let chinaSourceType: string | null = null;
    const chinaExpanded = expandChinaPackingListIfNeeded(headers, workRows, mergedExtractedMetadata);
    if (chinaExpanded) {
      workHeaders = chinaExpanded.headers;
      workRows = chinaExpanded.rows;
      chinaSourceType = chinaExpanded.sourceType;
    }

    // Detect columns
    let colMap = detectColumnMap(workHeaders);
    colMap = inferColumnMapFromData(workHeaders, workRows, colMap);
    const lengthUnit = detectLengthUnit(workHeaders, colMap);

    // Validate and collect rows
    const barcodesInFile = new Set<string>();
    const rowResults: {
      rowNo: number;
      rawData: Record<string, unknown>;
      nd: NormalizedRowData;
      result: RowValidationResult;
    }[] = [];

    const repairMeta = extractRepairMetadata(mergedExtractedMetadata as Record<string, unknown>, fileName);
    let autoRepairedRows = 0;

    for (let i = 0; i < workRows.length; i++) {
      const rawRow = workRows[i];
      // Skip completely empty rows
      const nonEmpty = rawRow.filter(v => v !== null && v !== undefined && String(v).trim() !== '');
      if (nonEmpty.length === 0) continue;
      if (isImportSummaryRow(rawRow)) continue;

      const rawData: Record<string, unknown> = {};
      workHeaders.forEach((h, idx) => { rawData[h] = rawRow[idx]; });

      const nd = normalizeRow(rawRow, colMap);
      coerceNormalizedRowNumbers(nd);
      if (chinaSourceType && cleanString((nd as any).rollNo) && !cleanString((nd as any).supplierRollRef)) {
        (nd as any).supplierRollRef = cleanString((nd as any).rollNo);
      }
      const rollSerial = cleanString((nd as any).rollNo) || cleanString((nd as any).supplierRollRef);
      if (rollSerial && !cleanString((nd as any).barcode)) {
        (nd as any).barcode = rollSerial;
      }
      if (!cleanString((nd as any).barcode)) {
        const v0 = rawRow[0];
        const b0 = cleanString(v0);
        if (b0 && /^\d{6,20}$/.test(b0) && !chinaSourceType) (nd as any).barcode = b0;
      }
      if (lengthUnit === 'yard') {
        const y = cleanNumber((nd as any).lengthM);
        if (y != null) (nd as any).lengthM = Math.round(y * 0.9144 * 1000) / 1000;
      }
      if (chinaSourceType) {
        applyChinaImportMetadata(nd, mergedExtractedMetadata as Record<string, unknown>, fileName);
      }

      let repairNotes: string[] = [];
      if (autoRepair) {
        const repaired = await applyImportAutoRepairs(nd, {
          rowNo: i + 2,
          companyId,
          batchId: 'preview',
          ...repairMeta,
          barcodesInFile,
          pool,
        });
        Object.assign(nd, repaired.nd);
        if (repaired.notes.length) {
          autoRepairedRows++;
          repairNotes = repaired.notes.map((n) => n.message);
        }
      }

      const result = await validateAndMatchRow(
        nd, companyId, warehouseId, defaultLocationId ?? null,
        supplierId ?? null, importMode, barcodesInFile, pool,
      );
      if (repairNotes.length && result.status !== 'ERROR') {
        result.warnings.push(...repairNotes.map((m) => `[إصلاح تلقائي] ${m}`));
        if (result.status === 'VALID') result.status = 'WARNING';
      }
      rowResults.push({ rowNo: i + 2, rawData, nd, result });  // +2 because row 1 is header
    }

    const validCount   = rowResults.filter(r => r.result.status === 'VALID').length;
    const warnCount    = rowResults.filter(r => r.result.status === 'WARNING').length;
    const errorCount   = rowResults.filter(r => r.result.status === 'ERROR').length;
    const totalLengthM = rowResults.reduce((s, r) => s + (cleanNumber(r.nd.lengthM) ?? 0), 0);
    const totalLengthYard = totalLengthM / 0.9144;
    const subtotalAmount = rowResults.reduce((s, r) => {
      const lm = cleanNumber(r.nd.lengthM) ?? 0;
      const uc = cleanNumber(r.nd.unitCost) ?? 0;
      return s + lm * uc;
    }, 0);
    const verificationTotal = rowResults.filter(r => r.result.status !== 'ERROR' && !!cleanString(r.nd.barcode)).length;
    const distinctMaterialsCount = new Set(
      rowResults
        .map((r) => cleanString(r.nd.internalMaterialCode) || cleanString(r.nd.supplierMaterialCode) || cleanString(r.nd.materialName))
        .filter(Boolean),
    ).size;
    const distinctColorsCount = new Set(
      rowResults
        .map((r) => cleanString(r.nd.colorCode) || cleanString(r.nd.colorName) || cleanString(r.nd.colorNameTr))
        .filter(Boolean),
    ).size;
    const totalActualWt = rowResults.reduce((s, r) => s + (cleanNumber(r.nd.actualWeightKg) ?? 0), 0);
    const totalCalcWt = rowResults.reduce((s, r) => {
      const lm = cleanNumber(r.nd.lengthM);
      const wc = cleanNumber(r.nd.widthCm);
      const gs = cleanNumber(r.nd.gsm);
      return s + (calcWeight(lm, wc, gs) ?? 0);
    }, 0);
    const metadataWarnings: string[] = [];
    const declaredRollCount = Number((mergedExtractedMetadata as { declaredRollCount?: unknown }).declaredRollCount);
    const totalsSource = String((mergedExtractedMetadata as { totalsSource?: string }).totalsSource || 'header');
    const totalsLabel = totalsSource === 'footer' ? 'نهاية الملف' : 'رأس الملف';
    if (Number.isFinite(declaredRollCount) && declaredRollCount !== rowResults.length) {
      metadataWarnings.push(`عدد الأتواب في ${totalsLabel} ${declaredRollCount}، بينما عدد الصفوف المقروءة ${rowResults.length}`);
    }
    const declaredTotalLength = Number((mergedExtractedMetadata as { declaredTotalLength?: unknown }).declaredTotalLength);
    if (Number.isFinite(declaredTotalLength) && Math.abs(declaredTotalLength - totalLengthM) > 0.5) {
      metadataWarnings.push(`إجمالي الأطوال في ${totalsLabel} ${declaredTotalLength}، بينما مجموع الصفوف ${parseFloat(totalLengthM.toFixed(3))}`);
    }
    const batchMetadata = {
      ...mergedExtractedMetadata,
      fabricFamily: inferFabricFamilyFromFileName(fileName),
      headerRowIndex: headerRowIndex ?? 0,
      preTableRows,
      warnings: metadataWarnings,
      sourceType: chinaSourceType ?? 'PURCHASE_INVOICE',
      chinaPackingExpanded: Boolean(chinaSourceType),
    };
    const detectedColumns = Array.from(colMap.entries()).map(([idx, field]) => ({ col: workHeaders[idx], field }));
    const batchSourceType = chinaSourceType ?? 'PURCHASE_INVOICE';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const batchRow = await client.query(
        `INSERT INTO purchase_import_batches
           (company_id, supplier_id, warehouse_id, default_location_id,
            source_type, file_name, file_size_bytes, sheet_name, status,
            row_count, valid_count, warning_count, error_count,
            total_length_m, total_actual_weight_kg, total_calculated_weight_kg,
            invoice_no, supplier_invoice_no, invoice_date, currency_code, exchange_rate_to_usd, notes,
            import_mode, extracted_metadata, detected_columns, created_by_user_id)
         VALUES ($1,$2,$3,$4,$25,$5,$6,$7,'PREVIEWED',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         RETURNING *`,
        [
          companyId, supplierId, warehouseId, defaultLocationId ?? null,
          fileName, fileSizeBytes ?? null, sheetName ?? null,
          rowResults.length, validCount, warnCount, errorCount,
          totalLengthM, totalActualWt, totalCalcWt,
          (invNoTrim ? invNoTrim : null),
          (invNoTrim ? invNoTrim : null),
          invoiceDateNorm,
          ccy,
          exchangeRateToUsd,
          notes?.trim() || null,
          importMode,
          JSON.stringify(batchMetadata),
          JSON.stringify(detectedColumns),
          userId,
          batchSourceType,
        ],
      );
      const batch = batchRow.rows[0];

      // Insert row records
      for (const { rowNo, rawData, nd, result } of rowResults) {
        await client.query(
          `INSERT INTO purchase_import_rows
             (company_id, batch_id, row_no, raw_data, normalized_data,
              status, errors, warnings,
              matched_item_id, matched_color_id, matched_variant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            companyId, batch.id, rowNo,
            JSON.stringify(rawData), JSON.stringify(nd),
            result.status, JSON.stringify(result.errors), JSON.stringify(result.warnings),
            result.matchedItemId, result.matchedColorId, result.matchedVariantId,
          ],
        );
      }

      await client.query('COMMIT');

      return reply.status(201).send({
        ok: true,
        data: {
          batchId: batch.id,
          fileName, sheetName, importMode,
          invoiceDate: invoiceDateNorm,
          purchaseInvoiceNo: (invNoTrim ? invNoTrim : null),
          currencyCode: ccy,
          exchangeRateToUsd,
          rowCount: rowResults.length,
          validCount, warnCount, errorCount,
          totalLengthM: parseFloat(totalLengthM.toFixed(3)),
          totalLengthYard: parseFloat(totalLengthYard.toFixed(3)),
          lengthUnit,
          distinctMaterialsCount,
          distinctColorsCount,
          subtotalAmount: parseFloat(subtotalAmount.toFixed(2)),
          totalActualWeightKg: parseFloat(totalActualWt.toFixed(3)),
          totalCalculatedWeightKg: parseFloat(totalCalcWt.toFixed(3)),
          verificationTotal,
          verificationVerified: 0,
          detectedColumns,
          extractedMetadata: batchMetadata,
          metadataWarnings,
          autoRepairedRows: autoRepair ? autoRepairedRows : undefined,
        },
      });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      app.log.error({ err, fileName }, 'purchase import preview failed');
      if (err.code === '42703' || err.code === '42P01') {
        return sendError(
          reply,
          409,
          'قاعدة البيانات غير محدثة (ترحيلات ناقصة). شغّل npm run server:migrate على قاعدة البيانات ثم أعد المحاولة.',
          'DB_SCHEMA_OUTDATED',
        );
      }
      if (err.code === '23505') {
        return sendError(reply, 409, 'تعارض بيانات (قيود تكرار). راجع رقم الفاتورة/الباركود ثم أعد المحاولة.', 'DUPLICATE');
      }
      if (err.code === '22007') return sendError(reply, 400, 'تاريخ غير صالح', 'VALIDATION');
      if (err.code === '22P02') return sendError(reply, 400, 'قيمة رقمية غير صالحة', 'VALIDATION');
      if (err.code === 'DUPLICATE') return sendError(reply, 409, err.message || 'تعارض', 'DUPLICATE');
      if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || 'حالة غير صالحة', 'INVALID_STATE');
      throw e;
    } finally {
      client.release();
    }
  });

  // ── B. Get batch ──────────────────────────────────────────────────────────
  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `SELECT b.*, s.name AS supplier_name, w.name AS warehouse_name,
              COALESCE(v.verification_total, 0)::int AS verification_total,
              COALESCE(v.verification_verified, 0)::int AS verification_verified
       FROM purchase_import_batches b
       LEFT JOIN suppliers s ON s.id = b.supplier_id
       LEFT JOIN warehouses w ON w.id = b.warehouse_id
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (
             WHERE r.status IN ('VALID','WARNING')
               AND COALESCE(NULLIF(trim(r.normalized_data->>'barcode'),''), NULL) IS NOT NULL
           )::int AS verification_total,
           COUNT(*) FILTER (
             WHERE r.status IN ('VALID','WARNING')
               AND COALESCE(NULLIF(trim(r.normalized_data->>'barcode'),''), NULL) IS NOT NULL
               AND r.verified_at IS NOT NULL
           )::int AS verification_verified
         FROM purchase_import_rows r
         WHERE r.batch_id = b.id AND r.company_id = b.company_id
       ) v ON true
       WHERE b.id=$1 AND b.company_id=$2`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'الدفعة غير موجودة', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  // ── C. Get batch rows (paginated) ─────────────────────────────────────────
  app.get('/:id/rows', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, string>;
    const statusFilter = q.status?.trim() || '';
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize) || 50));
    const offset = (page - 1) * pageSize;
    const pool = getPool();

    const batchCheck = await pool.query(
      'SELECT id FROM purchase_import_batches WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!batchCheck.rows.length) return sendError(reply, 404, 'الدفعة غير موجودة', 'NOT_FOUND');

    const conds = ['r.batch_id=$1'];
    const params: unknown[] = [id];
    let p = 2;
    if (statusFilter) { conds.push(`r.status=$${p}`); params.push(statusFilter); p++; }

    const where = conds.join(' AND ');
    const [rows, cnt] = await Promise.all([
      pool.query(
        `SELECT r.*,
                fi.name AS item_name, fi.internal_code,
                fc.name_ar AS color_name_ar, fc.color_code
         FROM purchase_import_rows r
         LEFT JOIN fabric_items fi ON fi.id = r.matched_item_id
         LEFT JOIN fabric_colors fc ON fc.id = r.matched_color_id
         WHERE ${where}
         ORDER BY r.row_no ASC
         LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM purchase_import_rows r WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: cnt.rows[0].total, page, pageSize });
  });

  // ── C2. Auto-repair batch rows ─────────────────────────────────────────────
  app.post('/:id/auto-repair', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();

    const batchRow = await pool.query<{
      id: string;
      company_id: string;
      supplier_id: string;
      warehouse_id: string;
      default_location_id: string | null;
      import_mode: string;
      file_name: string;
      extracted_metadata: unknown;
      status: string;
    }>(
      `SELECT id, company_id, supplier_id, warehouse_id, default_location_id,
              import_mode, file_name, extracted_metadata, status
       FROM purchase_import_batches
       WHERE id=$1 AND company_id=$2`,
      [id, companyId],
    );
    if (!batchRow.rows.length) return sendError(reply, 404, 'الدفعة غير موجودة', 'NOT_FOUND');
    const batch = batchRow.rows[0];
    if (batch.status === 'CONFIRMED') {
      return sendError(reply, 409, 'الدفعة مؤكَّدة — لا يمكن إصلاحها تلقائياً.', 'ALREADY_CONFIRMED');
    }
    if (batch.status === 'CANCELLED') {
      return sendError(reply, 400, 'الدفعة ملغاة.', 'CANCELLED');
    }

    try {
      const result = await repairAndRevalidateImportBatch(pool, batch);
      return reply.send({
        ok: true,
        data: {
          batchId: batch.id,
          validCount: result.validCount,
          warnCount: result.warnCount,
          errorCount: result.errorCount,
          repairedRows: result.repairedRows,
          repairSummary: result.repairSummary,
          totalLengthM: parseFloat(result.totalLengthM.toFixed(3)),
          totalActualWeightKg: parseFloat(result.totalActualWt.toFixed(3)),
          totalCalculatedWeightKg: parseFloat(result.totalCalcWt.toFixed(3)),
          verificationTotal: result.verificationTotal,
        },
      });
    } catch (e: unknown) {
      const err = e as { message?: string };
      app.log.error({ err, batchId: id }, 'purchase import auto-repair failed');
      return sendError(reply, 500, err.message || 'تعذر الإصلاح التلقائي', 'INTERNAL');
    }
  });

  // ── D. Scan verify (optional) ──────────────────────────────────────────────
  app.post('/:id/scan-verify', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = scanVerifySchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const barcode = cleanString(parsed.data.barcode);
    if (!barcode) return sendError(reply, 400, 'الباركود غير صالح', 'VALIDATION');

    const pool = getPool();
    const batchRow = await pool.query<{ id: string; status: string }>(
      'SELECT id, status FROM purchase_import_batches WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!batchRow.rows.length) return sendError(reply, 404, 'الدفعة غير موجودة', 'NOT_FOUND');
    const batch = batchRow.rows[0];
    if (batch.status === 'CONFIRMED') return sendError(reply, 409, 'الدفعة مؤكَّدة مسبقاً.', 'ALREADY_CONFIRMED');
    if (batch.status === 'CANCELLED') return sendError(reply, 400, 'الدفعة ملغاة ولا يمكن توثيقها.', 'CANCELLED');

    const rows = await pool.query<{ id: string; row_no: number; verified_at: string | null }>(
      `SELECT id, row_no, verified_at
       FROM purchase_import_rows
       WHERE batch_id=$1
         AND company_id=$2
         AND status IN ('VALID','WARNING')
         AND lower(trim(normalized_data->>'barcode'))=lower(trim($3))
       ORDER BY row_no ASC
       LIMIT 2`,
      [id, companyId, barcode],
    );
    if (!rows.rows.length) return sendError(reply, 404, 'الباركود غير موجود ضمن هذه الفاتورة', 'NOT_FOUND');
    if (rows.rows.length > 1) return sendError(reply, 409, 'الباركود مكرر ضمن الفاتورة', 'DUPLICATE');

    const target = rows.rows[0];
    let didVerify = false;
    if (!target.verified_at) {
      await pool.query(
        `UPDATE purchase_import_rows
         SET verified_at=now(), verified_by_user_id=$1
         WHERE id=$2 AND company_id=$3 AND verified_at IS NULL`,
        [userId, target.id, companyId],
      );
      didVerify = true;
    }

    const [tot, ver] = await Promise.all([
      pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM purchase_import_rows
         WHERE batch_id=$1 AND company_id=$2
           AND status IN ('VALID','WARNING')
           AND COALESCE(NULLIF(trim(normalized_data->>'barcode'),''), NULL) IS NOT NULL`,
        [id, companyId],
      ),
      pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM purchase_import_rows
         WHERE batch_id=$1 AND company_id=$2
           AND status IN ('VALID','WARNING')
           AND COALESCE(NULLIF(trim(normalized_data->>'barcode'),''), NULL) IS NOT NULL
           AND verified_at IS NOT NULL`,
        [id, companyId],
      ),
    ]);

    return reply.send({
      ok: true,
      data: {
        rowNo: target.row_no,
        barcode,
        didVerify,
        verificationTotal: tot.rows[0].total,
        verificationVerified: ver.rows[0].total,
      },
    });
  });

  // ── D. Pricing & landing costs ─────────────────────────────────────────────
  app.post('/:id/pricing', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = pricingSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const {
      purchaseBaseUnitPrice,
      priceUnit,
      freightCost,
      customsCost,
      clearanceCost,
      internalShippingCost,
      otherCost,
    } = parsed.data;

    const pool = getPool();
    const batchRow = await pool.query<{
      id: string;
      status: string;
      total_length_m: string;
      notes: string | null;
    }>(
      'SELECT id, status, total_length_m, notes FROM purchase_import_batches WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!batchRow.rows.length) return sendError(reply, 404, 'الدفعة غير موجودة', 'NOT_FOUND');
    const batch = batchRow.rows[0];
    if (batch.status === 'CONFIRMED') return sendError(reply, 409, 'الدفعة مؤكَّدة مسبقاً.', 'ALREADY_CONFIRMED');
    if (batch.status === 'CANCELLED') return sendError(reply, 400, 'الدفعة ملغاة.', 'CANCELLED');

    const totalLengthM = Number(batch.total_length_m);
    if (!Number.isFinite(totalLengthM) || totalLengthM <= 0) {
      return sendError(reply, 400, 'لا يمكن حساب التكلفة بدون أطوال صالحة', 'VALIDATION');
    }

    const basePerMeter =
      priceUnit === 'yard'
        ? purchaseBaseUnitPrice / 0.9144
        : purchaseBaseUnitPrice;
    const landingTotal = freightCost + customsCost + clearanceCost + internalShippingCost + otherCost;
    const landingPerMeter = landingTotal / totalLengthM;
    const finalUnitCost = Math.round((basePerMeter + landingPerMeter) * 1_000_000) / 1_000_000;
    const supplierInvoiceTotal = Math.round(basePerMeter * totalLengthM * 100) / 100;
    const inventoryValueTotal = Math.round(finalUnitCost * totalLengthM * 100) / 100;

    const landingNote = buildLandingCostNotes(
      basePerMeter,
      {
        freight: freightCost,
        customs: customsCost,
        clearance: clearanceCost,
        internalShipping: internalShippingCost,
        other: otherCost,
      },
      finalUnitCost,
      totalLengthM,
    );
    const mergedNotes = [cleanString(batch.notes), landingNote].filter(Boolean).join('\n');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE purchase_import_batches SET
           purchase_base_unit_price=$3,
           freight_cost=$4,
           customs_cost=$5,
           clearance_cost=$6,
           internal_shipping_cost=$7,
           other_cost=$8,
           landing_cost_total=$9,
           final_unit_cost=$10,
           notes=$11,
           status='VALIDATED',
           updated_at=now()
         WHERE id=$1 AND company_id=$2`,
        [
          id,
          companyId,
          basePerMeter,
          freightCost,
          customsCost,
          clearanceCost,
          internalShippingCost,
          otherCost,
          landingTotal,
          finalUnitCost,
          mergedNotes || null,
        ],
      );

      const rows = await client.query<{ id: string; normalized_data: NormalizedRowData }>(
        `SELECT id, normalized_data FROM purchase_import_rows
         WHERE batch_id=$1 AND company_id=$2 AND status IN ('VALID','WARNING')`,
        [id, companyId],
      );
      for (const row of rows.rows) {
        const nd = { ...(row.normalized_data ?? {}) } as NormalizedRowData;
        (nd as Record<string, unknown>).purchaseUnitPrice = basePerMeter;
        (nd as Record<string, unknown>).unitCost = finalUnitCost;
        await client.query(
          `UPDATE purchase_import_rows SET normalized_data=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
          [row.id, companyId, JSON.stringify(nd)],
        );
      }

      await client.query('COMMIT');
      return reply.send({
        ok: true,
        data: {
          batchId: id,
          purchaseBaseUnitPrice: basePerMeter,
          priceUnit,
          freightCost,
          customsCost,
          clearanceCost,
          internalShippingCost,
          otherCost,
          landingCostTotal: landingTotal,
          landingPerMeter: Math.round(landingPerMeter * 1_000_000) / 1_000_000,
          finalUnitCost,
          supplierInvoiceTotal,
          inventoryValueTotal,
          invoiceTotal: supplierInvoiceTotal,
          totalLengthM,
        },
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ── E. Confirm import ─────────────────────────────────────────────────────
  app.post('/:id/confirm', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = confirmSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const { allowWarnings } = parsed.data;

    const pool = getPool();

    const batchRow = await pool.query<{
      id: string;
      status: string;
      warehouse_id: string;
      default_location_id: string | null;
      supplier_id: string | null;
      currency_code: string | null;
      exchange_rate_to_usd: string | null;
      invoice_no: string | null;
      invoice_date: unknown;
      notes: string | null;
      import_mode: string;
      error_count: number;
      warning_count: number;
    }>(
      'SELECT * FROM purchase_import_batches WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!batchRow.rows.length) return sendError(reply, 404, 'الدفعة غير موجودة', 'NOT_FOUND');
    const batch = batchRow.rows[0];

    if (batch.status === 'CONFIRMED') return sendError(reply, 409, 'الدفعة مؤكَّدة مسبقاً.', 'ALREADY_CONFIRMED');
    if (batch.status === 'CANCELLED') return sendError(reply, 400, 'الدفعة ملغاة ولا يمكن تأكيدها.', 'CANCELLED');
    if (batch.status === 'CONFIRMING' || batch.status === 'FAILED') {
      await pool.query(
        `UPDATE purchase_import_batches
         SET status='VALIDATED', error_message=NULL, failed_at=NULL, updated_at=now()
         WHERE id=$1 AND company_id=$2 AND status IN ('CONFIRMING','FAILED')`,
        [id, companyId],
      );
      (batch as { status: string }).status = 'VALIDATED';
    }
    if (batch.error_count > 0) {
      const errorRows = await fetchImportRowIssues(pool, id, companyId, 'ERROR');
      return sendError(
        reply,
        400,
        buildImportIssuesMessage(batch.error_count, 'أخطاء', errorRows),
        'HAS_ERRORS',
        { errorCount: batch.error_count, rows: errorRows },
      );
    }
    if (batch.warning_count > 0 && !allowWarnings) {
      const warnRows = await fetchImportRowIssues(pool, id, companyId, 'WARNING');
      return sendError(
        reply,
        400,
        buildImportIssuesMessage(batch.warning_count, 'تحذيرات', warnRows),
        'HAS_WARNINGS',
        { warningCount: batch.warning_count, rows: warnRows },
      );
    }

    const rowsToImport = await pool.query<{
      id: string; row_no: number;
      normalized_data: NormalizedRowData;
      matched_item_id: string | null; matched_color_id: string | null; matched_variant_id: string | null;
      status: string;
    }>(
      `SELECT * FROM purchase_import_rows
       WHERE batch_id=$1 AND status IN ('VALID','WARNING') ORDER BY row_no ASC`,
      [id],
    );
    if (!rowsToImport.rows.length) return sendError(reply, 400, 'لا توجد أسطر صالحة للاستيراد', 'NO_VALID_ROWS');

    const supplierIdFinal = batch.supplier_id;
    if (!supplierIdFinal) return sendError(reply, 400, 'يرجى اختيار المورد', 'VALIDATION');

    const invoiceNoFinal = cleanString(batch.invoice_no) || generateDocumentNo('PI');
    const rawInvDate = (batch as unknown as { invoice_date?: unknown }).invoice_date;
    const invoiceDateFinal =
      rawInvDate instanceof Date
        ? rawInvDate.toISOString().slice(0, 10)
        : normalizeInvoiceDate(rawInvDate ? String(rawInvDate) : '') ?? '';
    if (!invoiceDateFinal) return sendError(reply, 400, 'تاريخ الفاتورة غير صالح', 'VALIDATION');

    const ccy = String(batch.currency_code || 'USD').trim().toUpperCase();
    let exchangeRateToUsd = batch.exchange_rate_to_usd != null ? Number(batch.exchange_rate_to_usd) : NaN;
    if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
      if (ccy === 'USD') {
        exchangeRateToUsd = 1;
      } else {
        const fromDb = await getExchangeRateToUsdTx(pool, companyId, ccy);
        exchangeRateToUsd = fromDb ?? NaN;
      }
    }
    if (ccy === 'USD') exchangeRateToUsd = 1;
    if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
      return sendError(reply, 400, 'لا يمكن تنفيذ العملية بدون سعر صرف', 'VALIDATION');
    }

    const batchExtras = batch as {
      final_unit_cost?: string | null;
      total_length_m?: string | null;
      purchase_base_unit_price?: string | null;
      landing_cost_total?: string | null;
      freight_cost?: string | null;
      customs_cost?: string | null;
      clearance_cost?: string | null;
      internal_shipping_cost?: string | null;
      other_cost?: string | null;
    };
    const purchaseBaseUnitPriceBatch = Number(batchExtras.purchase_base_unit_price);
    const landingCostTotalBatch = Number(batchExtras.landing_cost_total ?? 0);
    const finalUnitCostBatch = Number(batchExtras.final_unit_cost);
    if (!Number.isFinite(finalUnitCostBatch) || finalUnitCostBatch <= 0) {
      return sendError(reply, 400, 'يرجى إدخال التسعير وتكاليف الاستيراد قبل الحفظ والترحيل', 'PRICING_REQUIRED');
    }

    const invoiceNotes = cleanString(batch.notes) || null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE purchase_import_batches SET status='CONFIRMING', started_at=COALESCE(started_at, now()), updated_at=now()
         WHERE id=$1 AND company_id=$2`,
        [id, companyId],
      );

      let createdRolls = 0;
      let createdItems = 0;
      let createdColors = 0;
      let createdVariants = 0;
      let totalLen = 0;
      let totalActWt = 0;
      let totalCalcWt = 0;
      let createdPurchaseInvoiceId: string | null = null;
      const lineRowIds: string[] = [];
      const lineRollIds: string[] = [];
      const lineInputs: Array<Record<string, unknown>> = [];
      const categoryChainCache = new Set<string>();

      for (const row of rowsToImport.rows) {
        const nd = row.normalized_data as NormalizedRowData;
        let itemId = row.matched_item_id;
        let variantId = row.matched_variant_id;

        // Create missing item (fabric_items has UNIQUE (company_id, internal_code))
        if (!itemId && batch.import_mode === 'CREATE_MISSING_MASTER_DATA') {
          const matName = cleanString(nd.materialName) || `ITEM-IMPORT`;
          const supCode = cleanString(nd.supplierMaterialCode) || null;
          const intCodeRaw = cleanString(nd.internalMaterialCode) || cleanString(nd.supplierMaterialCode) || cleanString(nd.materialName);
          const intCode = intCodeRaw || generateImportCode('IMP');

          if (!cleanString(nd.internalMaterialCode) && supCode) {
            const byIntCode = await client.query<{ id: string }>(
              `SELECT id FROM fabric_items WHERE company_id=$1 AND lower(trim(internal_code))=lower(trim($2)) AND is_active=true LIMIT 1`,
              [companyId, supCode],
            );
            if (byIntCode.rows.length) itemId = byIntCode.rows[0].id;
          }
          if (!itemId) {
            // Try to find by name first to avoid duplicates
            const existCheck = await client.query<{ id: string }>(
              `SELECT id FROM fabric_items WHERE company_id=$1 AND lower(trim(name))=lower(trim($2)) AND is_active=true LIMIT 1`,
              [companyId, matName],
            );
            if (existCheck.rows.length) {
              itemId = existCheck.rows[0].id;
            } else {
              const newItem = await client.query<{ id: string }>(
                `INSERT INTO fabric_items (company_id, name, internal_code, supplier_code, is_active)
                 VALUES ($1,$2,$3,$4,true)
                 ON CONFLICT (company_id, internal_code) DO UPDATE SET
                   name=EXCLUDED.name,
                   supplier_code=COALESCE(EXCLUDED.supplier_code, fabric_items.supplier_code)
                 RETURNING id`,
                [companyId, matName, intCode, supCode],
              );
              itemId = newItem.rows[0].id;
              createdItems++;
            }
          }
        }
        if (!itemId) continue; // skip if still no item

        await applyPurchaseImportMaterialCodes(client, companyId, itemId, nd);
        const categoryKey = [
          cleanString(nd.materialName),
          resolveImportMaterialCode(nd),
          cleanString(nd.colorName) || cleanString(nd.colorNameTr),
          cleanString(nd.colorCode) || cleanString(nd.supplierColorCode),
        ].join('|');
        if (!categoryChainCache.has(categoryKey)) {
          await ensureFabricCategoryChainFromImport(client, companyId, nd);
          categoryChainCache.add(categoryKey);
        }

        const colorResolved = await resolveFabricColorForImport(
          client,
          companyId,
          nd,
          {
            createIfMissing: batch.import_mode === 'CREATE_MISSING_MASTER_DATA',
            rowNo: row.row_no,
          },
        );
        const colorId = colorResolved.id;
        if (colorResolved.created) createdColors++;

        if (variantId && colorId) {
          const variantColorCheck = await client.query<{ id: string }>(
            `SELECT id FROM fabric_item_variants WHERE id=$1 AND color_id=$2 LIMIT 1`,
            [variantId, colorId],
          );
          if (!variantColorCheck.rows.length) variantId = null;
        }

        // Create missing variant — fabric_item_variants has UNIQUE (company_id, variant_code)
        if (!variantId && itemId && colorId && batch.import_mode === 'CREATE_MISSING_MASTER_DATA') {
          const wc = cleanNumber(nd.widthCm);
          const gs = cleanNumber(nd.gsm);
          if (wc && gs) {
            // Check by item+color+width+gsm first
            const varCheck = await client.query<{ id: string }>(
              `SELECT id FROM fabric_item_variants
               WHERE company_id=$1 AND item_id=$2 AND color_id=$3
                 AND ABS(COALESCE(width_cm,0)-$4)<0.1 AND ABS(COALESCE(gsm,0)-$5)<0.5
                 AND is_active=true LIMIT 1`,
              [companyId, itemId, colorId, wc, gs],
            );
            if (varCheck.rows.length) {
              variantId = varCheck.rows[0].id;
            } else {
              const vcode = `V-${itemId.substring(0, 6)}-${colorId.substring(0, 6)}-${wc}x${gs}-${Date.now()}`;
              const newVar = await client.query<{ id: string }>(
                `INSERT INTO fabric_item_variants (company_id, item_id, color_id, variant_code, width_cm, gsm, is_active)
                 VALUES ($1,$2,$3,$4,$5,$6,true)
                 ON CONFLICT (company_id, variant_code) DO UPDATE SET width_cm=EXCLUDED.width_cm
                 RETURNING id`,
                [companyId, itemId, colorId, vcode, wc, gs],
              );
              variantId = newVar.rows[0].id;
              createdVariants++;
            }
          }
        }

        const barcode = await resolveImportRollBarcode(client, companyId, nd);

        const supplierRollRef =
          cleanString(nd.supplierRollRef) || cleanString(nd.rollNo) || null;

        const lengthM = cleanNumber(nd.lengthM) ?? 0;
        const widthCm = cleanNumber(nd.widthCm);
        const gsm = cleanNumber(nd.gsm);
        const actualWt = cleanNumber(nd.actualWeightKg);
        const calcWt = calcWeight(lengthM, widthCm, gsm);
        const inventoryUnitCost = cleanNumber(nd.unitCost) ?? finalUnitCostBatch;
        const purchaseUnitPrice =
          cleanNumber((nd as Record<string, unknown>).purchaseUnitPrice as string | number | null | undefined) ??
          (Number.isFinite(purchaseBaseUnitPriceBatch) && purchaseBaseUnitPriceBatch > 0
            ? purchaseBaseUnitPriceBatch
            : inventoryUnitCost);

        // Create fabric_roll
        const rollRow = await client.query(
          `INSERT INTO fabric_rolls
             (company_id, roll_no, barcode, item_id, color_id, variant_id, supplier_id,
              warehouse_id, location_id, length_m, width_cm, gsm,
              calculated_weight_kg, actual_weight_kg, unit_cost, currency_code,
              batch_no, container_no, purchase_invoice_no, supplier_roll_ref,
              notes, import_batch_id, created_by_user_id, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'AVAILABLE')
           RETURNING id`,
          [
            companyId,
            cleanString(nd.rollNo) || null,
            barcode,
            itemId,
            colorId,
            variantId,
            supplierIdFinal,
            batch.warehouse_id,
            batch.default_location_id,
            lengthM,
            widthCm,
            gsm,
            calcWt,
            actualWt,
            inventoryUnitCost,
            ccy,
            cleanString(nd.batchNo) || null,
            cleanString(nd.containerNo) || null,
            invoiceNoFinal,
            supplierRollRef,
            cleanString(nd.notes) || null,
            id,
            userId,
          ],
        );
        const rollId = rollRow.rows[0].id;

        // Create movement
        const movementRow = await client.query<{ id: string }>(
          `INSERT INTO inventory_movements
             (company_id, roll_id, movement_type, to_warehouse_id, to_location_id,
              new_status, reference_type, reference_id, reference_no,
              notes, created_by_user_id)
           VALUES ($1,$2,'PURCHASE_RECEIPT',$3,$4,'AVAILABLE','IMPORT_BATCH',$5,$6,$7,$8)
           RETURNING id`,
          [
            companyId, rollId,
            batch.warehouse_id, batch.default_location_id,
            id, `${batch.warehouse_id}/${invoiceNoFinal}`,
            null, userId,
          ],
        );
        const movementId = movementRow.rows[0]?.id ?? null;

        // Mark row imported
        await client.query(
          `UPDATE purchase_import_rows SET status='IMPORTED', created_roll_id=$1, created_inventory_movement_id=$3, updated_at=now()
           WHERE id=$2`,
          [rollId, row.id, movementId],
        );

        const descParts = [
          cleanString(nd.materialName),
          cleanString(nd.internalMaterialCode),
          cleanString(nd.supplierMaterialCode),
          cleanString(nd.colorName),
          cleanString(nd.colorNameTr),
        ].filter(Boolean);
        const desc = descParts.join(' / ');
        const qty = lengthM;
        const price = purchaseUnitPrice ?? 0;
        const lineTotal = Math.round(qty * price * 100) / 100;
        lineRowIds.push(row.id);
        lineRollIds.push(rollId);
        lineInputs.push({
          fabricRollId: rollId,
          fabricItemId: itemId,
          variantId,
          warehouseId: batch.warehouse_id,
          description: desc,
          quantity: qty,
          unit: 'meter',
          unitPrice: price,
          lineDiscount: 0,
          lineTax: 0,
          lineTotal,
          metadata: buildPurchaseLineMetadataFromImport(id, row, nd, barcode),
        });

        createdRolls++;
        totalLen += lengthM;
        totalActWt += actualWt ?? 0;
        totalCalcWt += calcWt ?? 0;
      }

      if (lineInputs.length > 0) {
        const subtotal = Math.round(lineInputs.reduce((s, l) => s + Number(l.lineTotal ?? 0), 0) * 100) / 100;
        const inv = await createPurchaseInvoice(client, companyId, userId, {
          invoiceNo: invoiceNoFinal,
          supplierInvoiceNo: cleanString(batch.invoice_no) || null,
          invoiceDate: invoiceDateFinal,
          supplierId: supplierIdFinal,
          warehouseId: batch.warehouse_id,
          currencyCode: ccy,
          exchangeRateToUsd,
          notes: invoiceNotes,
          subtotal,
          discountTotal: 0,
          taxTotal: 0,
          totalAmount: subtotal,
          paidAmount: 0,
          remainingAmount: subtotal,
          lines: lineInputs,
          confirm: false,
        });
        createdPurchaseInvoiceId = inv.id;

        await confirmPurchaseInvoice(client, companyId, userId, createdPurchaseInvoiceId, { skipStockMovement: true });

        if (landingCostTotalBatch > 0) {
          const landingUsd = importAmountToUsd(landingCostTotalBatch, ccy, exchangeRateToUsd);
          await postImportLandingCostsToGl(client, {
            companyId,
            batchId: id,
            purchaseInvoiceId: createdPurchaseInvoiceId,
            invoiceNo: invoiceNoFinal,
            invoiceDate: invoiceDateFinal,
            landingAmountUsd: landingUsd,
            userId,
          });
        }

        const lnRows = await client.query<{ id: string; line_no: number }>(
          `SELECT id, line_no FROM purchase_invoice_lines WHERE invoice_id=$1 AND company_id=$2 ORDER BY line_no ASC`,
          [createdPurchaseInvoiceId, companyId],
        );
        for (const ln of lnRows.rows) {
          const rowId = lineRowIds[ln.line_no - 1];
          const rollId = lineRollIds[ln.line_no - 1];
          if (!rowId) continue;
          await client.query(
            `UPDATE purchase_import_rows SET created_purchase_invoice_line_id=$1, updated_at=now() WHERE id=$2`,
            [ln.id, rowId],
          );
          if (rollId) {
            await client.query(
              `UPDATE fabric_rolls
               SET purchase_invoice_id=$1, purchase_invoice_line_id=$2, updated_at=now()
               WHERE id=$3 AND company_id=$4`,
              [createdPurchaseInvoiceId, ln.id, rollId, companyId],
            );
          }
        }
      }

      // Update batch
      await client.query(
        `UPDATE purchase_import_batches SET
           status='CONFIRMED',
           created_roll_count=$2, created_item_count=$3,
           created_color_count=$4, created_variant_count=$5,
           total_length_m=$6, total_actual_weight_kg=$7, total_calculated_weight_kg=$8,
           invoice_no=$10, invoice_date=$11::date, currency_code=$12, exchange_rate_to_usd=$13,
           supplier_invoice_no=$10,
           imported_count=$2, failed_count=0,
           created_purchase_invoice_id=$14,
           confirmed_by_user_id=$9, confirmed_at=now(), updated_at=now()
         WHERE id=$1`,
        [
          id,
          createdRolls, createdItems, createdColors, createdVariants,
          totalLen, totalActWt, totalCalcWt, userId,
          invoiceNoFinal,
          invoiceDateFinal,
          ccy,
          exchangeRateToUsd,
          createdPurchaseInvoiceId,
        ],
      );

      await client.query('COMMIT');

      return reply.send({
        ok: true,
        data: {
          batchId: id,
          createdRolls, createdItems, createdColors, createdVariants,
          totalLengthM: parseFloat(totalLen.toFixed(3)),
          totalActualWeightKg: parseFloat(totalActWt.toFixed(3)),
          totalCalculatedWeightKg: parseFloat(totalCalcWt.toFixed(3)),
          createdPurchaseInvoiceId,
          purchaseInvoiceNo: invoiceNoFinal,
        },
      });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      app.log.error({ err, batchId: id }, 'purchase import confirm failed');
      await pool.query(
        `UPDATE purchase_import_batches
         SET status='FAILED', failed_at=now(), error_message=$3, updated_at=now()
         WHERE id=$1 AND company_id=$2 AND status <> 'CONFIRMED'`,
        [id, companyId, err.message || 'Import confirm failed'],
      ).catch(() => { /* keep original error */ });
      if (err.code === '42703' || err.code === '42P01') {
        return sendError(
          reply,
          409,
          'قاعدة البيانات غير محدثة (ترحيلات ناقصة). شغّل npm run server:migrate على قاعدة البيانات ثم أعد المحاولة.',
          'DB_SCHEMA_OUTDATED',
        );
      }
      if (err.code === '23505') {
        return sendError(reply, 409, 'تعارض بيانات (قيود تكرار). راجع رقم الفاتورة/الباركود ثم أعد المحاولة.', 'DUPLICATE');
      }
      if (err.code === '22007') return sendError(reply, 400, 'تاريخ غير صالح', 'VALIDATION');
      if (err.code === '22P02') return sendError(reply, 400, 'قيمة رقمية غير صالحة', 'VALIDATION');
      if (err.code === 'DUPLICATE') return sendError(reply, 409, err.message || 'تعارض', 'DUPLICATE');
      if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || 'حالة غير صالحة', 'INVALID_STATE');
      if (err.code === '23514') {
        return sendError(
          reply,
          409,
          'قاعدة البيانات تحتاج ترحيلاً جديداً (قيود القيود المحاسبية). شغّل npm run server:migrate ثم أعد المحاولة.',
          'DB_CHECK_VIOLATION',
        );
      }
      if (err.code === 'GL_CONFIG' || err.code === 'GL_UNBALANCED') {
        return sendError(reply, 409, err.message || 'إعداد الحسابات العامة غير مكتمل', err.code);
      }
      return sendError(
        reply,
        500,
        err.message || ArabicErrors.server,
        'IMPORT_CONFIRM_FAILED',
      );
    } finally {
      client.release();
    }
  });

  // ── E. Cancel batch ────────────────────────────────────────────────────────
  app.post('/:id/cancel', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      'SELECT status FROM purchase_import_batches WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'الدفعة غير موجودة', 'NOT_FOUND');
    if (row.rows[0].status === 'CONFIRMED') return sendError(reply, 400, 'الدفعة مؤكَّدة ولا يمكن إلغاؤها.', 'ALREADY_CONFIRMED');
    await pool.query(
      `UPDATE purchase_import_batches SET status='CANCELLED', updated_at=now() WHERE id=$1`,
      [id],
    );
    return reply.send({ ok: true });
  });

  // ── F. List batches ────────────────────────────────────────────────────────
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const pool = getPool();

    const [rows, cnt] = await Promise.all([
      pool.query(
        `SELECT b.*, s.name AS supplier_name, w.name AS warehouse_name,
                COALESCE(v.verification_total, 0)::int AS verification_total,
                COALESCE(v.verification_verified, 0)::int AS verification_verified
         FROM purchase_import_batches b
         LEFT JOIN suppliers s ON s.id = b.supplier_id
         LEFT JOIN warehouses w ON w.id = b.warehouse_id
         LEFT JOIN LATERAL (
           SELECT
             COUNT(*) FILTER (
               WHERE r.status IN ('VALID','WARNING')
                 AND COALESCE(NULLIF(trim(r.normalized_data->>'barcode'),''), NULL) IS NOT NULL
             )::int AS verification_total,
             COUNT(*) FILTER (
               WHERE r.status IN ('VALID','WARNING')
                 AND COALESCE(NULLIF(trim(r.normalized_data->>'barcode'),''), NULL) IS NOT NULL
                 AND r.verified_at IS NOT NULL
             )::int AS verification_verified
           FROM purchase_import_rows r
           WHERE r.batch_id = b.id AND r.company_id = b.company_id
         ) v ON true
         WHERE b.company_id=$1
         ORDER BY b.created_at DESC
         LIMIT $2 OFFSET $3`,
        [companyId, pageSize, offset],
      ),
      pool.query('SELECT COUNT(*)::int AS total FROM purchase_import_batches WHERE company_id=$1', [companyId]),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: cnt.rows[0].total, page, pageSize });
  });
};
