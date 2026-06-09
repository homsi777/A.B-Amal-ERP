import { apiFetch } from './client';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RollStatus =
  | 'AVAILABLE'
  | 'RESERVED'
  | 'SOLD'
  | 'DAMAGED'
  | 'TRANSFERRED'
  | 'INACTIVE';

export interface FabricRollDto {
  id: string;
  company_id: string;
  roll_no: string | null;
  barcode: string;
  item_id: string;
  color_id: string | null;
  variant_id: string | null;
  supplier_id: string | null;
  warehouse_id: string;
  location_id: string | null;
  length_m: string;
  width_cm: string | null;
  gsm: string | null;
  calculated_weight_kg: string | null;
  actual_weight_kg: string | null;
  unit_cost: string | null;
  currency_code: string | null;
  batch_no: string | null;
  container_no: string | null;
  purchase_invoice_no: string | null;
  supplier_roll_ref: string | null;
  status: RollStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined display fields
  item_name?: string;
  internal_code?: string;
  supplier_code_item?: string;
  color_name_ar?: string;
  color_name_tr?: string;
  color_code?: string;
  hex_color?: string | null;
  variant_code?: string | null;
  supplier_name?: string | null;
  warehouse_name?: string;
  location_name?: string | null;
  label_print_count?: number;
  last_label_printed_at?: string | null;
}

export interface InventoryMovementDto {
  id: string;
  roll_id: string;
  movement_type: string;
  from_warehouse_id: string | null;
  to_warehouse_id: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  old_status: string | null;
  new_status: string | null;
  length_delta_m: string | null;
  weight_delta_kg: string | null;
  reference_type: string | null;
  reference_no: string | null;
  notes: string | null;
  created_at: string;
  from_warehouse_name?: string | null;
  to_warehouse_name?: string | null;
  from_location_name?: string | null;
  to_location_name?: string | null;
  created_by_name?: string | null;
}

export interface FabricRollListFilters {
  search?: string;
  barcode?: string;
  status?: RollStatus;
  warehouseId?: string;
  locationId?: string;
  itemId?: string;
  colorId?: string;
  variantId?: string;
  supplierId?: string;
  batchNo?: string;
  containerNo?: string;
  labelPrinted?: 'true' | 'false' | '';
  purchaseScope?: 'all' | 'purchased' | 'recent';
  recentDays?: number;
  /** When true, server returns only AVAILABLE rolls with length_m > 0 (takes precedence over status). */
  onlyAvailable?: boolean;
  sortBy?: 'created_at' | 'item_name' | 'internal_code' | 'barcode';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface FabricRollListResult {
  data: FabricRollDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FabricPricingGroupDto {
  item_id: string;
  item_name: string;
  internal_code: string;
  roll_count: number;
  color_count: number;
  total_meters: string;
  total_kg: string;
  avg_unit_cost: string;
  min_unit_cost: string;
  max_unit_cost: string;
  available_roll_count: number;
  default_selling_price: string | null;
  default_selling_currency_code: string | null;
  last_purchase_invoice_id: string | null;
  last_purchase_invoice_no: string | null;
  last_purchase_invoice_date: string | null;
}

export interface FabricPricingFilters {
  search?: string;
  batchTag?: string;
  supplierId?: string;
  warehouseId?: string;
  /** Force-scope by a specific purchase invoice. */
  purchaseInvoiceId?: string;
  /** When true and no purchaseInvoiceId is set, scope to the most recent purchase invoice. */
  lastInvoice?: boolean;
}

export interface FabricPricingGroupsResult {
  data: FabricPricingGroupDto[];
  resolvedPurchaseInvoiceId: string | null;
}

export interface RecentPurchaseInvoiceDto {
  id: string;
  invoice_no: string;
  supplier_invoice_no: string | null;
  invoice_date: string;
  supplier_id: string;
  warehouse_id: string | null;
  currency_code: string;
  total_amount: string;
  document_status: 'DRAFT' | 'CONFIRMED' | 'VOIDED';
  supplier_name: string | null;
  warehouse_name: string | null;
  roll_count: number;
}

export interface FinalizedBulkPurchaseDto {
  invoiceId: string;
  invoiceNo: string;
  supplierId: string;
  supplierName: string;
  batchTag: string;
  rollCount: number;
  totalAmount: number;
}

export interface FabricRollCreatePayload {
  barcode?: string;
  rollNo?: string;
  itemId: string;
  colorId?: string | null;
  variantId?: string | null;
  supplierId?: string | null;
  warehouseId: string;
  locationId?: string | null;
  lengthM: number;
  widthCm?: number | null;
  gsm?: number | null;
  actualWeightKg?: number | null;
  unitCost?: number | null;
  currencyCode?: string | null;
  batchNo?: string | null;
  containerNo?: string | null;
  purchaseInvoiceNo?: string | null;
  supplierRollRef?: string | null;
  notes?: string | null;
}

export interface FabricRollUpdatePayload {
  itemId?: string;
  colorId?: string | null;
  variantId?: string | null;
  rollNo?: string | null;
  supplierId?: string | null;
  locationId?: string | null;
  lengthM?: number;
  widthCm?: number | null;
  gsm?: number | null;
  actualWeightKg?: number | null;
  unitCost?: number | null;
  currencyCode?: string | null;
  batchNo?: string | null;
  containerNo?: string | null;
  purchaseInvoiceNo?: string | null;
  supplierRollRef?: string | null;
  notes?: string | null;
}

// ─── API calls ───────────────────────────────────────────────────────────────

export async function listFabricRolls(filters: FabricRollListFilters = {}): Promise<FabricRollListResult> {
  const q = new URLSearchParams();
  if (filters.search)      q.set('search',      filters.search);
  if (filters.barcode)     q.set('barcode',      filters.barcode);
  if (filters.status)      q.set('status',       filters.status);
  if (filters.warehouseId) q.set('warehouseId',  filters.warehouseId);
  if (filters.locationId)  q.set('locationId',   filters.locationId);
  if (filters.itemId)      q.set('itemId',       filters.itemId);
  if (filters.colorId)     q.set('colorId',      filters.colorId);
  if (filters.variantId)   q.set('variantId',    filters.variantId);
  if (filters.supplierId)  q.set('supplierId',   filters.supplierId);
  if (filters.batchNo)     q.set('batchNo',      filters.batchNo);
  if (filters.containerNo) q.set('containerNo',  filters.containerNo);
  if (filters.labelPrinted) q.set('labelPrinted', filters.labelPrinted);
  if (filters.purchaseScope && filters.purchaseScope !== 'all') q.set('purchaseScope', filters.purchaseScope);
  if (filters.recentDays) q.set('recentDays', String(filters.recentDays));
  if (filters.onlyAvailable) q.set('onlyAvailable', 'true');
  if (filters.sortBy) q.set('sortBy', filters.sortBy);
  if (filters.sortDir) q.set('sortDir', filters.sortDir);
  if (filters.page)        q.set('page',         String(filters.page));
  if (filters.pageSize)    q.set('pageSize',     String(filters.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<FabricRollListResult & { ok: boolean }>(`/api/inventory/rolls${qs}`);
  return res;
}

export async function listFabricPricingGroups(
  filters: string | FabricPricingFilters = '',
): Promise<FabricPricingGroupsResult> {
  const resolved: FabricPricingFilters = typeof filters === 'string' ? { search: filters } : filters;
  const q = new URLSearchParams();
  if (resolved.search?.trim()) q.set('search', resolved.search.trim());
  if (resolved.batchTag?.trim()) q.set('batchTag', resolved.batchTag.trim());
  if (resolved.supplierId) q.set('supplierId', resolved.supplierId);
  if (resolved.warehouseId) q.set('warehouseId', resolved.warehouseId);
  if (resolved.purchaseInvoiceId) q.set('purchaseInvoiceId', resolved.purchaseInvoiceId);
  if (resolved.lastInvoice) q.set('lastInvoice', 'true');
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<{
    ok: boolean;
    data: FabricPricingGroupDto[];
    resolvedPurchaseInvoiceId: string | null;
  }>(`/api/inventory/rolls/bulk-pricing/groups${qs}`);
  return { data: res.data, resolvedPurchaseInvoiceId: res.resolvedPurchaseInvoiceId };
}

export async function listRecentPurchaseInvoicesForPricing(limit = 50): Promise<RecentPurchaseInvoiceDto[]> {
  const q = new URLSearchParams();
  q.set('limit', String(Math.max(1, Math.min(200, limit))));
  const res = await apiFetch<{ ok: boolean; data: RecentPurchaseInvoiceDto[] }>(
    `/api/inventory/rolls/bulk-pricing/recent-purchase-invoices?${q.toString()}`,
  );
  return res.data;
}

export interface BulkPricingUpdateResult {
  updatedCount: number;
  updatedSellingPriceOnItem: boolean;
  updatedDraftInvoices: number;
  updatedDraftVouchers: number;
  /** Confirmed purchase invoices whose lines + header totals were auto-updated. */
  updatedConfirmedInvoices: number;
  /** GL journal entries that were reversed and re-posted with the new total. */
  repostedGlEntries: number;
  /** Always 0 with the new auto-cascade behavior; kept for backward compatibility. */
  skippedConfirmedInvoices: number;
}

export async function updateFabricBulkPricing(payload: {
  itemId: string;
  unitCost?: number;
  sellingPrice?: number;
  sellingCurrencyCode?: string;
  onlyAvailable?: boolean;
  batchTag?: string;
  supplierId?: string;
  warehouseId?: string;
  purchaseInvoiceId?: string;
  cascadeToInvoices?: boolean;
}): Promise<BulkPricingUpdateResult> {
  const res = await apiFetch<{ ok: boolean; data: BulkPricingUpdateResult }>(
    '/api/inventory/rolls/bulk-pricing',
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
  return res.data;
}

export async function finalizeBulkPurchaseAfterPricing(payload: {
  batchTag: string;
  supplierId: string;
  warehouseId?: string;
  currencyCode?: string;
}): Promise<FinalizedBulkPurchaseDto> {
  const res = await apiFetch<{ ok: boolean; data: FinalizedBulkPurchaseDto }>(
    '/api/inventory/rolls/bulk-pricing/finalize-purchase',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return res.data;
}

export async function getFabricRoll(id: string): Promise<FabricRollDto & { movements: InventoryMovementDto[] }> {
  const res = await apiFetch<{ ok: boolean; data: FabricRollDto & { movements: InventoryMovementDto[] } }>(
    `/api/inventory/rolls/${id}`,
  );
  return res.data;
}

export async function createFabricRoll(payload: FabricRollCreatePayload): Promise<FabricRollDto> {
  const res = await apiFetch<{ ok: boolean; data: FabricRollDto }>('/api/inventory/rolls', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateFabricRoll(id: string, payload: FabricRollUpdatePayload): Promise<FabricRollDto> {
  const res = await apiFetch<{ ok: boolean; data: FabricRollDto }>(`/api/inventory/rolls/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateFabricRollStatus(
  id: string,
  status: RollStatus,
  notes?: string,
): Promise<FabricRollDto> {
  const res = await apiFetch<{ ok: boolean; data: FabricRollDto }>(`/api/inventory/rolls/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, notes }),
  });
  return res.data;
}

export async function moveFabricRoll(
  id: string,
  payload: { toWarehouseId: string; toLocationId?: string | null; notes?: string },
): Promise<FabricRollDto> {
  const res = await apiFetch<{ ok: boolean; data: FabricRollDto }>(`/api/inventory/rolls/${id}/move`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function getFabricRollMovements(id: string): Promise<InventoryMovementDto[]> {
  const res = await apiFetch<{ ok: boolean; data: InventoryMovementDto[] }>(
    `/api/inventory/rolls/${id}/movements`,
  );
  return res.data;
}

/** Fill only missing/zero length_m and actual_weight_kg from sales invoice (server rejects overwrites). */
export async function completeMissingRollFields(
  rollId: string,
  payload: { lengthMeters?: number; weightKg?: number },
): Promise<{ applied: boolean; message: string | null; data: FabricRollDto }> {
  const res = await apiFetch<{
    ok: boolean;
    applied: boolean;
    message: string | null;
    data: FabricRollDto;
  }>(`/api/inventory/rolls/${rollId}/missing-fields`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return { applied: res.applied, message: res.message ?? null, data: res.data };
}
