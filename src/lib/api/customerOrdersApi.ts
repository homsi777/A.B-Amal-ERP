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
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateCustomerOrderApi(id: string, payload: CustomerOrderPayload): Promise<CustomerOrder> {
  const res = await apiFetch<{ ok: boolean; data: CustomerOrder }>(`/api/customer-orders/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
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
