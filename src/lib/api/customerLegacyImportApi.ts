import { apiFetch } from './client';
import type { LegacyStatementParsedRow } from '../customerLegacyStatementExcelParser';

export interface LegacyImportResult {
  invoicesCreated: number;
  journalEntriesCreated: number;
  openingBalancePosted: boolean;
  skipped: string[];
}

export async function importCustomerLegacyStatement(
  customerId: string,
  payload: {
    fileName: string;
    currencyCode: string;
    exchangeRateToUsd: number;
    openingBalanceDebit: number;
    openingBalanceCredit: number;
    rows: LegacyStatementParsedRow[];
  },
): Promise<LegacyImportResult> {
  const res = await apiFetch<{ ok: boolean; data: LegacyImportResult }>(
    `/api/customers/${customerId}/legacy-statement-import`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return res.data;
}
