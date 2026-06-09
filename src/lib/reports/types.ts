export type ReportColumnType = 'text' | 'number' | 'date' | 'currency';

export interface ReportColumnDef {
  key: string;
  label: string;
  type?: ReportColumnType;
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
  key?: string;
  title: string;
  subtitle?: string;
  generatedAt: string;
  filtersApplied: Record<string, unknown>;
  columns: ReportColumnDef[];
  rows: Record<string, unknown>[];
  totals?: Record<string, number | string>;
  groups?: Array<{ groupKey: string; groupLabel: string; totals: Record<string, number | string> }>;
  summaryCards?: Array<{ label: string; value: string | number; hint?: string }>;
  warnings?: Array<{ code: string; count?: number; message: string }>;
  insights?: UnifiedReportInsights;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
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
