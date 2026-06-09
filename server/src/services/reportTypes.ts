/** Unified report envelope for /api/reports/* endpoints */

export type ReportColumnType = 'text' | 'number' | 'date' | 'currency';

export interface ReportColumn {
  key: string;
  label: string;
  type?: ReportColumnType;
}

export interface SummaryCard {
  label: string;
  value: string | number;
  hint?: string;
}

export interface ReportWarning {
  code: string;
  count?: number;
  message: string;
}

export interface ReportGroup {
  groupKey: string;
  groupLabel: string;
  totals: Record<string, number | string>;
}

export interface ProfitTopCustomerInvoice {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  salesAmount: string;
  soldMeters?: string;
  remainingAmount?: string;
}

export interface ProfitTopCustomerInsight {
  customerId: string;
  customerName: string;
  salesAmount: string;
  costAmount?: string;
  grossProfit?: string;
  paidAmount?: string;
  remainingAmount?: string;
  soldMeters?: string;
  remainingReceivableMeters?: string;
  invoiceCount?: number;
  lastInvoiceDate?: string;
  topMaterialName?: string;
  topInvoices?: ProfitTopCustomerInvoice[];
}

export interface UnifiedReportInsights {
  topCustomer?: ProfitTopCustomerInsight | null;
}

export interface UnifiedReportPayload {
  /** Stable report identifier (matches frontend card key when set). */
  key?: string;
  title: string;
  subtitle?: string;
  generatedAt: string;
  filtersApplied: Record<string, unknown>;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, number | string>;
  groups?: ReportGroup[];
  summaryCards?: SummaryCard[];
  warnings?: ReportWarning[];
  insights?: UnifiedReportInsights;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
    /** Explains empty/partial data without implying the report is disabled. */
    note?: string;
    dataCompleteness?: 'FULL' | 'PARTIAL' | 'EMPTY_REASON';
    missingCostCount?: number;
    fallbackCostCount?: number;
    historicalSnapshotCount?: number;
    partialCostCount?: number;
    costMethod?: string;
    collectionMethod?: string;
    collectionAllocationMethod?: string;
    groupBy?: string;
    groupingScope?: string;
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
