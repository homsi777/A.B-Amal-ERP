/**
 * قسم التسليم — Obada wholesale (API حقيقي)
 */

import { apiFetch } from './client';
import { displayStoredInvoiceNo } from '../invoiceDbMappers';

export type DeliveryQueueItem = {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  customerLabel: string;
  rollCount: number;
  totalAmount: number;
  currencyCode: string;
  deliveryStatus: 'CONFIRMED_SALE' | 'IN_DELIVERY' | 'FULFILLED';
};

export type DeliveryLineDraft = {
  lineNo: number;
  lineIndex: number;
  description: string;
  rollQty: number;
  unit: string;
  tafnidLength?: number;
  tafnidUnit?: 'meter' | 'yard';
};

function mapDeliveryStatus(raw: unknown): DeliveryQueueItem['deliveryStatus'] {
  const s = String(raw ?? 'IN_DELIVERY').toUpperCase();
  if (s === 'FULFILLED') return 'FULFILLED';
  if (s === 'IN_DELIVERY') return 'IN_DELIVERY';
  return 'CONFIRMED_SALE';
}

export async function listDeliveryQueue(search?: string): Promise<DeliveryQueueItem[]> {
  const q = new URLSearchParams();
  if (search?.trim()) q.set('search', search.trim());
  q.set('pageSize', '200');

  const res = await apiFetch<{
    ok: boolean;
    rows: Record<string, unknown>[];
  }>(`/api/delivery/queue?${q.toString()}`);

  return res.rows.map((row) => ({
    id: String(row.id ?? ''),
    invoiceNo: displayStoredInvoiceNo(row.invoice_no),
    invoiceDate: String(row.invoice_date ?? '').slice(0, 10),
    customerLabel: String(row.customer_name ?? '—'),
    rollCount: Number(row.roll_count ?? 0) || 0,
    totalAmount: Number(row.total_amount ?? 0),
    currencyCode: String(row.currency_code ?? 'USD'),
    deliveryStatus: mapDeliveryStatus(row.delivery_status),
  }));
}

export async function getDeliveryDetail(invoiceId: string): Promise<{
  header: DeliveryQueueItem;
  lines: DeliveryLineDraft[];
}> {
  const res = await apiFetch<{
    ok: boolean;
    data: { header: Record<string, unknown>; lines: Record<string, unknown>[] };
  }>(`/api/delivery/${invoiceId}`);

  const h = res.data.header;
  const lines = res.data.lines ?? [];

  const header: DeliveryQueueItem = {
    id: String(h.id ?? invoiceId),
    invoiceNo: displayStoredInvoiceNo(h.invoice_no),
    invoiceDate: String(h.invoice_date ?? '').slice(0, 10),
    customerLabel: String(h.customer_name ?? '—'),
    rollCount: lines.reduce((sum, ln) => sum + (ln.unit === 'roll' ? Number(ln.quantity ?? 0) : 0), 0),
    totalAmount: Number(h.total_amount ?? 0),
    currencyCode: String(h.currency_code ?? 'USD'),
    deliveryStatus: mapDeliveryStatus(h.delivery_status),
  };

  const mappedLines: DeliveryLineDraft[] = lines.map((line) => {
    const lineNo = Number(line.line_no ?? 0);
    const tafnidUnit = (line.tafnid_length_unit as 'meter' | 'yard' | undefined) ?? 'meter';
    const tafnidLen = line.tafnid_length != null ? Number(line.tafnid_length) : undefined;
    return {
      lineNo,
      lineIndex: lineNo,
      description: String(line.description ?? '—'),
      rollQty: Number(line.quantity ?? 0),
      unit: line.unit === 'roll' ? 'توب' : line.unit === 'yard' ? 'ياردة' : 'متر',
      tafnidLength: Number.isFinite(tafnidLen) ? tafnidLen : undefined,
      tafnidUnit,
    };
  });

  return { header, lines: mappedLines };
}

export async function saveDeliveryTafnid(
  invoiceId: string,
  lines: DeliveryLineDraft[],
): Promise<void> {
  await apiFetch(`/api/delivery/${invoiceId}/tafnid`, {
    method: 'PUT',
    body: JSON.stringify({
      lines: lines.map((ln) => ({
        lineNo: ln.lineNo,
        tafnidLength: ln.tafnidLength,
        lengthUnit: ln.tafnidUnit ?? 'meter',
      })),
    }),
  });
}

export async function confirmDeliveryFulfillment(invoiceId: string): Promise<void> {
  await apiFetch(`/api/delivery/${invoiceId}/fulfill`, { method: 'POST' });
}
