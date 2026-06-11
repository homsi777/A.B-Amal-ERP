import React, { useCallback, useEffect, useState } from 'react';
import { Calendar, Check, Download, FileUp, Loader2, Pencil, Plus, Printer, RefreshCw, Search, Send, Trash2, X } from 'lucide-react';
import {
  type ApiCustomer,
  type CustomerPayload,
  createCustomer,
  listCustomers,
  toggleCustomerStatus,
  updateCustomer,
} from '../lib/api/customersApi';
import { focusNextFormControl } from '../lib/forms/enterNavigation';
import { useNavigate } from 'react-router-dom';
import { getCustomerStatement } from '../lib/api/partyStatementsApi';
import { exportPdfFromHtmlString, renderCustomerAccountStatementPdfHtml } from '../lib/pdfExport';
import { loadCustomerSaleInvoiceDetails } from '../lib/customerStatementInvoiceDetails';
import { BRAND } from '../branding';
import { CustomerStatementImportModal } from '../components/customers/CustomerStatementImportModal';
import { A4PreviewModal } from '../components/printing/A4PreviewModal';
import { sendTelegramAccountStatementPdf } from '../lib/telegramStatement';

const emptyForm = (): CustomerPayload => ({
  name: '', code: '', phone: '', email: '', address: '', notes: '',
  telegramChatId: '', telegramEnabled: false, telegramLabel: '',
});

export const Customers = () => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [reminderDate, setReminderDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isA4PreviewOpen, setIsA4PreviewOpen] = useState(false);
  const [isTelegramExportOpen, setIsTelegramExportOpen] = useState(false);
  const [telegramSelectionMode, setTelegramSelectionMode] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiCustomer | null>(null);
  const [form, setForm] = useState<CustomerPayload>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [summaryByCustomerId, setSummaryByCustomerId] = useState<
    Record<string, { debit: number; credit: number; total: number; remaining: number; currency: string }>
  >({});
  const [telegramSelectedIds, setTelegramSelectedIds] = useState<Set<string>>(new Set());
  const [telegramCustomers, setTelegramCustomers] = useState<ApiCustomer[]>([]);
  const [telegramSearch, setTelegramSearch] = useState('');
  const [telegramFromDate, setTelegramFromDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [telegramToDate, setTelegramToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await listCustomers({
        search: search || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        page, pageSize,
      });
      setCustomers(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في تحميل البيانات');
    } finally { setLoading(false); }
  }, [search, statusFilter, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ids = customers.map((c) => c.id);
    if (!ids.length) {
      setSummaryByCustomerId({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const pairs = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await getCustomerStatement(id, {});
            const debit = Number(res.data.totals.debit || 0);
            const credit = Number(res.data.totals.credit || 0);
            const totalAmount = debit + credit;
            const remaining = Math.abs(Number(res.data.totals.closingBalance || 0));
            const currency = String(res.data.rows[0]?.currency || 'USD');
            return [id, { debit, credit, total: totalAmount, remaining, currency }] as const;
          } catch {
            return [id, { debit: 0, credit: 0, total: 0, remaining: 0, currency: 'USD' }] as const;
          }
        }),
      );
      if (cancelled) return;
      setSummaryByCustomerId(Object.fromEntries(pairs));
    })();
    return () => {
      cancelled = true;
    };
  }, [customers]);

  const openAdd = () => { setEditTarget(null); setForm(emptyForm()); setSaveError(null); setIsModalOpen(true); };
  const openEdit = (c: ApiCustomer) => {
    setEditTarget(c);
    setForm({
      name: c.name,
      code: c.code,
      phone: c.phone,
      email: c.email || '',
      address: c.address,
      notes: c.notes,
      telegramChatId: c.telegram_chat_id || '',
      telegramEnabled: c.telegram_enabled,
      telegramLabel: c.telegram_label || '',
    });
    setSaveError(null);
    setIsModalOpen(true);
  };
  const closeModal = () => { setIsModalOpen(false); setEditTarget(null); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setSaveError(null);
    try {
      if (editTarget) { await updateCustomer(editTarget.id, form); }
      else { await createCustomer(form); }
      closeModal(); load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'فشل الحفظ');
    } finally { setSaving(false); }
  };

  const handleToggle = async (id: string) => {
    try {
      const res = await toggleCustomerStatus(id);
      setCustomers(c => c.map(x => x.id === id ? { ...x, is_active: res.is_active } : x));
    } catch { /* no-op */ }
  };

  const handleDeactivate = async (customer: ApiCustomer) => {
    if (!customer.is_active) return;
    if (!window.confirm(`تعطيل العميل "${customer.name}"؟ سيبقى محفوظاً للفواتير والكشوفات السابقة.`)) return;
    await handleToggle(customer.id);
  };

  const totalPages = Math.ceil(total / pageSize);
  const formatMoney = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const escapeHtml = (value: unknown) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const renderCustomersReminderHtml = () => {
    const rows = customers
      .map((customer) => {
        const s = summaryByCustomerId[customer.id] ?? { debit: 0, credit: 0, total: 0, remaining: 0, currency: 'USD' };
        return `
          <tr>
            <td>${escapeHtml(customer.code)}</td>
            <td>${escapeHtml(customer.name)}</td>
            <td>${formatMoney(s.total)}</td>
            <td>${formatMoney(s.credit)}</td>
            <td>${formatMoney(s.debit)}</td>
            <td>${formatMoney(s.remaining)}</td>
            <td>${escapeHtml(s.currency)}</td>
            <td>${escapeHtml(customer.notes || '—')}</td>
          </tr>
        `;
      })
      .join('');

    return `
      <!doctype html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="utf-8" />
          <title>كشف ذمم العملاء</title>
          <style>
            @page { size: A4; margin: 10mm; }
            body { font-family: Arial, Tahoma, sans-serif; color: #0f172a; font-size: 12px; }
            .head { display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #1e293b; padding-bottom:8px; margin-bottom:10px; }
            .brand { font-weight:900; font-size:18px; color:#1e293b; }
            .title { text-align:center; margin: 8px 0; font-weight:900; font-size:20px; }
            .meta { display:flex; justify-content:space-between; margin-bottom:8px; color:#334155; font-size:11px; }
            table { width:100%; border-collapse:collapse; }
            th, td { border:1px solid #cbd5e1; padding:6px; text-align:right; }
            thead th { background:#0f172a; color:#fff; }
            tbody tr:nth-child(even) { background:#f8fafc; }
          </style>
        </head>
        <body>
          <div class="head">
            <div class="brand">${escapeHtml(BRAND.name)}</div>
            <div>${escapeHtml(BRAND.descriptionAr)}</div>
          </div>
          <div class="title">كشف ذمم العملاء</div>
          <div class="meta">
            <div>تاريخ التذكير: ${escapeHtml(reminderDate)}</div>
            <div>عدد العملاء: ${customers.length}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>الكود</th>
                <th>اسم العميل</th>
                <th>مجموع</th>
                <th>دائن</th>
                <th>مدين</th>
                <th>متبقي</th>
                <th>العملة</th>
                <th>ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="8" style="text-align:center;">لا توجد بيانات</td></tr>`}
            </tbody>
          </table>
        </body>
      </html>
    `;
  };

  const handleExportCustomersPdf = async () => {
    const html = renderCustomersReminderHtml();
    await exportPdfFromHtmlString(html, `ذمم_العملاء_${reminderDate}`, { orientation: 'portrait' });
  };

  const handlePrintCustomersA4 = () => {
    setIsA4PreviewOpen(true);
  };

  const openTelegramExportLegacy = async () => {
    setTelegramSelectionMode(true);
    setTelegramStatus('');
    try {
      const res = await listCustomers({ status: 'active', page: 1, pageSize: 1000 });
      void res;
      const enabled = res.data.filter((c) => c.telegram_enabled || c.telegram_chat_id).map((c) => c.id);
      setTelegramSelectedIds(new Set(enabled));
    } catch (e) {
      setTelegramStatus(e instanceof Error ? e.message : 'تعذر تحميل العملاء للإرسال');
    }
  };

  const toggleTelegramCustomer = (id: string) => {
    setTelegramSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasTelegramLink = (customer: ApiCustomer) =>
    Boolean(customer.telegram_enabled && String(customer.telegram_chat_id || '').trim());

  const safePdfName = (value: string) =>
    value.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 120) || 'customer';

  const joinPdfPath = (folderPath: string, fileName: string) =>
    `${folderPath.replace(/[\\/]+$/, '')}\\${fileName.replace(/\.pdf$/i, '')}.pdf`;

  const toggleTelegramSelectionMode = () => {
    setTelegramSelectionMode((current) => {
      const next = !current;
      if (!next) {
        setTelegramSelectedIds(new Set());
        setTelegramStatus('');
      } else {
        setTelegramStatus('حدد العملاء المرتبطين بتيليغرام من الجدول ثم اختر التصدير والإرسال.');
      }
      return next;
    });
  };

  const sendSelectedCustomerStatements = async () => {
    const selected = customers.filter((c) => telegramSelectedIds.has(c.id) && hasTelegramLink(c));
    if (!selected.length) {
      setTelegramStatus('اختر عميلاً واحداً على الأقل.');
      return;
    }
    if (!window.fabricApp?.pickPdfFolder || !window.fabricApp?.printToPdf) {
      setTelegramStatus('التصدير الجماعي إلى مجلد يحتاج تشغيل التطبيق عبر Electron.');
      return;
    }
    const folderPath = await window.fabricApp.pickPdfFolder();
    if (!folderPath) {
      setTelegramStatus('تم إلغاء اختيار مجلد التصدير.');
      return;
    }
    setTelegramBusy(true);
    setTelegramStatus('بدء تجهيز ملفات PDF...');
    try {
      let exported = 0;
      let sent = 0;
      for (let i = 0; i < selected.length; i += 1) {
        const customer = selected[i];
        setTelegramStatus(`${i + 1} / ${selected.length} - تجهيز كشف ${customer.name}`);
        const res = await getCustomerStatement(customer.id, {
          fromDate: telegramFromDate,
          toDate: telegramToDate,
        });
        const statement = res.data;
        const party = statement.customer;
        const partyName = party?.name || customer.name;
        const invoiceDetails = await loadCustomerSaleInvoiceDetails(
          customer.id,
          telegramFromDate,
          telegramToDate,
        );
        const pdfHtml = renderCustomerAccountStatementPdfHtml({
          customerName: partyName,
          customerPhone: party?.phone ?? customer.phone ?? null,
          customerAddress: party?.address ?? customer.address ?? null,
          fromDate: telegramFromDate,
          toDate: telegramToDate,
          openingBalance: statement.openingBalance,
          rows: statement.rows,
          totals: statement.totals,
          invoiceDetailsBySourceId: invoiceDetails.invoiceDetailsBySourceId,
          invoiceDetailsByDocumentNo: invoiceDetails.invoiceDetailsByDocumentNo,
        });
        const closing = statement.totals.closingBalance;
        const fileName = `كشف_حساب_${safePdfName(partyName)}_${telegramFromDate}_${telegramToDate}.pdf`;
        const pdfResult = await window.fabricApp.printToPdf(pdfHtml, {
          pageSize: 'A4',
          defaultFileName: fileName,
          outputPath: joinPdfPath(folderPath, fileName),
          margins: { top: 6, right: 6, bottom: 6, left: 6 },
        });
        if (!pdfResult.ok) {
          throw new Error(pdfResult.error || `تعذر حفظ PDF للعميل ${partyName}`);
        }
        exported += 1;
        await sendTelegramAccountStatementPdf({
          partyType: 'customer',
          partyId: customer.id,
          partyName,
          fromDate: telegramFromDate,
          toDate: telegramToDate,
          openingBalance: statement.openingBalance,
          debitTotal: statement.totals.debit,
          creditTotal: statement.totals.credit,
          closingLabel: closing >= 0 ? 'مدين' : 'دائن',
          closingAmount: Math.abs(closing),
          currency: statement.rows[0]?.currency ?? 'USD',
          rowsCount: statement.rows.length,
          pdfHtml,
          fileName: `كشف_حساب_${partyName.replace(/[\\/:*?"<>|]+/g, '_')}_${telegramFromDate}_${telegramToDate}.pdf`,
        });
        sent += 1;
      }
      setTelegramStatus('تم إرسال الكشوفات المحددة إلى تيليغرام ونسخة المدير حسب الصلاحيات.');
    } catch (e) {
      setTelegramStatus(e instanceof Error ? e.message : 'تعذر إرسال كشوف العملاء إلى تيليغرام');
    } finally {
      setTelegramBusy(false);
    }
  };

  const filteredTelegramCustomers = telegramCustomers.filter((customer) => {
    const q = telegramSearch.trim().toLowerCase();
    if (!q) return true;
    return [customer.name, customer.code, customer.phone, customer.telegram_label, customer.telegram_chat_id]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <A4PreviewModal
        open={isA4PreviewOpen}
        title="معاينة كشف ذمم العملاء A4"
        html={renderCustomersReminderHtml()}
        pageSize="A4"
        defaultFileName={`ذمم_العملاء_${reminderDate}.pdf`}
        onClose={() => setIsA4PreviewOpen(false)}
        onPrinted={() => setIsA4PreviewOpen(false)}
        onExported={() => setIsA4PreviewOpen(false)}
      />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">العملاء</h2>
          <p className="text-slate-500 mt-1">إدارة بيانات العملاء — مُتصل بـ PostgreSQL</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Calendar className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="date"
              value={reminderDate}
              onChange={(e) => setReminderDate(e.target.value)}
              className="pr-9 pl-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              title="تاريخ التذكير"
            />
          </div>
          <button
            onClick={() => void handleExportCustomersPdf()}
            className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition"
          >
            <Download className="w-4 h-4" />
            <span>تصدير PDF</span>
          </button>
          <button
            onClick={handlePrintCustomersA4}
            className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة A4</span>
          </button>
          <button
            onClick={toggleTelegramSelectionMode}
            className={`text-white px-4 py-2 rounded-lg flex items-center gap-2 transition ${
              telegramSelectedIds.size > 0 ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
            }`}
          >
            <Send className="w-4 h-4" />
            <span>إرسال كشوف تيليغرام</span>
            {telegramSelectedIds.size > 0 && <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{telegramSelectedIds.size}</span>}
          </button>
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700 transition"
          >
            <FileUp className="w-4 h-4" />
            <span>استيراد كشف عميل</span>
          </button>
          <button onClick={load} className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={openAdd} className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition">
            <Plus className="w-4 h-4" /><span>إضافة عميل</span>
          </button>
        </div>
      </div>

      {telegramSelectionMode && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-black text-slate-900">تحديد عملاء لتصدير كشف حساب PDF وإرساله</h3>
              <p className="mt-1 text-sm text-slate-600">
                سيتم التعامل فقط مع العملاء المرتبطين بتيليغرام، وكل عميل يستلم ملفه الخاص فقط، مع حفظ نسخة PDF في المجلد الذي تختاره.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={telegramFromDate}
                onChange={(e) => setTelegramFromDate(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                title="من تاريخ"
              />
              <input
                type="date"
                value={telegramToDate}
                onChange={(e) => setTelegramToDate(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                title="إلى تاريخ"
              />
              <button
                type="button"
                disabled={telegramBusy || telegramSelectedIds.size === 0}
                onClick={() => void sendSelectedCustomerStatements()}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {telegramBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                تصدير وإرسال المحدد ({telegramSelectedIds.size})
              </button>
              <button
                type="button"
                onClick={() => setTelegramSelectedIds(new Set())}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                إلغاء التحديد
              </button>
            </div>
          </div>
          {telegramStatus && <p className="mt-3 text-sm font-bold text-sky-900">{telegramStatus}</p>}
        </div>
      )}

      <CustomerStatementImportModal
        open={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImported={() => {
          void load();
        }}
      />

      {isTelegramExportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">إرسال كشوف العملاء إلى تيليغرام</h3>
                <p className="mt-1 text-sm text-slate-500">اختر العملاء، وسيتم إنشاء PDF لكل عميل وإرساله للعميل المرتبط ونسخة المدير حسب صلاحيات تيليغرام.</p>
              </div>
              <button onClick={() => setIsTelegramExportOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-4 border-b border-slate-100 bg-slate-50 px-6 py-4 md:grid-cols-[1fr_160px_160px]">
              <div className="relative">
                <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  value={telegramSearch}
                  onChange={(e) => setTelegramSearch(e.target.value)}
                  placeholder="بحث باسم العميل أو الكود أو Chat ID..."
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <input
                type="date"
                value={telegramFromDate}
                onChange={(e) => setTelegramFromDate(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                title="من تاريخ"
              />
              <input
                type="date"
                value={telegramToDate}
                onChange={(e) => setTelegramToDate(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                title="إلى تاريخ"
              />
            </div>

            <div className="max-h-[430px] overflow-auto px-6 py-4">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="font-bold text-slate-700">المحدد: {telegramSelectedIds.size}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTelegramSelectedIds(new Set(filteredTelegramCustomers.map((c) => c.id)))}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-50"
                  >
                    تحديد الظاهر
                  </button>
                  <button
                    type="button"
                    onClick={() => setTelegramSelectedIds(new Set())}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-50"
                  >
                    إلغاء التحديد
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {filteredTelegramCustomers.map((customer) => {
                  const enabled = Boolean(customer.telegram_enabled || customer.telegram_chat_id);
                  return (
                    <label key={customer.id} className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={telegramSelectedIds.has(customer.id)}
                          onChange={() => toggleTelegramCustomer(customer.id)}
                          className="h-4 w-4 accent-sky-600"
                        />
                        <span>
                          <span className="block font-black text-slate-900">{customer.name}</span>
                          <span className="text-xs text-slate-500">{customer.code} | {customer.phone || 'لا يوجد هاتف'}</span>
                        </span>
                      </span>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {enabled ? 'مرتبط تيليغرام' : 'سيذهب للمدير فقط إذا لا يوجد ربط'}
                      </span>
                    </label>
                  );
                })}
                {!filteredTelegramCustomers.length && (
                  <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-500">لا توجد نتائج.</div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
              <p className="min-h-5 text-sm font-bold text-sky-800">{telegramStatus}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsTelegramExportOpen(false)}
                  className="rounded-xl bg-slate-100 px-4 py-2 font-bold text-slate-700 hover:bg-slate-200"
                >
                  إغلاق
                </button>
                <button
                  type="button"
                  disabled={telegramBusy || telegramSelectedIds.size === 0}
                  onClick={() => void sendSelectedCustomerStatements()}
                  className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 font-bold text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {telegramBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  إرسال PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input type="text" placeholder="بحث بالاسم أو الكود أو الهاتف..." value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pr-9 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value as typeof statusFilter); setPage(1); }}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="all">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
          </select>
        </div>

        {error && <div className="m-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">{error}</div>}

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
              <tr>
                {telegramSelectionMode && <th className="px-4 py-3">تحديد</th>}
                <th className="px-4 py-3">الكود</th>
                <th className="px-4 py-3">الاسم</th>
                <th className="px-4 py-3">مجموع</th>
                <th className="px-4 py-3">دائن</th>
                <th className="px-4 py-3">مدين</th>
                <th className="px-4 py-3">متبقي</th>
                <th className="px-4 py-3">نوع العملة</th>
                <th className="px-4 py-3">ملاحظة</th>
                <th className="px-4 py-3">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={telegramSelectionMode ? 10 : 9} className="px-4 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-400" /></td></tr>
              ) : customers.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">لا يوجد عملاء.</td></tr>
              ) : customers.map(c => (
                <tr key={c.id} className="hover:bg-slate-50/50">
                  {(() => {
                    const s = summaryByCustomerId[c.id] ?? { debit: 0, credit: 0, total: 0, remaining: 0, currency: 'USD' };
                    return (
                      <>
                        {telegramSelectionMode && (
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              disabled={!hasTelegramLink(c)}
                              checked={telegramSelectedIds.has(c.id)}
                              onChange={() => toggleTelegramCustomer(c.id)}
                              title={hasTelegramLink(c) ? 'تحديد العميل للتصدير' : 'هذا العميل غير مرتبط بتيليغرام'}
                              className="h-4 w-4 accent-emerald-600 disabled:opacity-30"
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.code}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{c.name}</td>
                        <td className="px-4 py-3 text-slate-800 font-semibold">{formatMoney(s.total)}</td>
                        <td className="px-4 py-3 text-emerald-700 font-semibold">{formatMoney(s.credit)}</td>
                        <td className="px-4 py-3 text-blue-700 font-semibold">{formatMoney(s.debit)}</td>
                        <td className="px-4 py-3 text-rose-700 font-semibold">{formatMoney(s.remaining)}</td>
                        <td className="px-4 py-3 text-slate-600 font-mono">{s.currency}</td>
                        <td className="px-4 py-3 text-slate-600 max-w-[220px] truncate" title={c.notes || ''}>{c.notes || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => navigate(`/customers/statement?customerId=${encodeURIComponent(c.id)}`)}
                              title="دخول إلى كشف الحساب"
                              className="px-2 py-1 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition"
                            >
                              كشفه
                            </button>
                            <button onClick={() => openEdit(c)} title="تعديل" className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => void handleToggle(c.id)}
                              title={c.is_active ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                              className={`px-2 py-1 text-xs font-bold rounded-lg transition ${
                                c.is_active
                                  ? 'text-rose-700 bg-rose-50 hover:bg-rose-100'
                                  : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                              }`}
                            >
                              {c.is_active ? 'تعطيل' : 'تفعيل'}
                            </button>
                            <button onClick={() => void handleDeactivate(c)} disabled={!c.is_active} title="تعطيل العميل" className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition disabled:opacity-30">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </>
                    );
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between text-sm text-slate-600">
            <span>{total} عميل إجمالاً</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">السابق</button>
              <span className="px-3 py-1.5">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">التالي</button>
            </div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-lg">{editTarget ? 'تعديل عميل' : 'إضافة عميل جديد'}</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              {saveError && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">{saveError}</p>}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الاسم *</label>
                  <input required type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} onKeyDown={focusNextFormControl}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الكود</label>
                  <input type="text" value={form.code || ''} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} onKeyDown={focusNextFormControl}
                    placeholder="تلقائي إذا تُرك فارغاً"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الهاتف</label>
                  <input type="text" value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} onKeyDown={focusNextFormControl}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">البريد الإلكتروني</label>
                  <input type="email" value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} onKeyDown={focusNextFormControl}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">العنوان</label>
                <input type="text" value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} onKeyDown={focusNextFormControl}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">ملاحظات</label>
                <textarea rows={2} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none" />
              </div>
              <div className="border border-sky-100 bg-sky-50/40 rounded-xl p-3 space-y-3">
                <label className="flex items-center justify-between gap-3 text-sm font-bold text-slate-700">
                  <span>تفعيل إرسال تيليغرام لهذا العميل</span>
                  <input
                    type="checkbox"
                    checked={Boolean(form.telegramEnabled)}
                    onChange={e => setForm(f => ({ ...f, telegramEnabled: e.target.checked }))}
                    className="w-4 h-4 accent-sky-600"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Telegram Chat ID</label>
                    <input
                      type="text"
                      value={form.telegramChatId || ''}
                      onChange={e => setForm(f => ({ ...f, telegramChatId: e.target.value }))}
                      onKeyDown={focusNextFormControl}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">اسم تيليغرام</label>
                    <input
                      type="text"
                      value={form.telegramLabel || ''}
                      onChange={e => setForm(f => ({ ...f, telegramLabel: e.target.value }))}
                      onKeyDown={focusNextFormControl}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-3">
                <button type="button" onClick={closeModal} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm">إلغاء</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm flex items-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editTarget ? 'حفظ التعديلات' : 'إضافة العميل'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
