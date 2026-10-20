import { apiFetch } from './client';

export type ExternalJobDocumentStatus = 'DRAFT' | 'CONFIRMED' | 'VOIDED';
export type ExternalJobLineStatus = 'SENT' | 'RECEIVED' | 'CANCELLED';
export type ExternalJobKind = 'GENERAL' | 'PROCESSING';
export type FabricStage = 'RAW' | 'FINISHED';

export interface ExternalJob {
  id: string;
  company_id: string;
  job_no: string;
  supplier_id: string;
  supplier_name?: string;
  sent_date: string;
  notes: string | null;
  fee_amount: string | number | null;
  fee_currency_code: string | null;
  fee_exchange_rate_to_usd: string | number | null;
  fee_posted_at: string | null;
  document_status: ExternalJobDocumentStatus;
  job_kind: ExternalJobKind;
  fabric_stage: FabricStage | null;
  preparation_type_id: string | null;
  preparation_type_name?: string | null;
  source_warehouse_id: string | null;
  source_warehouse_name?: string | null;
  supplier_order_no: number | null;
  process_description: string | null;
  line_count?: number;
  received_count?: number;
  created_at: string;
  updated_at: string;
}

export interface PreparationType {
  id: string;
  name: string;
  default_waste_pct: string | number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateProcessingJobPayload {
  supplierId: string;
  fabricStage: FabricStage;
  preparationTypeId: string;
  sourceWarehouseId: string;
  processDescription?: string | null;
  notes?: string | null;
  rollIds: string[];
}

export interface CreateProcessingJobResult {
  id: string;
  jobNo: string;
  supplierOrderNo: number;
  totalRolls: number;
  totalM: number;
  totalKg: number;
}

export interface ExternalJobLine {
  id: string;
  job_id: string;
  roll_id: string;
  line_status: ExternalJobLineStatus;
  sent_color_id: string | null;
  sent_length_m: string | number | null;
  sent_barcode: string | null;
  sent_color_name_ar?: string | null;
  sent_color_code?: string | null;
  received_at: string | null;
  received_by_user_id: string | null;
  new_color_id: string | null;
  new_barcode: string | null;
  new_length_m: string | number | null;
  new_color_name_ar?: string | null;
  new_color_code?: string | null;
  receipt_notes: string | null;
  current_barcode?: string | null;
  current_length_m?: string | number | null;
  current_color_name_ar?: string | null;
  current_color_code?: string | null;
  roll_status?: string | null;
  roll_width_cm?: string | number | null;
  roll_gsm?: string | number | null;
  roll_weight_kg?: string | number | null;
  item_name?: string | null;
  item_internal_code?: string | null;
}

export interface ExternalJobDetail extends ExternalJob {
  lines: ExternalJobLine[];
  supplier_phone?: string | null;
  preparation_type_default_waste_pct?: string | number | null;
}

export interface CreateExternalJobPayload {
  supplierId: string;
  sentDate?: string;
  notes?: string | null;
  feeAmount?: number | null;
  feeCurrencyCode?: string | null;
  lines: { rollId: string }[];
}

export interface ReceiveExternalJobLinePayload {
  newColorName?: string | null;
  newColorCode?: string | null;
  newBarcode?: string | null;
  newLengthM?: number | null;
  receiptNotes?: string | null;
}

export async function listExternalJobs(params: {
  search?: string;
  supplierId?: string;
  documentStatus?: ExternalJobDocumentStatus | 'ALL';
  dateFrom?: string;
  dateTo?: string;
  jobKind?: ExternalJobKind;
  page?: number;
  pageSize?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.supplierId) q.set('supplierId', params.supplierId);
  if (params.documentStatus) q.set('documentStatus', params.documentStatus);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.jobKind) q.set('jobKind', params.jobKind);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; rows: ExternalJob[]; total: number; page: number; pageSize: number }>(
    `/api/external-jobs${qs}`,
  );
}

export async function getExternalJob(id: string) {
  return apiFetch<{ ok: boolean; data: ExternalJobDetail }>(`/api/external-jobs/${id}`);
}

export async function createExternalJob(payload: CreateExternalJobPayload) {
  return apiFetch<{ ok: boolean; data: { id: string; jobNo: string } }>('/api/external-jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function confirmExternalJob(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/external-jobs/${id}/confirm`, { method: 'POST', body: '{}' });
}

export async function receiveExternalJobLine(jobId: string, lineId: string, payload: ReceiveExternalJobLinePayload) {
  return apiFetch<{ ok: boolean }>(`/api/external-jobs/${jobId}/lines/${lineId}/receive`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function setExternalJobFee(id: string, feeAmount: number, feeCurrencyCode: string) {
  return apiFetch<{ ok: boolean }>(`/api/external-jobs/${id}/fee`, {
    method: 'POST',
    body: JSON.stringify({ feeAmount, feeCurrencyCode }),
  });
}

export async function postExternalJobFee(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/external-jobs/${id}/post-fee`, { method: 'POST', body: '{}' });
}

export async function voidExternalJob(id: string, reason?: string | null) {
  return apiFetch<{ ok: boolean }>(`/api/external-jobs/${id}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason ?? null }),
  });
}

// ─── Preparation types ("مصنعية") ────────────────────────────────────────────

export async function listPreparationTypes(includeInactive = false) {
  const qs = includeInactive ? '?includeInactive=true' : '';
  return apiFetch<{ ok: boolean; data: PreparationType[] }>(`/api/external-jobs/preparation-types${qs}`);
}

export async function createPreparationType(payload: { name: string; defaultWastePct?: number | null }) {
  return apiFetch<{ ok: boolean; data: PreparationType }>('/api/external-jobs/preparation-types', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updatePreparationType(
  id: string,
  payload: { name?: string; defaultWastePct?: number | null; isActive?: boolean },
) {
  return apiFetch<{ ok: boolean; data: PreparationType }>(`/api/external-jobs/preparation-types/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

// ─── Processing ("مصنعية") dispatch ──────────────────────────────────────────

export async function createProcessingExternalJob(payload: CreateProcessingJobPayload) {
  return apiFetch<{ ok: boolean; data: CreateProcessingJobResult }>('/api/external-jobs/processing', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function editProcessingExternalJob(
  id: string,
  payload: { password: string; processDescription?: string | null; notes?: string | null; preparationTypeId?: string },
) {
  return apiFetch<{ ok: boolean }>(`/api/external-jobs/${id}/processing`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function voidProcessingExternalJob(id: string, payload: { password: string; reason?: string | null }) {
  return apiFetch<{ ok: boolean }>(`/api/external-jobs/${id}/void-processing`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
