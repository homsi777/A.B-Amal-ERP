/**
 * Execute SURYA purchase import via local API (preview + confirm).
 * Usage: npx tsx server/src/scripts/executeSuryaPurchaseImport.ts [--apply]
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import * as XLSX from 'xlsx';
import { getPool } from '../db/pool.js';
import { signAuthToken } from '../middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env'), quiet: true });

const APPLY = process.argv.includes('--apply');
const FILE = resolve(__dirname, '../../../AHMET BARAKAT SURYA 1.xls');
const REF_BATCH = '52d9c5e6-6ad4-41fa-a015-be0ee9c4307f';
const API = `http://127.0.0.1:${process.env.PORT || '4020'}`;

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
      const matched = HEADER_KEYWORDS.some(
        (keyword) => keyword && (value === keyword || value.includes(keyword) || keyword.includes(value)),
      );
      return sum + (matched ? 1 : 0);
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestScore >= 2 ? bestIndex : 0;
}

function parseExcel(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const preferredSheets = ['وارد', 'فاتورة', 'بيانات', 'مخزون', 'Sheet1', 'Data'];
  const sheetName =
    workbook.SheetNames.find((n) => preferredSheets.includes(n)) ?? workbook.SheetNames[0];
  if (!sheetName) throw new Error('no sheet');
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });
  const headerRowIndex = findHeaderRow(rawRows as unknown[][]);
  const headers = ((rawRows[headerRowIndex] ?? []) as unknown[]).map((h) =>
    h == null ? '' : String(h).trim(),
  );
  const rows = rawRows.slice(headerRowIndex + 1) as unknown[][];
  const preTableRows = rawRows.slice(0, headerRowIndex) as unknown[][];
  return { sheetName, headers, rows, headerRowIndex, preTableRows };
}

async function apiFetch<T>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { ok?: boolean; data?: T; message?: string; error?: string };
  if (!res.ok || json.ok === false) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.data as T;
}

async function main() {
  const pool = getPool();
  const user = await pool.query<{ id: string; company_id: string; username: string; role: string }>(
    `SELECT id, company_id, username, role FROM users WHERE username='admin' AND is_active=true LIMIT 1`,
  );
  if (!user.rows.length) throw new Error('admin user not found');
  const u = user.rows[0];

  const perms = await pool.query<{ code: string }>(
    `SELECT p.code FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     JOIN roles r ON r.id = rp.role_id
     WHERE r.code = $1`,
    [u.role],
  );
  const permissions = perms.rows.map((p) => p.code);

  const batch = await pool.query<{
    supplier_id: string;
    warehouse_id: string;
    default_location_id: string | null;
    currency_code: string | null;
    exchange_rate_to_usd: string;
    invoice_no: string | null;
    invoice_date: string;
    import_mode: string;
    notes: string | null;
  }>(
    `SELECT supplier_id, warehouse_id, default_location_id, currency_code,
            exchange_rate_to_usd::text, invoice_no, invoice_date::text, import_mode, notes
     FROM purchase_import_batches WHERE id=$1`,
    [REF_BATCH],
  );
  if (!batch.rows.length) throw new Error('ref batch not found');
  const b = batch.rows[0];

  const dup = await pool.query(
    `SELECT id FROM purchase_invoices WHERE company_id=$1 AND invoice_no=$2 LIMIT 1`,
    [u.company_id, b.invoice_no],
  );
  const purchaseInvoiceNo = dup.rows.length ? null : b.invoice_no;

  const token = signAuthToken({
    sub: u.id,
    companyId: u.company_id,
    username: u.username,
    role: u.role,
    permissions,
  });

  const buf = readFileSync(FILE);
  const { sheetName, headers, rows, headerRowIndex, preTableRows } = parseExcel(buf);

  console.log(JSON.stringify({ step: 'parsed', sheetName, dataRows: rows.length, apply: APPLY }, null, 2));

  const preview = await apiFetch<{
    batchId: string;
    rowCount: number;
    validCount: number;
    warnCount: number;
    errorCount: number;
    totalLengthM: number;
  }>(token, '/api/purchases/import/preview', {
    fileName: 'AHMET BARAKAT SURYA 1.xls',
    fileSizeBytes: buf.length,
    sheetName,
    headers,
    rows,
    headerRowIndex,
    preTableRows,
    extractedMetadata: {},
    supplierId: b.supplier_id,
    warehouseId: b.warehouse_id,
    defaultLocationId: b.default_location_id,
    currencyCode: b.currency_code || 'USD',
    exchangeRateToUsd: Number(b.exchange_rate_to_usd) || 1,
    invoiceDate: b.invoice_date,
    purchaseInvoiceNo,
    notes: b.notes || 'SURYA safe re-import',
    importMode: b.import_mode,
  });

  console.log(JSON.stringify({ step: 'preview', ...preview }, null, 2));

  if (preview.errorCount > 0) {
    throw new Error(`Preview has ${preview.errorCount} errors — aborting`);
  }

  if (!APPLY) {
    console.log('\n[executeSuryaPurchaseImport] DRY-RUN preview OK — re-run with --apply to confirm');
    await pool.end();
    return;
  }

  const confirmed = await apiFetch<{
    batchId: string;
    createdRollCount: number;
    createdPurchaseInvoiceId: string | null;
    status: string;
  }>(token, `/api/purchases/import/${preview.batchId}/confirm`, {
    allowWarnings: preview.warnCount > 0,
    ignoreErrors: false,
  });

  console.log(JSON.stringify({ step: 'confirmed', ...confirmed }, null, 2));
  await pool.end();
}

main().catch(async (e) => {
  console.error('[executeSuryaPurchaseImport] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
