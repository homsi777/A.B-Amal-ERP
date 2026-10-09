import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Loader2, Printer, RefreshCw, RotateCcw, TrendingUp } from 'lucide-react';
import { useToast } from '../../components/NonBlockingToast';
import { ReportToolbar } from '../../components/reports/ReportToolbar';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import { fetchUnifiedReport } from '../../lib/api/reportsApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { exportReportPdf, printReport } from '../../lib/reports/printReport';
import type { UnifiedReportPayload } from '../../lib/reports/types';
import i18n from '../../i18n/config';

type DetailLevel = 'invoice' | 'line';
type GroupBy = 'none' | 'customer' | 'material' | 'supplier' | 'date';

const today = new Date().toISOString().slice(0, 10);
const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

const fmtMoney = (value: unknown) => `${Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})} USD`;

const fmtMeters = (value: unknown) => `${Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})} ${i18n.t('units.meters', { ns: 'profitDetails' })}`;

const dash = (value: unknown) => {
  const text = String(value ?? '').trim();
  return text || '-';
};

const paymentStatusLabel = (value: unknown) => {
  switch (String(value || '')) {
    case 'paid':
      return i18n.t('paymentStatus.paid', { ns: 'profitDetails' });
    case 'partial':
      return i18n.t('paymentStatus.partial', { ns: 'profitDetails' });
    case 'unpaid':
      return i18n.t('paymentStatus.unpaid', { ns: 'profitDetails' });
    default:
      return '-';
  }
};

const costQualityClass = (quality: unknown) => {
  switch (String(quality || '')) {
    case 'HISTORICAL_SNAPSHOT':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'CURRENT_COST_FALLBACK':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'MISSING_COST':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'PARTIAL_COST':
      return 'bg-orange-50 text-orange-700 border-orange-200';
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
};

const costQualityLabel = (row: Record<string, unknown>) => {
  if (row.cost_quality_label) return String(row.cost_quality_label);
  switch (String(row.cost_quality || '')) {
    case 'HISTORICAL_SNAPSHOT':
      return i18n.t('costQuality.historical', { ns: 'profitDetails' });
    case 'CURRENT_COST_FALLBACK':
      return i18n.t('costQuality.fallback', { ns: 'profitDetails' });
    case 'MISSING_COST':
      return i18n.t('costQuality.missing', { ns: 'profitDetails' });
    case 'PARTIAL_COST':
      return i18n.t('costQuality.partial', { ns: 'profitDetails' });
    default:
      return i18n.t('costQuality.unknown', { ns: 'profitDetails' });
  }
};

const CostBadge = ({ row }: { row: Record<string, unknown> }) => (
  <span
    className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-black ${costQualityClass(row.cost_quality)}`}
    title={String(row.cost_warning ?? '')}
  >
    {costQualityLabel(row)}
  </span>
);

export const ProfitDetails = () => {
  const { t } = useTranslation('profitDetails');
  const { showToast } = useToast();
  const [fromDate, setFromDate] = useState(firstDay);
  const [toDate, setToDate] = useState(today);
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('invoice');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [customerId, setCustomerId] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [materialCode, setMaterialCode] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [report, setReport] = useState<UnifiedReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [lookupsLoading, setLookupsLoading] = useState(false);
  const [error, setError] = useState('');
  const [topCustomerOpen, setTopCustomerOpen] = useState(false);

  const isLineMode = detailLevel === 'line';
  const totalRows = Number(report?.meta?.total ?? 0);
  const totalPages = totalRows > 0 ? Math.max(1, Math.ceil(totalRows / pageSize)) : 1;
  const canGoPrevious = page > 1;
  const canGoNext = totalRows > 0 ? page < totalPages : (report?.rows?.length ?? 0) >= pageSize;

  const resetPage = () => setPage(1);

  const handleDetailLevelChange = (value: DetailLevel) => {
    setDetailLevel(value);
    if (value === 'invoice' && (groupBy === 'material' || groupBy === 'supplier')) {
      setGroupBy('none');
    }
    resetPage();
  };

  const handleGroupByChange = (value: GroupBy) => {
    setGroupBy(value);
    if (value === 'material' || value === 'supplier') {
      setDetailLevel('line');
    }
    resetPage();
  };

  const queryParams = useMemo(() => {
    const params: Record<string, string | number | undefined> = {
      fromDate,
      toDate,
      detailLevel,
      groupBy,
      customerId,
      paymentStatus,
      page,
      pageSize,
    };
    if (isLineMode) {
      params.materialCode = materialCode.trim();
      params.supplierId = supplierId;
      params.warehouseId = warehouseId;
    }
    return params;
  }, [customerId, detailLevel, fromDate, groupBy, isLineMode, materialCode, page, pageSize, paymentStatus, supplierId, toDate, warehouseId]);

  const load = async (params: Record<string, string | number | undefined> = queryParams) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchUnifiedReport('/financial/profit-details', params);
      setReport(res.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('toast.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const goToPage = (nextPage: number) => {
    const targetPage = Math.max(1, nextPage);
    setPage(targetPage);
    void load({ ...queryParams, page: targetPage });
  };

  const pdfFileName = () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const raw = `profit-details-${fromDate}-${toDate}-${detailLevel}-${groupBy}-p${page}-${stamp}.pdf`;
    return raw.replace(/[^a-zA-Z0-9._-]/g, '_');
  };

  const handleExportPdf = async () => {
    if (!report) return;
    try {
      await exportReportPdf(report, pdfFileName());
    } catch (err) {
      showToast({
        message: err instanceof Error ? err.message : t('toast.exportPdfError'),
        type: 'error',
      });
    }
  };

  const handlePrint = () => {
    if (!report) return;
    const ok = printReport(report);
    if (!ok) {
      showToast({
        message: t('toast.printBlocked'),
        type: 'warning',
      });
    }
  };

  const resetFilters = () => {
    setFromDate(firstDay);
    setToDate(today);
    setDetailLevel('invoice');
    setGroupBy('none');
    setCustomerId('');
    setPaymentStatus('');
    setMaterialCode('');
    setSupplierId('');
    setWarehouseId('');
    setPage(1);
    setPageSize(100);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    const loadLookups = async () => {
      setLookupsLoading(true);
      try {
        const [customerResult, supplierResult, warehouseResult] = await Promise.all([
          listCustomers({ status: 'active', pageSize: 200 }),
          listSuppliers({ status: 'active', pageSize: 200 }),
          listWarehouses({ status: 'active' }),
        ]);
        if (!alive) return;
        setCustomers(customerResult.data);
        setSuppliers(supplierResult.data);
        setWarehouses(warehouseResult);
      } catch {
        if (alive) {
          setCustomers([]);
          setSuppliers([]);
          setWarehouses([]);
        }
      } finally {
        if (alive) setLookupsLoading(false);
      }
    };
    void loadLookups();
    return () => {
      alive = false;
    };
  }, []);

  const warnings = report?.warnings ?? [];
  const topCustomer = report?.insights?.topCustomer ?? null;
  const summaryCards = useMemo(() => {
    if (!report) return [];
    const totals = report.totals ?? {};
    const base = [
      { label: t('stats.totalSales'), value: `${totals.sales_amount ?? '0.00'} USD` },
      { label: t('stats.totalCost'), value: `${totals.cost_amount ?? '0.00'} USD` },
      { label: t('stats.totalProfit'), value: `${totals.gross_profit ?? '0.00'} USD` },
      { label: t('stats.totalSoldMeters'), value: fmtMeters(totals.sold_meters) },
      { label: t('stats.collected'), value: `${totals.paid_amount ?? '0.00'} USD` },
      { label: t('stats.remainingReceivable'), value: `${totals.remaining_amount ?? '0.00'} USD` },
      { label: t('stats.remainingReceivableMeters'), value: fmtMeters(totals.remaining_receivable_meters) },
      { label: t('stats.realizedProfit'), value: `${totals.realized_profit ?? '0.00'} USD` },
      { label: t('stats.receivableProfit'), value: `${totals.receivable_profit ?? '0.00'} USD` },
    ];
    if (report.meta?.missingCostCount) base.push({ label: t('stats.missingCostCount'), value: report.meta.missingCostCount });
    if (report.meta?.fallbackCostCount) base.push({ label: t('stats.fallbackCostCount'), value: report.meta.fallbackCostCount });
    return base;
  }, [report, t]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-emerald-600" />
            {t('page.title')}
          </h2>
          <p className="text-slate-500 mt-1">
            {t('page.subtitle')}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
            <label className="text-xs font-bold text-slate-500">
              {t('filters.detailLevelLabel')}
              <select
                value={detailLevel}
                onChange={(event) => handleDetailLevelChange(event.target.value as DetailLevel)}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              >
                <option value="invoice">{t('filters.detailLevel.invoice')}</option>
                <option value="line">{t('filters.detailLevel.line')}</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">
              {t('filters.groupByLabel')}
              <select
                value={groupBy}
                onChange={(event) => handleGroupByChange(event.target.value as GroupBy)}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              >
                <option value="none">{t('filters.groupBy.none')}</option>
                <option value="customer">{t('filters.groupBy.customer')}</option>
                <option value="material">{t('filters.groupBy.material')}</option>
                <option value="supplier">{t('filters.groupBy.supplier')}</option>
                <option value="date">{t('filters.groupBy.date')}</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">
              {t('filters.fromDate')}
              <input
                type="date"
                value={fromDate}
                onChange={(event) => {
                  setFromDate(event.target.value);
                  resetPage();
                }}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg"
              />
            </label>
            <label className="text-xs font-bold text-slate-500">
              {t('filters.toDate')}
              <input
                type="date"
                value={toDate}
                onChange={(event) => {
                  setToDate(event.target.value);
                  resetPage();
                }}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg"
              />
            </label>
            <label className="text-xs font-bold text-slate-500">
              {t('filters.customerLabel')}
              <select
                value={customerId}
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  resetPage();
                }}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              >
                <option value="">{t('filters.allCustomers')}</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">
              {t('filters.paymentStatusLabel')}
              <select
                value={paymentStatus}
                onChange={(event) => {
                  setPaymentStatus(event.target.value);
                  resetPage();
                }}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              >
                <option value="">{t('filters.allStatuses')}</option>
                <option value="paid">{t('paymentStatus.paid')}</option>
                <option value="partial">{t('paymentStatus.partial')}</option>
                <option value="unpaid">{t('paymentStatus.unpaid')}</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">
              {t('filters.materialCodeLabel')}
              <input
                value={materialCode}
                onChange={(event) => {
                  setMaterialCode(event.target.value);
                  resetPage();
                }}
                disabled={!isLineMode}
                placeholder={isLineMode ? t('filters.materialCodePlaceholder') : t('filters.lineOnlyPlaceholder')}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg disabled:bg-slate-50 disabled:text-slate-400"
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-indigo-700 disabled:opacity-60"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {t('actions.refresh')}
              </button>
              <button
                onClick={resetFilters}
                className="inline-flex items-center justify-center gap-2 border border-slate-200 text-slate-700 px-3 py-2 rounded-lg font-bold hover:bg-slate-50"
              >
                <RotateCcw className="w-4 h-4" />
                {t('actions.clear')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="text-xs font-bold text-slate-500">
              {t('filters.supplierLabel')}
              <select
                value={supplierId}
                onChange={(event) => {
                  setSupplierId(event.target.value);
                  resetPage();
                }}
                disabled={!isLineMode}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">{isLineMode ? t('filters.allSuppliers') : t('filters.lineOnlyPlaceholder')}</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">
              {t('filters.warehouseLabel')}
              <select
                value={warehouseId}
                onChange={(event) => {
                  setWarehouseId(event.target.value);
                  resetPage();
                }}
                disabled={!isLineMode}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">{isLineMode ? t('filters.allWarehouses') : t('filters.lineOnlyPlaceholder')}</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">
              {t('filters.pageSizeLabel')}
              <select
                value={pageSize}
                onChange={(event) => {
                  const nextPageSize = Number(event.target.value);
                  setPageSize(nextPageSize);
                  setPage(1);
                  void load({ ...queryParams, page: 1, pageSize: nextPageSize });
                }}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </label>
            <div className="text-xs text-slate-500 flex items-end">
              {lookupsLoading ? t('filters.loadingLookups') : isLineMode ? t('filters.lineHint') : t('filters.invoiceHint')}
            </div>
          </div>
        </div>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 font-bold">{error}</div>}
      {(report?.meta?.note || warnings.length > 0 || (isLineMode && groupBy !== 'none')) && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm font-bold space-y-1">
          {report?.meta?.note && <p>{report.meta.note}</p>}
          {warnings.map((warning) => (
            <p key={warning.code}>{warning.message}{warning.count != null ? ` (${warning.count})` : ''}</p>
          ))}
          {isLineMode && <p>{t('filters.lineHint')}</p>}
          {isLineMode && groupBy !== 'none' && (
            <p>{t('warnings.groupProrationNote')}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <p className="text-xs font-bold text-slate-500">{card.label}</p>
            <p className="mt-2 text-lg font-black text-slate-900 font-mono">{card.value}</p>
          </div>
        ))}
        {topCustomer ? (
          <button
            type="button"
            onClick={() => setTopCustomerOpen(true)}
            className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 text-right hover:bg-slate-50 transition"
            disabled={loading}
            title={t('topCustomer.viewDetails')}
          >
            <p className="text-xs font-bold text-slate-500">{t('topCustomer.cardTitle')}</p>
            <p className="mt-2 text-lg font-black text-slate-900">{dash(topCustomer.customerName)}</p>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <span className="text-slate-500 font-bold">{t('topCustomer.totalPurchase')}</span>
              <span className="font-mono text-slate-900">{fmtMoney(topCustomer.salesAmount)}</span>
              <span className="text-slate-500 font-bold">{t('topCustomer.meters')}</span>
              <span className="font-mono text-slate-900">{fmtMeters(topCustomer.soldMeters)}</span>
              <span className="text-slate-500 font-bold">{t('topCustomer.invoiceCount')}</span>
              <span className="font-mono text-slate-900">{dash(topCustomer.invoiceCount)}</span>
              <span className="text-slate-500 font-bold">{t('topCustomer.remaining')}</span>
              <span className="font-mono text-amber-700">{fmtMoney(topCustomer.remainingAmount)}</span>
            </div>
            <div className="mt-2 text-xs font-bold text-indigo-700 underline">{t('topCustomer.viewDetails')}</div>
          </button>
        ) : null}
      </div>

      {groupBy !== 'none' && (
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="font-black text-slate-900">{t('groupSummary.title')}</h3>
            <p className="text-xs text-slate-500">
              {t('groupSummary.subtitle')}
            </p>
          </div>
          <div className="overflow-x-auto">
            <GroupSummaryTable groups={report?.groups ?? []} loading={loading} />
          </div>
        </section>
      )}

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="font-black text-slate-900">{isLineMode ? t('table.lineTitle') : t('table.invoiceTitle')}</h3>
            <p className="text-xs text-slate-500">
              {t('table.currencyNote')}
              {totalRows > 0 ? ` · ${t('table.rowsCount', { count: totalRows.toLocaleString('en-US') })}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ReportToolbar
              disabled={loading || !report}
              onExportPdf={report ? handleExportPdf : undefined}
            />
            <button
              type="button"
              title={t('actions.print')}
              disabled={loading || !report}
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-45"
            >
              <Printer className="w-4 h-4" />
              {t('actions.print')}
            </button>
            <button
              onClick={() => goToPage(page - 1)}
              disabled={!canGoPrevious || loading}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              title={t('actions.previous')}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold text-slate-600">
              {totalRows > 0 ? t('table.pageLabelWithTotal', { page, total: totalPages }) : t('table.pageLabel', { page })}
            </span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={!canGoNext || loading}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              title={t('actions.next')}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {loading && <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />}
          </div>
        </div>
        <div className="overflow-x-auto">
          {isLineMode ? (
            <LineTable rows={report?.rows ?? []} loading={loading} />
          ) : (
            <InvoiceTable rows={report?.rows ?? []} loading={loading} />
          )}
        </div>
      </section>

      {topCustomerOpen && topCustomer && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" dir="rtl" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0"
            aria-label={t('actions.close')}
            onClick={() => setTopCustomerOpen(false)}
          />
          <div className="relative z-10 my-6 w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-500">{t('topCustomerModal.title')}</p>
                <h3 className="mt-1 text-xl font-black text-slate-900">{dash(topCustomer.customerName)}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {t('topCustomerModal.lastPurchase', { date: String(topCustomer.lastInvoiceDate ?? '').slice(0, 10) || '-' })}
                  {topCustomer.topMaterialName ? ` · ${t('topCustomerModal.topMaterial', { material: topCustomer.topMaterialName })}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTopCustomerOpen(false)}
                className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                {t('actions.close')}
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-500">{t('topCustomerModal.totalSales')}</p>
                  <p className="mt-2 font-mono text-lg font-black text-slate-900">{fmtMoney(topCustomer.salesAmount)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-500">{t('topCustomerModal.totalMeters')}</p>
                  <p className="mt-2 font-mono text-lg font-black text-slate-900">{fmtMeters(topCustomer.soldMeters)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-500">{t('topCustomerModal.totalCost')}</p>
                  <p className="mt-2 font-mono text-lg font-black text-slate-900">{fmtMoney(topCustomer.costAmount)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-500">{t('topCustomerModal.totalProfit')}</p>
                  <p className="mt-2 font-mono text-lg font-black text-slate-900">{fmtMoney(topCustomer.grossProfit)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-500">{t('topCustomerModal.collected')}</p>
                  <p className="mt-2 font-mono text-lg font-black text-emerald-700">{fmtMoney(topCustomer.paidAmount)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-500">{t('topCustomerModal.remaining')}</p>
                  <p className="mt-2 font-mono text-lg font-black text-amber-700">{fmtMoney(topCustomer.remainingAmount)}</p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-black text-slate-900">{t('topCustomerModal.topInvoicesTitle')}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right">
                    <thead className="bg-slate-900 text-white">
                      <tr>
                        <th className="p-3">{t('topCustomerModal.col.date')}</th>
                        <th className="p-3">{t('topCustomerModal.col.invoiceNo')}</th>
                        <th className="p-3">{t('topCustomerModal.col.sales')}</th>
                        <th className="p-3">{t('topCustomerModal.col.meters')}</th>
                        <th className="p-3">{t('topCustomerModal.col.remaining')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(topCustomer.topInvoices ?? []).map((inv) => (
                        <tr key={inv.invoiceId || inv.invoiceNo} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="p-3 font-mono">{String(inv.invoiceDate ?? '').slice(0, 10)}</td>
                          <td className="p-3 font-mono text-indigo-700">{dash(inv.invoiceNo)}</td>
                          <td className="p-3 font-mono">{fmtMoney(inv.salesAmount)}</td>
                          <td className="p-3 font-mono">{fmtMeters(inv.soldMeters)}</td>
                          <td className="p-3 font-mono text-amber-700">{fmtMoney(inv.remainingAmount)}</td>
                        </tr>
                      ))}
                      {(topCustomer.topInvoices ?? []).length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-slate-500 bg-white">
                            {t('topCustomerModal.noInvoices')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const GroupSummaryTable = ({
  groups,
  loading,
}: {
  groups: Array<{ groupKey: string; groupLabel: string; totals: Record<string, number | string> }>;
  loading: boolean;
}) => {
  const { t } = useTranslation('profitDetails');
  return (
    <table className="w-full text-sm text-right">
      <thead className="bg-slate-900 text-white">
        <tr>
          <th className="p-3">{t('groupTable.col.group')}</th>
          <th className="p-3">{t('groupTable.col.invoiceCount')}</th>
          <th className="p-3">{t('groupTable.col.lineCount')}</th>
          <th className="p-3">{t('groupTable.col.sales')}</th>
          <th className="p-3">{t('groupTable.col.cost')}</th>
          <th className="p-3">{t('groupTable.col.profit')}</th>
          <th className="p-3">{t('groupTable.col.collected')}</th>
          <th className="p-3">{t('groupTable.col.remaining')}</th>
          <th className="p-3">{t('groupTable.col.meters')}</th>
          <th className="p-3">{t('groupTable.col.costQuality')}</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <tr key={group.groupKey || group.groupLabel} className="border-b border-slate-100 hover:bg-slate-50">
            <td className="p-3 font-black text-slate-900">{dash(group.groupLabel)}</td>
            <td className="p-3 font-mono">{dash(group.totals.invoice_count)}</td>
            <td className="p-3 font-mono">{dash(group.totals.line_count)}</td>
            <td className="p-3 font-mono">{fmtMoney(group.totals.sales_amount)}</td>
            <td className="p-3 font-mono">{fmtMoney(group.totals.cost_amount)}</td>
            <td className="p-3 font-mono font-bold">{fmtMoney(group.totals.gross_profit)}</td>
            <td className="p-3 font-mono text-emerald-700">{fmtMoney(group.totals.paid_amount)}</td>
            <td className="p-3 font-mono text-amber-700">{fmtMoney(group.totals.remaining_amount)}</td>
            <td className="p-3 font-mono">
              <div>{fmtMeters(group.totals.sold_meters)}</div>
              <div className="text-[11px] text-amber-700">{fmtMeters(group.totals.remaining_receivable_meters)}</div>
            </td>
            <td className="p-3">
              <div className="flex flex-wrap gap-1">
                <QualityCount label={t('costQuality.historicalShort')} value={group.totals.historical_snapshot_count} className="bg-emerald-50 text-emerald-700 border-emerald-200" />
                <QualityCount label={t('costQuality.fallbackShort')} value={group.totals.fallback_cost_count} className="bg-amber-50 text-amber-700 border-amber-200" />
                <QualityCount label={t('costQuality.missingShort')} value={group.totals.missing_cost_count} className="bg-rose-50 text-rose-700 border-rose-200" />
                <QualityCount label={t('costQuality.partialShort')} value={group.totals.partial_cost_count} className="bg-orange-50 text-orange-700 border-orange-200" />
              </div>
            </td>
          </tr>
        ))}
        {!loading && groups.length === 0 && (
          <tr>
            <td colSpan={10} className="p-8 text-center text-slate-500 bg-slate-50">
              {t('groupTable.empty')}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
};

const QualityCount = ({ label, value, className }: { label: string; value: unknown; className: string }) => {
  const count = Number(value ?? 0);
  if (!count) return null;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-black ${className}`}>
      {label}: {count}
    </span>
  );
};

const InvoiceTable = ({ rows, loading }: { rows: Record<string, unknown>[]; loading: boolean }) => {
  const { t } = useTranslation('profitDetails');
  return (
  <table className="w-full text-sm text-right">
    <thead className="bg-slate-900 text-white">
      <tr>
        <th className="p-3">{t('invoiceTable.col.date')}</th>
        <th className="p-3">{t('invoiceTable.col.invoiceNo')}</th>
        <th className="p-3">{t('invoiceTable.col.customer')}</th>
        <th className="p-3">{t('invoiceTable.col.sales')}</th>
        <th className="p-3">{t('invoiceTable.col.collected')}</th>
        <th className="p-3">{t('invoiceTable.col.remainingReceivable')}</th>
        <th className="p-3">{t('invoiceTable.col.cost')}</th>
        <th className="p-3">{t('invoiceTable.col.grossProfit')}</th>
        <th className="p-3">{t('invoiceTable.col.realizedProfit')}</th>
        <th className="p-3">{t('invoiceTable.col.receivableProfit')}</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row, index) => (
        <tr key={`${row.invoice_no}-${index}`} className="border-b border-slate-100 hover:bg-slate-50">
          <td className="p-3 font-mono">{String(row.invoice_date ?? '').slice(0, 10)}</td>
          <td className="p-3 font-mono text-indigo-700">{dash(row.invoice_no)}</td>
          <td className="p-3 font-bold text-slate-900">{dash(row.customer_name)}</td>
          <td className="p-3 font-mono">{fmtMoney(row.sales_amount)}</td>
          <td className="p-3 font-mono text-emerald-700">{fmtMoney(row.paid_amount)}</td>
          <td className="p-3 font-mono text-amber-700">{fmtMoney(row.remaining_amount)}</td>
          <td className="p-3">
            <div className="font-mono">{fmtMoney(row.cost_amount)}</div>
            <CostBadge row={row} />
          </td>
          <td className="p-3 font-mono font-bold">{fmtMoney(row.gross_profit)}</td>
          <td className="p-3 font-mono text-emerald-700">{fmtMoney(row.realized_profit)}</td>
          <td className="p-3 font-mono text-amber-700">{fmtMoney(row.receivable_profit)}</td>
        </tr>
      ))}
      {!loading && rows.length === 0 && (
        <tr>
          <td colSpan={10} className="p-10 text-center text-slate-500 bg-slate-50">
            {t('invoiceTable.empty')}
          </td>
        </tr>
      )}
    </tbody>
  </table>
  );
};

const LineTable = ({ rows, loading }: { rows: Record<string, unknown>[]; loading: boolean }) => {
  const { t } = useTranslation('profitDetails');
  return (
  <table className="w-full text-xs text-right">
    <thead className="bg-slate-900 text-white">
      <tr>
        <th className="p-3">{t('lineTable.col.date')}</th>
        <th className="p-3">{t('lineTable.col.invoiceNo')}</th>
        <th className="p-3">{t('lineTable.col.customer')}</th>
        <th className="p-3">{t('lineTable.col.paymentStatus')}</th>
        <th className="p-3">{t('lineTable.col.material')}</th>
        <th className="p-3">{t('lineTable.col.materialCode')}</th>
        <th className="p-3">{t('lineTable.col.color')}</th>
        <th className="p-3">{t('lineTable.col.barcode')}</th>
        <th className="p-3">{t('lineTable.col.supplier')}</th>
        <th className="p-3">{t('lineTable.col.warehouse')}</th>
        <th className="p-3">{t('lineTable.col.quantity')}</th>
        <th className="p-3">{t('lineTable.col.unit')}</th>
        <th className="p-3">{t('lineTable.col.quantityMeters')}</th>
        <th className="p-3">{t('lineTable.col.totalSales')}</th>
        <th className="p-3">{t('lineTable.col.totalCost')}</th>
        <th className="p-3">{t('lineTable.col.profit')}</th>
        <th className="p-3">{t('lineTable.col.collected')}</th>
        <th className="p-3">{t('lineTable.col.remaining')}</th>
        <th className="p-3">{t('lineTable.col.costQuality')}</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row, index) => (
        <tr key={`${row.line_id ?? row.invoice_no}-${index}`} className="border-b border-slate-100 hover:bg-slate-50">
          <td className="p-3 font-mono">{String(row.invoice_date ?? '').slice(0, 10)}</td>
          <td className="p-3 font-mono text-indigo-700">{dash(row.invoice_no)}</td>
          <td className="p-3 font-bold text-slate-900">{dash(row.customer_name)}</td>
          <td className="p-3">{paymentStatusLabel(row.payment_status)}</td>
          <td className="p-3 font-bold">{dash(row.material_name)}</td>
          <td className="p-3 font-mono">{dash(row.material_code)}</td>
          <td className="p-3">{dash(row.color_name)}</td>
          <td className="p-3 font-mono">{dash(row.barcode)}</td>
          <td className="p-3">{dash(row.supplier_name)}</td>
          <td className="p-3">{dash(row.warehouse_name)}</td>
          <td className="p-3 font-mono">{dash(row.quantity)}</td>
          <td className="p-3">{dash(row.unit)}</td>
          <td className="p-3 font-mono">{dash(row.quantity_meters)}</td>
          <td className="p-3 font-mono">{fmtMoney(row.sales_amount)}</td>
          <td className="p-3 font-mono">{fmtMoney(row.cost_amount)}</td>
          <td className="p-3 font-mono font-bold">{fmtMoney(row.gross_profit)}</td>
          <td className="p-3 font-mono text-emerald-700">{fmtMoney(row.paid_amount)}</td>
          <td className="p-3 font-mono text-amber-700">{fmtMoney(row.remaining_amount)}</td>
          <td className="p-3"><CostBadge row={row} /></td>
        </tr>
      ))}
      {!loading && rows.length === 0 && (
        <tr>
          <td colSpan={19} className="p-10 text-center text-slate-500 bg-slate-50">
            {t('lineTable.empty')}
          </td>
        </tr>
      )}
    </tbody>
  </table>
  );
};
