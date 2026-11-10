import { apiFetch } from './client';
import type { LegacyStatementParsedRow } from '../customerLegacyStatementExcelParser';

export interface LegacyStatementBatchSummary {
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
}

export interface LegacyStatementEntryRow {
  row_index: number;
  header_row_index: number;
  document_type: string | null;
  document_no: string | null;
  document_date: string | null;
  document_ref: string | null;
  description: string | null;
  unit_price: string | null;
  quantity: string | null;
  bonus: string | null;
  piece_count: string | null;
  line_total: string | null;
  unit: string | null;
  warehouse_name: string | null;
  roll_lot_no: string | null;
  item_code: string | null;
  net_amount: string | null;
  price_with_tax: string | null;
  debit: string;
  credit: string;
  net_debit: string;
  net_credit: string;
  currency_code: string | null;
}

export async function importCustomerLegacyStatementBatch(
  customerId: string,
  payload: {
    fileName: string;
    sheetName: string | null;
    openingBalanceDebit: number;
    openingBalanceCredit: number;
    closingBalanceDebit: number;
    closingBalanceCredit: number;
    totalDebit: number;
    totalCredit: number;
    rows: LegacyStatementParsedRow[];
  },
): Promise<LegacyStatementBatchSummary> {
  const res = await apiFetch<{ ok: boolean; data: LegacyStatementBatchSummary }>(
    `/api/customers/${customerId}/legacy-statement-batches`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return res.data;
}

export async function listCustomerLegacyStatementBatches(customerId: string): Promise<LegacyStatementBatchSummary[]> {
  const res = await apiFetch<{ ok: boolean; data: LegacyStatementBatchSummary[] }>(
    `/api/customers/${customerId}/legacy-statement-batches`,
  );
  return res.data;
}

export async function getCustomerLegacyStatementBatchEntries(batchId: string): Promise<LegacyStatementEntryRow[]> {
  const res = await apiFetch<{ ok: boolean; data: LegacyStatementEntryRow[] }>(
    `/api/customers/legacy-statement-batches/${batchId}/entries`,
  );
  return res.data;
}

export async function deleteCustomerLegacyStatementBatch(batchId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/customers/legacy-statement-batches/${batchId}`, { method: 'DELETE' });
}
