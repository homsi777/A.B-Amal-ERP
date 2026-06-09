import { apiFetch } from './client';

export type TransferStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export interface InventoryTransferRow {
  id: string;
  transfer_no: string;
  transfer_date: string;
  from_warehouse_id: string;
  from_location_id: string | null;
  to_warehouse_id: string;
  to_location_id: string | null;
  status: TransferStatus;
  notes: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  from_warehouse_name?: string;
  to_warehouse_name?: string;
  line_count?: number;
}

export interface InventoryTransferLine {
  id: string;
  fabric_roll_id: string;
  line_barcode: string | null;
  quantity: string;
  notes: string | null;
  roll_no: string | null;
  roll_barcode: string;
  length_m: string;
  roll_status: string;
  item_name: string;
}

export interface InventoryTransferDetail extends InventoryTransferRow {
  lines: InventoryTransferLine[];
}

export async function listInventoryTransfers(params: {
  search?: string;
  status?: TransferStatus;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  if (params.fromWarehouseId) q.set('fromWarehouseId', params.fromWarehouseId);
  if (params.toWarehouseId) q.set('toWarehouseId', params.toWarehouseId);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; data: InventoryTransferRow[]; total: number; page: number; pageSize: number }>(
    `/api/inventory/transfers${qs}`,
  );
}

export async function getInventoryTransfer(id: string) {
  return apiFetch<{ ok: boolean; data: InventoryTransferDetail }>(`/api/inventory/transfers/${id}`);
}

export async function createInventoryTransfer(payload: {
  fromWarehouseId: string;
  fromLocationId?: string | null;
  toWarehouseId: string;
  toLocationId?: string | null;
  transferDate?: string;
  notes?: string | null;
  lines: { fabricRollId: string; quantity?: number; barcode?: string | null; notes?: string | null }[];
}) {
  return apiFetch<{ ok: boolean; data: InventoryTransferRow }>('/api/inventory/transfers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateInventoryTransfer(
  id: string,
  payload: {
    fromWarehouseId: string;
    fromLocationId?: string | null;
    toWarehouseId: string;
    toLocationId?: string | null;
    transferDate?: string;
    notes?: string | null;
    lines: { fabricRollId: string; quantity?: number; barcode?: string | null; notes?: string | null }[];
  },
) {
  return apiFetch<{ ok: boolean; data: InventoryTransferRow }>(`/api/inventory/transfers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function confirmInventoryTransfer(id: string) {
  return apiFetch<{ ok: boolean; data: InventoryTransferRow }>(`/api/inventory/transfers/${id}/confirm`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
}

export async function cancelInventoryTransfer(id: string) {
  return apiFetch<{ ok: boolean; data: InventoryTransferRow }>(`/api/inventory/transfers/${id}/cancel`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
}
