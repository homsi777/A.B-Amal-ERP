import { apiFetch } from './client';

export interface ApiIntakeDispatchSlip {
  id: string;
  company_id: string;
  intake_operation_id: string;
  slip_no: string;
  slip_type: 'STOCK' | 'PURCHASE';
  warehouse_id: string;
  supplier_id: string;
  warehouse_name: string;
  supplier_name: string;
  order_no: string;
  operation_status: 'DRAFT' | 'COMPLETED' | 'VOID';
  purchase_invoice_id: string | null;
  purchase_invoice_no: string | null;
  line_count: number;
  priced_line_count: number;
  created_at: string;
  updated_at: string;
}

export interface ApiIntakeDispatchSlipLine {
  id: string;
  slip_id: string;
  fabric_roll_id: string;
  unit_price: string | null;
  line_total: string | null;
  barcode: string;
  length_m: string;
  item_name: string;
  color_name_ar: string | null;
}

export async function listIntakeDispatchSlips(): Promise<ApiIntakeDispatchSlip[]> {
  const res = await apiFetch<{ ok: boolean; data: ApiIntakeDispatchSlip[] }>('/api/intake-dispatch-slips');
  return res.data;
}

export async function getIntakeDispatchSlip(
  id: string,
): Promise<{ slip: ApiIntakeDispatchSlip; lines: ApiIntakeDispatchSlipLine[] }> {
  const res = await apiFetch<{ ok: boolean; data: { slip: ApiIntakeDispatchSlip; lines: ApiIntakeDispatchSlipLine[] } }>(
    `/api/intake-dispatch-slips/${id}`,
  );
  return res.data;
}

export async function updateIntakeDispatchSlipLinePrices(
  id: string,
  lines: { lineId: string; unitPrice: number }[],
): Promise<void> {
  await apiFetch(`/api/intake-dispatch-slips/${id}/lines`, {
    method: 'PATCH',
    body: JSON.stringify({ lines }),
  });
}

/** إلغاء ورقي بالكامل — الأتواب التي أُنشئت بهذه العملية تبقى بالمخزون كما هي. */
export async function voidIntakeDispatchSlip(id: string): Promise<void> {
  await apiFetch(`/api/intake-dispatch-slips/${id}/void`, { method: 'POST' });
}

/** يُرحِّل إرسالية شراء مُسعَّرة بالكامل إلى فاتورة شراء حقيقية مؤكَّدة —
 * بعدها تظهر بكشف حساب المورّد. متاح فقط لإرساليات slip_type='PURCHASE'. */
export async function createPurchaseInvoiceFromDispatchSlip(
  id: string,
): Promise<{ id: string; invoiceNo: string }> {
  const res = await apiFetch<{ ok: boolean; data: { id: string; invoiceNo: string } }>(
    `/api/intake-dispatch-slips/${id}/create-purchase-invoice`,
    { method: 'POST' },
  );
  return res.data;
}
