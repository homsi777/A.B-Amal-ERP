import { apiFetch } from './client';

export async function postCustomerOpeningBalance(
  customerId: string,
  payload: {
    amount: number;
    direction: 'DEBIT' | 'CREDIT';
    asOfDate: string;
    description?: string | null;
  },
): Promise<{ journalEntryId: string; entryNo: string }> {
  const res = await apiFetch<{ ok: boolean; data: { journalEntryId: string; entryNo: string } }>(
    `/api/customers/${customerId}/opening-balance`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return res.data;
}
