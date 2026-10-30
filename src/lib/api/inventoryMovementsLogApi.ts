import { apiFetch } from './client';

export type MovementKind = 'PURCHASE' | 'SALE' | 'PROCESSING' | 'RETURN' | 'TRANSFER' | 'WASTE' | 'MANUAL' | 'INTAKE' | 'OTHER';

export type DocKind = 'INTAKE_STOCK' | 'INTAKE_PURCHASE' | 'INTAKE_PROCESSING' | 'INTAKE_RETURN' | 'SALE';

export interface InventoryMovementDocumentRow {
  doc_kind: DocKind;
  reference_type: string;
  reference_id: string;
  doc_no: string;
  doc_date: string;
  party_name: string | null;
  roll_count: number;
  total_length_m: string | number;
}

export interface InventoryMovementDocumentsParams {
  docKind?: DocKind;
  warehouseId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface InventoryMovementDocumentsResult {
  rows: InventoryMovementDocumentRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listInventoryMovementDocuments(
  params: InventoryMovementDocumentsParams = {},
): Promise<InventoryMovementDocumentsResult> {
  const q = new URLSearchParams();
  if (params.docKind) q.set('docKind', params.docKind);
  if (params.warehouseId) q.set('warehouseId', params.warehouseId);
  if (params.search) q.set('search', params.search);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<{ ok: boolean } & InventoryMovementDocumentsResult>(`/api/inventory-movements-log/documents${qs}`);
  return res;
}

export interface InventoryMovementLogRow {
  id: string;
  movement_no: number;
  movement_at: string;
  movement_type: string;
  movement_kind: MovementKind;
  barcode: string;
  item_name: string;
  color_name: string;
  length_delta_m: string | number | null;
  weight_delta_kg: string | number | null;
  from_warehouse_name: string | null;
  to_warehouse_name: string | null;
  reference_type: string | null;
  reference_no: string | null;
  notes: string | null;
  created_by_name: string | null;
  source_link: string;
}

export interface InventoryMovementsLogParams {
  movementKind?: MovementKind;
  warehouseId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  referenceType?: string;
  referenceId?: string;
  page?: number;
  pageSize?: number;
}

export interface InventoryMovementsLogResult {
  rows: InventoryMovementLogRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listInventoryMovementsLog(
  params: InventoryMovementsLogParams = {},
): Promise<InventoryMovementsLogResult> {
  const q = new URLSearchParams();
  if (params.movementKind) q.set('movementKind', params.movementKind);
  if (params.warehouseId) q.set('warehouseId', params.warehouseId);
  if (params.search) q.set('search', params.search);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.referenceType) q.set('referenceType', params.referenceType);
  if (params.referenceId) q.set('referenceId', params.referenceId);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<{ ok: boolean } & InventoryMovementsLogResult>(`/api/inventory-movements-log${qs}`);
  return res;
}
