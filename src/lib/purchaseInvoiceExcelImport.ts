import * as XLSX from 'xlsx';
import type { FabricItem, InvoiceItem } from '../types';

export interface ImportedPurchaseRoll {
  id: string;
  barcode: string;
  materialName: string;
  designCode: string;
  colorName: string;
  meters: number;
  confirmed: boolean;
  raw: Record<string, string | number>;
}

export interface PurchaseInvoiceImportPreview {
  fileName: string;
  sheetName: string;
  importedAt: string;
  rolls: ImportedPurchaseRoll[];
  warnings: string[];
}

/** Trim control chars, unify case for matching — preserves hyphens and digits. */
export function normalizePurchaseBarcode(raw: string): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\r\n\t]/g, '')
    .trim()
    .toUpperCase();
}

/**
 * O(1) lookup: primary barcode + optional aliases from raw columns (barcode / roll no. style keys only).
 */
export function buildPurchaseRollBarcodeIndex(rolls: ImportedPurchaseRoll[]): Map<string, ImportedPurchaseRoll> {
  const m = new Map<string, ImportedPurchaseRoll>();
  for (const roll of rolls) {
    const primary = normalizePurchaseBarcode(roll.barcode);
    if (primary) m.set(primary, roll);
    for (const [key, val] of Object.entries(roll.raw)) {
      const kn = String(key).toLowerCase();
      if (/barkod|barcode|rollno|rulno|numara|^lot|tedarik|supplier|musteri|müşteri/.test(kn)) {
        const s = normalizePurchaseBarcode(String(val));
        if (s.length >= 4) m.set(s, roll);
      }
    }
  }
  return m;
}

const normalizeHeader = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

const parseNumber = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value || '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const readFileAsArrayBuffer = (file: File) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });

export async function parsePurchaseInvoiceExcelFile(file: File): Promise<PurchaseInvoiceImportPreview> {
  const buffer = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' });
  const warnings: string[] = [];

  if (!rows.length) {
    return { fileName: file.name, sheetName: sheetName || '', importedAt: new Date().toISOString(), rolls: [], warnings: ['ملف Excel فارغ.'] };
  }

  const headers = rows[0].map(normalizeHeader);
  const findColumn = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const barcodeIndex = findColumn('barkod', 'barcode', 'باركود');
  const materialIndex = findColumn('stokadi', 'stokadı', 'material', 'item', 'الخامة');
  const designIndex = findColumn('desenadi', 'desenadı', 'design', 'desen', 'النقشة');
  const colorIndex = findColumn('zeminrenk', 'renk', 'color', 'اللون');
  const metersIndex = findColumn('metre', 'meter', 'meters', 'متر');

  if (barcodeIndex < 0) warnings.push('لم يتم العثور على عمود الباركود Barkod.');
  if (materialIndex < 0) warnings.push('لم يتم العثور على عمود اسم الخامة Stok Adi.');
  if (metersIndex < 0) warnings.push('لم يتم العثور على عمود الأمتار Metre.');

  const seen = new Set<string>();
  const rolls = rows
    .slice(1)
    .map((row, index) => {
      const barcode = String(row[barcodeIndex] || '').trim();
      const materialName = String(row[materialIndex] || '').trim();
      if (!barcode || barcode.length < 5 || !materialName) return null;
      if (seen.has(barcode)) {
        warnings.push(`باركود مكرر في ملف Excel: ${barcode}`);
      }
      seen.add(barcode);

      return {
        id: `${barcode}-${index + 2}`,
        barcode,
        materialName,
        designCode: String(row[designIndex] || '').trim(),
        colorName: String(row[colorIndex] || '').trim(),
        meters: parseNumber(row[metersIndex]),
        confirmed: false,
        raw: Object.fromEntries(headers.map((header, colIndex) => [header || `col_${colIndex + 1}`, row[colIndex] || ''])),
      };
    })
    .filter((roll): roll is ImportedPurchaseRoll => Boolean(roll));

  return {
    fileName: file.name,
    sheetName,
    importedAt: new Date().toISOString(),
    rolls,
    warnings,
  };
}

export function importedRollToInventoryItem(
  roll: ImportedPurchaseRoll,
  options: { warehouseId: string; internalRollId: string },
): Omit<FabricItem, 'id' | 'qrCode'> {
  return {
    name: roll.materialName,
    fabricCode: roll.materialName,
    designNumber: roll.designCode,
    colorName: roll.colorName,
    colorCode: roll.colorName,
    lengthType: 'meter',
    length: roll.meters,
    rollWidth: 150,
    weight: 0,
    warehouseId: options.warehouseId,
    costPrice: 0,
    sellingPrice: 0,
    status: 'available',
    barcode: roll.barcode,
    supplierBarcode: roll.barcode,
    internalRollId: options.internalRollId,
    rollNumber: options.internalRollId,
    type: roll.materialName,
    meters: roll.meters,
    yards: Number((roll.meters * 1.09361).toFixed(2)),
    minStockLevel: 0,
  };
}

export function importedRollToInvoiceItem(roll: ImportedPurchaseRoll, internalRollId: string): InvoiceItem {
  return {
    fabricId: internalRollId,
    quantity: roll.meters,
    unitType: 'meter',
    unitPrice: 0,
    total: 0,
    fabricName: roll.materialName,
    materialName: roll.materialName,
    designCode: roll.designCode,
    colorName: roll.colorName,
    colorCode: roll.colorName,
    barcode: roll.barcode,
    supplierBarcode: roll.barcode,
    internalRollId,
    rollNumber: internalRollId,
    rollNo: internalRollId,
    weight: 0,
    weightKg: 0,
    widthCm: 150,
    note: 'Imported purchase invoice roll confirmed by barcode scan',
  };
}
