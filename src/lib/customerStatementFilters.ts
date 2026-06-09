import type { Customer, Invoice, InvoiceItem, Transaction } from '../types';

/** حساب الذمم المدينة للعملاء من حركات الفواتير المحلية */
export const CUSTOMER_AR_ACCOUNT_ID = '1102';

export type StatementPreset = 'manual' | 'highest_debt' | 'most_payments' | 'top_buyer_fabric';

export interface StatementFabricRow {
  id: string;
  date: string;
  fabricName: string;
  fabricCode: string;
  rollsCount: number;
  quantity: number;
  unit: 'متر' | 'يارد';
  unitPrice: number;
  total: number;
  payments: number;
  remaining: number;
  invoiceRef: string;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function invoiceLineMatchesFabric(line: InvoiceItem, fabricKey: string): boolean {
  const k = norm(fabricKey);
  if (!k) return false;
  const candidates = [line.fabricName, line.materialName, line.designCode].filter(Boolean) as string[];
  return candidates.some((c) => norm(c) === k);
}

/** أكثر عميل رصيد ذمة (مدين) — يعتمد على حقل balance الحالي */
export function resolveCustomerHighestDebt(customers: Customer[]): string | null {
  if (!customers.length) return null;
  return [...customers].sort((a, b) => b.balance - a.balance)[0].id;
}

/** أكثر عميل سدّد دفعات (قبوض ذمة في الفترة؛ ثم احتياطي على كل الفترات) */
export function resolveCustomerMostPayments(
  transactions: Transaction[],
  customers: Customer[],
  fromDate: string,
  toDate: string,
): string | null {
  const custIds = new Set(customers.map((c) => c.id));

  const sumCredits = (list: Transaction[]) => {
    const sums = new Map<string, number>();
    for (const t of list) {
      if (
        t.accountId !== CUSTOMER_AR_ACCOUNT_ID ||
        t.type !== 'credit' ||
        !t.partyId ||
        !custIds.has(t.partyId)
      ) {
        continue;
      }
      sums.set(t.partyId, (sums.get(t.partyId) || 0) + t.amount);
    }
    return sums;
  };

  let sums = sumCredits(transactions.filter((t) => t.date >= fromDate && t.date <= toDate));
  let bestId: string | null = null;
  let best = -1;
  for (const [id, amt] of sums) {
    if (amt > best) {
      best = amt;
      bestId = id;
    }
  }
  if (bestId) return bestId;

  sums = sumCredits(transactions);
  best = -1;
  bestId = null;
  for (const [id, amt] of sums) {
    if (amt > best) {
      best = amt;
      bestId = id;
    }
  }
  return bestId ?? customers[0]?.id ?? null;
}

/** أكثر عميل مشتريات (مجموع المبالغ) لخامة ضمن الفترة — مطابقة اسم خامة أو كود تصميم */
export function resolveCustomerTopFabricBuyer(
  invoices: Invoice[],
  fabricKey: string,
  fromDate: string,
  toDate: string,
): string | null {
  const k = fabricKey.trim();
  if (!k) return null;

  const totals = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.type !== 'sale') continue;
    if (inv.date < fromDate || inv.date > toDate) continue;
    for (const line of inv.items) {
      if (!invoiceLineMatchesFabric(line, k)) continue;
      totals.set(inv.partyId, (totals.get(inv.partyId) || 0) + line.total);
    }
  }

  let bestId: string | null = null;
  let best = -1;
  for (const [id, amt] of totals) {
    if (amt > best) {
      best = amt;
      bestId = id;
    }
  }
  return bestId;
}

export function resolveCustomerForPreset(
  preset: StatementPreset,
  fabricKey: string,
  customers: Customer[],
  invoices: Invoice[],
  transactions: Transaction[],
  fromDate: string,
  toDate: string,
): string | null {
  switch (preset) {
    case 'manual':
      return null;
    case 'highest_debt':
      return resolveCustomerHighestDebt(customers);
    case 'most_payments':
      return resolveCustomerMostPayments(transactions, customers, fromDate, toDate);
    case 'top_buyer_fabric':
      return resolveCustomerTopFabricBuyer(invoices, fabricKey, fromDate, toDate);
    default:
      return null;
  }
}

/** أسطر الكشف من فواتير المبيعات الفعلية */
export function buildFabricRowsFromSaleInvoices(
  invoices: Invoice[],
  customerId: string,
  fromDate: string,
  toDate: string,
): StatementFabricRow[] {
  const rows: StatementFabricRow[] = [];

  for (const inv of invoices) {
    if (inv.type !== 'sale' || inv.partyId !== customerId) continue;
    if (inv.date < fromDate || inv.date > toDate) continue;

    const linesSum = inv.items.reduce((s, line) => s + line.total, 0);
    const denom =
      linesSum > 0 ? linesSum : inv.totalAmount > 0 ? inv.totalAmount : 0;

    inv.items.forEach((line, idx) => {
      const total = line.total;
      const ratio = denom > 0 ? total / denom : 0;
      const payments = inv.paidAmount * ratio;
      const remaining = inv.remainingAmount * ratio;
      const rolls = line.rollsCount ?? Math.max(1, Math.round(line.quantity / 25));

      rows.push({
        id: `${inv.id}-${idx}`,
        date: inv.date,
        fabricName: line.fabricName || line.materialName || '—',
        fabricCode: line.designCode || line.fabricId || '—',
        rollsCount: rolls,
        quantity: line.quantity,
        unit: line.unitType === 'yard' ? 'يارد' : 'متر',
        unitPrice: line.unitPrice,
        total,
        payments,
        remaining,
        invoiceRef: inv.invoiceNumber ?? inv.id,
      });
    });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** قائمة خامات للقائمة المنسدلة: من الفواتير + المخزون */
export function collectFabricTypeOptions(invoices: Invoice[], inventoryNames: string[]): string[] {
  const set = new Set<string>();
  for (const inv of invoices) {
    if (inv.type !== 'sale') continue;
    for (const line of inv.items) {
      const n = line.fabricName?.trim() || line.materialName?.trim();
      if (n) set.add(n);
      const code = line.designCode?.trim();
      if (code) set.add(code);
    }
  }
  for (const n of inventoryNames) {
    if (n?.trim()) set.add(n.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
}
