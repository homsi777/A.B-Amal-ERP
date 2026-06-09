import { apiFetch } from './client';

export type WasteStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export type WasteType =
  | 'DAMAGE'
  | 'SHORTAGE'
  | 'CUTTING_WASTE'
  | 'QUALITY_REJECT'
  | 'LOST'
  | 'OTHER';

export interface InventoryWasteRow {
  id: string;
  waste_no: string;
  waste_date: string;
  waste_type: WasteType;
  warehouse_id: string | null;
  location_id: string | null;
  status: WasteStatus;
  reason: string | null;
  notes: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  warehouse_name?: string | null;
  line_count?: number;
}

export interface InventoryWasteLine {
  id: string;
  fabric_roll_id: string;
  line_barcode: string | null;
  quantity: string;
  waste_length_m: string | null;
  waste_weight_kg: string | null;
  notes: string | null;
  roll_no: string | null;
  roll_barcode: string;
  length_m: string;
  roll_status: string;
  item_name: string;
}

export interface InventoryWasteDetail extends InventoryWasteRow {
  lines: InventoryWasteLine[];
}

export async function listInventoryWaste(params: {
  search?: string;
  status?: WasteStatus;
  wasteType?: WasteType;
  warehouseId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  if (params.wasteType) q.set('wasteType', params.wasteType);
  if (params.warehouseId) q.set('warehouseId', params.warehouseId);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; data: InventoryWasteRow[]; total: number; page: number; pageSize: number }>(
    `/api/inventory/waste${qs}`,
  );
}

export async function getInventoryWaste(id: string) {
  return apiFetch<{ ok: boolean; data: InventoryWasteDetail }>(`/api/inventory/waste/${id}`);
}

export async function createInventoryWaste(payload: {
  wasteType?: WasteType;
  warehouseId?: string | null;
  locationId?: string | null;
  wasteDate?: string;
  reason?: string | null;
  notes?: string | null;
  lines: {
    fabricRollId: string;
    quantity?: number;
    barcode?: string | null;
    wasteLengthM?: number | null;
    wasteWeightKg?: number | null;
    notes?: string | null;
  }[];
}) {
  return apiFetch<{ ok: boolean; data: InventoryWasteRow }>('/api/inventory/waste', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateInventoryWaste(
  id: string,
  payload: {
    wasteType?: WasteType;
    warehouseId?: string | null;
    locationId?: string | null;
    wasteDate?: string;
    reason?: string | null;
    notes?: string | null;
    lines: {
      fabricRollId: string;
      quantity?: number;
      barcode?: string | null;
      wasteLengthM?: number | null;
      wasteWeightKg?: number | null;
      notes?: string | null;
    }[];
  },
) {
  return apiFetch<{ ok: boolean; data: InventoryWasteRow }>(`/api/inventory/waste/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function confirmInventoryWaste(id: string) {
  return apiFetch<{ ok: boolean; data: InventoryWasteRow }>(`/api/inventory/waste/${id}/confirm`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
}

export async function cancelInventoryWaste(id: string) {
  return apiFetch<{ ok: boolean; data: InventoryWasteRow }>(`/api/inventory/waste/${id}/cancel`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
}
