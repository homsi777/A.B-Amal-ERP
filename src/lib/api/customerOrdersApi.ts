import type { CustomerOrder, CustomerOrderStatus, OrderTemplate } from '../../types';
import { apiFetch } from './client';

export type CustomerOrderPayload = {
  orderNumber?: string;
  date: string;
  customerId: string;
  currency: string;
  warehouse?: string;
  notes?: string;
  items: CustomerOrder['items'];
  status: CustomerOrderStatus;
  expectedDate?: string;
  templateId?: string;
  advancePayment?: number;
};

function sanitizeOrderPayload(payload: CustomerOrderPayload): CustomerOrderPayload {
  return {
    ...payload,
    orderNumber: payload.orderNumber?.trim() || undefined,
    warehouse: payload.warehouse?.trim() || undefined,
    notes: payload.notes?.trim() || undefined,
    expectedDate: payload.expectedDate?.trim() || undefined,
    templateId: payload.templateId?.trim() || undefined,
    advancePayment:
      payload.advancePayment != null && Number.isFinite(payload.advancePayment)
        ? payload.advancePayment
        : undefined,
    items: payload.items.map((line) => ({
      ...line,
      materialName: line.materialName ?? '',
      dsamNumber: line.dsamNumber ?? '',
      rollNo: line.rollNo ?? '',
      colorCode: line.colorCode ?? '',
      colorName: line.colorName ?? '',
      note: line.note?.trim() || undefined,
      imageUrl:
        line.imageUrl && String(line.imageUrl).trim().startsWith('data:image/')
          ? String(line.imageUrl).trim()
          : line.imageUrl?.trim() || undefined,
      referenceBarcode: line.referenceBarcode?.trim() || undefined,
    })),
  };
}

export type CustomerOrdersListResult = {
  data: CustomerOrder[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listCustomerOrders(params: { search?: string; status?: CustomerOrderStatus } = {}) {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  q.set('pageSize', '200');
  const res = await apiFetch<CustomerOrdersListResult & { ok: boolean }>(`/api/customer-orders?${q}`);
  return res;
}

export async function createCustomerOrderApi(payload: CustomerOrderPayload): Promise<CustomerOrder> {
  const res = await apiFetch<{ ok: boolean; data: CustomerOrder }>('/api/customer-orders', {
    method: 'POST',
    body: JSON.stringify(sanitizeOrderPayload(payload)),
  });
  return res.data;
}

export async function updateCustomerOrderApi(id: string, payload: CustomerOrderPayload): Promise<CustomerOrder> {
  const res = await apiFetch<{ ok: boolean; data: CustomerOrder }>(`/api/customer-orders/${id}`, {
    method: 'PUT',
    body: JSON.stringify(sanitizeOrderPayload(payload)),
  });
  return res.data;
}

export async function updateCustomerOrderStatusApi(id: string, status: CustomerOrderStatus): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/customer-orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function deleteCustomerOrderApi(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/customer-orders/${id}`, { method: 'DELETE' });
}

export async function listOrderTemplatesApi(): Promise<OrderTemplate[]> {
  const res = await apiFetch<{ ok: boolean; data: OrderTemplate[] }>('/api/customer-orders/templates');
  return res.data;
}

export async function createOrderTemplateApi(payload: Omit<OrderTemplate, 'id' | 'createdAt'>): Promise<OrderTemplate> {
  const res = await apiFetch<{ ok: boolean; data: OrderTemplate }>('/api/customer-orders/templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function deleteOrderTemplateApi(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/customer-orders/templates/${id}`, { method: 'DELETE' });
}

export type CustomerOrderImportLine = {
  orderLineId: string;
  materialName: string;
  dsamNumber: string;
  rollNo: string;
  colorCode: string;
  colorName: string;
  metersPerRoll: number;
  rollCount: number;
  orderedMeters: number;
  fulfilledMeters: number;
  remainingMeters: number;
  price: number;
  referenceBarcode?: string;
  widthCm?: number;
  gsm?: number;
  weight?: number;
  note?: string;
};

export type CustomerOrderImportPreview = {
  orderId: string;
  orderNumber: string;
  customerId: string;
  currency: string;
  warehouse?: string;
  status: CustomerOrderStatus;
  lines: CustomerOrderImportLine[];
};

export async function fetchCustomerOrderImportPreview(orderNo: string): Promise<CustomerOrderImportPreview> {
  const encoded = encodeURIComponent(orderNo.trim());
  const res = await apiFetch<{ ok: boolean; data: CustomerOrderImportPreview }>(
    `/api/customer-orders/import-preview/${encoded}`,
  );
  return res.data;
}
