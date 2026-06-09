/**
 * Client for the smart stock-import endpoint.
 * Mirrors the Zod schema in `server/src/routes/stockImportRoutes.ts`.
 */
import { apiFetch } from './client';

export interface StockImportRow {
  itemName: string;
  itemCode?: string;
  barcode?: string;
  colorName?: string;
  colorNameTr?: string;
  colorCode?: string;
  unit?: string;
  quantity: number;
  price?: number;
  costPrice?: number;
  widthCm?: number;
  gsm?: number;
  actualWeightKg?: number;
  date?: string;
  purchaseInvoiceNo?: string;
}

export interface StockImportPayload {
  warehouseId?: string;
  supplierId?: string;
  sourceType?: 'OPENING_STOCK' | 'DIRECT_STOCK_IMPORT' | 'PURCHASE_INVOICE' | 'STOCK_IMPORT';
  fileName?: string;
  sheetName?: string;
  detectedColumns?: Array<Record<string, unknown>>;
  extractedMetadata?: Record<string, unknown>;
  sourceLabel?: string;
  rows: StockImportRow[];
}

export interface StockImportResult {
  warehouseId: string;
  warehouseName: string;
  supplierId?: string | null;
  supplierName?: string | null;
  purchaseInvoiceNo?: string | null;
  batchId?: string;
  sourceType?: string;
  batchTag: string;
  totalRows: number;
  createdRolls: number;
  createdItems: number;
  createdColors: number;
  createdCategories?: number;
  skippedRows: number;
  /** Number of rows whose numeric values were clamped to safe DB bounds. */
  clampedValues?: number;
  errorCount: number;
  errors: Array<{ rowIndex: number; reason: string }>;
  /** Server-side elapsed import time in milliseconds. */
  elapsedMs?: number;
  status?: string;
  queued?: boolean;
  startedAt?: string | null;
  confirmedAt?: string | null;
  failedAt?: string | null;
  errorMessage?: string | null;
}

export async function startStockImport(payload: StockImportPayload): Promise<StockImportResult> {
  const res = await apiFetch<{ ok: boolean; data: StockImportResult }>(
    '/api/inventory/stock-import',
    {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 180_000,
    },
  );
  return res.data;
}

export async function getStockImportStatus(batchId: string): Promise<StockImportResult> {
  const res = await apiFetch<{ ok: boolean; data: StockImportResult }>(
    `/api/inventory/stock-import/${encodeURIComponent(batchId)}/status`,
    {
      method: 'GET',
      timeoutMs: 60_000,
    },
  );
  return res.data;
}
