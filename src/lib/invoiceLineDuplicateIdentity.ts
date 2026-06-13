/**
 * Duplicate / identity rules for invoice lines (fabric ERP).
 * Same material name alone must NOT imply duplicate — identity uses roll UUID, barcode, or full composite.
 */

export const INVOICE_LINE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeInvoiceIdentityToken(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** True if the line has any identity beyond free-text material name (or bare price). */
export function lineHasMeaningfulFabricIdentity(line: {
  dsamNumber: string;
  colorCode: string;
  colorName: string;
  rollNo: string;
  supplierBarcode: string;
  rawBarcodePayload: string;
  internalRollId: string;
}): boolean {
  const u = line.internalRollId.trim();
  if (u && INVOICE_LINE_UUID_RE.test(u)) return true;
  if (line.dsamNumber.trim()) return true;
  if (line.colorCode.trim()) return true;
  if (line.colorName.trim()) return true;
  if (line.rollNo.trim()) return true;
  if (line.supplierBarcode.trim()) return true;
  if (line.rawBarcodePayload.trim()) return true;
  return false;
}

function normalizePriceKey(price: string): string {
  const n = Number(String(price).replace(/,/g, '.'));
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 10000) / 10000);
}

function normalizeLengthKey(length?: string): string {
  const n = Number(String(length ?? '').replace(/,/g, '.'));
  if (!Number.isFinite(n) || n <= 0) return '0';
  return String(Math.round(n * 1000) / 1000);
}

/**
 * Key for save-time duplicate detection: inventory UUID, barcode, composite (when meaningful), or per-line unique bucket.
 */
export function buildInvoiceSaveDuplicateKey(
  line: {
    id: number;
    materialName: string;
    dsamNumber: string;
    colorCode: string;
    colorName: string;
    rollNo: string;
    length?: string;
    price: string;
    supplierBarcode: string;
    rawBarcodePayload: string;
    internalRollId: string;
  },
  warehouseKey: string,
  opts?: { salesWholesale?: boolean },
): string {
  if (opts?.salesWholesale) {
    const mat = normalizeInvoiceIdentityToken(line.materialName);
    if (mat) return `wh:${warehouseKey}:${mat}`;
  }
  const u = line.internalRollId.trim();
  if (u && INVOICE_LINE_UUID_RE.test(u)) {
    return `u:${u.toLowerCase()}`;
  }
  const bc =
    normalizeInvoiceIdentityToken(line.supplierBarcode) ||
    normalizeInvoiceIdentityToken(line.rawBarcodePayload);
  if (bc) {
    return `b:${bc}`;
  }
  if (!lineHasMeaningfulFabricIdentity(line)) {
    return `i:${line.id}`;
  }
  return [
    'c',
    normalizeInvoiceIdentityToken(line.materialName),
    normalizeInvoiceIdentityToken(line.dsamNumber),
    normalizeInvoiceIdentityToken(line.colorCode),
    normalizeInvoiceIdentityToken(line.colorName),
    normalizeInvoiceIdentityToken(line.rollNo),
    normalizeLengthKey(line.length),
    normalizeInvoiceIdentityToken(warehouseKey),
    normalizePriceKey(line.price),
  ].join('|');
}

export type InvoiceLineIdentityLike = {
  id: number;
  supplierBarcode: string;
  rawBarcodePayload: string;
  internalRollId: string;
};

/** True if this line already represents the same stock row as `stock` (UUID or barcode). */
export function incomingStockConflictsWithLine(
  line: InvoiceLineIdentityLike,
  excludeLineId: number,
  stock: Record<string, unknown>,
): boolean {
  if (line.id === excludeLineId) return false;
  const sid = String(stock.id ?? '').trim();
  if (sid && INVOICE_LINE_UUID_RE.test(sid)) {
    const lid = String(line.internalRollId || '').trim().toLowerCase();
    if (lid === sid.toLowerCase()) return true;
  }
  const sbc =
    normalizeInvoiceIdentityToken(String(stock.barcode ?? '')) ||
    normalizeInvoiceIdentityToken(String((stock as { supplierBarcode?: string }).supplierBarcode ?? ''));
  if (sbc) {
    const lb = normalizeInvoiceIdentityToken(line.supplierBarcode);
    const rb = normalizeInvoiceIdentityToken(line.rawBarcodePayload);
    if (lb === sbc || rb === sbc) return true;
  }
  return false;
}
