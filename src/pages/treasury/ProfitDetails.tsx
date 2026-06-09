import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Printer, RefreshCw, RotateCcw, TrendingUp } from 'lucide-react';
import { useToast } from '../../components/NonBlockingToast';
import { ReportToolbar } from '../../components/reports/ReportToolbar';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import { fetchUnifiedReport } from '../../lib/api/reportsApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { exportReportPdf, printReport } from '../../lib/reports/printReport';
import type { UnifiedReportPayload } from '../../lib/reports/types';

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
})} م`;

const dash = (value: unknown) => {
  const text = String(value ?? '').trim();
  return text || '-';
};

const paymentStatusLabel = (value: unknown) => {
  switch (String(value || '')) {
    case 'paid':
      return 'مدفوع';
    case 'partial':
      return 'مدفوع جزئياً';
    case 'unpaid':
      return 'غير مدفوع';
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
      return 'تكلفة مثبتة';
    case 'CURRENT_COST_FALLBACK':
      return 'تكلفة تقديرية';
    case 'MISSING_COST':
      return 'تكلفة مفقودة';
    case 'PARTIAL_COST':
      return 'تكلفة جزئية';
    default:
      return 'غير معروف';
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
      setError(err instanceof Error ? err.message : 'تعذر تحميل كشف الأرباح');
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
        message: err instanceof Error ? err.message : 'فشل تصدير PDF',
        type: 'error',
      });
    }
  };

  const handlePrint = () => {
    if (!report) return;
    const ok = printReport(report);
    if (!ok) {
      showToast({
        message: 'تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.',
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
      { label: 'إجمالي المبيعات', value: `${totals.sales_amount ?? '0.00'} USD` },
      { label: 'إجمالي التكلفة', value: `${totals.cost_amount ?? '0.00'} USD` },
      { label: 'إجمالي الربح', value: `${totals.gross_profit ?? '0.00'} USD` },
      { label: 'إجمالي الأمتار المباعة', value: fmtMeters(totals.sold_meters) },
      { label: 'المحصل', value: `${totals.paid_amount ?? '0.00'} USD` },
      { label: 'المتبقي ضمن الذمم', value: `${totals.remaining_amount ?? '0.00'} USD` },
      { label: 'أمتار ضمن الذمم', value: fmtMeters(totals.remaining_receivable_meters) },
      { label: 'ربح محصل', value: `${totals.realized_profit ?? '0.00'} USD` },
      { label: 'ربح متبق ضمن الذمم', value: `${totals.receivable_profit ?? '0.00'} USD` },
    ];
    if (report.meta?.missingCostCount) base.push({ label: 'بنود تكلفة مفقودة', value: report.meta.missingCostCount });
    if (report.meta?.fallbackCostCount) base.push({ label: 'بنود تكلفة تقديرية', value: report.meta.fallbackCostCount });
    return base;
  }, [report]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-emerald-600" />
            كشف الأرباح التفصيلي
          </h2>
          <p className="text-slate-500 mt-1">
            أرباح فواتير البيع مع فصل المبيعات والتكلفة والتحصيل والذمم، مع توضيح جودة التكلفة.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
            <label className="text-xs font-bold text-slate-500">
              طريقة العرض
              <select
                value={detailLevel}
                onChange={(event) => handleDetailLevelChange(event.target.value as DetailLevel)}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              >
                <option value="invoice">ملخص الفواتير</option>
                <option value="line">تفصيل حسب الخامة</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">
              تجميع حسب
              <select
                value={groupBy}
                onChange={(event) => handleGroupByChange(event.target.value as GroupBy)}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              >
                <option value="none">بدون تجميع</option>
                <option value="customer">العميل</option>
                <option value="material">الخامة</option>
                <option value="supplier">المورد</option>
                <option value="date">التاريخ</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">
              من تاريخ
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
              إلى تاريخ
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
              العميل
              <select
                value={customerId}
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  resetPage();
                }}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              >
                <option value="">كل العملاء</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">
              حالة الدفع
              <select
                value={paymentStatus}
                onChange={(event) => {
                  setPaymentStatus(event.target.value);
                  resetPage();
                }}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              >
                <option value="">كل الحالات</option>
                <option value="paid">مدفوع</option>
                <option value="partial">مدفوع جزئياً</option>
                <option value="unpaid">غير مدفوع</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">
              كود الخامة
              <input
                value={materialCode}
                onChange={(event) => {
                  setMaterialCode(event.target.value);
                  resetPage();
                }}
                disabled={!isLineMode}
                placeholder={isLineMode ? 'اكتب كود الخامة' : 'خاص بالتفصيل'}
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
                تحديث
              </button>
              <button
                onClick={resetFilters}
                className="inline-flex items-center justify-center gap-2 border border-slate-200 text-slate-700 px-3 py-2 rounded-lg font-bold hover:bg-slate-50"
              >
                <RotateCcw className="w-4 h-4" />
                مسح
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="text-xs font-bold text-slate-500">
              المورد
              <select
                value={supplierId}
                onChange={(event) => {
                  setSupplierId(event.target.value);
                  resetPage();
                }}
                disabled={!isLineMode}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">{isLineMode ? 'كل الموردين' : 'خاص بالتفصيل'}</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">
              المستودع
              <select
                value={warehouseId}
                onChange={(event) => {
                  setWarehouseId(event.target.value);
                  resetPage();
                }}
                disabled={!isLineMode}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">{isLineMode ? 'كل المستودعات' : 'خاص بالتفصيل'}</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">
              عدد الأسطر
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
              {lookupsLoading ? 'جاري تحميل القوائم...' : isLineMode ? 'المحصل والمتبقي موزعان نسبياً حسب قيمة البند.' : 'فلاتر الخامة والمورد والمستودع تعمل في التفصيل.'}
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
          {isLineMode && <p>المحصل والمتبقي موزعان نسبياً حسب قيمة البند.</p>}
          {isLineMode && groupBy !== 'none' && (
            <p>المحصل والمتبقي في التجميع محسوبان بناءً على التوزيع النسبي حسب قيمة البنود، وليس تخصيص سندات قبض دقيق.</p>
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
            title="عرض التفاصيل"
          >
            <p className="text-xs font-bold text-slate-500">أكثر زبون يشتري</p>
            <p className="mt-2 text-lg font-black text-slate-900">{dash(topCustomer.customerName)}</p>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <span className="text-slate-500 font-bold">إجمالي الشراء</span>
              <span className="font-mono text-slate-900">{fmtMoney(topCustomer.salesAmount)}</span>
              <span className="text-slate-500 font-bold">الأمتار</span>
              <span className="font-mono text-slate-900">{fmtMeters(topCustomer.soldMeters)}</span>
              <span className="text-slate-500 font-bold">الفواتير</span>
              <span className="font-mono text-slate-900">{dash(topCustomer.invoiceCount)}</span>
              <span className="text-slate-500 font-bold">المتبقي</span>
              <span className="font-mono text-amber-700">{fmtMoney(topCustomer.remainingAmount)}</span>
            </div>
            <div className="mt-2 text-xs font-bold text-indigo-700 underline">عرض التفاصيل</div>
          </button>
        ) : null}
      </div>

      {groupBy !== 'none' && (
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="font-black text-slate-900">ملخص التجميع</h3>
            <p className="text-xs text-slate-500">
              المجاميع محسوبة من كامل البيانات المفلترة، وليست من الصفحة الحالية فقط.
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
            <h3 className="font-black text-slate-900">{isLineMode ? 'تفصيل حسب الخامة' : 'تفصيل الفواتير'}</h3>
            <p className="text-xs text-slate-500">
              العملة المعتمدة في التقرير: USD
              {totalRows > 0 ? ` · ${totalRows.toLocaleString('en-US')} سطر` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ReportToolbar
              disabled={loading || !report}
              onExportPdf={report ? handleExportPdf : undefined}
            />
            <button
              type="button"
              title="طباعة"
              disabled={loading || !report}
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-45"
            >
              <Printer className="w-4 h-4" />
              طباعة
            </button>
            <button
              onClick={() => goToPage(page - 1)}
              disabled={!canGoPrevious || loading}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              title="السابق"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold text-slate-600">
              صفحة {page}{totalRows > 0 ? ` / ${totalPages}` : ''}
            </span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={!canGoNext || loading}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              title="التالي"
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
            aria-label="إغلاق"
            onClick={() => setTopCustomerOpen(false)}
          />
          <div className="relative z-10 my-6 w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-500">تفاصيل أكثر زبون يشتري</p>
                <h3 className="mt-1 text-xl font-black text-slate-900">{dash(topCustomer.customerName)}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  آخر شراء: {String(topCustomer.lastInvoiceDate ?? '').slice(0, 10) || '-'}
                  {topCustomer.topMaterialName ? ` · أكثر خامة: ${topCustomer.topMaterialName}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTopCustomerOpen(false)}
                className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                إغلاق
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-500">إجمالي المبيعات</p>
                  <p className="mt-2 font-mono text-lg font-black text-slate-900">{fmtMoney(topCustomer.salesAmount)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-500">إجمالي الأمتار</p>
                  <p className="mt-2 font-mono text-lg font-black text-slate-900">{fmtMeters(topCustomer.soldMeters)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-500">إجمالي التكلفة</p>
                  <p className="mt-2 font-mono text-lg font-black text-slate-900">{fmtMoney(topCustomer.costAmount)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-500">إجمالي الربح</p>
                  <p className="mt-2 font-mono text-lg font-black text-slate-900">{fmtMoney(topCustomer.grossProfit)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-500">المحصل</p>
                  <p className="mt-2 font-mono text-lg font-black text-emerald-700">{fmtMoney(topCustomer.paidAmount)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-500">المتبقي</p>
                  <p className="mt-2 font-mono text-lg font-black text-amber-700">{fmtMoney(topCustomer.remainingAmount)}</p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-black text-slate-900">أهم 5 فواتير</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right">
                    <thead className="bg-slate-900 text-white">
                      <tr>
                        <th className="p-3">التاريخ</th>
                        <th className="p-3">رقم الفاتورة</th>
                        <th className="p-3">المبيعات</th>
                        <th className="p-3">الأمتار</th>
                        <th className="p-3">متبقي</th>
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
                            لا توجد بيانات فواتير ضمن الفلاتر الحالية.
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
}) => (
  <table className="w-full text-sm text-right">
    <thead className="bg-slate-900 text-white">
      <tr>
        <th className="p-3">المجموعة</th>
        <th className="p-3">عدد الفواتير</th>
        <th className="p-3">عدد البنود</th>
        <th className="p-3">إجمالي البيع</th>
        <th className="p-3">إجمالي التكلفة</th>
        <th className="p-3">الربح</th>
        <th className="p-3">المحصل</th>
        <th className="p-3">المتبقي</th>
        <th className="p-3">الأمتار</th>
        <th className="p-3">جودة التكلفة</th>
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
              <QualityCount label="مثبتة" value={group.totals.historical_snapshot_count} className="bg-emerald-50 text-emerald-700 border-emerald-200" />
              <QualityCount label="تقديرية" value={group.totals.fallback_cost_count} className="bg-amber-50 text-amber-700 border-amber-200" />
              <QualityCount label="مفقودة" value={group.totals.missing_cost_count} className="bg-rose-50 text-rose-700 border-rose-200" />
              <QualityCount label="جزئية" value={group.totals.partial_cost_count} className="bg-orange-50 text-orange-700 border-orange-200" />
            </div>
          </td>
        </tr>
      ))}
      {!loading && groups.length === 0 && (
        <tr>
          <td colSpan={10} className="p-8 text-center text-slate-500 bg-slate-50">
            لا توجد مجاميع مطابقة للفلاتر الحالية.
          </td>
        </tr>
      )}
    </tbody>
  </table>
);

const QualityCount = ({ label, value, className }: { label: string; value: unknown; className: string }) => {
  const count = Number(value ?? 0);
  if (!count) return null;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-black ${className}`}>
      {label}: {count}
    </span>
  );
};

const InvoiceTable = ({ rows, loading }: { rows: Record<string, unknown>[]; loading: boolean }) => (
  <table className="w-full text-sm text-right">
    <thead className="bg-slate-900 text-white">
      <tr>
        <th className="p-3">التاريخ</th>
        <th className="p-3">رقم الفاتورة</th>
        <th className="p-3">العميل</th>
        <th className="p-3">البيع</th>
        <th className="p-3">المحصل</th>
        <th className="p-3">المتبقي ذمم</th>
        <th className="p-3">التكلفة</th>
        <th className="p-3">الربح الكلي</th>
        <th className="p-3">ربح محصل</th>
        <th className="p-3">ربح مع الذمم</th>
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
            لا توجد فواتير بيع مؤكدة ضمن هذا النطاق.
          </td>
        </tr>
      )}
    </tbody>
  </table>
);

const LineTable = ({ rows, loading }: { rows: Record<string, unknown>[]; loading: boolean }) => (
  <table className="w-full text-xs text-right">
    <thead className="bg-slate-900 text-white">
      <tr>
        <th className="p-3">التاريخ</th>
        <th className="p-3">رقم الفاتورة</th>
        <th className="p-3">العميل</th>
        <th className="p-3">حالة الدفع</th>
        <th className="p-3">الخامة</th>
        <th className="p-3">كود الخامة</th>
        <th className="p-3">اللون</th>
        <th className="p-3">الباركود</th>
        <th className="p-3">المورد</th>
        <th className="p-3">المستودع</th>
        <th className="p-3">الكمية</th>
        <th className="p-3">الوحدة</th>
        <th className="p-3">الكمية بالمتر</th>
        <th className="p-3">إجمالي البيع</th>
        <th className="p-3">إجمالي التكلفة</th>
        <th className="p-3">الربح</th>
        <th className="p-3">المحصل</th>
        <th className="p-3">المتبقي</th>
        <th className="p-3">جودة التكلفة</th>
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
            لا توجد بنود بيع مطابقة للفلاتر.
          </td>
        </tr>
      )}
    </tbody>
  </table>
);
