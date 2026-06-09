import * as XLSX from 'xlsx';
import { FabricItem } from '../types';

export interface ImportedInventoryRow {
  rowNumber: number;
  colorCode: string;
  itemCode: string;
  name: string;
  unit: string;
  colorName: string;
  incoming: number;
  outgoing: number;
  stockMeters: number;
  price: number;
  total: number;
}

export interface InventoryImportPreview {
  fileName: string;
  sheetName: string;
  totalRows: number;
  importableRows: number;
  uniqueMaterials: number;
  uniqueColors: number;
  totalIncoming: number;
  totalOutgoing: number;
  totalMeters: number;
  totalWeightKg: number | null;
  rows: ImportedInventoryRow[];
}

const clean = (value: unknown) => String(value ?? '').trim();

const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = clean(value).replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeHeader = (value: unknown) => clean(value).replace(/\s+/g, '');

const findHeaderRowIndex = (rows: unknown[][]) =>
  rows.findIndex((row) => row.some((cell) => normalizeHeader(cell) === 'اسمالصنف'));

const chooseImportSheetName = (sheetNames: string[]) => {
  if (sheetNames.includes('وارد')) return 'وارد';
  if (sheetNames.includes('المخزون')) return 'المخزون';
  return sheetNames[0];
};

const getCell = (row: unknown[], columnIndex: number) => row[columnIndex] ?? '';

export function parseInventoryExcelFile(file: File): Promise<InventoryImportPreview> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الإكسل'));
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: 'array' });
        const sheetName = chooseImportSheetName(workbook.SheetNames);
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
          throw new Error('لا يوجد شيت صالح داخل الملف');
        }

        const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '' });
        const headerRowIndex = findHeaderRowIndex(rawRows);
        if (headerRowIndex === -1) {
          throw new Error('لم يتم العثور على أعمدة المخزون داخل الملف');
        }

        const headerRow = rawRows[headerRowIndex].map(normalizeHeader);
        const columnIndex = (name: string, fallback: number) => {
          const found = headerRow.findIndex((header) => header === normalizeHeader(name));
          return found >= 0 ? found : fallback;
        };

        const colorCodeIndex = columnIndex('رمز اللون', 1);
        const nameIndex = columnIndex('اسم الصنف', 2);
        const itemCodeIndex = columnIndex('رمز الصنف', sheetName === 'وارد' ? 4 : 2);
        const unitIndex = columnIndex('الوحدة', sheetName === 'وارد' ? 5 : 3);
        const colorNameIndex = columnIndex('اللون', sheetName === 'وارد' ? 6 : 4);
        const incomingIndex = columnIndex('الوارد', 5);
        const outgoingIndex = columnIndex('الصادر', 6);
        const stockIndex = sheetName === 'وارد' ? columnIndex('الكمية', 7) : columnIndex('المخزن', 7);
        const priceIndex = columnIndex('السعر', sheetName === 'وارد' ? 8 : 8);
        const totalIndex = columnIndex('الاجمالى', sheetName === 'وارد' ? 9 : 9);

        const allRows = rawRows.slice(headerRowIndex + 1).map((row, index) => ({
          rowNumber: headerRowIndex + index + 2,
          colorCode: clean(getCell(row, colorCodeIndex)),
          itemCode: clean(getCell(row, itemCodeIndex)),
          name: clean(getCell(row, nameIndex)),
          unit: clean(getCell(row, unitIndex)) || 'متر',
          colorName: clean(getCell(row, colorNameIndex)),
          incoming: sheetName === 'وارد' ? toNumber(getCell(row, stockIndex)) : toNumber(getCell(row, incomingIndex)),
          outgoing: toNumber(getCell(row, outgoingIndex)),
          stockMeters: toNumber(getCell(row, stockIndex)),
          price: toNumber(getCell(row, priceIndex)),
          total: toNumber(getCell(row, totalIndex)),
        })).filter((row) => row.name || row.colorCode || row.colorName || row.stockMeters > 0);

        const importableRows = allRows.filter((row) => row.stockMeters > 0);
        const uniqueMaterials = new Set(importableRows.map((row) => row.name).filter(Boolean)).size;
        const uniqueColors = new Set(importableRows.map((row) => row.colorName || row.colorCode).filter(Boolean)).size;

        resolve({
          fileName: file.name,
          sheetName,
          totalRows: allRows.length,
          importableRows: importableRows.length,
          uniqueMaterials,
          uniqueColors,
          totalIncoming: allRows.reduce((sum, row) => sum + row.incoming, 0),
          totalOutgoing: allRows.reduce((sum, row) => sum + row.outgoing, 0),
          totalMeters: importableRows.reduce((sum, row) => sum + row.stockMeters, 0),
          totalWeightKg: null,
          rows: importableRows,
        });
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

export function inventoryRowsToFabricItems(rows: ImportedInventoryRow[], warehouseId?: string): Omit<FabricItem, 'id' | 'qrCode'>[] {
  return rows.map((row) => ({
    name: row.name || 'غير محدد',
    fabricCode: row.itemCode || row.colorCode || row.name || `ROW-${row.rowNumber}`,
    colorName: row.colorName || 'غير محدد',
    colorCode: row.colorCode || '#94a3b8',
    lengthType: 'meter',
    length: row.stockMeters,
    rollWidth: 0,
    weight: 0,
    warehouseId,
    costPrice: row.price,
    sellingPrice: row.price,
    status: row.stockMeters > 0 ? 'available' : 'out_of_stock',
    barcode: row.colorCode || row.itemCode || undefined,
    type: row.name,
    yards: Number((row.stockMeters * 1.09361).toFixed(2)),
    meters: row.stockMeters,
    rollNumber: `XLSX-${row.rowNumber}`,
    minStockLevel: 10,
  }));
}
