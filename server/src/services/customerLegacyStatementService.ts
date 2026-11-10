import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool.js';

type ServiceErrorCode = 'VALIDATION' | 'NOT_FOUND';

function fail(message: string, code: ServiceErrorCode): never {
  throw Object.assign(new Error(message), { code });
}

export type LegacyStatementRowInput = {
  rowIndex: number;
  headerRowIndex: number;
  documentType?: string | null;
  documentNo?: string | null;
  documentDate?: string | null;
  documentRef?: string | null;
  description?: string | null;
  unitPrice?: number | null;
  quantity?: number | null;
  bonus?: number | null;
  pieceCount?: number | null;
  lineTotal?: number | null;
  unit?: string | null;
  warehouseName?: string | null;
  rollLotNo?: string | null;
  itemCode?: string | null;
  netAmount?: number | null;
  priceWithTax?: number | null;
  debit?: number | null;
  credit?: number | null;
  netDebit?: number | null;
  netCredit?: number | null;
  currencyCode?: string | null;
  raw?: unknown;
};

export type ImportLegacyStatementBatchInput = {
  companyId: string;
  customerId: string;
  userId: string | null;
  fileName: string;
  sheetName?: string | null;
  openingBalanceDebit?: number;
  openingBalanceCredit?: number;
  closingBalanceDebit?: number;
  closingBalanceCredit?: number;
  totalDebit?: number;
  totalCredit?: number;
  rows: LegacyStatementRowInput[];
};

export type LegacyStatementBatchSummary = {
  id: string;
  fileName: string;
  sheetName: string | null;
  rowCount: number;
  openingBalanceDebit: string;
  openingBalanceCredit: string;
  closingBalanceDebit: string;
  closingBalanceCredit: string;
  totalDebit: string;
  totalCredit: string;
  createdAt: string;
};

async function assertCustomerBelongsToCompany(client: PoolClient, companyId: string, customerId: string): Promise<void> {
  const row = await client.query(`SELECT id FROM customers WHERE id = $1 AND company_id = $2`, [customerId, companyId]);
  if (!row.rows.length) fail('العميل غير موجود', 'NOT_FOUND');
}

/** استيراد دفعة كشف حساب أرشيفي من ملف Excel قديم — عرض فقط، بلا أي تأثير على
 * الفواتير/السندات/المخزون/حسابات العميل الحية. الصفوف تصل مُقسَّمة مسبقاً من
 * المتصفح (نفس نمط stock-import/import-statement)، ولا يُعاد تفكيكها محاسبياً. */
export async function importLegacyStatementBatch(
  client: PoolClient,
  input: ImportLegacyStatementBatchInput,
): Promise<LegacyStatementBatchSummary> {
  if (!input.fileName.trim()) fail('اسم الملف مطلوب', 'VALIDATION');
  if (!input.rows.length) fail('لا توجد صفوف للاستيراد', 'VALIDATION');

  await assertCustomerBelongsToCompany(client, input.companyId, input.customerId);

  const batchRow = await client.query<{ id: string; created_at: string }>(
    `INSERT INTO customer_legacy_statement_batches (
       company_id, customer_id, file_name, sheet_name, row_count,
       opening_balance_debit, opening_balance_credit,
       closing_balance_debit, closing_balance_credit,
       total_debit, total_credit, imported_by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, created_at`,
    [
      input.companyId,
      input.customerId,
      input.fileName.trim(),
      input.sheetName?.trim() || null,
      input.rows.length,
      input.openingBalanceDebit ?? 0,
      input.openingBalanceCredit ?? 0,
      input.closingBalanceDebit ?? 0,
      input.closingBalanceCredit ?? 0,
      input.totalDebit ?? 0,
      input.totalCredit ?? 0,
      input.userId,
    ],
  );
  const batchId = batchRow.rows[0].id;

  for (const row of input.rows) {
    await client.query(
      `INSERT INTO customer_legacy_statement_entries (
         batch_id, company_id, customer_id, row_index, header_row_index,
         document_type, document_no, document_date, document_ref, description,
         unit_price, quantity, bonus, piece_count, line_total, unit,
         warehouse_name, roll_lot_no, item_code, net_amount, price_with_tax,
         debit, credit, net_debit, net_credit, currency_code, raw_json
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
       )`,
      [
        batchId,
        input.companyId,
        input.customerId,
        row.rowIndex,
        row.headerRowIndex,
        row.documentType || null,
        row.documentNo || null,
        row.documentDate || null,
        row.documentRef || null,
        row.description || null,
        row.unitPrice ?? null,
        row.quantity ?? null,
        row.bonus ?? null,
        row.pieceCount ?? null,
        row.lineTotal ?? null,
        row.unit || null,
        row.warehouseName || null,
        row.rollLotNo || null,
        row.itemCode || null,
        row.netAmount ?? null,
        row.priceWithTax ?? null,
        row.debit ?? 0,
        row.credit ?? 0,
        row.netDebit ?? 0,
        row.netCredit ?? 0,
        row.currencyCode || null,
        JSON.stringify(row.raw ?? null),
      ],
    );
  }

  return {
    id: batchId,
    fileName: input.fileName.trim(),
    sheetName: input.sheetName?.trim() || null,
    rowCount: input.rows.length,
    openingBalanceDebit: String(input.openingBalanceDebit ?? 0),
    openingBalanceCredit: String(input.openingBalanceCredit ?? 0),
    closingBalanceDebit: String(input.closingBalanceDebit ?? 0),
    closingBalanceCredit: String(input.closingBalanceCredit ?? 0),
    totalDebit: String(input.totalDebit ?? 0),
    totalCredit: String(input.totalCredit ?? 0),
    createdAt: batchRow.rows[0].created_at,
  };
}

export async function listLegacyStatementBatches(
  companyId: string,
  customerId: string,
): Promise<LegacyStatementBatchSummary[]> {
  const pool: Pool = getPool();
  const res = await pool.query(
    `SELECT id, file_name, sheet_name, row_count,
            opening_balance_debit, opening_balance_credit,
            closing_balance_debit, closing_balance_credit,
            total_debit, total_credit, created_at
     FROM customer_legacy_statement_batches
     WHERE company_id = $1 AND customer_id = $2
     ORDER BY created_at DESC`,
    [companyId, customerId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    sheetName: r.sheet_name,
    rowCount: r.row_count,
    openingBalanceDebit: r.opening_balance_debit,
    openingBalanceCredit: r.opening_balance_credit,
    closingBalanceDebit: r.closing_balance_debit,
    closingBalanceCredit: r.closing_balance_credit,
    totalDebit: r.total_debit,
    totalCredit: r.total_credit,
    createdAt: r.created_at,
  }));
}

export async function getLegacyStatementBatchEntries(
  companyId: string,
  batchId: string,
): Promise<Record<string, unknown>[]> {
  const pool: Pool = getPool();
  const batch = await pool.query(`SELECT id FROM customer_legacy_statement_batches WHERE id = $1 AND company_id = $2`, [
    batchId,
    companyId,
  ]);
  if (!batch.rows.length) fail('الدفعة غير موجودة', 'NOT_FOUND');

  const res = await pool.query(
    `SELECT row_index, header_row_index, document_type, document_no, document_date, document_ref,
            description, unit_price, quantity, bonus, piece_count, line_total, unit,
            warehouse_name, roll_lot_no, item_code, net_amount, price_with_tax,
            debit, credit, net_debit, net_credit, currency_code
     FROM customer_legacy_statement_entries
     WHERE batch_id = $1
     ORDER BY row_index ASC`,
    [batchId],
  );
  return res.rows;
}

export async function deleteLegacyStatementBatch(client: PoolClient, companyId: string, batchId: string): Promise<void> {
  const res = await client.query(
    `DELETE FROM customer_legacy_statement_batches WHERE id = $1 AND company_id = $2 RETURNING id`,
    [batchId, companyId],
  );
  if (!res.rows.length) fail('الدفعة غير موجودة', 'NOT_FOUND');
}
