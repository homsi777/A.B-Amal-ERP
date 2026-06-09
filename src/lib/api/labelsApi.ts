import { apiFetch } from './client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LabelTemplateDto {
  id: string;
  company_id: string;
  code: string;
  name: string;
  template_type: string;
  width_mm: number;
  height_mm: number;
  content_config: Record<string, unknown>;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
}

export interface RollLabelPreviewDto {
  rollId: string;
  barcode: string;
  qrPayload: string;
  rollNo: string | null;
  itemName: string | null;
  internalCode: string | null;
  supplierCode: string | null;
  colorNameAr: string | null;
  colorNameTr: string | null;
  colorCode: string | null;
  supplierColorCode: string | null;
  variantCode: string | null;
  lengthM: number | null;
  widthCm: number | null;
  gsm: number | null;
  calculatedWeightKg: number | null;
  actualWeightKg: number | null;
  supplierName: string | null;
  warehouseName: string | null;
  locationName: string | null;
  batchNo: string | null;
  containerNo: string | null;
  purchaseInvoiceNo: string | null;
  supplierRollRef: string | null;
  status: string;
  currencyCode: string | null;
  unitCost: number | null;
}

export interface PrintJobDto {
  id: string;
  company_id: string;
  job_type: string;
  status: 'CREATED' | 'PREVIEWED' | 'PRINTED' | 'FAILED' | 'CANCELLED';
  template_id: string | null;
  source_type: string | null;
  source_id: string | null;
  roll_count: number;
  printed_count: number;
  failed_count: number;
  printer_name: string | null;
  page_size: string | null;
  notes: string | null;
  created_at: string;
  printed_at: string | null;
  error_message: string | null;
  template_name?: string | null;
  width_mm?: number;
  height_mm?: number;
  created_by_name?: string | null;
}

export interface CreatePrintJobPayload {
  rollIds: string[];
  templateId?: string;
  sourceType?: 'ROLL_SELECTION' | 'IMPORT_BATCH' | 'SINGLE_ROLL';
  sourceId?: string;
  printerName?: string;
  pageSize?: string;
  notes?: string;
}

export interface PrintJobFilters {
  page?: number;
  pageSize?: number;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

export async function listLabelTemplates(): Promise<LabelTemplateDto[]> {
  const res = await apiFetch<{ ok: boolean; data: LabelTemplateDto[] }>('/api/labels/templates');
  return res.data;
}

export async function getDefaultLabelTemplate(): Promise<LabelTemplateDto | null> {
  const res = await apiFetch<{ ok: boolean; data: LabelTemplateDto | null }>('/api/labels/templates/default');
  return res.data;
}

export async function previewRollLabels(
  rollIds: string[],
  templateId?: string,
): Promise<{ data: RollLabelPreviewDto[]; template: LabelTemplateDto | null }> {
  const res = await apiFetch<{ ok: boolean; data: RollLabelPreviewDto[]; template: LabelTemplateDto | null }>(
    '/api/labels/rolls/preview',
    { method: 'POST', body: JSON.stringify({ rollIds, templateId }) },
  );
  return { data: res.data, template: res.template };
}

export async function previewBatchLabels(
  batchId: string,
  templateId?: string,
): Promise<{ data: RollLabelPreviewDto[]; template: LabelTemplateDto | null }> {
  const res = await apiFetch<{ ok: boolean; data: RollLabelPreviewDto[]; template: LabelTemplateDto | null }>(
    '/api/labels/rolls/preview-by-batch',
    { method: 'POST', body: JSON.stringify({ batchId, templateId }) },
  );
  return { data: res.data, template: res.template };
}

export async function createPrintJob(
  payload: CreatePrintJobPayload,
): Promise<{ jobId: string; rollCount: number }> {
  const res = await apiFetch<{ ok: boolean; data: { jobId: string; rollCount: number } }>(
    '/api/labels/print-jobs',
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return res.data;
}

export async function updatePrintJobStatus(
  jobId: string,
  status: 'PREVIEWED' | 'PRINTED' | 'FAILED' | 'CANCELLED',
  errorMessage?: string,
): Promise<void> {
  await apiFetch(`/api/labels/print-jobs/${jobId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, errorMessage }),
  });
}

export async function listPrintJobs(
  filters: PrintJobFilters = {},
): Promise<{ data: PrintJobDto[]; total: number }> {
  const q = new URLSearchParams();
  if (filters.page)     q.set('page',     String(filters.page));
  if (filters.pageSize) q.set('pageSize', String(filters.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<{ ok: boolean; data: PrintJobDto[]; total: number }>(`/api/labels/print-jobs${qs}`);
  return { data: res.data, total: res.total };
}

export async function getPrintJob(jobId: string): Promise<PrintJobDto & { labels: unknown[] }> {
  const res = await apiFetch<{ ok: boolean; data: PrintJobDto & { labels: unknown[] } }>(`/api/labels/print-jobs/${jobId}`);
  return res.data;
}
