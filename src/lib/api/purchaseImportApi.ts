import { apiFetch } from './client';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ImportMode = 'MATCH_ONLY' | 'CREATE_MISSING_MASTER_DATA';
export type BatchStatus = 'PREVIEW' | 'PREVIEWED' | 'VALIDATED' | 'CONFIRMING' | 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'FAILED' | 'CANCELLED';
export type RowStatus = 'PENDING' | 'VALID' | 'WARNING' | 'ERROR' | 'IMPORTED' | 'SKIPPED';
export type ImportSourceType = 'PURCHASE_INVOICE' | 'OPENING_STOCK' | 'DIRECT_STOCK_IMPORT' | 'CHINA_PACKING_LIST' | 'STOCK_IMPORT';

export interface ExtractedImportMetadata {
  materialName?: string;
  widthRaw?: string;
  widthUnit?: 'inch';
  widthCmMin?: number;
  widthCmMax?: number;
  widthCmAvg?: number;
  declaredTotalLength?: number;
  declaredLengthUnit?: string;
  declaredRollCount?: number;
  documentDate?: string;
  warnings?: string[];
  [key: string]: unknown;
}

export interface PurchaseImportBatchDto {
  id: string;
  company_id: string;
  supplier_id: string | null;
  source_type?: ImportSourceType;
  warehouse_id: string;
  default_location_id: string | null;
  file_name: string;
  file_size_bytes: number | null;
  sheet_name: string | null;
  invoice_no?: string | null;
  supplier_invoice_no?: string | null;
  invoice_date?: string | null;
  exchange_rate_to_usd?: string | null;
  created_purchase_invoice_id?: string | null;
  status: BatchStatus;
  row_count: number;
  valid_count: number;
  warning_count: number;
  error_count: number;
  created_roll_count: number;
  created_item_count: number;
  created_color_count: number;
  created_variant_count: number;
  total_length_m: string;
  total_actual_weight_kg: string;
  total_calculated_weight_kg: string;
  currency_code: string | null;
  extracted_metadata?: ExtractedImportMetadata | null;
  detected_columns?: { col: string; field: string }[] | null;
  import_mode: ImportMode;
  notes: string | null;
  created_at: string;
  confirmed_at: string | null;
  updated_at: string;
  verification_total?: number;
  verification_verified?: number;
  // Joined display fields
  supplier_name?: string | null;
  warehouse_name?: string | null;
}

export interface PurchaseImportRowDto {
  id: string;
  batch_id: string;
  row_no: number;
  raw_data: Record<string, unknown>;
  normalized_data: Record<string, unknown>;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  matched_item_id: string | null;
  matched_color_id: string | null;
  matched_variant_id: string | null;
  created_roll_id: string | null;
  verified_at?: string | null;
  verified_by_user_id?: string | null;
  created_at: string;
  // Joined
  item_name?: string | null;
  internal_code?: string | null;
  color_name_ar?: string | null;
  color_code?: string | null;
}

export interface ImportPreviewSummary {
  batchId: string;
  fileName: string;
  sheetName?: string;
  importMode: ImportMode;
  invoiceDate?: string;
  purchaseInvoiceNo?: string | null;
  currencyCode?: string;
  exchangeRateToUsd?: number;
  rowCount: number;
  validCount: number;
  warnCount: number;
  errorCount: number;
  totalLengthM: number;
  totalLengthYard?: number;
  lengthUnit?: 'meter' | 'yard';
  distinctMaterialsCount?: number;
  distinctColorsCount?: number;
  subtotalAmount?: number;
  totalActualWeightKg: number;
  totalCalculatedWeightKg: number;
  verificationTotal?: number;
  verificationVerified?: number;
  detectedColumns: { col: string; field: string }[];
  extractedMetadata?: ExtractedImportMetadata | null;
  metadataWarnings?: string[];
}

export interface ImportConfirmResult {
  batchId: string;
  createdRolls: number;
  createdItems: number;
  createdColors: number;
  createdVariants: number;
  totalLengthM: number;
  totalActualWeightKg: number;
  totalCalculatedWeightKg: number;
  createdPurchaseInvoiceId?: string | null;
  purchaseInvoiceNo?: string | null;
}

export interface ImportPricingResult {
  batchId: string;
  purchaseBaseUnitPrice: number;
  priceUnit: 'meter' | 'yard';
  freightCost: number;
  customsCost: number;
  clearanceCost: number;
  internalShippingCost: number;
  otherCost: number;
  landingCostTotal: number;
  landingPerMeter: number;
  finalUnitCost: number;
  supplierInvoiceTotal: number;
  inventoryValueTotal: number;
  /** ذمة المورد فقط (سعر الشراء × الأطوال) */
  invoiceTotal: number;
  totalLengthM: number;
}

export interface ImportPricingPayload {
  purchaseBaseUnitPrice: number;
  priceUnit?: 'meter' | 'yard';
  freightCost?: number;
  customsCost?: number;
  clearanceCost?: number;
  internalShippingCost?: number;
  otherCost?: number;
}

export interface PreviewOptions {
  supplierId: string;
  warehouseId: string;
  defaultLocationId?: string | null;
  currencyCode?: string | null;
  invoiceDate: string;
  purchaseInvoiceNo?: string | null;
  notes?: string | null;
  exchangeRateToUsd?: number | null;
  importMode?: ImportMode;
}

export interface ImportRowsFilters {
  status?: RowStatus;
  page?: number;
  pageSize?: number;
}

export interface ImportBatchesFilters {
  page?: number;
  pageSize?: number;
}

// ─── Excel parsing (client-side) ─────────────────────────────────────────────

function normalizeHeaderValue(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

const HEADER_KEYWORDS = [
  'material', 'fabric', 'item', 'article', 'stock', 'stok', 'kumas', 'kumaş',
  'code', 'kod', 'color', 'renk', 'barcode', 'barkod', 'meter', 'metre',
  'length', 'qty', 'quantity', 'kg', 'weight', 'width', 'gsm', 'price',
  'cost', 'roll', 'top', 'lot',
  'الخامة', 'الصنف', 'اللون', 'الكود', 'الباركود', 'متر', 'الكمية', 'الوزن', 'السعر',
].map(normalizeHeaderValue);

function findHeaderRow(rows: unknown[][]): number {
  const limit = Math.min(rows.length, 20);
  let bestIndex = 0;
  let bestScore = 0;

  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? [];
    const values = row.map(normalizeHeaderValue).filter(Boolean);
    const score = values.reduce((sum, value) => {
      const matched = HEADER_KEYWORDS.some((keyword) => keyword && (value === keyword || value.includes(keyword) || keyword.includes(value)));
      return sum + (matched ? 1 : 0);
    }, 0);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestScore >= 2 ? bestIndex : 0;
}

function parseLooseNumber(value: string): number | null {
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function extractPreTableMetadata(rows: unknown[][]): ExtractedImportMetadata {
  const text = rows
    .flat()
    .map((cell) => String(cell ?? '').trim())
    .filter(Boolean)
    .join('\n');
  const metadata: ExtractedImportMetadata = {};

  const detail = /DETAIL\s+PACKING\s+LIST\s+OF\s+(.+?)\s+(\d{2,3}\s*\/\s*\d{2,3})/i.exec(text);
  if (detail) {
    metadata.materialName = detail[1].trim();
    metadata.widthRaw = detail[2].replace(/\s+/g, '');
    metadata.widthUnit = 'inch';
    const [minRaw, maxRaw] = metadata.widthRaw.split('/');
    const min = parseLooseNumber(minRaw ?? '');
    const max = parseLooseNumber(maxRaw ?? '');
    if (min != null && max != null) {
      metadata.widthCmMin = Number((min * 2.54).toFixed(2));
      metadata.widthCmMax = Number((max * 2.54).toFixed(2));
      metadata.widthCmAvg = Number((((min + max) / 2) * 2.54).toFixed(2));
    }
  }

  const total = /TOTAL\s+SHIPPED\s+SITUATION\s*[:：]?\s*([\d,.]+)\s*([A-Z]+)\s+([\d,.]+)\s*ROLLS?/i.exec(text);
  if (total) {
    metadata.declaredTotalLength = parseLooseNumber(total[1]) ?? undefined;
    metadata.declaredLengthUnit = total[2].toUpperCase();
    metadata.declaredRollCount = parseLooseNumber(total[3]) ?? undefined;
  }

  const date = /DATE\s*[:：]?\s*([0-9]{1,2}\s*\/\s*[A-Za-z]{3,}\s*\/\s*[0-9]{2,4}|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}|[0-9]{1,2}[\/.-][0-9]{1,2}[\/.-][0-9]{2,4})/i.exec(text);
  if (date) metadata.documentDate = date[1].trim();

  return metadata;
}

/**
 * Parses an Excel file in the browser using the `xlsx` library.
 * Returns headers + rows as arrays (raw Excel cell values).
 */
export async function parseExcelFile(file: File): Promise<{
  sheetName: string;
  headers: string[];
  rows: unknown[][];
  headerRowIndex: number;
  preTableRows: unknown[][];
  extractedMetadata: ExtractedImportMetadata;
}> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });

  // Prefer known sheet names, otherwise take first
  const preferredSheets = ['وارد', 'فاتورة', 'بيانات', 'مخزون', 'Sheet1', 'Data'];
  const sheetName =
    workbook.SheetNames.find(n => preferredSheets.includes(n)) ??
    workbook.SheetNames[0];

  if (!sheetName) throw new Error('الملف لا يحتوي على أي شيت.');

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });

  if (rawRows.length < 2) throw new Error('الملف لا يحتوي على صفوف كافية (يجب صف رأسي + صف بيانات على الأقل).');

  const headerRowIndex = findHeaderRow(rawRows as unknown[][]);
  const headers = ((rawRows[headerRowIndex] ?? []) as unknown[]).map(h => (h == null ? '' : String(h).trim()));
  const rows = rawRows.slice(headerRowIndex + 1) as unknown[][];
  const preTableRows = rawRows.slice(0, headerRowIndex) as unknown[][];
  const extractedMetadata = extractPreTableMetadata(preTableRows);

  return { sheetName, headers, rows, headerRowIndex, preTableRows, extractedMetadata };
}

// ─── API calls ───────────────────────────────────────────────────────────────

export async function previewPurchaseExcelImport(
  file: File,
  options: PreviewOptions,
): Promise<ImportPreviewSummary> {
  const { sheetName, headers, rows, headerRowIndex, preTableRows, extractedMetadata } = await parseExcelFile(file);

  const res = await apiFetch<{ ok: boolean; data: ImportPreviewSummary }>(
    '/api/purchases/import/preview',
    {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name,
        fileSizeBytes: file.size,
        sheetName,
        headers,
        rows,
        headerRowIndex,
        preTableRows,
        extractedMetadata,
        supplierId: options.supplierId,
        warehouseId: options.warehouseId,
        defaultLocationId: options.defaultLocationId ?? null,
        currencyCode: options.currencyCode ?? null,
        invoiceDate: options.invoiceDate,
        purchaseInvoiceNo: options.purchaseInvoiceNo ?? null,
        notes: options.notes ?? null,
        exchangeRateToUsd: options.exchangeRateToUsd ?? null,
        importMode: options.importMode ?? 'MATCH_ONLY',
      }),
      timeoutMs: 120_000,
    },
  );
  return res.data;
}

export async function getImportBatch(id: string): Promise<PurchaseImportBatchDto> {
  const res = await apiFetch<{ ok: boolean; data: PurchaseImportBatchDto }>(
    `/api/purchases/import/${id}`,
  );
  return res.data;
}

export async function listImportRows(
  batchId: string,
  filters: ImportRowsFilters = {},
): Promise<{ data: PurchaseImportRowDto[]; total: number }> {
  const q = new URLSearchParams();
  if (filters.status)   q.set('status',   filters.status);
  if (filters.page)     q.set('page',     String(filters.page));
  if (filters.pageSize) q.set('pageSize', String(filters.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<{ ok: boolean; data: PurchaseImportRowDto[]; total: number }>(
    `/api/purchases/import/${batchId}/rows${qs}`,
  );
  return { data: res.data, total: res.total };
}

export async function saveImportPricing(
  batchId: string,
  payload: ImportPricingPayload,
): Promise<ImportPricingResult> {
  const res = await apiFetch<{ ok: boolean; data: ImportPricingResult }>(
    `/api/purchases/import/${batchId}/pricing`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return res.data;
}

export async function confirmImportBatch(
  id: string,
  options: { allowWarnings?: boolean } = {},
): Promise<ImportConfirmResult> {
  const res = await apiFetch<{ ok: boolean; data: ImportConfirmResult }>(
    `/api/purchases/import/${id}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify({ allowWarnings: options.allowWarnings ?? false }),
      timeoutMs: 180_000,
    },
  );
  return res.data;
}

export async function scanVerifyImportBatch(
  id: string,
  barcode: string,
): Promise<{ rowNo: number; barcode: string; didVerify: boolean; verificationTotal: number; verificationVerified: number }> {
  const res = await apiFetch<{ ok: boolean; data: { rowNo: number; barcode: string; didVerify: boolean; verificationTotal: number; verificationVerified: number } }>(
    `/api/purchases/import/${id}/scan-verify`,
    {
      method: 'POST',
      body: JSON.stringify({ barcode }),
    },
  );
  return res.data;
}

export async function cancelImportBatch(id: string): Promise<void> {
  await apiFetch(`/api/purchases/import/${id}/cancel`, { method: 'POST' });
}

export async function listImportBatches(
  filters: ImportBatchesFilters = {},
): Promise<{ data: PurchaseImportBatchDto[]; total: number }> {
  const q = new URLSearchParams();
  if (filters.page)     q.set('page',     String(filters.page));
  if (filters.pageSize) q.set('pageSize', String(filters.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<{ ok: boolean; data: PurchaseImportBatchDto[]; total: number }>(
    `/api/purchases/import${qs}`,
  );
  return { data: res.data, total: res.total };
}
