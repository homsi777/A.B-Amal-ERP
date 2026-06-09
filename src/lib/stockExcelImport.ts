/**
 * Stock Excel import — preview parser for the Aleppo warehouse workbook.
 *
 * Designed against the real customer file `مستودعات حلب-27.xlsx`, which has
 * three sheets:
 *   1. "المخزون" — balance summary (item, color, in/out/stock, price, total)
 *   2. "وارد"   — incoming history (date, item, item code, color, quantity, price)
 *   3. "صادر"   — outgoing history (same shape as وارد)
 *
 * The parser auto-detects the header row (skipping title rows / merged cells)
 * and maps Arabic header names to canonical fields. Columns we cannot detect
 * are simply ignored and reported under `warnings`.
 *
 * The result is consumed by `StockExcelImportModal` to render a full preview
 * (counts, total quantity, per-item totals, per-color totals, sample rows)
 * before any actual import takes place.
 */
import * as XLSX from 'xlsx';

// ─── Public types ────────────────────────────────────────────────────────────

export type StockSheetKind = 'balance' | 'incoming' | 'outgoing' | 'unknown';

export interface StockExcelRow {
  /** 1-based row index in the original sheet (header excluded). */
  rowIndex: number;
  /** Supplier / roll barcode when present (Barkod / باركود). */
  barcode: string;
  /** Date column if present (raw string, no formatting assumptions). */
  date: string | null;
  /** اسم الصنف — fabric / item name. */
  itemName: string;
  /** رمز الصنف — item code (may be empty). */
  itemCode: string;
  /** الوحدة — unit (متر / ياردة / كغ ...). */
  unit: string;
  /** اللون — color name (Arabic / generic). */
  colorName: string;
  /** اللون التركي — ZeminRenk / RenkAdi when present. */
  colorNameTr: string;
  /** رمز اللون — color code. */
  colorCode: string;
  /** الكمية / الوارد — quantity in the row's unit. */
  quantity: number;
  /** السعر — unit price. */
  price: number;
  /** سعر التكلفة، إذا كان الملف يميزه عن سعر البيع. */
  costPrice: number;
  /** عرض الثوب بالسنتيمتر، إذا كان موجودا. */
  widthCm: number;
  /** GSM / وزن المتر المربع. */
  gsm: number;
  /** الوزن الفعلي بالكيلوغرام. */
  actualWeightKg: number;
  /** الإجمالي — line total. */
  total: number;
  /** Original raw values keyed by header (for advanced debugging). */
  raw: Record<string, string | number>;
}

export interface StockSheetPreview {
  /** Original Excel sheet name. */
  sheetName: string;
  /** Detected kind based on the sheet name + headers. */
  kind: StockSheetKind;
  /** Index of the row used as header (0-based). */
  headerRowIndex: number;
  /** Raw header values as they appear in the file. */
  rawHeaders: string[];
  /** Total non-empty data rows extracted. */
  totalRows: number;
  /** Total skipped (empty / non-data) rows. */
  skippedRows: number;
  /** Parsed rows (already filtered to non-empty). */
  rows: StockExcelRow[];
  /** Sum of quantity column. */
  totalQuantity: number;
  /** Sum of total column. */
  totalValue: number;
  /** Distinct item names. */
  distinctItemCount: number;
  /** Distinct color names (excluding blanks). */
  distinctColorCount: number;
  /** Distinct units. */
  distinctUnits: string[];
  /** Per-item aggregations sorted by quantity desc. */
  itemBreakdown: Array<{
    itemName: string;
    itemCode: string;
    rollCount: number;
    totalQuantity: number;
    totalValue: number;
    colors: string[];
  }>;
  /** Per-color aggregations sorted by quantity desc. */
  colorBreakdown: Array<{
    colorName: string;
    colorCode: string;
    rollCount: number;
    totalQuantity: number;
  }>;
  /** Soft warnings to surface in the UI. */
  warnings: string[];
}

export interface StockWorkbookPreview {
  fileName: string;
  fileSize: number;
  importedAt: string;
  sheets: StockSheetPreview[];
}

// ─── Header normalisation & mapping ──────────────────────────────────────────

/** Strips whitespace, lowercases, and removes Arabic diacritics for matching. */
const normalize = (raw: unknown): string =>
  String(raw ?? '')
    .replace(/[\u064B-\u065F\u0670]/g, '') // Arabic diacritics
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();

const HEADER_MAP: Record<keyof Omit<StockExcelRow, 'rowIndex' | 'raw'>, string[]> = {
  barcode:   ['باركود', 'باركورد', 'barkod', 'barcode', 'ean'],
  date:      ['التاريخ', 'date', 'tarih'],
  itemName:  ['اسمالصنف', 'اسمالخامة', 'الصنف', 'الخامه', 'الخامة', 'item', 'itemname', 'stokadi', 'stokadı', 'stok adi', 'urun'],
  itemCode:  ['رمزالصنف', 'كودالصنف', 'كودالخامة', 'كودخامة', 'code', 'itemcode', 'sku', 'stokkodu', 'desenadi', 'desenadı', 'desenkodu', 'desenno', 'modelkodu'],
  unit:      ['الوحده', 'الوحدة', 'unit', 'birim'],
  colorName: ['اللون', 'colorname', 'colour'],
  colorNameTr: ['renk', 'renkadi', 'renkadı', 'zeminrenk', 'color'],
  colorCode: ['رمزاللون', 'كوداللون', 'colorcode', 'renkkodu', 'renk_kodu'],
  quantity:  ['الكميه', 'الكمية', 'الطول', 'الوارد', 'qty', 'quantity', 'metre', 'meters', 'meter'],
  price:     ['السعر', 'سعرالبيع', 'sellingprice', 'price', 'fiyat', 'unitprice'],
  costPrice: ['سعرالتكلفه', 'سعرالتكلفة', 'التكلفه', 'التكلفة', 'cost', 'costprice', 'unitcost', 'maliyet'],
  widthCm:   ['العرض', 'عرض', 'عرضالثوب', 'width', 'widthcm', 'en'],
  gsm:       ['gsm', 'جياسام', 'وزنالمتر', 'غرامالمتر', 'gramaj'],
  actualWeightKg: ['الوزن', 'وزن', 'الوزنالصافي', 'الوزنkg', 'weight', 'netweight', 'kg', 'kilo'],
  total:     ['الاجمالى', 'الاجمالي', 'الإجمالي', 'الاجماليه', 'total', 'tutar', 'amount'],
};

function detectColumnIndices(headers: string[]): Record<keyof typeof HEADER_MAP, number> {
  const normHeaders = headers.map(normalize);
  const out = {} as Record<keyof typeof HEADER_MAP, number>;
  (Object.keys(HEADER_MAP) as Array<keyof typeof HEADER_MAP>).forEach((key) => {
    const candidates = HEADER_MAP[key].map(normalize);
    out[key] = normHeaders.findIndex((h) => h && candidates.includes(h));
  });
  return out;
}

// ─── Header row detection ────────────────────────────────────────────────────

/**
 * Find the row that looks like the actual header. Many human-edited workbooks
 * put the company name / sheet title in the first 1-3 rows, so we scan the
 * first 8 rows and pick the first one that contains at least 3 known header
 * keywords.
 */
function findHeaderRow(aoa: Array<Array<string | number>>): number {
  const limit = Math.min(aoa.length, 8);
  const known = new Set<string>();
  Object.values(HEADER_MAP).forEach((arr) => arr.forEach((h) => known.add(normalize(h))));

  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < limit; i++) {
    const row = aoa[i] || [];
    const score = row.reduce<number>((acc, cell) => {
      const n = normalize(cell);
      return acc + (n && known.has(n) ? 1 : 0);
    }, 0);
    if (score >= 3 && score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx >= 0 ? bestIdx : 0;
}

export function isSupplierPurchaseInvoiceHeaders(headers: string[]): boolean {
  const norm = headers.map(normalize);
  const hasBarcode = norm.some((h) => ['barkod', 'باركود', 'باركورد', 'barcode'].includes(h));
  const hasLength = norm.some((h) => ['metre', 'meter', 'meters', 'الطول', 'طول', 'miktar', 'kg'].includes(h));
  const hasMaterial = norm.some((h) =>
    ['stokadi', 'اسمالخامة', 'الخامة', 'اسمالصنف', 'الصنف', 'itemname', 'الخامه'].includes(h),
  );
  return hasBarcode && hasLength && hasMaterial;
}

/** Effective display / grouping color label. */
export function stockRowColorLabel(row: Pick<StockExcelRow, 'colorName' | 'colorNameTr'>): string {
  return row.colorName || row.colorNameTr || '';
}

function detectSheetKind(sheetName: string, headers: string[]): StockSheetKind {
  const n = normalize(sheetName);
  if (n.includes('وارد') || n === 'incoming' || n === 'in') return 'incoming';
  if (n.includes('صادر') || n === 'outgoing' || n === 'out') return 'outgoing';
  if (n.includes('مخزون') || n === 'stock' || n === 'balance' || n === 'inventory') return 'balance';
  if (isSupplierPurchaseInvoiceHeaders(headers)) return 'incoming';
  // Fallback by inspecting headers
  const hasIn = headers.some((h) => normalize(h) === 'الوارد');
  const hasOut = headers.some((h) => normalize(h) === 'الصادر');
  const hasStock = headers.some((h) => normalize(h) === 'المخزن');
  if (hasIn && hasOut && hasStock) return 'balance';
  return 'unknown';
}

// ─── Number coercion ─────────────────────────────────────────────────────────

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null || value === '') return 0;
  let s = String(value).trim().replace(/\s/g, '');
  if (/,\d{1,4}$/.test(s) && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(',', '.');
  }
  const cleaned = s.replace(/[^\d.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function findHeaderIndex(headers: string[], candidates: string[]): number {
  const normHeaders = headers.map(normalize);
  const normCandidates = candidates.map(normalize);
  return normHeaders.findIndex((header) => header && normCandidates.includes(header));
}

function isKnownUnit(value: string): boolean {
  const n = normalize(value);
  return ['متر', 'مترطولي', 'يارد', 'يارده', 'yard', 'yd', 'meter', 'metre', 'kg', 'كيلو', 'كغ'].includes(n);
}

function looksLikeColorCode(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  if (/^#?[0-9a-f]{3,8}$/i.test(s)) return true;
  return /^[a-z]{1,4}[-\s]?\d{1,6}$/i.test(s) || /^[a-z]-?\d{1,6}$/i.test(s);
}

// ─── Date coercion ───────────────────────────────────────────────────────────

function toDateString(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  // Pre-formatted "24l5l2025" / "2025-05-17T..." — keep as-is.
  return s || null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

const readFileAsArrayBuffer = (file: File) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    if (typeof file.arrayBuffer === 'function') {
      file.arrayBuffer().then(resolve).catch(reject);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });

export async function parseStockWorkbook(file: File): Promise<StockWorkbookPreview> {
  const buffer = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  const sheets: StockSheetPreview[] = workbook.SheetNames.map((sheetName) => {
    const ws = workbook.Sheets[sheetName];
    return parseSheet(sheetName, ws);
  });

  return {
    fileName: file.name,
    fileSize: file.size,
    importedAt: new Date().toISOString(),
    sheets,
  };
}

function parseSheet(sheetName: string, ws: XLSX.WorkSheet): StockSheetPreview {
  const aoa = XLSX.utils.sheet_to_json<Array<string | number>>(ws, {
    header: 1,
    defval: '',
    raw: true,
  });
  const warnings: string[] = [];

  if (!aoa.length) {
    return {
      sheetName,
      kind: 'unknown',
      headerRowIndex: 0,
      rawHeaders: [],
      totalRows: 0,
      skippedRows: 0,
      rows: [],
      totalQuantity: 0,
      totalValue: 0,
      distinctItemCount: 0,
      distinctColorCount: 0,
      distinctUnits: [],
      itemBreakdown: [],
      colorBreakdown: [],
      warnings: ['ورقة فارغة'],
    };
  }

  const headerRowIndex = findHeaderRow(aoa);
  const rawHeaders = (aoa[headerRowIndex] || []).map((c) => String(c ?? '').trim());
  const cols = detectColumnIndices(rawHeaders);
  const kind = detectSheetKind(sheetName, rawHeaders);
  const stockQuantityIndex = findHeaderIndex(rawHeaders, ['المخزن', 'الرصيد', 'المتوفر', 'stock', 'balance']);

  // For balance sheets the quantity is "الوارد - الصادر" but in this customer
  // file all those columns are zero, so we just expose them as-is and rely on
  // the price/total columns. The "الوارد" column is mapped to `quantity`.
  if (cols.quantity < 0 && cols.itemName < 0) {
    warnings.push('لم يتم اكتشاف أعمدة معروفة في هذه الورقة — لن تُستورد البيانات.');
  }

  const rows: StockExcelRow[] = [];
  let skipped = 0;
  for (let i = headerRowIndex + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const barcode = cols.barcode >= 0 ? String(row[cols.barcode] ?? '').trim() : '';
    const itemName = String(row[cols.itemName] ?? '').trim();
    let itemCode = cols.itemCode >= 0 ? String(row[cols.itemCode] ?? '').trim() : '';
    let unit = cols.unit >= 0 ? String(row[cols.unit] ?? '').trim() : '';
    let colorName = cols.colorName >= 0 ? String(row[cols.colorName] ?? '').trim() : '';
    let colorNameTr = cols.colorNameTr >= 0 ? String(row[cols.colorNameTr] ?? '').trim() : '';
    let colorCode = cols.colorCode >= 0 ? String(row[cols.colorCode] ?? '').trim() : '';
    const quantitySource =
      kind === 'balance' && stockQuantityIndex >= 0
        ? row[stockQuantityIndex]
        : (cols.quantity >= 0 ? row[cols.quantity] : 0);
    const quantity = toNumber(quantitySource);

    // Some Aleppo sheets have shifted columns: the color name appears under
    // "unit", and the actual color code appears under "color".
    if (!colorCode && colorName && unit && !isKnownUnit(unit) && looksLikeColorCode(colorName)) {
      colorCode = colorName;
      colorName = unit;
      unit = '';
    }
    if (!colorCode && colorName && !unit && looksLikeColorCode(colorName)) {
      colorCode = colorName;
      colorName = '';
    }
    if (unit && !isKnownUnit(unit)) {
      colorName = colorName && colorName !== unit ? `${unit} - ${colorName}` : unit;
      unit = '';
    }
    if (!unit && !itemCode && colorName && cols.unit >= 0 && isKnownUnit(colorName)) {
      unit = colorName;
      colorName = '';
    }

    // Skip completely empty rows OR rows with no item AND no quantity.
    const allBlank = row.every((c) => String(c ?? '').trim() === '');
    if (allBlank || (!itemName && quantity === 0 && !colorName && !colorNameTr)) {
      skipped++;
      continue;
    }

    const raw: Record<string, string | number> = {};
    rawHeaders.forEach((h, idx) => {
      const key = h || `col_${idx + 1}`;
      raw[key] = (row[idx] ?? '') as string | number;
    });

    rows.push({
      rowIndex: i - headerRowIndex,
      barcode,
      date: cols.date >= 0 ? toDateString(row[cols.date]) : null,
      itemName,
      itemCode,
      unit,
      colorName,
      colorNameTr,
      colorCode,
      quantity,
      price: cols.price >= 0 ? toNumber(row[cols.price]) : 0,
      costPrice: cols.costPrice >= 0
        ? toNumber(row[cols.costPrice])
        : (cols.price >= 0 ? toNumber(row[cols.price]) : 0),
      widthCm: cols.widthCm >= 0 ? toNumber(row[cols.widthCm]) : 0,
      gsm: cols.gsm >= 0 ? toNumber(row[cols.gsm]) : 0,
      actualWeightKg: cols.actualWeightKg >= 0 ? toNumber(row[cols.actualWeightKg]) : 0,
      total: cols.total >= 0 ? toNumber(row[cols.total]) : 0,
      raw,
    });
  }

  // لا نملأ الخانات الفارغة تلقائياً — تبقى كما في Excel.

  // ─── Aggregations ──────────────────────────────────────────────────────────
  const totalQuantity = rows.reduce((s, r) => s + r.quantity, 0);
  const totalValue = rows.reduce((s, r) => s + r.total, 0);

  const itemMap = new Map<
    string,
    { itemName: string; itemCode: string; rollCount: number; totalQuantity: number; totalValue: number; colors: Set<string> }
  >();
  const colorMap = new Map<
    string,
    { colorName: string; colorCode: string; rollCount: number; totalQuantity: number }
  >();
  const unitsSet = new Set<string>();

  rows.forEach((r) => {
    if (r.unit) unitsSet.add(r.unit);

    const itemKey = r.itemName || '—';
    const item = itemMap.get(itemKey) ?? {
      itemName: itemKey,
      itemCode: r.itemCode,
      rollCount: 0,
      totalQuantity: 0,
      totalValue: 0,
      colors: new Set<string>(),
    };
    item.rollCount += 1;
    item.totalQuantity += r.quantity;
    item.totalValue += r.total;
    const colorLabel = stockRowColorLabel(r);
    if (colorLabel) item.colors.add(colorLabel);
    if (!item.itemCode && r.itemCode) item.itemCode = r.itemCode;
    itemMap.set(itemKey, item);

    if (colorLabel) {
      const colorKey = colorLabel;
      const c = colorMap.get(colorKey) ?? {
        colorName: colorLabel,
        colorCode: r.colorCode,
        rollCount: 0,
        totalQuantity: 0,
      };
      c.rollCount += 1;
      c.totalQuantity += r.quantity;
      if (!c.colorCode && r.colorCode) c.colorCode = r.colorCode;
      colorMap.set(colorKey, c);
    }
  });

  const itemBreakdown = Array.from(itemMap.values())
    .map((it) => ({
      itemName: it.itemName,
      itemCode: it.itemCode,
      rollCount: it.rollCount,
      totalQuantity: Number(it.totalQuantity.toFixed(3)),
      totalValue: Number(it.totalValue.toFixed(2)),
      colors: Array.from(it.colors).slice(0, 12),
    }))
    .sort((a, b) => b.totalQuantity - a.totalQuantity);

  const colorBreakdown = Array.from(colorMap.values())
    .map((c) => ({
      colorName: c.colorName,
      colorCode: c.colorCode,
      rollCount: c.rollCount,
      totalQuantity: Number(c.totalQuantity.toFixed(3)),
    }))
    .sort((a, b) => b.totalQuantity - a.totalQuantity);

  return {
    sheetName,
    kind,
    headerRowIndex,
    rawHeaders,
    totalRows: rows.length,
    skippedRows: skipped,
    rows,
    totalQuantity: Number(totalQuantity.toFixed(3)),
    totalValue: Number(totalValue.toFixed(2)),
    distinctItemCount: itemMap.size,
    distinctColorCount: colorMap.size,
    distinctUnits: Array.from(unitsSet).sort(),
    itemBreakdown,
    colorBreakdown,
    warnings,
  };
}

// ─── Sheet selection helpers ─────────────────────────────────────────────────

/**
 * Pick the most useful sheet for the import preview:
 * 1. The first sheet whose detected kind is "incoming"
 * 2. Otherwise the first sheet with > 0 rows
 * 3. Otherwise the first sheet
 */
export function pickDefaultSheet(preview: StockWorkbookPreview): StockSheetPreview {
  const incoming = preview.sheets.find((s) => s.kind === 'incoming' && s.totalRows > 0);
  if (incoming) return incoming;
  const balance = preview.sheets.find((s) => s.kind === 'balance' && s.totalRows > 0);
  if (balance) return balance;
  const withRows = preview.sheets.find((s) => s.totalRows > 0);
  if (withRows) return withRows;
  return preview.sheets[0];
}

export const STOCK_SHEET_KIND_LABEL: Record<StockSheetKind, string> = {
  balance:  'الرصيد',
  incoming: 'الوارد',
  outgoing: 'الصادر',
  unknown:  'غير محدد',
};
