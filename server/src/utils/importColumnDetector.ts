/**
 * Maps raw Excel column headers to normalized field names.
 * Supports Arabic, Turkish, and English headers.
 */

export type NormalizedField =
  | 'materialName'
  | 'supplierMaterialCode'
  | 'internalMaterialCode'
  | 'colorName'
  | 'colorNameTr'
  | 'colorCode'
  | 'supplierColorCode'
  | 'rollNo'
  | 'barcode'
  | 'lengthM'
  | 'widthCm'
  | 'gsm'
  | 'actualWeightKg'
  | 'calculatedWeightKg'
  | 'quantity'
  | 'unitCost'
  | 'currencyCode'
  | 'batchNo'
  | 'containerNo'
  | 'purchaseInvoiceNo'
  | 'supplierRollRef'
  | 'notes';

type AliasMap = Record<string, NormalizedField>;

export function normalizeDigitsToLatin(input: string): string {
  const map: Record<string, string> = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  };
  return input.replace(/[٠-٩۰-۹]/g, (d) => map[d] ?? d);
}

const normalize = (s: string) =>
  s.trim().toLowerCase()
    .replace(/[\s\-_\/\.]+/g, '')
    .replace(/[ًٌٍَُِّْ]/g, '');  // strip Arabic diacritics

const ALIAS_MAP: AliasMap = {
  // ── Material name ─────────────────────────────────────────────────────────
  'اسمالمادة': 'materialName',
  'اسمالخامة': 'materialName',
  'اسمالصنف': 'materialName',
  'اسمالمنتج': 'materialName',
  'المادة': 'materialName',
  'القماش': 'materialName',
  'الخامة': 'materialName',
  'stokadi': 'materialName',
  'stokadı': 'materialName',
  'stoğadı': 'materialName',
  'material': 'materialName',
  'fabric': 'materialName',
  'materialname': 'materialName',
  'itemname': 'materialName',
  'fabricname': 'materialName',
  'productname': 'materialName',
  'description': 'materialName',

  // ── Supplier material code ────────────────────────────────────────────────
  'كودالمادة': 'supplierMaterialCode',
  'كودالخامة': 'supplierMaterialCode',
  'كودخامة': 'supplierMaterialCode',
  'كودالقماش': 'supplierMaterialCode',
  'كودالتصميم': 'supplierMaterialCode',
  'رقمالتصميم': 'supplierMaterialCode',
  'رقمالخامة': 'supplierMaterialCode',
  'رمزالصنف': 'supplierMaterialCode',
  'كودالصنف': 'supplierMaterialCode',
  'stokkodu': 'supplierMaterialCode',
  'stok_kodu': 'supplierMaterialCode',
  'stokkod': 'supplierMaterialCode',
  'urunkodu': 'supplierMaterialCode',
  'ürünkodu': 'supplierMaterialCode',
  'desen': 'supplierMaterialCode',
  'desenadi': 'supplierMaterialCode',
  'desenad': 'supplierMaterialCode',
  'desenadı': 'supplierMaterialCode',
  'desenno': 'supplierMaterialCode',
  'desenkodu': 'supplierMaterialCode',
  'desennr': 'supplierMaterialCode',
  'varyantno': 'internalMaterialCode',
  'model': 'supplierMaterialCode',
  'modelno': 'supplierMaterialCode',
  'modelkodu': 'supplierMaterialCode',
  'kod': 'supplierMaterialCode',
  'design': 'supplierMaterialCode',
  'designcode': 'supplierMaterialCode',
  'designno': 'supplierMaterialCode',
  'dsam': 'supplierMaterialCode',
  'dsamno': 'supplierMaterialCode',
  'artikel': 'supplierMaterialCode',
  'artikelno': 'supplierMaterialCode',
  'fabriccode': 'supplierMaterialCode',
  'code': 'supplierMaterialCode',
  'materialcode': 'supplierMaterialCode',
  'itemcode': 'supplierMaterialCode',
  'suppliercode': 'supplierMaterialCode',
  'suppliermaterialcode': 'supplierMaterialCode',

  // ── Internal material code ────────────────────────────────────────────────
  'الكودالداخلي': 'internalMaterialCode',
  'كودداخلي': 'internalMaterialCode',
  'internalcode': 'internalMaterialCode',
  'internalmaterialcode': 'internalMaterialCode',
  'erpcode': 'internalMaterialCode',
  'ref': 'internalMaterialCode',

  // ── Color name (Arabic) ───────────────────────────────────────────────────
  'اللون': 'colorName',
  'اسماللون': 'colorName',
  'لوناللون': 'colorName',
  'colorname': 'colorName',
  'color': 'colorName',
  'colour': 'colorName',

  // ── Color name (Turkish) ──────────────────────────────────────────────────
  'renk': 'colorNameTr',
  'renkadi': 'colorNameTr',
  'renkadı': 'colorNameTr',
  'zeminrenk': 'colorNameTr',
  'colornametur': 'colorNameTr',
  'colortr': 'colorNameTr',

  // ── Color code ────────────────────────────────────────────────────────────
  'كوداللون': 'colorCode',
  'رمزاللون': 'colorCode',
  'colorcode': 'colorCode',
  'colourcode': 'colorCode',
  'renkkodu': 'colorCode',
  'renk_kodu': 'colorCode',

  // ── Supplier color code ───────────────────────────────────────────────────
  'كودلوناالمورد': 'supplierColorCode',
  'كودلونالمورد': 'supplierColorCode',
  'suppliercolorcode': 'supplierColorCode',
  'suppliercolourcode': 'supplierColorCode',
  'tedarikcirenkkodu': 'supplierColorCode',

  // ── Roll number ───────────────────────────────────────────────────────────
  'رقمالثوب': 'rollNo',
  'رقمالتوب': 'rollNo',
  'رقمالرول': 'rollNo',
  'رقمالبوبينة': 'rollNo',
  'topno': 'rollNo',
  'partino': 'rollNo',
  'rollno': 'rollNo',
  'rollnumber': 'rollNo',
  'lot': 'rollNo',
  'lotnumber': 'rollNo',
  'topartino': 'rollNo',
  'talepno': 'rollNo',

  // ── Barcode ───────────────────────────────────────────────────────────────
  'باركود': 'barcode',
  'الباركود': 'barcode',
  'barkod': 'barcode',
  'barcode': 'barcode',
  'ean': 'barcode',
  'ean13': 'barcode',
  'qr': 'barcode',

  // ── Length ────────────────────────────────────────────────────────────────
  'الطول': 'lengthM',
  'طول': 'lengthM',
  'متر': 'lengthM',
  'الامتار': 'lengthM',
  'الأمتار': 'lengthM',
  'الاطوال': 'lengthM',
  'metre': 'lengthM',
  'metraj': 'lengthM',
  'length': 'lengthM',
  'lengthm': 'lengthM',
  'meters': 'lengthM',
  'qty': 'lengthM',
  'quantity': 'quantity',
  'miktari': 'lengthM',
  'miktar': 'lengthM',

  // ── Width ─────────────────────────────────────────────────────────────────
  'العرض': 'widthCm',
  'عرض': 'widthCm',
  'عرضالتوب': 'widthCm',
  'en': 'widthCm',
  'widthcm': 'widthCm',
  'width': 'widthCm',
  'widthincm': 'widthCm',
  'genişlik': 'widthCm',
  'genislik': 'widthCm',

  // ── GSM ───────────────────────────────────────────────────────────────────
  'كثافة': 'gsm',
  'gsm': 'gsm',
  'gramaj': 'gsm',
  'grm2': 'gsm',
  'gr/m2': 'gsm',
  'g/m2': 'gsm',
  'gm2': 'gsm',
  'grammage': 'gsm',

  // ── Actual weight ─────────────────────────────────────────────────────────
  'الوزن': 'actualWeightKg',
  'وزن': 'actualWeightKg',
  'الوزنالفعلي': 'actualWeightKg',
  'وزنفعلي': 'actualWeightKg',
  'kg': 'actualWeightKg',
  'kilogram': 'actualWeightKg',
  'netkg': 'actualWeightKg',
  'actualweight': 'actualWeightKg',
  'actualweightkg': 'actualWeightKg',
  'agirlik': 'actualWeightKg',
  'ağırlık': 'actualWeightKg',
  'netağırlık': 'actualWeightKg',

  // ── Calculated weight ─────────────────────────────────────────────────────
  'الوزنالمحسوب': 'calculatedWeightKg',
  'calculatedweight': 'calculatedWeightKg',
  'calculatedweightkg': 'calculatedWeightKg',

  // ── Unit cost ─────────────────────────────────────────────────────────────
  'سعرالتكلفة': 'unitCost',
  'التكلفة': 'unitCost',
  'سعر': 'unitCost',
  'price': 'unitCost',
  'unitcost': 'unitCost',
  'unitprice': 'unitCost',
  'fiyat': 'unitCost',
  'birimfiyat': 'unitCost',

  // ── Currency ──────────────────────────────────────────────────────────────
  'العملة': 'currencyCode',
  'currency': 'currencyCode',
  'currencycode': 'currencyCode',
  'para': 'currencyCode',
  'parabirimi': 'currencyCode',

  // ── Batch no ─────────────────────────────────────────────────────────────
  'رقمالدفعة': 'batchNo',
  'الدفعة': 'batchNo',
  'batchno': 'batchNo',
  'batchnumber': 'batchNo',
  'lotno': 'batchNo',
  'parti': 'batchNo',
  'partino_batch': 'batchNo',

  // ── Container no ─────────────────────────────────────────────────────────
  'رقمالحاوية': 'containerNo',
  'الحاوية': 'containerNo',
  'containerno': 'containerNo',
  'container': 'containerNo',
  'konteyner': 'containerNo',
  'konteynerno': 'containerNo',

  // ── Purchase invoice no ───────────────────────────────────────────────────
  'رقمالفاتورة': 'purchaseInvoiceNo',
  'فاتورةالشراء': 'purchaseInvoiceNo',
  'invoiceno': 'purchaseInvoiceNo',
  'purchaseinvoiceno': 'purchaseInvoiceNo',
  'faturano': 'purchaseInvoiceNo',

  // ── Supplier roll ref ─────────────────────────────────────────────────────
  'مرجعالمورد': 'supplierRollRef',
  'supplierref': 'supplierRollRef',
  'supplierrollref': 'supplierRollRef',
  'supplierbarkod': 'supplierRollRef',
  'tedarikciref': 'supplierRollRef',

  // ── Notes ─────────────────────────────────────────────────────────────────
  'ملاحظات': 'notes',
  'notes': 'notes',
  'note': 'notes',
  'notlar': 'notes',
  'aciklama': 'notes',
  'açıklama': 'notes',
};

/**
 * Build a header→field mapping from the first row of an Excel file.
 * Returns a map of { columnIndex: NormalizedField }.
 */
export function detectColumnMap(
  headers: string[],
): Map<number, NormalizedField> {
  const result = new Map<number, NormalizedField>();
  for (let i = 0; i < headers.length; i++) {
    const key = normalize(headers[i]);
    const field = ALIAS_MAP[key];
    if (field && !Array.from(result.values()).includes(field)) {
      result.set(i, field);
    }
  }
  return result;
}

/**
 * Convert a raw Excel row (array of cell values) to a normalized data object
 * using the column map produced by detectColumnMap.
 */
export function normalizeRow(
  rawRow: unknown[],
  colMap: Map<number, NormalizedField>,
): Partial<Record<NormalizedField, string | number | null>> {
  const result: Partial<Record<NormalizedField, string | number | null>> = {};
  for (const [idx, field] of colMap.entries()) {
    const val = rawRow[idx];
    if (val === null || val === undefined || String(val).trim() === '') {
      result[field] = null;
    } else if (typeof val === 'number') {
      result[field] = val;
    } else {
      result[field] = String(val).trim();
    }
  }
  return result;
}

/** Fields stored as numbers after coercion (Turkish/European decimals like 107,7). */
const NUMERIC_NORMALIZED_FIELDS: NormalizedField[] = [
  'lengthM',
  'widthCm',
  'gsm',
  'actualWeightKg',
  'calculatedWeightKg',
  'quantity',
  'unitCost',
];

export function coerceNormalizedRowNumbers(
  row: Partial<Record<NormalizedField, string | number | null>>,
): void {
  for (const field of NUMERIC_NORMALIZED_FIELDS) {
    if (row[field] === undefined || row[field] === null || row[field] === '') {
      row[field] = null;
      continue;
    }
    row[field] = cleanNumber(row[field]);
  }
}

export function cleanString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return normalizeDigitsToLatin(String(v)).trim();
}

export function cleanNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = normalizeDigitsToLatin(String(v))
    .trim()
    .replace(/٬/g, '')
    .replace(/٫/g, '.')
    .replace(/\s/g, '');
  if (!s) return null;
  // European / Turkish: 1.234,56 → 1234.56
  if (/,\d{1,4}$/.test(s) && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
