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
  printBarcode?: string;
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
  if (line.printBarcode?.trim()) return true;
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
): string {
  const u = line.internalRollId.trim();
  if (u && INVOICE_LINE_UUID_RE.test(u)) {
    return `u:${u.toLowerCase()}`;
  }
  const bc =
    normalizeInvoiceIdentityToken(line.supplierBarcode) ||
    normalizeInvoiceIdentityToken(line.rawBarcodePayload) ||
    normalizeInvoiceIdentityToken((line as { printBarcode?: string }).printBarcode ?? '');
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
  printBarcode?: string;
  internalRollId: string;
};

function lineBarcodeTokens(line: InvoiceLineIdentityLike): string[] {
  return [
    normalizeInvoiceIdentityToken(line.supplierBarcode),
    normalizeInvoiceIdentityToken(line.rawBarcodePayload),
    normalizeInvoiceIdentityToken(line.printBarcode ?? ''),
  ].filter(Boolean);
}

function stockBarcodeTokens(stock: Record<string, unknown>): string[] {
  const row = stock as {
    barcode?: string;
    supplierBarcode?: string;
    supplier_barcode?: string;
    roll_no?: string;
    rollNumber?: string;
    supplier_roll_ref?: string;
  };
  return [
    normalizeInvoiceIdentityToken(String(row.barcode ?? '')),
    normalizeInvoiceIdentityToken(String(row.supplierBarcode ?? row.supplier_barcode ?? '')),
    normalizeInvoiceIdentityToken(String(row.roll_no ?? row.rollNumber ?? '')),
    normalizeInvoiceIdentityToken(String(row.supplier_roll_ref ?? '')),
  ].filter(Boolean);
}

/**
 * Scan-time duplicate key while entering invoice lines (barcode scan / stock apply).
 * Must NOT treat same material + length alone as duplicate — each roll needs its own barcode/UUID/roll.
 */
export function buildInvoiceScanDuplicateKey(
  line: {
    id: number;
    materialName: string;
    dsamNumber: string;
    colorCode: string;
    colorName: string;
    rollNo: string;
    length?: string;
    supplierBarcode: string;
    rawBarcodePayload: string;
    printBarcode?: string;
    internalRollId: string;
  },
): string {
  const bc =
    normalizeInvoiceIdentityToken(line.supplierBarcode) ||
    normalizeInvoiceIdentityToken(line.rawBarcodePayload) ||
    normalizeInvoiceIdentityToken(line.printBarcode ?? '');
  if (bc) {
    return `b:${bc}`;
  }
  const u = line.internalRollId.trim();
  if (u && INVOICE_LINE_UUID_RE.test(u)) {
    return `u:${u.toLowerCase()}`;
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
  ].join('|');
}

/** True if this line already represents the same stock row as `stock` (UUID or barcode). */
export function incomingStockConflictsWithLine(
  line: InvoiceLineIdentityLike,
  excludeLineId: number,
  stock: Record<string, unknown>,
  scannedBarcode = '',
): boolean {
  if (line.id === excludeLineId) return false;
  const sid = String(stock.id ?? '').trim();
  if (sid && INVOICE_LINE_UUID_RE.test(sid)) {
    const lid = String(line.internalRollId || '').trim().toLowerCase();
    if (lid === sid.toLowerCase()) return true;
  }
  const scanned = normalizeInvoiceIdentityToken(scannedBarcode);
  if (scanned) {
    const lineTokens = lineBarcodeTokens(line);
    if (lineTokens.includes(scanned)) return true;
  }
  const stockTokens = stockBarcodeTokens(stock);
  if (!stockTokens.length) return false;
  const lineTokens = lineBarcodeTokens(line);
  return stockTokens.some((token) => lineTokens.includes(token));
}
