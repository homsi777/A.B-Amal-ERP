import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText,
  TrendingUp,
  PackageSearch,
  Users,
  Activity,
  Wallet,
  ShoppingCart,
  Truck,
  Scissors,
  ChevronLeft,
  Package,
  AlertCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  fetchUnifiedReport,
  getCashboxSummary,
  getDashboardSummary,
  getInventorySummary,
  getPayrollSummary,
  getVouchersSummary,
  type DashboardSummary,
} from '../../lib/api/reportsApi';
import { ApiRequestError } from '../../lib/api/client';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import type { UnifiedReportPayload } from '../../lib/reports/types';
import { exportReportToExcel, safeReportFilename } from '../../lib/reports/exportReportToExcel';
import { exportReportPdf } from '../../lib/reports/printReport';
import { ReportViewer } from '../../components/reports/ReportViewer';
import { ReportToolbar } from '../../components/reports/ReportToolbar';

type TabId = 'executive' | 'financial' | 'sales' | 'purchases' | 'inventory' | 'customers' | 'suppliers' | 'textile';

interface ReportCardDef {
  id: string;
  title: string;
  desc: string;
  /** Path after /api/reports */
  path: string;
  tab: TabId;
}

const ALL_REPORT_CARDS: ReportCardDef[] = [
  { id: 'executive_summary', title: 'التقرير التنفيذي الموحّد', desc: 'جدول مؤشرات من PostgreSQL', path: '/executive/summary-report', tab: 'executive' },

  { id: 'financial_cashboxes', title: 'أرصدة الصناديق', desc: 'أرصدة حسب العملة', path: '/financial/cashboxes', tab: 'financial' },
  { id: 'financial_cb_mov', title: 'حركة الصندوق', desc: 'حركات نقدية', path: '/financial/cashbox-movements', tab: 'financial' },
  { id: 'financial_vouchers', title: 'سجل السندات', desc: 'قبض وصرف', path: '/financial/vouchers', tab: 'financial' },
  { id: 'fin_rec_pay', title: 'ملخص المقبوضات والمدفوعات', desc: 'سندات مفصّلة', path: '/financial/receipts-payments', tab: 'financial' },
  { id: 'fin_acct_act', title: 'تقرير حركة الحساب المخصص', desc: 'دفتر تشغيلي مع فلاتر', path: '/financial/account-activity', tab: 'financial' },
  { id: 'payroll_summary', title: 'ملخص الرواتب (بطاقات)', desc: 'مسيرات وصافي', path: '/payroll/summary', tab: 'financial' },
  { id: 'pay_emp', title: 'قائمة الموظفين', desc: 'بيانات الموظفين', path: '/payroll/employees', tab: 'financial' },
  { id: 'pay_runs', title: 'مسيرات الرواتب', desc: 'سجل المسيرات', path: '/payroll/runs-list', tab: 'financial' },
  { id: 'pay_month', title: 'ملخص رواتب شهري', desc: 'تجميع شهري', path: '/payroll/monthly-summary', tab: 'financial' },
  { id: 'gl', title: 'دفتر الأستاذ (تشغيلي)', desc: 'سندات + صناديق + مرتجعات + رواتب + أنشطة', path: '/financial/operational-ledger', tab: 'financial' },
  { id: 'tb', title: 'ميزان مراجعة (تشغيلي)', desc: 'تجميع صناديق وسندات', path: '/financial/operational-balance-summary', tab: 'financial' },
  { id: 'pl', title: 'قائمة دخل/مصروف (تشغيلي)', desc: 'من السندات والمرتجعات والرواتب', path: '/financial/operational-income-expense', tab: 'financial' },
  { id: 'bs', title: 'مركز مالي (تشغيلي)', desc: 'نقد ومخزون ومسودات', path: '/financial/operational-position', tab: 'financial' },
  { id: 'cf', title: 'التدفقات النقدية (تشغيلي)', desc: 'من حركات الصناديق', path: '/financial/cash-flow', tab: 'financial' },
  { id: 'fx', title: 'تعرّض العملات', desc: 'أرصدة وسندات لكل عملة', path: '/financial/currency-differences', tab: 'financial' },

  { id: 'sa1', title: 'ملخص المبيعات', desc: 'سندات ومرتجعات ونشاط', path: '/sales/summary', tab: 'sales' },
  { id: 'sa2', title: 'المبيعات التفصيلية', desc: 'نشاط العملاء', path: '/sales/details', tab: 'sales' },
  { id: 'sa_item', title: 'المبيعات حسب الصنف', desc: 'هيكل جاهز لربط فواتير البيع', path: '/sales/by-item', tab: 'sales' },
  { id: 'sa_cust', title: 'المبيعات حسب العميل', desc: 'تجميع نشاط عملاء', path: '/sales/by-customer', tab: 'sales' },
  { id: 'sa_agent', title: 'المبيعات حسب المندوب', desc: '', path: '/sales/by-agent', tab: 'sales' },
  { id: 'sa_color', title: 'المبيعات حسب اللون', desc: '', path: '/sales/by-color', tab: 'sales' },
  { id: 'sa_margins', title: 'تحليل هوامش الربح', desc: 'يتطلب تكلفة وبيع', path: '/sales/margins', tab: 'sales' },

  { id: 'purchases_batches', title: 'سجل دفعات استيراد Excel', desc: 'ملفات وحالة الدفعة', path: '/purchases/import-batches', tab: 'purchases' },
  { id: 'purchases_rows', title: 'صفوف دفعة الاستيراد', desc: 'أدخل UUID الدفعة في الفلاتر', path: '/purchases/import-rows', tab: 'purchases' },
  { id: 'pur_sum', title: 'ملخص المشتريات', desc: 'استيراد وأدواب', path: '/purchases/summary', tab: 'purchases' },
  { id: 'pur_det', title: 'المشتريات التفصيلية', desc: 'أدواب في المخزون', path: '/purchases/details', tab: 'purchases' },
  { id: 'pur_sup', title: 'المشتريات حسب المورد', desc: '', path: '/purchases/by-supplier', tab: 'purchases' },
  { id: 'pur_item', title: 'المشتريات حسب الصنف', desc: '', path: '/purchases/by-item', tab: 'purchases' },
  { id: 'pur_batch', title: 'المشتريات حسب الدفعة/اللوط', desc: '', path: '/purchases/by-batch', tab: 'purchases' },
  { id: 'pur_cost', title: 'اتجاه التكلفة', desc: 'متوسط تكلفة وحدة', path: '/purchases/cost-trend', tab: 'purchases' },

  { id: 'inventory_rolls', title: 'كشف أتواب المخزون', desc: 'تدقيق وتصفية حسب الحالة — يشمل المباع والصفرية عند الحاجة؛ ليس بديلاً عن شاشة «المتاح للبيع».', path: '/inventory/rolls', tab: 'inventory' },
  { id: 'inventory_stock_audit_page', title: 'جرد مخزون المخزون', desc: 'التصميم التشغيلي السابق (صفحة كاملة)', path: '/inventory', tab: 'inventory' },
  { id: 'inventory_movements', title: 'حركة الأتواب', desc: '', path: '/inventory/movements', tab: 'inventory' },
  { id: 'inventory_by_wh', title: 'الأدواب حسب المستودع', desc: '', path: '/inventory/by-warehouse', tab: 'inventory' },
  { id: 'inventory_item_color', title: 'الأدواب حسب الخامة واللون', desc: '', path: '/inventory/by-item-color', tab: 'inventory' },
  { id: 'inv_balance', title: 'أرصدة المخزون', desc: 'تجميع تشغيلي', path: '/inventory/balances', tab: 'inventory' },
  { id: 'inv_move_old', title: 'تقييم المخزون', desc: 'طول × تكلفة وحدة', path: '/inventory/valuation', tab: 'inventory' },
  { id: 'inv_by_color', title: 'المخزون حسب اللون', desc: '', path: '/inventory/by-color', tab: 'inventory' },
  { id: 'inv_aging', title: 'أعمار المخزون', desc: '_buckets زمنية', path: '/inventory/aging', tab: 'inventory' },
  { id: 'inv_slow', title: 'أصناف بطيئة الحركة', desc: 'بدون حركة مخزون طويلة', path: '/inventory/slow-moving', tab: 'inventory' },
  { id: 'inv_negative', title: 'شذوذ سالب (طول/وزن)', desc: '', path: '/inventory/negative-stock', tab: 'inventory' },
  { id: 'tx1', title: 'المخزون على مستوى الطاقة', desc: 'تفاصيل ثوب', path: '/inventory/roll-level', tab: 'inventory' },
  { id: 'inv_batch_tr', title: 'تتبع الدفعات', desc: 'دفعات استيراد', path: '/inventory/batch-tracking', tab: 'inventory' },
  { id: 'inv_fabric_types', title: 'أنواع الأقمشة', desc: 'حسب فئة الكatalog', path: '/inventory/fabric-types', tab: 'inventory' },
  { id: 'inv_waste', title: 'الهدر والأضرار', desc: 'سجلات الهدر + DAMAGE', path: '/inventory/waste-analysis', tab: 'inventory' },
  { id: 'inv_cut', title: 'كفاءة القص', desc: '', path: '/inventory/cutting-efficiency', tab: 'inventory' },
  { id: 'inv_rem_len', title: 'الأطوال المتبقية', desc: 'ثوب غير مباع', path: '/inventory/remaining-lengths', tab: 'inventory' },

  { id: 'parties_activity', title: 'نشاط العملاء والموردين', desc: 'سجل الأنشطة', path: '/parties/activity', tab: 'customers' },
  { id: 'cust_act', title: 'نشاط العملاء فقط', desc: '', path: '/customers/activity', tab: 'customers' },
  { id: 'c1', title: 'كشف حساب عميل', desc: 'سندات عملاء', path: '/customers/statement', tab: 'customers' },
  { id: 'c2', title: 'أعمار ديون العملاء', desc: '', path: '/customers/aging', tab: 'customers' },
  { id: 'c_status', title: 'العملاء حسب الحالة', desc: '', path: '/customers/by-status', tab: 'customers' },
  { id: 'c_sum', title: 'ملخص تعاملات العملاء', desc: '', path: '/customers/summary', tab: 'customers' },

  { id: 'sup_act', title: 'نشاط الموردين', desc: '', path: '/suppliers/activity', tab: 'suppliers' },
  { id: 's1', title: 'كشف حساب مورد', desc: 'سندات موردين', path: '/suppliers/statement', tab: 'suppliers' },
  { id: 's2', title: 'أعمار ذمم الموردين', desc: '', path: '/suppliers/aging', tab: 'suppliers' },
  { id: 'sup_status', title: 'الموردون حسب الحالة', desc: '', path: '/suppliers/by-status', tab: 'suppliers' },
  { id: 'sup_sum', title: 'ملخص تعاملات الموردين', desc: '', path: '/suppliers/summary', tab: 'suppliers' },

  { id: 'printing_jobs', title: 'سجل مهام الطباعة', desc: '', path: '/printing/jobs', tab: 'textile' },
  { id: 'print_labels', title: 'اللصاقات المطبوعة', desc: '', path: '/printing/printed-labels', tab: 'textile' },
  { id: 'print_unprinted', title: 'أدواب بدون لصاقة', desc: '', path: '/printing/unprinted-rolls', tab: 'textile' },
];

const PAGE_NAVIGATION_CARDS = new Set<string>(['inventory_stock_audit_page']);

const isPageNavigation = (cardId: string) => PAGE_NAVIGATION_CARDS.has(cardId);

const WAREHOUSE_KEYS = new Set([
  'inventory_rolls',
  'inventory_movements',
  'pur_det',
  'tx1',
]);

const CASHBOX_KEYS = new Set(['financial_cb_mov', 'financial_vouchers', 'fin_rec_pay']);

type ReportRow = Record<string, unknown>;
type ReportGroup = {
  rows: ReportRow[];
  summary: ReportRow | null;
  index: number;
};

const reportCollator = new Intl.Collator('ar', {
  sensitivity: 'base',
  numeric: true,
});

function sortableText(value: unknown): string {
  return String(value ?? '').trim();
}

function compareReportValues(aValue: unknown, bValue: unknown, dir: 'asc' | 'desc'): number {
  const direction = dir === 'asc' ? 1 : -1;
  const aText = sortableText(aValue);
  const bText = sortableText(bValue);
  const aNum = Number(aText);
  const bNum = Number(bText);
  if (aText !== '' && bText !== '' && Number.isFinite(aNum) && Number.isFinite(bNum)) {
    return (aNum - bNum) * direction;
  }

  const maybeDates = /[-/:T]/.test(aText) && /[-/:T]/.test(bText);
  const aDate = maybeDates ? new Date(aText).getTime() : Number.NaN;
  const bDate = maybeDates ? new Date(bText).getTime() : Number.NaN;
  if (maybeDates && Number.isFinite(aDate) && Number.isFinite(bDate)) {
    return (aDate - bDate) * direction;
  }

  return reportCollator.compare(aText, bText) * direction;
}

function splitInventoryReportGroups(rows: ReportRow[]): ReportGroup[] {
  const groups: ReportGroup[] = [];
  let current: ReportGroup = { rows: [], summary: null, index: 0 };

  const flush = () => {
    if (!current.rows.length && !current.summary) return;
    groups.push(current);
    current = { rows: [], summary: null, index: groups.length };
  };

  for (const row of rows) {
    if (row.__is_group_summary) {
      current.summary = row;
      flush();
    } else {
      current.rows.push(row);
    }
  }
  flush();
  return groups;
}

function groupSortValue(group: ReportGroup, key: string): unknown {
  const first = group.rows[0] ?? {};
  if (key === 'internal_code') return first.internal_code || first.item_name;
  if (key === 'item_name') return first.item_name || first.internal_code;
  return first[key];
}

function flattenInventoryReportGroups(groups: ReportGroup[]): ReportRow[] {
  return groups.flatMap((group) => (group.summary ? [...group.rows, group.summary] : group.rows));
}

function sortInventoryRollRows(rows: ReportRow[], sortBy: string, sortDir: 'asc' | 'desc'): ReportRow[] {
  const groups = splitInventoryReportGroups(rows);

  if (sortBy === 'item_name' || sortBy === 'internal_code') {
    groups.sort((a, b) => {
      const primary = compareReportValues(groupSortValue(a, sortBy), groupSortValue(b, sortBy), sortDir);
      if (primary !== 0) return primary;
      const secondaryKey = sortBy === 'item_name' ? 'internal_code' : 'item_name';
      const secondary = compareReportValues(groupSortValue(a, secondaryKey), groupSortValue(b, secondaryKey), 'asc');
      return secondary || a.index - b.index;
    });
  } else {
    for (const group of groups) {
      group.rows = [...group.rows].sort((a, b) => {
        const primary = compareReportValues(a[sortBy], b[sortBy], sortDir);
        if (primary !== 0) return primary;
        const colorCode = compareReportValues(a.color_code, b.color_code, 'asc');
        if (colorCode !== 0) return colorCode;
        return compareReportValues(a.barcode, b.barcode, 'asc');
      });
    }
  }

  return flattenInventoryReportGroups(groups);
}

export const ReportsCenter = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('executive');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [search, setSearch] = useState('');
  const [cashboxId, setCashboxId] = useState('');
   const [batchId, setBatchId] = useState('');
   const [sortMode, setSortMode] = useState<'default' | 'alpha_asc' | 'alpha_desc' | 'date_desc' | 'date_asc'>('default');
   const [applyNonce, setApplyNonce] = useState(0);

   // Column-based sorting (used primarily for inventory_rolls)
   const [columnSortBy, setColumnSortBy] = useState<string>('');
   const [columnSortDir, setColumnSortDir] = useState<'asc' | 'desc'>('asc');

  const [report, setReport] = useState<UnifiedReportPayload | null>(null);
  const [repLoading, setRepLoading] = useState(false);
  const [repErr, setRepErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState<null | 'excel' | 'pdf'>(null);
  const [exportNotice, setExportNotice] = useState<null | { type: 'info' | 'success' | 'error'; text: string }>(null);
  const [page, setPage] = useState(1);

  const tabs = [
    { id: 'executive' as const, name: 'لوحة القيادة التنفيذية', icon: Activity },
    { id: 'financial' as const, name: 'التقارير المالية', icon: TrendingUp },
    { id: 'sales' as const, name: 'تقارير المبيعات', icon: ShoppingCart },
    { id: 'purchases' as const, name: 'تقارير المشتريات', icon: Truck },
    { id: 'inventory' as const, name: 'تقارير المخزون', icon: PackageSearch },
    { id: 'customers' as const, name: 'تقارير العملاء', icon: Users },
    { id: 'suppliers' as const, name: 'تقارير الموردين', icon: Wallet },
    { id: 'textile' as const, name: 'تقارير النسيج التخصصية', icon: Scissors },
  ];

  useEffect(() => {
    void listWarehouses({ status: 'active' }).then(setWarehouses).catch(() => setWarehouses([]));
  }, []);

  const selectedCard = useMemo(
    () => ALL_REPORT_CARDS.find((c) => c.id === selectedKey) ?? null,
    [selectedKey],
  );

  const loadLiveReport = useCallback(async () => {
    if (!selectedCard) return;
    setRepLoading(true);
    setRepErr(null);
    try {
      const params: Record<string, string | number | undefined> = {
        page,
        pageSize: selectedCard.id === 'inventory_rolls' ? 10000 : 50,
      };
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (search.trim()) params.search = search.trim();
      if (warehouseId && WAREHOUSE_KEYS.has(selectedCard.id)) {
        params.warehouseId = warehouseId;
      }
      if (cashboxId && CASHBOX_KEYS.has(selectedCard.id)) {
        params.cashboxId = cashboxId;
      }
      if (selectedCard.id === 'purchases_rows' && batchId.trim()) {
        params.batchId = batchId.trim();
      }
      const res = await fetchUnifiedReport(selectedCard.path, params);
      setReport({ ...res.report, key: selectedCard.id });
    } catch (e) {
      setReport(null);
      setRepErr(e instanceof ApiRequestError ? e.message : 'تعذر تحميل التقرير');
    } finally {
      setRepLoading(false);
    }
  }, [selectedCard, page, applyNonce, dateFrom, dateTo, search, warehouseId, cashboxId, batchId]);

   useEffect(() => {
     void loadLiveReport();
   }, [loadLiveReport]);

   // Reset column sort when switching reports
   useEffect(() => {
     setColumnSortBy('');
     setColumnSortDir('asc');
   }, [selectedKey]);

   // Reset page when column sorting changes
   useEffect(() => {
     setPage(1);
   }, [columnSortBy, columnSortDir]);

   const selectedTitle = selectedCard?.title ?? '';

   // Sorting logic for reports
   const sortedReport = useMemo<UnifiedReportPayload | null>(() => {
     if (!report || !report.rows?.length) return report;

     const isInventoryRolls = selectedCard?.id === 'inventory_rolls';
     let rows = [...report.rows];

     // Column-based sorting for inventory rolls
     if (isInventoryRolls && columnSortBy) {
       rows = sortInventoryRollRows(rows, columnSortBy, columnSortDir);
     } else if (sortMode !== 'default') {
       // Preserve existing sortMode logic for other reports
       const dateKey = report.columns.find((c) =>
         /(date|created|updated|time|تاريخ)/i.test(c.key) || /(date|created|updated|time|تاريخ)/i.test(c.label),
       )?.key;
       let alphaKey = report.columns.find((c) =>
         /(name|item|fabric|customer|supplier|اسم|خامة|عميل|مورد)/i.test(c.key) ||
         /(name|item|fabric|customer|supplier|اسم|خامة|عميل|مورد)/i.test(c.label),
       )?.key ?? report.columns[0]?.key;

       if (sortMode === 'alpha_asc' || sortMode === 'alpha_desc') {
         const dir = sortMode === 'alpha_asc' ? 1 : -1;
         rows.sort((a, b) => String(a[alphaKey] ?? '').localeCompare(String(b[alphaKey] ?? ''), 'ar', { sensitivity: 'base' }) * dir);
       } else if (dateKey) {
         const dir = sortMode === 'date_desc' ? -1 : 1;
         rows.sort((a, b) => {
           const ta = new Date(String(a[dateKey] ?? '')).getTime();
           const tb = new Date(String(b[dateKey] ?? '')).getTime();
           const av = Number.isFinite(ta) ? ta : 0;
           const bv = Number.isFinite(tb) ? tb : 0;
           if (av === bv) return 0;
           return av > bv ? dir : -dir;
         });
       }
     } else {
       return report;
     }

     return { ...report, rows };
   }, [report, sortMode, selectedCard, columnSortBy, columnSortDir]);

  const waitForPaint = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => window.setTimeout(resolve, 0));
    });

  const handleExport = async () => {
    if (!sortedReport || !selectedKey || exporting) return;
    setExporting('excel');
    setExportNotice({ type: 'info', text: 'جاري تجهيز ملف Excel...' });
    try {
      await waitForPaint();
      exportReportToExcel(sortedReport, safeReportFilename(selectedKey));
      setExportNotice({ type: 'success', text: 'تم تصدير ملف Excel بنجاح.' });
    } catch (error) {
      console.error('Report Excel export failed', error);
      setExportNotice({ type: 'error', text: 'تعذر تصدير ملف Excel. جرّب تحديث التقرير ثم التصدير مرة أخرى.' });
    } finally {
      setExporting(null);
    }
  };

  const handlePrint = async () => {
    if (!sortedReport || !selectedKey || exporting) return;
    setExporting('pdf');
    setExportNotice({ type: 'info', text: 'جاري تجهيز ملف PDF...' });
    try {
      await waitForPaint();
      await exportReportPdf(sortedReport, `${safeReportFilename(selectedKey)}.pdf`);
      setExportNotice({ type: 'success', text: 'تم تصدير ملف PDF بنجاح.' });
    } catch (error) {
      console.error('Report print failed', error);
      setExportNotice({ type: 'error', text: 'تعذر تصدير ملف PDF. جرّب مرة أخرى.' });
    } finally {
      setExporting(null);
    }
  };

  const applyFilters = () => {
    setPage(1);
    setApplyNonce((n) => n + 1);
  };

  const renderCards = (tab: TabId) => (
    <div className="animation-fade-in pb-8">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {ALL_REPORT_CARDS.filter((c) => c.tab === tab).map((reportItem) => (
          <button
            key={reportItem.id}
            type="button"
            onClick={() => {
              if (isPageNavigation(reportItem.id)) {
                navigate(reportItem.path);
              } else {
                setSelectedKey(reportItem.id);
                setPage(1);
              }
            }}
            className={`text-right bg-white p-5 rounded-xl border transition-all flex flex-col ${
              selectedKey === reportItem.id && !isPageNavigation(reportItem.id)
                ? 'border-indigo-500 shadow-md ring-1 ring-indigo-100'
                : 'border-slate-200 hover:border-indigo-400 hover:shadow-md'
            }`}
          >
            <h4 className="font-bold text-indigo-900 mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" />
              {reportItem.title}
              <span className="mr-auto text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">جاهز</span>
            </h4>
            <p className="text-sm text-slate-500 leading-relaxed mt-auto border-t border-slate-50 pt-3">{reportItem.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );

  const renderDetail = () => {
    if (!selectedKey || !selectedCard) return null;

    return (
      <div className="space-y-3">
        {selectedKey === 'purchases_rows' ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex flex-wrap gap-3 items-end">
            <div className="space-y-1 flex-1 min-w-[200px]">
              <label className="text-xs font-bold text-slate-500">معرف دفعة الاستيراد (UUID)</label>
              <input
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                placeholder="من سجل دفعات الاستيراد"
                className="w-full p-2 border border-slate-200 rounded-lg text-sm font-mono"
              />
            </div>
            <button type="button" onClick={applyFilters} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm">
              تحميل الصفوف
            </button>
          </div>
        ) : null}

        <div className="hidden">
          <div>
            <h3 className="text-base font-bold text-slate-900">{report?.title ?? selectedTitle}</h3>
            {sortedReport?.subtitle ? <p className="text-xs text-indigo-700 font-medium mt-0.5">{sortedReport.subtitle}</p> : null}
            <p className="text-xs text-slate-500">
              {sortedReport?.generatedAt ? new Date(sortedReport.generatedAt).toLocaleDateString('ar-SY') : ''}
            </p>
          </div>
          <ReportToolbar
            disabled={repLoading || Boolean(exporting)}
            disableReason={exporting ? 'جاري تنفيذ التصدير...' : undefined}
            onExportExcel={sortedReport ? handleExport : undefined}
            onExportPdf={sortedReport ? handlePrint : undefined}
          />
        </div>

        {exportNotice ? (
          <div
            className={`rounded-lg border px-4 py-3 text-sm font-bold flex items-center justify-between gap-3 ${
              exportNotice.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : exportNotice.type === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-800'
            }`}
          >
            <span>{exportNotice.text}</span>
            <button
              type="button"
              onClick={() => setExportNotice(null)}
              className="text-xs font-bold opacity-70 hover:opacity-100"
            >
              إخفاء
            </button>
          </div>
        ) : null}

         <ReportViewer
           report={sortedReport}
           loading={repLoading}
           error={repErr}
           onPageChange={(p) => {
             setPage(p);
           }}
           enableSorting={selectedCard?.id === 'inventory_rolls'}
           sortBy={columnSortBy}
           sortDir={columnSortDir}
           onSortChange={(by, dir) => {
             setColumnSortBy(by);
             setColumnSortDir(dir);
           }}
         />
      </div>
    );
  };

  const renderTabBody = () => {
    if (activeTab === 'executive') {
      return (
        <div className="space-y-8">
          <ExecutiveDashboardPanel />
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-3">تقارير تنفيذية</h3>
            {renderCards('executive')}
          </div>
        </div>
      );
    }
    if (activeTab === 'financial') return renderCards('financial');
    if (activeTab === 'sales') return renderCards('sales');
    if (activeTab === 'purchases') return renderCards('purchases');
    if (activeTab === 'inventory') return renderCards('inventory');
    if (activeTab === 'customers') return renderCards('customers');
    if (activeTab === 'suppliers') return renderCards('suppliers');
    if (activeTab === 'textile') return renderCards('textile');
    return null;
  };

  return (
    <div className="w-full max-w-none flex flex-col p-6">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">مركز التقارير المتطور</h2>
          <p className="text-slate-500 mt-1">
            كل تقرير ظاهر مرتبط بـ PostgreSQL — تصدير Excel وطباعة. التقارير «التشغيلية» توضح أنها ليست محاسبة Journal كاملة حيث ينطبق ذلك.
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="w-full lg:w-72 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col p-4 space-y-2 shrink-0 select-none">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setSelectedKey(null);
                setReport(null);
              }}
              className={`flex items-center gap-3 px-4 py-3.5 rounded-lg text-right transition-colors w-full font-medium ${
                activeTab === tab.id && !selectedKey
                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-100 shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <tab.icon className={`w-5 h-5 ${activeTab === tab.id && !selectedKey ? 'text-indigo-600' : 'text-slate-400'}`} />
              {tab.name}
            </button>
          ))}
        </div>

        <div className="w-full lg:flex-1 min-w-0 flex flex-col relative">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 mb-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-8 gap-2 shrink-0 items-end">
            <div className="space-y-0.5 xl:col-span-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">من تاريخ</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-0.5 xl:col-span-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">إلى تاريخ</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-0.5 xl:col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">المستودع</label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">كل المستودعات</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={`space-y-0.5 ${selectedCard?.id === 'inventory_rolls' ? 'xl:col-span-2' : 'xl:col-span-4'}`}>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">بحث نصّي</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="باركود، اسم، رقم..."
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
             </div>
             {selectedCard?.id === 'inventory_rolls' && (
               <div className="flex items-end justify-start xl:col-span-2">
                 <ReportToolbar
                   disabled={repLoading || Boolean(exporting)}
                   disableReason={exporting ? 'ط¬ط§ط±ظٹ طھظ†ظپظٹط° ط§ظ„طھطµط¯ظٹط±...' : undefined}
                   onExportExcel={sortedReport ? handleExport : undefined}
                   onExportPdf={sortedReport ? handlePrint : undefined}
                 />
               </div>
             )}
             {/* Column sorting is available directly in the table headers for inventory rolls */}
             {selectedCard?.id !== 'inventory_rolls' && (
               <div className="space-y-0.5 xl:col-span-2">
                 <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">فرز التقرير</label>
                 <select
                   value={sortMode}
                   onChange={(e) => setSortMode(e.target.value as 'default' | 'alpha_asc' | 'alpha_desc' | 'date_desc' | 'date_asc')}
                   className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                 >
                   <option value="default">افتراضي</option>
                   <option value="alpha_asc">أبجديًا (أ-ي)</option>
                   <option value="alpha_desc">أبجديًا (ي-أ)</option>
                   <option value="date_desc">تاريخ الإدخال (الأحدث)</option>
                   <option value="date_asc">تاريخ الإدخال (الأقدم)</option>
                 </select>
               </div>
             )}
            {selectedCard?.id !== 'inventory_rolls' && (
            <>
            <div className="space-y-0.5 xl:col-span-4">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">صندوق (حركة/سندات/مقبوضات)</label>
              <input
                value={cashboxId}
                onChange={(e) => setCashboxId(e.target.value)}
                placeholder="UUID صندوق — اختياري"
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex items-end gap-2 xl:col-span-2">
              <button
                type="button"
                onClick={applyFilters}
                className="flex-1 bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700 transition shadow-sm"
              >
                تطبيق وحساب
              </button>
            </div>
            </>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex-1 flex flex-col">
            {selectedKey ? (
              <div className="flex flex-col">
                <div className="hidden">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedKey(null);
                      setReport(null);
                    }}
                    className="text-slate-500 hover:text-slate-800 transition bg-slate-50 p-2 rounded-lg"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{selectedTitle}</h3>
                  </div>
                </div>
                <div>{renderDetail()}</div>
              </div>
            ) : (
              renderTabBody()
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function ExecutiveDashboardPanel() {
  const [dash, setDash] = useState<DashboardSummary | null>(null);
  const [inv, setInv] = useState<Awaited<ReturnType<typeof getInventorySummary>>['data'] | null>(null);
  const [vch, setVch] = useState<Awaited<ReturnType<typeof getVouchersSummary>>['data'] | null>(null);
  const [pay, setPay] = useState<Awaited<ReturnType<typeof getPayrollSummary>>['data'] | null>(null);
  const [cashDetail, setCashDetail] = useState<Awaited<ReturnType<typeof getCashboxSummary>>['data'] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [d, i, v, p, c] = await Promise.all([
          getDashboardSummary(),
          getInventorySummary(),
          getVouchersSummary(),
          getPayrollSummary(),
          getCashboxSummary(),
        ]);
        setDash(d.data);
        setInv(i.data);
        setVch(v.data);
        setPay(p.data);
        setCashDetail(c.data);
      } catch (e) {
        setErr(e instanceof ApiRequestError ? e.message : 'تعذر تحميل الملخص');
      }
    })();
  }, []);

  const kpis =
    dash && inv && vch
      ? [
          { label: 'العملاء', value: dash.customers_count.toLocaleString(), icon: Users, bg: 'bg-indigo-50', color: 'text-indigo-600' },
          { label: 'الموردون', value: dash.suppliers_count.toLocaleString(), icon: Truck, bg: 'bg-slate-50', color: 'text-slate-600' },
          { label: 'أدواب المخزون', value: dash.fabric_rolls_count.toLocaleString(), icon: PackageSearch, bg: 'bg-cyan-50', color: 'text-cyan-600' },
          {
            label: 'أدواب نشطة',
            value: (dash.active_fabric_rolls_count ?? 0).toLocaleString(),
            icon: Package,
            bg: 'bg-teal-50',
            color: 'text-teal-700',
          },
          {
            label: 'إجمالي أمتار الأدواب',
            value: Number(inv.totalLengthM).toLocaleString(undefined, { maximumFractionDigits: 2 }),
            unit: 'م',
            icon: Activity,
            bg: 'bg-emerald-50',
            color: 'text-emerald-600',
          },
          {
            label: 'وزن الأدواب (تقدير)',
            value: Number(dash.total_roll_weight_kg ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 }),
            unit: 'kg',
            icon: Package,
            bg: 'bg-lime-50',
            color: 'text-lime-700',
          },
          {
            label: 'قبض مؤكد / صرف مؤكد',
            value: `${Number(dash.receipt_total ?? 0).toLocaleString()} / ${Number(dash.payment_total ?? 0).toLocaleString()}`,
            icon: Wallet,
            bg: 'bg-violet-50',
            color: 'text-violet-700',
          },
          {
            label: 'حركات المخزون',
            value: (dash.inventory_movements_count ?? inv.movementsCount).toLocaleString(),
            icon: TrendingUp,
            bg: 'bg-amber-50',
            color: 'text-amber-600',
          },
          {
            label: 'أدواب تالفة',
            value: (dash.damaged_or_waste_rolls_count ?? dash.damaged_rolls_count ?? 0).toLocaleString(),
            icon: AlertCircle,
            bg: 'bg-rose-50',
            color: 'text-rose-600',
          },
          {
            label: 'الصناديق / السندات',
            value: `${dash.cashboxes_count} / ${dash.vouchers_count}`,
            icon: Wallet,
            bg: 'bg-rose-50',
            color: 'text-rose-600',
          },
          {
            label: 'دفعات استيراد / طباعة',
            value: `${dash.purchase_import_batches_count} / ${dash.print_jobs_count}`,
            icon: FileText,
            bg: 'bg-violet-50',
            color: 'text-violet-700',
          },
          {
            label: 'مسيرات رواتب',
            value: (dash.payroll_runs_count ?? 0).toLocaleString(),
            icon: Activity,
            bg: 'bg-sky-50',
            color: 'text-sky-700',
          },
        ]
      : [];

  return (
    <div className="animation-fade-in pb-8 pr-2">
      <h3 className="text-xl font-bold text-slate-900 mb-2">الملخص التنفيذي العام</h3>
      <p className="text-sm text-slate-500 mb-6">أعداد ومؤشرات حقيقية من PostgreSQL — صفر عند عدم وجود بيانات.</p>

      {err && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{err}</div>}

      {!dash ? (
        <p className="text-slate-500 text-sm">جاري تحميل البيانات...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {kpis.map((kpi, idx) => (
              <div key={idx} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500 mb-1">{kpi.label}</p>
                  <h4 className="text-3xl font-bold text-slate-900 tracking-tight">
                    {kpi.value}{' '}
                    {'unit' in kpi && kpi.unit ? (
                      <span className="text-sm font-normal text-slate-500 ml-1">{kpi.unit}</span>
                    ) : null}
                  </h4>
                </div>
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${kpi.bg}`}>
                  <kpi.icon className={`w-6 h-6 ${kpi.color}`} />
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl border border-slate-200">
              <h4 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                <Package className="w-5 h-5 text-indigo-500" />
                ملخص السندات النقدية
              </h4>
              <div className="divide-y divide-slate-100 text-sm">
                <div className="py-3 flex justify-between">
                  <span className="text-slate-600">مسودات</span>
                  <span className="font-bold">{vch?.draft ?? 0}</span>
                </div>
                <div className="py-3 flex justify-between">
                  <span className="text-slate-600">مؤكدة</span>
                  <span className="font-bold text-emerald-700">{vch?.confirmed ?? 0}</span>
                </div>
                <div className="py-3 flex justify-between">
                  <span className="text-slate-600">إجمالي قبض مؤكد</span>
                  <span className="font-mono">{Number(vch?.confirmed_receipts ?? 0).toLocaleString()}</span>
                </div>
                <div className="py-3 flex justify-between">
                  <span className="text-slate-600">إجمالي صرف مؤكد</span>
                  <span className="font-mono">{Number(vch?.confirmed_payments ?? 0).toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200">
              <h4 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                <Wallet className="w-5 h-5 text-emerald-600" />
                أرصدة الصناديق حسب العملة
              </h4>
              <div className="divide-y divide-slate-100 text-sm">
                {(dash.total_cash_by_currency ?? []).length === 0 ? (
                  <p className="text-slate-500 py-2">لا توجد صناديق نشطة أو أرصدة صفر.</p>
                ) : (
                  (dash.total_cash_by_currency ?? []).map((row, i) => (
                    <div key={i} className="py-2 flex justify-between">
                      <span className="font-mono">{row.currency_code}</span>
                      <span className="font-bold">{Number(row.total).toLocaleString()}</span>
                    </div>
                  ))
                )}
                {cashDetail?.cashboxes?.length ? (
                  <p className="text-xs text-slate-400 pt-2">صناديق نشطة: {cashDetail.cashboxes.length}</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-6 bg-white p-6 rounded-xl border border-slate-200">
            <h4 className="font-bold text-slate-900 mb-2">الموارد البشرية (ملخص)</h4>
            <p className="text-sm text-slate-600">
              موظفون نشطون: <strong>{pay?.active_employees ?? '—'}</strong> — مسيرات:{' '}
              <strong>{pay?.payroll_runs_count ?? '—'}</strong> — مدفوعة:{' '}
              <strong>{pay?.paid_runs ?? '—'}</strong>
            </p>
          </div>
        </>
      )}
    </div>
  );
}
