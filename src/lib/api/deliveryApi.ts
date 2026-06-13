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
  deliveryStatus: 'CONFIRMED_SALE' | 'IN_DELIVERY' | 'TAFNID_SAVED' | 'FULFILLED';
};

export type TafnidRollEntry = {
  rollSeq: number;
  length?: number;
};

export type DeliveryLineDraft = {
  lineNo: number;
  lineIndex: number;
  description: string;
  rollQty: number;
  unit: string;
  /** @deprecated single-roll legacy — use rollTafnid */
  tafnidLength?: number;
  tafnidUnit?: 'meter' | 'yard';
  rollTafnid?: TafnidRollEntry[];
};

function rollsNeededForLine(unit: string, quantity: number): number {
  if (unit === 'roll' || unit === 'توب') return Math.max(1, Math.round(quantity));
  return 1;
}

function mapDeliveryStatus(raw: unknown): DeliveryQueueItem['deliveryStatus'] {
  const s = String(raw ?? 'IN_DELIVERY').toUpperCase();
  if (s === 'FULFILLED') return 'FULFILLED';
  if (s === 'TAFNID_SAVED') return 'TAFNID_SAVED';
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
    const unitRaw = String(line.unit ?? 'roll');
    const isRoll = unitRaw === 'roll';
    const tafnidUnitDefault: 'meter' | 'yard' = 'meter';
    const rawRolls = Array.isArray(line.tafnid_rolls)
      ? (line.tafnid_rolls as { rollSeq?: number; roll_seq?: number; tafnidLength?: number; tafnid_length?: number; lengthUnit?: string; length_unit?: string }[])
      : [];
    const rollTafnid: TafnidRollEntry[] = rawRolls.map((r) => {
      const len = r.tafnidLength ?? r.tafnid_length;
      const n = len != null ? Number(len) : undefined;
      return {
        rollSeq: Number(r.rollSeq ?? r.roll_seq ?? 0),
        length: Number.isFinite(n) && (n as number) > 0 ? (n as number) : undefined,
      };
    });
    const firstLen = rollTafnid.find((r) => r.rollSeq === 1)?.length;
    const firstUnit =
      (rawRolls.find((r) => Number(r.rollSeq ?? r.roll_seq) === 1)?.lengthUnit as 'meter' | 'yard' | undefined) ??
      (rawRolls.find((r) => Number(r.rollSeq ?? r.roll_seq) === 1)?.length_unit as 'meter' | 'yard' | undefined) ??
      tafnidUnitDefault;
    return {
      lineNo,
      lineIndex: lineNo,
      description: String(line.description ?? '—'),
      rollQty: Number(line.quantity ?? 0),
      unit: isRoll ? 'توب' : unitRaw === 'yard' ? 'ياردة' : 'متر',
      tafnidLength: firstLen,
      tafnidUnit: firstUnit,
      rollTafnid,
    };
  });

  return { header, lines: mappedLines };
}

export async function saveDeliveryTafnid(
  invoiceId: string,
  lines: DeliveryLineDraft[],
): Promise<void> {
  const payloadLines: {
    lineNo: number;
    rollSeq: number;
    tafnidLength: number;
    lengthUnit: 'meter' | 'yard';
  }[] = [];

  for (const ln of lines) {
    const needed = rollsNeededForLine(ln.unit, ln.rollQty);
    const entries = ln.rollTafnid?.length
      ? ln.rollTafnid
      : ln.tafnidLength != null
        ? [{ rollSeq: 1, length: ln.tafnidLength }]
        : [];
    for (let seq = 1; seq <= needed; seq++) {
      const entry = entries.find((e) => e.rollSeq === seq) ?? entries[seq - 1];
      const len = entry?.length;
      if (len != null && Number.isFinite(len) && len > 0) {
        payloadLines.push({
          lineNo: ln.lineNo,
          rollSeq: seq,
          tafnidLength: len,
          lengthUnit: ln.tafnidUnit ?? 'meter',
        });
      }
    }
  }

  await apiFetch(`/api/delivery/${invoiceId}/tafnid`, {
    method: 'PUT',
    body: JSON.stringify({ lines: payloadLines }),
  });
}

export async function confirmDeliveryFulfillment(invoiceId: string): Promise<void> {
  await apiFetch(`/api/delivery/${invoiceId}/fulfill`, { method: 'POST' });
}

export type DeliveryNotificationItem = {
  id: string;
  invoiceNo: string;
  customerName: string;
};

export type DeliveryNotifications = {
  pendingTafnid: number;
  pendingManagerApproval: number;
  tafnidQueue: DeliveryNotificationItem[];
  approvalQueue: DeliveryNotificationItem[];
};

export async function fetchDeliveryNotifications(): Promise<DeliveryNotifications> {
  const res = await apiFetch<{
    ok: boolean;
    pendingTafnid: number;
    pendingManagerApproval: number;
    tafnidQueue: DeliveryNotificationItem[];
    approvalQueue: DeliveryNotificationItem[];
  }>('/api/delivery/notifications');
  return {
    pendingTafnid: Number(res.pendingTafnid ?? 0) || 0,
    pendingManagerApproval: Number(res.pendingManagerApproval ?? 0) || 0,
    tafnidQueue: res.tafnidQueue ?? [],
    approvalQueue: res.approvalQueue ?? [],
  };
}

export async function countPendingDeliveryApprovals(): Promise<number> {
  const res = await fetchDeliveryNotifications();
  return res.pendingManagerApproval;
}
