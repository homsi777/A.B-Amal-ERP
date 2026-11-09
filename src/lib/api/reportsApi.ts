import { apiFetch } from './client';
import type { UnifiedReportPayload } from '../reports/types';

export interface DashboardSummary {
  customers_count: number;
  suppliers_count: number;
  fabric_rolls_count: number;
  warehouses_count: number;
  purchase_import_batches_count: number;
  print_jobs_count: number;
  cashboxes_count: number;
  vouchers_count: number;
  return_invoices_count: number;
  payroll_employees_count: number;
  transfers_count?: number;
  waste_records_count?: number;
  damaged_rolls_count?: number;
  active_fabric_rolls_count?: number;
  damaged_or_waste_rolls_count?: number;
  payroll_runs_count?: number;
  inventory_movements_count?: number;
  total_roll_length_m?: string;
  total_roll_weight_kg?: string;
  total_cash_by_currency?: { currency_code: string; total: string }[];
  receipt_total?: string;
  payment_total?: string;
}

export async function getDashboardSummary() {
  return apiFetch<{ ok: boolean; data: DashboardSummary }>('/api/reports/dashboard-summary');
}

export async function getInventorySummary() {
  return apiFetch<{
    ok: boolean;
    data: { rollsCount: number; totalLengthM: string; movementsCount: number };
  }>('/api/reports/inventory-summary');
}

export async function getCashboxSummary() {
  return apiFetch<{
    ok: boolean;
    data: {
      cashboxes: { id: string; name: string; code: string; current_balance: string; currency_code: string }[];
      movementsCount: number;
    };
  }>('/api/reports/cashbox-summary');
}

export async function getVouchersSummary() {
  return apiFetch<{
    ok: boolean;
    data: {
      draft: number;
      confirmed: number;
      cancelled: number;
      confirmed_receipts: string;
      confirmed_payments: string;
    };
  }>('/api/reports/vouchers-summary');
}

export async function getPayrollSummary() {
  return apiFetch<{
    ok: boolean;
    data: { active_employees: number; payroll_runs_count: number; paid_runs: number };
  }>('/api/reports/payroll-summary');
}

/** Unified MVP report envelope */
export async function fetchUnifiedReport(
  apiSubPath: string,
  params: Record<string, string | number | undefined> = {},
) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    q.set(k, String(v));
  }
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; report: UnifiedReportPayload }>(`/api/reports${apiSubPath}${qs}`);
}

export interface CustomerItemColorSalesRow {
  material_name: string;
  material_code: string;
  color_name: string;
  color_code: string;
  roll_count: number;
  meters_sold: string;
  net_sales_amount: string;
  returned_meters: string;
  returned_amount: string;
  net_meters_after_returns: string;
  net_amount_after_returns: string;
  invoice_refs: Array<{ sourceId: string; documentNo: string }>;
}

/** العرض التفصيلي لكشف حساب العميل — مبيعات مجمَّعة حسب (الصنف، اللون) خلال
 * نفس فترة الكشف، بما فيها صافي المرتجعات لكل مجموعة. */
export async function listSalesByItemColorForCustomer(params: {
  customerId: string;
  dateFrom: string;
  dateTo: string;
}): Promise<CustomerItemColorSalesRow[]> {
  const q = new URLSearchParams({ customerId: params.customerId, dateFrom: params.dateFrom, dateTo: params.dateTo });
  const res = await apiFetch<{ ok: boolean; data: CustomerItemColorSalesRow[] }>(`/api/reports/sales/by-item-color?${q}`);
  return res.data;
}
