import React, { useCallback, useEffect, useState } from 'react';
import { randomId } from '../lib/cryptoPolyfill';
import { Search, Filter, Plus, ArrowLeftRight, Loader2, Eye, Pencil, Ban, Printer } from 'lucide-react';
import {
  listReturns,
  createReturn,
  updateReturn,
  confirmReturn,
  cancelReturn,
  getReturn,
  listEligibleSalesInvoices,
  listEligiblePurchaseInvoices,
  getSourceInvoiceForReturn,
  type ReturnInvoice,
  type ReturnInvoiceDetail,
  type ReturnType,
  type ReturnStatus,
  type SettlementType,
  type SourceInvoiceLineForReturn,
  type ReturnLineInput,
  type CreateReturnPayload,
} from '../lib/api/returnsApi';
import { listCustomers, type ApiCustomer } from '../lib/api/customersApi';
import { listSuppliers, type ApiSupplier } from '../lib/api/suppliersApi';
import { ApiRequestError } from '../lib/api/client';
import { arDocumentStatus } from '../lib/i18n/arTerminology';
import { useToast } from '../components/NonBlockingToast';
import { listExchangeRates, type ExchangeRateDto, type SupportedCurrencyCode } from '../lib/api/exchangeRatesApi';
import { SUPPORTED_CURRENCIES, normalizeExchangeRate } from '../lib/currency';

function labelReturnType(t: string) {
  if (t === 'SALES_RETURN') return 'مرتجع مبيعات';
  if (t === 'PURCHASE_RETURN') return 'مرتجع مشتريات';
  return t;
}

function labelSettlement(s: string) {
  if (s === 'CREDIT_BALANCE') return 'تخفيض ذمة / رصيد دائن';
  if (s === 'NO_FINANCIAL_EFFECT') return 'بدون أثر مالي';
  if (s === 'CASH_REFUND') return 'رد نقدي (غير مفعّل)';
  if (s === 'MIXED') return 'مختلط (غير مفعّل)';
  return s;
}

function maxQtyInUnit(line: SourceInvoiceLineForReturn): number {
  const u = line.unit === 'yard' ? 'yard' : 'meter';
  if (u === 'yard') return Math.round((line.available_meters / 0.9144) * 1000) / 1000;
  return Math.round(line.available_meters * 1000) / 1000;
}

function originalInvoiceLabel(r: ReturnInvoice): string {
  return (
    r.original_sales_invoice_no ||
    r.original_purchase_invoice_no ||
    r.original_invoice_no ||
    '—'
  );
}

export const ReturnInvoices = () => {
  const { showToast } = useToast();
  const [rows, setRows] = useState<ReturnInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [listSearch, setListSearch] = useState('');
  const [listType, setListType] = useState<'' | ReturnType>('');
  const [listStatus, setListStatus] = useState<'' | ReturnStatus>('');
  const [listDateFrom, setListDateFrom] = useState('');
  const [listDateTo, setListDateTo] = useState('');
  const [listPage, setListPage] = useState(1);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<ReturnInvoiceDetail | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelSaving, setCancelSaving] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateDto[]>([]);

  const [formReturnType, setFormReturnType] = useState<ReturnType>('SALES_RETURN');
  const [linkMode, setLinkMode] = useState<'linked' | 'unlinked'>('linked');
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formSupplierId, setFormSupplierId] = useState('');
  const [originalSalesInvoiceId, setOriginalSalesInvoiceId] = useState('');
  const [originalPurchaseInvoiceId, setOriginalPurchaseInvoiceId] = useState('');
  const [eligibleSalesOpts, setEligibleSalesOpts] = useState<{ id: string; invoice_no: string; invoice_date: string }[]>(
    [],
  );
  const [eligiblePurchaseOpts, setEligiblePurchaseOpts] = useState<{ id: string; invoice_no: string; invoice_date: string }[]>(
    [],
  );
  const [sourceLines, setSourceLines] = useState<SourceInvoiceLineForReturn[]>([]);
  const [lineReturns, setLineReturns] = useState<Record<string, { qty: string; returnReason: string; rollId: string }>>(
    {},
  );

  const [formCurrencyCode, setFormCurrencyCode] = useState<SupportedCurrencyCode>('USD');
  const [formExchangeRateToUsd, setFormExchangeRateToUsd] = useState('1');
  const [formDiscount, setFormDiscount] = useState('0');
  const [formTax, setFormTax] = useState('0');
  const [formReason, setFormReason] = useState('');
  const [formSettlement, setFormSettlement] = useState<SettlementType>('CREDIT_BALANCE');
  const [formNotes, setFormNotes] = useState('');

  const [unlinkedLines, setUnlinkedLines] = useState<
    { id: string; description: string; qty: string; unitPrice: string; unit: 'meter' | 'yard'; rollId: string }[]
  >([{ id: randomId(), description: '', qty: '1', unitPrice: '0', unit: 'meter', rollId: '' }]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listReturns({
        search: listSearch.trim() || undefined,
        type: listType || undefined,
        status: listStatus || undefined,
        dateFrom: listDateFrom || undefined,
        dateTo: listDateTo || undefined,
        page: listPage,
        pageSize: 20,
      });
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'تعذر تحميل المرتجعات');
    } finally {
      setLoading(false);
    }
  }, [listSearch, listType, listStatus, listDateFrom, listDateTo, listPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetCreateForm = (opts?: { keepEditId?: string | null }) => {
    setEditId(opts?.keepEditId ?? null);
    setFormReturnType('SALES_RETURN');
    setLinkMode('linked');
    setFormCustomerId('');
    setFormSupplierId('');
    setOriginalSalesInvoiceId('');
    setOriginalPurchaseInvoiceId('');
    setSourceLines([]);
    setLineReturns({});
    setFormCurrencyCode('USD');
    setFormExchangeRateToUsd('1');
    setFormDiscount('0');
    setFormTax('0');
    setFormReason('');
    setFormSettlement('CREDIT_BALANCE');
    setFormNotes('');
    setUnlinkedLines([{ id: randomId(), description: '', qty: '1', unitPrice: '0', unit: 'meter', rollId: '' }]);
  };

  useEffect(() => {
    if (!modalOpen) return;
    void (async () => {
      try {
        const [c, s, r] = await Promise.all([
          listCustomers({ pageSize: 500 }),
          listSuppliers({ pageSize: 500 }),
          listExchangeRates(),
        ]);
        setCustomers(c.data);
        setSuppliers(s.data);
        setExchangeRates(r.data);
      } catch {
        /* ignore */
      }
    })();
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen) return;
    if (formCurrencyCode === 'USD') {
      setFormExchangeRateToUsd('1');
      return;
    }
    const found = exchangeRates.find((x) => x.currency_code === formCurrencyCode);
    if (found) setFormExchangeRateToUsd(String(found.exchange_rate_to_usd));
  }, [modalOpen, formCurrencyCode, exchangeRates]);

  const loadEligibleInvoices = useCallback(async () => {
    if (formReturnType === 'SALES_RETURN' && formCustomerId) {
      const res = await listEligibleSalesInvoices({ customerId: formCustomerId, pageSize: 100 });
      setEligibleSalesOpts(res.data.map((x) => ({ id: x.id, invoice_no: x.invoice_no, invoice_date: x.invoice_date })));
    } else if (formReturnType === 'PURCHASE_RETURN' && formSupplierId) {
      const res = await listEligiblePurchaseInvoices({ supplierId: formSupplierId, pageSize: 100 });
      setEligiblePurchaseOpts(
        res.data.map((x) => ({ id: x.id, invoice_no: x.invoice_no, invoice_date: x.invoice_date })),
      );
    }
  }, [formReturnType, formCustomerId, formSupplierId]);

  useEffect(() => {
    if (!modalOpen || linkMode !== 'linked') return;
    void loadEligibleInvoices().catch(() => {});
  }, [modalOpen, linkMode, loadEligibleInvoices]);

  const loadSourceInvoice = async (type: 'sales' | 'purchase', invId: string) => {
    const ex = editId;
    const res = await getSourceInvoiceForReturn(type, invId, ex);
    setSourceLines(res.data.lines);
    const init: Record<string, { qty: string; returnReason: string; rollId: string }> = {};
    for (const ln of res.data.lines) {
      init[ln.id] = {
        qty: '',
        returnReason: '',
        rollId: ln.fabric_roll_id ?? '',
      };
    }
    setLineReturns(init);
    const h = res.data.header as { currency_code?: string; exchange_rate_to_usd?: number | string };
    if (h.currency_code) setFormCurrencyCode(h.currency_code as SupportedCurrencyCode);
    if (h.exchange_rate_to_usd != null) setFormExchangeRateToUsd(String(h.exchange_rate_to_usd));
  };

  useEffect(() => {
    if (!modalOpen || linkMode !== 'linked') return;
    if (formReturnType === 'SALES_RETURN' && originalSalesInvoiceId) {
      void loadSourceInvoice('sales', originalSalesInvoiceId).catch(() => {
        showToast({ type: 'error', message: 'تعذر تحميل فاتورة البيع' });
      });
    } else if (formReturnType === 'PURCHASE_RETURN' && originalPurchaseInvoiceId) {
      void loadSourceInvoice('purchase', originalPurchaseInvoiceId).catch(() => {
        showToast({ type: 'error', message: 'تعذر تحميل فاتورة الشراء' });
      });
    } else {
      setSourceLines([]);
      setLineReturns({});
    }
  }, [modalOpen, linkMode, formReturnType, originalSalesInvoiceId, originalPurchaseInvoiceId, editId]);

  const buildPayload = (): CreateReturnPayload => {
    const rate = formCurrencyCode === 'USD' ? 1 : normalizeExchangeRate(formExchangeRateToUsd);
    const discountTotal = Number(formDiscount) || 0;
    const taxTotal = Number(formTax) || 0;

    let lines: ReturnLineInput[] = [];

    if (linkMode === 'linked') {
      if (formReturnType === 'SALES_RETURN') {
        lines = sourceLines
          .map((ln) => {
            const st = lineReturns[ln.id];
            const qty = Number(st?.qty ?? 0);
            if (qty <= 0) return null;
            const maxU = maxQtyInUnit(ln);
            if (qty > maxU + 1e-6) {
              throw new Error(`الكمية للسطر ${ln.line_no} تتجاوز المتاح`);
            }
            const u = ln.unit === 'yard' ? 'yard' : 'meter';
            const up = Number(ln.unit_price) || 0;
            return {
              description: ln.description || 'بند مرتجع',
              quantity: qty,
              unitPrice: up,
              unit: u,
              fabricRollId: st?.rollId?.trim() || ln.fabric_roll_id || null,
              fabricItemId: ln.fabric_item_id,
              originalSalesInvoiceLineId: ln.id,
              returnReason: st?.returnReason?.trim() || null,
            } satisfies ReturnLineInput;
          })
          .filter(Boolean) as ReturnLineInput[];
      } else {
        lines = sourceLines
          .map((ln) => {
            const st = lineReturns[ln.id];
            const qty = Number(st?.qty ?? 0);
            if (qty <= 0) return null;
            const maxU = maxQtyInUnit(ln);
            if (qty > maxU + 1e-6) {
              throw new Error(`الكمية للسطر ${ln.line_no} تتجاوز المتاح`);
            }
            const u = ln.unit === 'yard' ? 'yard' : 'meter';
            const up = Number(ln.unit_price) || 0;
            return {
              description: ln.description || 'بند مرتجع',
              quantity: qty,
              unitPrice: up,
              unit: u,
              fabricRollId: st?.rollId?.trim() || ln.fabric_roll_id || null,
              fabricItemId: ln.fabric_item_id,
              originalPurchaseInvoiceLineId: ln.id,
              returnReason: st?.returnReason?.trim() || null,
            } satisfies ReturnLineInput;
          })
          .filter(Boolean) as ReturnLineInput[];
      }
      if (!lines.length) throw new Error('أدخل كمية إرجاع لسطر واحد على الأقل');
    } else {
      lines = unlinkedLines
        .filter((l) => l.description.trim())
        .map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.qty) || 0,
          unitPrice: Number(l.unitPrice) || 0,
          unit: l.unit,
          fabricRollId: l.rollId.trim() || null,
        }));
      if (!lines.length) throw new Error('أضف بنداً واحداً على الأقل بوصف واضح');
    }

    return {
      returnType: formReturnType,
      customerId: formReturnType === 'SALES_RETURN' ? formCustomerId || null : null,
      supplierId: formReturnType === 'PURCHASE_RETURN' ? formSupplierId || null : null,
      originalSalesInvoiceId: linkMode === 'linked' && formReturnType === 'SALES_RETURN' ? originalSalesInvoiceId : null,
      originalPurchaseInvoiceId:
        linkMode === 'linked' && formReturnType === 'PURCHASE_RETURN' ? originalPurchaseInvoiceId : null,
      currencyCode: formCurrencyCode,
      exchangeRateToUsd: rate,
      discountTotal,
      taxTotal,
      notes: formNotes.trim() || null,
      reason: formReason.trim() || null,
      settlementType: formSettlement,
      lines,
    };
  };

  let draftTotal: number | null = null;
  try {
    const p = buildPayload();
    const sub = p.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    draftTotal = Math.round((sub - (Number(formDiscount) || 0) + (Number(formTax) || 0)) * 100) / 100;
  } catch {
    draftTotal = null;
  }

  const openCreate = () => {
    resetCreateForm();
    setModalOpen(true);
  };

  const openEdit = async (id: string) => {
    resetCreateForm({ keepEditId: id });
    setModalOpen(true);
    try {
      const res = await getReturn(id);
      const r = res.data;
      setFormReturnType(r.return_type);
      setFormCustomerId(r.customer_id ?? '');
      setFormSupplierId(r.supplier_id ?? '');
      setOriginalSalesInvoiceId(r.original_sales_invoice_id ?? '');
      setOriginalPurchaseInvoiceId(r.original_purchase_invoice_id ?? '');
      setLinkMode(r.original_sales_invoice_id || r.original_purchase_invoice_id ? 'linked' : 'unlinked');
      setFormCurrencyCode((r.currency_code as SupportedCurrencyCode) || 'USD');
      setFormExchangeRateToUsd(String(r.exchange_rate_to_usd ?? 1));
      setFormDiscount(String(r.discount_total ?? 0));
      setFormTax(String(r.tax_total ?? 0));
      setFormReason(r.reason ?? '');
      setFormSettlement((r.settlement_type as SettlementType) || 'CREDIT_BALANCE');
      setFormNotes(r.notes ?? '');
      if (r.original_sales_invoice_id || r.original_purchase_invoice_id) {
        const type = r.return_type === 'SALES_RETURN' ? 'sales' : 'purchase';
        const invId = r.original_sales_invoice_id || r.original_purchase_invoice_id || '';
        const src = await getSourceInvoiceForReturn(type, invId, id);
        setSourceLines(src.data.lines);
        const init: Record<string, { qty: string; returnReason: string; rollId: string }> = {};
        for (const ln of src.data.lines) {
          const existing = r.lines.find(
            (x) =>
              (x.original_sales_invoice_line_id && x.original_sales_invoice_line_id === ln.id) ||
              (x.original_purchase_invoice_line_id && x.original_purchase_invoice_line_id === ln.id),
          );
          init[ln.id] = {
            qty: existing ? String(existing.quantity) : '',
            returnReason: existing?.return_reason ?? '',
            rollId: existing?.fabric_roll_id ?? ln.fabric_roll_id ?? '',
          };
        }
        setLineReturns(init);
      } else {
        setUnlinkedLines(
          r.lines.map((ln) => ({
            id: ln.id,
            description: ln.description,
            qty: String(ln.quantity),
            unitPrice: String(ln.unit_price),
            unit: ln.unit === 'yard' ? 'yard' : 'meter',
            rollId: ln.fabric_roll_id ?? '',
          })),
        );
      }
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : 'تعذر تحميل المسودة' });
      setModalOpen(false);
    }
  };

  const submitSave = async (alsoConfirm: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const rate = formCurrencyCode === 'USD' ? 1 : normalizeExchangeRate(formExchangeRateToUsd);
      if (formCurrencyCode !== 'USD' && rate <= 0) {
        showToast({ type: 'error', message: 'يرجى إدخال سعر صرف صحيح' });
        setSaving(false);
        return;
      }
      const payload = buildPayload();
      if (editId) {
        await updateReturn(editId, payload);
        if (alsoConfirm) {
          await confirmReturn(editId);
          showToast({ type: 'success', message: 'تم التحديث والتأكيد' });
        } else {
          showToast({ type: 'success', message: 'تم تحديث المسودة' });
        }
      } else {
        const cr = await createReturn(payload);
        if (alsoConfirm && cr.data?.id) {
          await confirmReturn(cr.data.id);
          showToast({ type: 'success', message: 'تم الحفظ والتأكيد' });
        } else {
          showToast({ type: 'success', message: 'تم حفظ المسودة' });
        }
      }
      setModalOpen(false);
      resetCreateForm();
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : e instanceof ApiRequestError ? e.message : 'فشل الحفظ';
      setError(msg);
      showToast({ type: 'error', message: msg });
    } finally {
      setSaving(false);
    }
  };

  const onConfirm = async (id: string) => {
    try {
      await confirmReturn(id);
      showToast({ type: 'success', message: 'تم تأكيد المرتجع بنجاح' });
      await load();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'فشل التأكيد');
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : 'فشل التأكيد' });
    }
  };

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await getReturn(id);
      setDetail(res.data);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : 'تعذر التحميل' });
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const submitCancel = async () => {
    if (!cancelId) return;
    setCancelSaving(true);
    try {
      await cancelReturn(cancelId, cancelReason.trim() || null);
      showToast({ type: 'success', message: 'تم إلغاء المرتجع وعكس الأثر المحاسبي والمخزني' });
      setCancelOpen(false);
      setCancelId(null);
      setCancelReason('');
      await load();
      if (detail?.id === cancelId) setDetailOpen(false);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : 'فشل الإلغاء' });
    } finally {
      setCancelSaving(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">فواتير المرتجعات</h2>
          <p className="text-slate-500 mt-1">ربط بالفاتورة الأصلية، ضبط الكميات، تأكيد وإلغاء محاسبي</p>
        </div>
        <button
          type="button"
          onClick={() => openCreate()}
          className="bg-rose-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-rose-700 transition shadow-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          <span>مرتجع جديد</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-3 items-end bg-slate-50">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              placeholder="بحث برقم المرتجع أو الفاتورة..."
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void load()}
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
          </div>
          <select
            value={listType}
            onChange={(e) => {
              setListPage(1);
              setListType(e.target.value as '' | ReturnType);
            }}
            className="border border-slate-200 rounded-lg px-3 py-2 bg-white"
          >
            <option value="">كل الأنواع</option>
            <option value="SALES_RETURN">مرتجع مبيعات</option>
            <option value="PURCHASE_RETURN">مرتجع مشتريات</option>
          </select>
          <select
            value={listStatus}
            onChange={(e) => {
              setListPage(1);
              setListStatus(e.target.value as '' | ReturnStatus);
            }}
            className="border border-slate-200 rounded-lg px-3 py-2 bg-white"
          >
            <option value="">كل الحالات</option>
            <option value="DRAFT">مسودة</option>
            <option value="CONFIRMED">مؤكد</option>
            <option value="CANCELLED">ملغى</option>
          </select>
          <input
            type="date"
            value={listDateFrom}
            onChange={(e) => {
              setListPage(1);
              setListDateFrom(e.target.value);
            }}
            className="border border-slate-200 rounded-lg px-2 py-2 bg-white text-sm"
          />
          <input
            type="date"
            value={listDateTo}
            onChange={(e) => {
              setListPage(1);
              setListDateTo(e.target.value);
            }}
            className="border border-slate-200 rounded-lg px-2 py-2 bg-white text-sm"
          />
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            <Filter className="w-4 h-4" />
            تطبيق
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-4 py-3">رقم المرتجع</th>
                <th className="px-4 py-3">التاريخ</th>
                <th className="px-4 py-3">النوع</th>
                <th className="px-4 py-3">الفاتورة الأصلية</th>
                <th className="px-4 py-3">العميل / المورد</th>
                <th className="px-4 py-3">الإجمالي</th>
                <th className="px-4 py-3">الحالة</th>
                <th className="px-4 py-3">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
                    جاري التحميل...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                    لا توجد مرتجعات
                  </td>
                </tr>
              ) : (
                rows.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-slate-50 bg-white">
                    <td className="px-4 py-3 font-mono font-medium text-rose-600">{invoice.return_no}</td>
                    <td className="px-4 py-3 text-slate-600">{invoice.return_date}</td>
                    <td className="px-4 py-3">{labelReturnType(invoice.return_type)}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{originalInvoiceLabel(invoice)}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {invoice.customer_name || invoice.supplier_name || '—'}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-900">
                      {Number(invoice.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                      {invoice.currency_code}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded text-xs font-bold bg-slate-100 text-slate-800">
                        {arDocumentStatus(invoice.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap flex flex-wrap gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => void openDetail(invoice.id)}
                        className="text-slate-600 hover:text-indigo-600 inline-flex items-center gap-1"
                        title="تفاصيل"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {invoice.status === 'DRAFT' && (
                        <>
                          <button
                            type="button"
                            onClick={() => void openEdit(invoice.id)}
                            className="text-amber-700 hover:underline inline-flex items-center gap-1"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onConfirm(invoice.id)}
                            className="text-indigo-600 font-medium hover:underline"
                          >
                            تأكيد
                          </button>
                        </>
                      )}
                      {invoice.status === 'CONFIRMED' && (
                        <button
                          type="button"
                          onClick={() => {
                            setCancelId(invoice.id);
                            setCancelReason('');
                            setCancelOpen(true);
                          }}
                          className="text-rose-700 hover:underline inline-flex items-center gap-1"
                        >
                          <Ban className="w-4 h-4" />
                          إلغاء
                        </button>
                      )}
                      <button type="button" disabled className="text-slate-300 cursor-not-allowed" title="الطباعة لاحقاً">
                        <Printer className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {total > 20 && (
          <div className="p-3 border-t border-slate-100 flex justify-between items-center text-sm text-slate-600">
            <span>
              الصفحة {listPage} — إجمالي {total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={listPage <= 1}
                className="px-3 py-1 border rounded disabled:opacity-40"
                onClick={() => setListPage((p) => Math.max(1, p - 1))}
              >
                السابق
              </button>
              <button
                type="button"
                disabled={listPage * 20 >= total}
                className="px-3 py-1 border rounded disabled:opacity-40"
                onClick={() => setListPage((p) => p + 1)}
              >
                التالي
              </button>
            </div>
          </div>
        )}
      </div>

      {detailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full p-6 space-y-4 border border-slate-200 my-8">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-900">تفاصيل المرتجع</h3>
              <button type="button" className="text-slate-500 hover:text-slate-800" onClick={() => setDetailOpen(false)}>
                ✕
              </button>
            </div>
            {detailLoading || !detail ? (
              <div className="py-12 text-center text-slate-500">
                <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
                جاري التحميل...
              </div>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-slate-500">الرقم</dt>
                  <dd className="font-mono font-semibold">{detail.return_no}</dd>
                  <dt className="text-slate-500">النوع</dt>
                  <dd>{labelReturnType(detail.return_type)}</dd>
                  <dt className="text-slate-500">الحالة</dt>
                  <dd>{arDocumentStatus(detail.status)}</dd>
                  <dt className="text-slate-500">الفاتورة الأصلية</dt>
                  <dd className="font-mono">{originalInvoiceLabel(detail)}</dd>
                  <dt className="text-slate-500">التسوية</dt>
                  <dd>{labelSettlement(detail.settlement_type || 'CREDIT_BALANCE')}</dd>
                  <dt className="text-slate-500">سبب المرتجع</dt>
                  <dd>{detail.reason || '—'}</dd>
                  <dt className="text-slate-500">posted_at</dt>
                  <dd>{detail.posted_at ? new Date(detail.posted_at).toLocaleString() : '—'}</dd>
                  <dt className="text-slate-500">إلغاء</dt>
                  <dd>
                    {detail.cancelled_at
                      ? `${new Date(detail.cancelled_at).toLocaleString()} — ${detail.cancellation_reason || ''}`
                      : '—'}
                  </dd>
                  <dt className="text-slate-500">قيد GL</dt>
                  <dd className="font-mono text-xs">
                    {detail.gl_journal
                      ? `${detail.gl_journal.entry_no} (${detail.gl_journal.entry_date})`
                      : 'لا يوجد (مثلاً بدون أثر مالي أو لم يُنشر)'}
                  </dd>
                </dl>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="px-2 py-2 text-right">البند</th>
                        <th className="px-2 py-2">كمية</th>
                        <th className="px-2 py-2">سعر</th>
                        <th className="px-2 py-2">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((ln) => (
                        <tr key={ln.id} className="border-t">
                          <td className="px-2 py-2">{ln.description}</td>
                          <td className="px-2 py-2">
                            {ln.quantity} {ln.unit}
                          </td>
                          <td className="px-2 py-2">{ln.unit_price}</td>
                          <td className="px-2 py-2">{ln.line_total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {cancelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-rose-100">
            <h3 className="text-lg font-bold text-rose-800">إلغاء مرتجع مؤكد</h3>
            <p className="text-sm text-slate-700 leading-relaxed">
              سيتم عكس حركة المخزون (إن وُجدت) وعكس قيد اليومية RETURN_INVOICE_REVERSAL. لا يمكن التراجع عن هذا الإجراء
              بسهولة.
            </p>
            <label className="block text-sm font-medium text-slate-700">سبب الإلغاء</label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[80px]"
              placeholder="سبب الإلغاء..."
            />
            <div className="flex gap-2 justify-end">
              <button type="button" className="px-4 py-2 border rounded-lg" onClick={() => setCancelOpen(false)}>
                رجوع
              </button>
              <button
                type="button"
                disabled={cancelSaving}
                onClick={() => void submitCancel()}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white disabled:opacity-50"
              >
                {cancelSaving ? 'جاري...' : 'تأكيد الإلغاء'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full p-6 space-y-4 border border-slate-200 my-6">
            <h3 className="text-lg font-bold text-slate-900">{editId ? 'تعديل مسودة مرتجع' : 'مرتجع جديد'}</h3>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">نوع المرتجع</label>
                <select
                  value={formReturnType}
                  onChange={(e) => {
                    setFormReturnType(e.target.value as ReturnType);
                    setOriginalSalesInvoiceId('');
                    setOriginalPurchaseInvoiceId('');
                  }}
                  disabled={!!editId}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 disabled:bg-slate-100"
                >
                  <option value="SALES_RETURN">مرتجع مبيعات</option>
                  <option value="PURCHASE_RETURN">مرتجع مشتريات</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">ربط بفاتورة أصلية</label>
                <select
                  value={linkMode}
                  onChange={(e) => setLinkMode(e.target.value as 'linked' | 'unlinked')}
                  disabled={!!editId}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 disabled:bg-slate-100"
                >
                  <option value="linked">مرتبط (مُوصى به)</option>
                  <option value="unlinked">غير مرتبط — أخطر محاسبياً</option>
                </select>
              </div>
            </div>

            {formReturnType === 'SALES_RETURN' ? (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">العميل</label>
                <select
                  value={formCustomerId}
                  onChange={(e) => {
                    setFormCustomerId(e.target.value);
                    setOriginalSalesInvoiceId('');
                  }}
                  disabled={!!editId}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 disabled:bg-slate-100"
                >
                  <option value="">— اختر عميلاً —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">المورد</label>
                <select
                  value={formSupplierId}
                  onChange={(e) => {
                    setFormSupplierId(e.target.value);
                    setOriginalPurchaseInvoiceId('');
                  }}
                  disabled={!!editId}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 disabled:bg-slate-100"
                >
                  <option value="">— اختر مورداً —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {linkMode === 'linked' && formReturnType === 'SALES_RETURN' && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">فاتورة البيع المؤكدة</label>
                <select
                  value={originalSalesInvoiceId}
                  onChange={(e) => setOriginalSalesInvoiceId(e.target.value)}
                  disabled={!!editId}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-sm disabled:bg-slate-100"
                >
                  <option value="">— اختر فاتورة —</option>
                  {eligibleSalesOpts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.invoice_no} — {o.invoice_date}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {linkMode === 'linked' && formReturnType === 'PURCHASE_RETURN' && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">فاتورة الشراء المؤكدة</label>
                <select
                  value={originalPurchaseInvoiceId}
                  onChange={(e) => setOriginalPurchaseInvoiceId(e.target.value)}
                  disabled={!!editId}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-sm disabled:bg-slate-100"
                >
                  <option value="">— اختر فاتورة —</option>
                  {eligiblePurchaseOpts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.invoice_no} — {o.invoice_date}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {linkMode === 'linked' && sourceLines.length > 0 && (
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-xs min-w-[640px]">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="px-2 py-2">#</th>
                      <th className="px-2 py-2">الصنف / الرول</th>
                      <th className="px-2 py-2">متاح</th>
                      <th className="px-2 py-2">مرتجع سابق (م)</th>
                      <th className="px-2 py-2">كمية الإرجاع</th>
                      <th className="px-2 py-2">سعر</th>
                      <th className="px-2 py-2">توب</th>
                      <th className="px-2 py-2">سبب السطر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceLines.map((ln) => {
                      const st = lineReturns[ln.id] ?? { qty: '', returnReason: '', rollId: '' };
                      const maxU = maxQtyInUnit(ln);
                      return (
                        <tr key={ln.id} className="border-t">
                          <td className="px-2 py-2">{ln.line_no}</td>
                          <td className="px-2 py-2">
                            <div className="font-medium">{ln.description}</div>
                            <div className="text-slate-500 text-[10px]">
                              {ln.barcode || ln.internal_code || '—'} {ln.color_name_ar ? `· ${ln.color_name_ar}` : ''}
                            </div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            {maxU.toFixed(3)} {ln.unit === 'yard' ? 'yd' : 'م'}
                          </td>
                          <td className="px-2 py-2">{ln.returned_meters.toFixed(3)}</td>
                          <td className="px-2 py-2">
                            <input
                              type="number"
                              className="w-20 border rounded px-1 py-0.5"
                              min={0}
                              max={maxU}
                              step="0.001"
                              value={st.qty}
                              onChange={(e) =>
                                setLineReturns((prev) => ({
                                  ...prev,
                                  [ln.id]: { ...st, qty: e.target.value },
                                }))
                              }
                            />
                          </td>
                          <td className="px-2 py-2">{ln.unit_price}</td>
                          <td className="px-2 py-2">
                            <input
                              className="w-28 border rounded px-1 font-mono text-[10px]"
                              placeholder="UUID توب"
                              value={st.rollId}
                              onChange={(e) =>
                                setLineReturns((prev) => ({
                                  ...prev,
                                  [ln.id]: { ...st, rollId: e.target.value },
                                }))
                              }
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              className="w-full border rounded px-1"
                              value={st.returnReason}
                              onChange={(e) =>
                                setLineReturns((prev) => ({
                                  ...prev,
                                  [ln.id]: { ...st, returnReason: e.target.value },
                                }))
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {linkMode === 'unlinked' && (
              <div className="space-y-2">
                {unlinkedLines.map((row, idx) => (
                  <div key={row.id} className="grid grid-cols-12 gap-2 items-end border-b pb-2">
                    <div className="col-span-4">
                      <label className="text-xs text-slate-500">البيان</label>
                      <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={row.description}
                        onChange={(e) => {
                          const v = e.target.value;
                          setUnlinkedLines((prev) => prev.map((x) => (x.id === row.id ? { ...x, description: v } : x)));
                        }}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-slate-500">كمية</label>
                      <input
                        type="number"
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={row.qty}
                        onChange={(e) => {
                          const v = e.target.value;
                          setUnlinkedLines((prev) => prev.map((x) => (x.id === row.id ? { ...x, qty: v } : x)));
                        }}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-slate-500">سعر</label>
                      <input
                        type="number"
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={row.unitPrice}
                        onChange={(e) => {
                          const v = e.target.value;
                          setUnlinkedLines((prev) => prev.map((x) => (x.id === row.id ? { ...x, unitPrice: v } : x)));
                        }}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-slate-500">وحدة</label>
                      <select
                        className="w-full border rounded px-1 py-1 text-sm"
                        value={row.unit}
                        onChange={(e) => {
                          const v = e.target.value as 'meter' | 'yard';
                          setUnlinkedLines((prev) => prev.map((x) => (x.id === row.id ? { ...x, unit: v } : x)));
                        }}
                      >
                        <option value="meter">متر</option>
                        <option value="yard">ياردة</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-slate-500">توب</label>
                      <input
                        className="w-full border rounded px-1 py-1 font-mono text-[10px]"
                        placeholder="UUID"
                        value={row.rollId}
                        onChange={(e) => {
                          const v = e.target.value;
                          setUnlinkedLines((prev) => prev.map((x) => (x.id === row.id ? { ...x, rollId: v } : x)));
                        }}
                      />
                    </div>
                    {unlinkedLines.length > 1 && (
                      <button
                        type="button"
                        className="text-rose-600 text-xs col-span-12"
                        onClick={() => setUnlinkedLines((prev) => prev.filter((x) => x.id !== row.id))}
                      >
                        حذف السطر
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="text-sm text-indigo-600"
                  onClick={() =>
                    setUnlinkedLines((prev) => [
                      ...prev,
                      { id: randomId(), description: '', qty: '1', unitPrice: '0', unit: 'meter', rollId: '' },
                    ])
                  }
                >
                  + سطر
                </button>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">العملة</label>
                <select
                  value={formCurrencyCode}
                  onChange={(e) => setFormCurrencyCode(e.target.value as SupportedCurrencyCode)}
                  disabled={linkMode === 'linked' && sourceLines.length > 0}
                  className="w-full border rounded-lg px-3 py-2 disabled:bg-slate-100"
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.nameAr}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">سعر الصرف ↔ USD</label>
                <input
                  value={formExchangeRateToUsd}
                  onChange={(e) => setFormExchangeRateToUsd(e.target.value)}
                  disabled={formCurrencyCode === 'USD' || (linkMode === 'linked' && sourceLines.length > 0)}
                  className="w-full border rounded-lg px-3 py-2 disabled:bg-slate-100"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">خصم</label>
                <input
                  type="number"
                  value={formDiscount}
                  onChange={(e) => setFormDiscount(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">ضريبة</label>
                <input
                  type="number"
                  value={formTax}
                  onChange={(e) => setFormTax(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">نوع التسوية</label>
              <select
                value={formSettlement}
                onChange={(e) => setFormSettlement(e.target.value as SettlementType)}
                className="w-full border rounded-lg px-3 py-2"
              >
                <option value="CREDIT_BALANCE">تخفيض ذمة / رصيد دائن</option>
              </select>
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                خيار «بدون أثر مالي» مؤجّل من الواجهة (V4): يُدار عبر الـ API فقط بعد الحاجة، مع قيود مخزون على الخادم.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">سبب عام للمرتجع</label>
              <textarea
                value={formReason}
                onChange={(e) => setFormReason(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm min-h-[56px]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">ملاحظات</label>
              <textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm min-h-[40px]"
              />
            </div>

            {draftTotal != null && (
              <p className="text-sm font-semibold text-slate-800">
                إجمالي المسودة (تقريبي): {draftTotal.toFixed(2)} {formCurrencyCode}
              </p>
            )}

            <div className="flex flex-wrap gap-2 justify-end pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-lg border border-slate-200">
                إلغاء
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitSave(false)}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white disabled:opacity-50"
              >
                {saving ? 'جاري...' : editId ? 'حفظ التعديلات' : 'حفظ مسودة'}
              </button>
              {!editId && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void submitSave(true)}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50"
                >
                  حفظ وتأكيد
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500 flex items-center gap-2">
        <ArrowLeftRight className="w-4 h-4" />
        المرتجع المرتبط بفاتورة يُتحقق من الكميات على الخادم. إلغاء المؤكد فقط يعكس المخزون والقيد. المرتجع غير المرتبط
        يتطلب ضبط التوب بعناية للمخزون.
      </p>
    </div>
  );
};
