import { apiFetch } from './client';

export type IntakeActionType = 'PROCESSING' | 'STOCK' | 'RETURN' | 'PURCHASE';

export interface ApiIntakeOperation {
  id: string;
  company_id: string;
  order_no: string;
  supplier_id: string;
  warehouse_id: string;
  action_type: IntakeActionType;
  customer_id: string | null;
  fabric_stage: 'RAW' | 'FINISHED' | null;
  preparation_type_id: string | null;
  status: 'DRAFT' | 'COMPLETED' | 'VOID';
  result_external_job_id: string | null;
  result_dispatch_slip_id: string | null;
  result_return_invoice_id: string | null;
  result_sales_invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateIntakeOperationPayload {
  supplierId: string;
  warehouseId: string;
  actionType: IntakeActionType;
  customerId?: string | null;
  fabricStage?: 'RAW' | 'FINISHED' | null;
  preparationTypeId?: string | null;
}

export interface FinalizeIntakeOperationResult {
  operation: ApiIntakeOperation;
  externalJob?: { id: string; jobNo: string };
  dispatchSlip?: { id: string; slipNo: string };
  returnInvoice?: { id: string; returnNo: string };
  salesInvoice?: { id: string; invoiceNo: string };
}

/** عند actionType='STOCK' فقط — الأتواب المحدَّدة للبيع (بسعر كل منها) وعميل
 * واحد لها جميعاً؛ الباقي يذهب لإرسالية المخزون كالمعتاد. */
export interface FinalizeIntakeOperationSalePayload {
  customerId: string;
  lines: { rollId: string; unitPrice: number }[];
}

export async function getIntakeOperation(id: string): Promise<ApiIntakeOperation> {
  const res = await apiFetch<{ ok: boolean; data: ApiIntakeOperation }>(`/api/intake-operations/${id}`);
  return res.data;
}

export async function createIntakeOperation(payload: CreateIntakeOperationPayload): Promise<ApiIntakeOperation> {
  const res = await apiFetch<{ ok: boolean; data: ApiIntakeOperation }>('/api/intake-operations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function finalizeIntakeOperation(
  id: string,
  sale?: FinalizeIntakeOperationSalePayload,
): Promise<FinalizeIntakeOperationResult> {
  const res = await apiFetch<{ ok: boolean; data: FinalizeIntakeOperationResult }>(
    `/api/intake-operations/${id}/finalize`,
    { method: 'POST', body: JSON.stringify(sale ?? {}) },
  );
  return res.data;
}
