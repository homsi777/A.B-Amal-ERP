/**
 * قسم التسليم — Obada wholesale
 * مؤقتاً: يعتمد على فواتير البيع المؤكدة حتى يُضاف delivery_status في الخادم.
 */

import { getSalesInvoice, listSalesInvoices } from './salesInvoicesApi';
import { displayStoredInvoiceNo, mapSalesListRowToInvoice } from '../invoiceDbMappers';

export type DeliveryQueueItem = {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  customerLabel: string;
  rollCount: number;
  totalAmount: number;
  currencyCode: string;
  /** مؤقت — CONFIRMED = بانتظار التسليم */
  deliveryStatus: 'CONFIRMED_SALE' | 'IN_DELIVERY' | 'FULFILLED';
};

export type DeliveryLineDraft = {
  lineIndex: number;
  description: string;
  rollQty: number;
  unit: string;
  tafnidLength?: number;
  tafnidUnit?: 'meter' | 'yard';
};

function rollCountFromLines(lines: Record<string, unknown>[]): number {
  return lines.reduce((sum, line) => {
    const q = Number(line.quantity ?? 0);
    return sum + (Number.isFinite(q) ? Math.max(0, q) : 0);
  }, 0);
}

export async function listDeliveryQueue(search?: string): Promise<DeliveryQueueItem[]> {
  const res = await listSalesInvoices({
    search: search?.trim() || undefined,
    documentStatus: 'CONFIRMED',
    pageSize: 200,
  });

  return res.rows.map((row) => {
    const inv = mapSalesListRowToInvoice(row);
    const meta = (row.metadata as Record<string, unknown> | undefined) ?? {};
    const deliveryStatus =
      String(meta.delivery_status ?? meta.deliveryStatus ?? 'CONFIRMED_SALE').toUpperCase() === 'FULFILLED'
        ? 'FULFILLED'
        : 'CONFIRMED_SALE';

    return {
      id: inv.id,
      invoiceNo: inv.invoiceNumber ?? displayStoredInvoiceNo(row.invoice_no),
      invoiceDate: inv.date,
      customerLabel: inv.partyLabel ?? inv.partyDisplayName ?? '—',
      rollCount: rollCountFromLines((row.lines as Record<string, unknown>[] | undefined) ?? []) || inv.items?.length || 0,
      totalAmount: inv.totalAmount,
      currencyCode: inv.currency ?? 'USD',
      deliveryStatus,
    };
  });
}

export async function getDeliveryDetail(invoiceId: string): Promise<{
  header: DeliveryQueueItem;
  lines: DeliveryLineDraft[];
}> {
  const res = await getSalesInvoice(invoiceId);
  const h = res.data.header;
  const lines = res.data.lines ?? [];

  const header: DeliveryQueueItem = {
    id: String(h.id ?? invoiceId),
    invoiceNo: displayStoredInvoiceNo(h.invoice_no),
    invoiceDate: String(h.invoice_date ?? '').slice(0, 10),
    customerLabel: String(h.customer_name ?? h.party_name ?? '—'),
    rollCount: rollCountFromLines(lines),
    totalAmount: Number(h.total_amount ?? 0),
    currencyCode: String(h.currency_code ?? 'USD'),
    deliveryStatus: 'CONFIRMED_SALE',
  };

  const mappedLines: DeliveryLineDraft[] = lines.map((line, index) => ({
    lineIndex: index + 1,
    description: String(line.description ?? line.fabric_item_name ?? '—'),
    rollQty: Number(line.quantity ?? 0),
    unit: line.unit === 'yard' ? 'ياردة' : 'متر',
    tafnidLength: undefined,
    tafnidUnit: line.unit === 'yard' ? 'yard' : 'meter',
  }));

  return { header, lines: mappedLines };
}
