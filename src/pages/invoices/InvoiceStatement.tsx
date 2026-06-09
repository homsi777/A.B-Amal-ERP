import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Printer, Share2, FileText, ArrowRight } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { calculateFabricInvoiceSummary, FabricInvoiceSummaryLine } from '../../lib/fabricInvoiceSummary';
import {
  getSalesInvoice,
  listSalesInvoices,
  confirmSalesInvoice,
  deleteSalesInvoice,
  voidSalesInvoice,
} from '../../lib/api/salesInvoicesApi';
import {
  getPurchaseInvoice,
  listPurchaseInvoices,
  confirmPurchaseInvoice,
  deletePurchaseInvoice,
  voidPurchaseInvoice,
} from '../../lib/api/purchaseInvoicesApi';
import { mapSalesInvoiceDetailToInvoice, mapPurchaseInvoiceDetailToInvoice, displayStoredInvoiceNo } from '../../lib/invoiceDbMappers';
import type { Invoice } from '../../types';
import { useToast } from '../../components/NonBlockingToast';
import { renderInvoiceStatementA4Html } from '../../lib/printing/renderInvoiceStatementA4';
import { A4PreviewModal } from '../../components/printing/A4PreviewModal';
import {
  AR_INVOICE_STATEMENT,
  arCashPartyFallbackLabel,
  arDocumentStatus,
  arInvoicePaymentStatusCode,
  arSaleTermsFromInvoice,
} from '../../lib/i18n/arTerminology';
import { ApiRequestError } from '../../lib/api/client';
import { listCashboxes } from '../../lib/api/cashboxesApi';

const formatNumber = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (value: number, currency: string) => `${formatNumber(value)} ${currency || 'USD'}`;
const formatRate = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type InvoiceListEntry = {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  partyName: string;
  totalAmount: number;
  currencyCode: string;
  invoiceType: 'sale' | 'purchase';
};

export const InvoiceStatement = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { invoices, customers, suppliers } = useStore();
  const { showToast } = useToast();
  const [searchId, setSearchId] = useState(id || '');
  const [hideFinancialColumns, setHideFinancialColumns] = useState(false);
  const [apiInvoice, setApiInvoice] = useState<Invoice | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [allInvoices, setAllInvoices] = useState<InvoiceListEntry[]>([]);
  const [allInvoicesLoading, setAllInvoicesLoading] = useState(false);
  const [invoiceActionBusy, setInvoiceActionBusy] = useState(false);
  const [confirmCashboxId, setConfirmCashboxId] = useState('');
  const [cashboxOptions, setCashboxOptions] = useState<{ id: string; name: string; code: string }[]>([]);

  const currentId = id || searchId;

  useEffect(() => {
    void listCashboxes({ active: true })
      .then((res) => {
        setCashboxOptions(
          res.data.map((box) => ({
            id: box.id,
            name: box.name,
            code: box.code,
          })),
        );
      })
      .catch(() => setCashboxOptions([]));
  }, []);

  const refetchInvoiceDetail = useCallback(
    async (inv: Invoice) => {
      if (!uuidRe.test(inv.id)) return;
      setApiLoading(true);
      try {
        if (inv.type === 'sale') {
          const s = await getSalesInvoice(inv.id);
          setApiInvoice(mapSalesInvoiceDetailToInvoice(s.data));
        } else {
          const p = await getPurchaseInvoice(inv.id);
          setApiInvoice(mapPurchaseInvoiceDetailToInvoice(p.data));
        }
      } catch {
        showToast({ type: 'error', message: 'تعذر تحديث بيانات الفاتورة' });
      } finally {
        setApiLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    let cancelled = false;
    setAllInvoicesLoading(true);
    void (async () => {
      try {
        const mapRow = (row: Record<string, unknown>, type: 'sale' | 'purchase'): InvoiceListEntry | null => {
          const rowId = String(row.id ?? '').trim();
          if (!rowId) return null;
          return {
            id: rowId,
            invoiceNo: displayStoredInvoiceNo(row.invoice_no ?? row.invoiceNo),
            invoiceDate: String(row.invoice_date ?? row.invoiceDate ?? row.created_at ?? '').trim(),
            partyName: String(
              row.customer_name ?? row.supplier_name ?? row.party_name ?? row.partyName ?? row.customerName ?? row.supplierName ?? '—',
            ).trim() || '—',
            totalAmount: Number(row.total_amount ?? row.totalAmount ?? 0),
            currencyCode: String(row.currency_code ?? row.currencyCode ?? 'USD'),
            invoiceType: type,
          };
        };

        const [salesList, purchaseList] = await Promise.all([
          listSalesInvoices({ page: 1, pageSize: 500 }),
          listPurchaseInvoices({ page: 1, pageSize: 500 }),
        ]);
        if (cancelled) return;

        const rows: InvoiceListEntry[] = [
          ...salesList.rows.map((row) => mapRow(row, 'sale')).filter((x): x is InvoiceListEntry => x !== null),
          ...purchaseList.rows.map((row) => mapRow(row, 'purchase')).filter((x): x is InvoiceListEntry => x !== null),
        ];

        rows.sort((a, b) => {
          const ad = Date.parse(a.invoiceDate || '');
          const bd = Date.parse(b.invoiceDate || '');
          if (Number.isFinite(ad) && Number.isFinite(bd) && ad !== bd) return bd - ad;
          return b.invoiceNo.localeCompare(a.invoiceNo);
        });

        setAllInvoices(rows);
      } catch {
        if (!cancelled) setAllInvoices([]);
      } finally {
        if (!cancelled) setAllInvoicesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredInvoices = useMemo(() => {
    const term = String(searchId || '').trim().toLowerCase();
    if (!term) return allInvoices;
    return allInvoices.filter((entry) => {
      return (
        entry.invoiceNo.toLowerCase().includes(term)
        || entry.partyName.toLowerCase().includes(term)
        || entry.invoiceDate.toLowerCase().includes(term)
        || entry.invoiceType.toLowerCase().includes(term)
      );
    });
  }, [allInvoices, searchId]);

  useEffect(() => {
    if (!currentId) {
      setApiInvoice(null);
      return;
    }
    let cancelled = false;
    setApiLoading(true);
    void (async () => {
      try {
        const loadByUuid = async (invoiceId: string) => {
          try {
            const s = await getSalesInvoice(invoiceId);
            if (cancelled) return true;
            setApiInvoice(mapSalesInvoiceDetailToInvoice(s.data));
            return true;
          } catch {
            try {
              const p = await getPurchaseInvoice(invoiceId);
              if (cancelled) return true;
              setApiInvoice(mapPurchaseInvoiceDetailToInvoice(p.data));
              return true;
            } catch {
              return false;
            }
          }
        };

        if (uuidRe.test(currentId)) {
          const ok = await loadByUuid(currentId);
          if (!ok && !cancelled) setApiInvoice(null);
          return;
        }

        const term = currentId.trim();
        const [salesList, purchaseList] = await Promise.all([
          listSalesInvoices({ search: term, page: 1, pageSize: 50 }),
          listPurchaseInvoices({ search: term, page: 1, pageSize: 50 }),
        ]);
        if (cancelled) return;

        const matchByTerm = (row: Record<string, unknown>) =>
          String(row.invoice_no ?? row.invoiceNo ?? '').trim().toLowerCase() === term.toLowerCase();
        const matchedRow =
          salesList.rows.find(matchByTerm) ??
          purchaseList.rows.find(matchByTerm) ??
          salesList.rows[0] ??
          purchaseList.rows[0];
        const matchedId = String(matchedRow?.id ?? '').trim();
        if (!matchedId || !uuidRe.test(matchedId)) {
          if (!cancelled) setApiInvoice(null);
          return;
        }

        const ok = await loadByUuid(matchedId);
        if (!ok && !cancelled) setApiInvoice(null);
      } catch {
        if (!cancelled) setApiInvoice(null);
      } finally {
        if (!cancelled) setApiLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  const invoice = apiInvoice ?? invoices.find((item) => item.id === currentId) ?? (!id && searchId === '' ? invoices[0] : null);

  const documentStatus = invoice?.documentStatus;
  const paymentCode = invoice ? invoice.paymentStatus ?? invoice.status : 'unpaid';
  const draftEditPath =
    invoice?.id && uuidRe.test(invoice.id)
      ? invoice.type === 'sale'
        ? `/invoices/sales/${invoice.id}/edit`
        : `/invoices/purchases/${invoice.id}/edit`
      : null;

  const handleStatementConfirmDraft = async () => {
    if (!invoice) return;
    if (!window.confirm('سيتم ترحيل الفاتورة وسيؤثر ذلك على المخزون والحسابات، هل أنت متأكد؟')) return;

    let paidAmount = Number(invoice.paidAmount ?? 0) || 0;
    if (uuidRe.test(invoice.id)) {
      try {
        const detail =
          invoice.type === 'sale' ? await getSalesInvoice(invoice.id) : await getPurchaseInvoice(invoice.id);
        paidAmount = Number(detail.data.header.paid_amount ?? 0) || 0;
      } catch {
        showToast({ type: 'error', message: 'تعذر قراءة بيانات المسودة قبل التأكيد' });
        return;
      }
    }
    if (paidAmount > 1e-4 && !confirmCashboxId) {
      showToast({
        type: 'warning',
        message: 'اختر الصندوق المالي لربط الدفعة بخزينة حقيقية وتوليد السند تلقائياً على الخادم.',
      });
      return;
    }

    setInvoiceActionBusy(true);
    try {
      const confirmBody = paidAmount > 1e-4 ? { cashboxId: confirmCashboxId } : {};
      if (invoice.type === 'sale') {
        await confirmSalesInvoice(invoice.id, confirmBody);
      } else {
        await confirmPurchaseInvoice(invoice.id, confirmBody);
      }
      showToast({ type: 'success', message: 'تم تأكيد الفاتورة' });
      await refetchInvoiceDetail(invoice);
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر تأكيد الفاتورة',
      });
    } finally {
      setInvoiceActionBusy(false);
    }
  };

  const handleStatementDeleteDraft = async () => {
    if (!invoice) return;
    if (!window.confirm('سيتم حذف المسودة فقط ولن يؤثر ذلك على المخزون أو الحسابات. هل تريد المتابعة؟')) return;
    setInvoiceActionBusy(true);
    try {
      if (invoice.type === 'sale') {
        await deleteSalesInvoice(invoice.id);
      } else {
        await deletePurchaseInvoice(invoice.id);
      }
      showToast({ type: 'success', message: 'تم حذف المسودة' });
      navigate(invoice.type === 'sale' ? '/invoices/sales' : '/invoices/purchases');
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر حذف المسودة',
      });
    } finally {
      setInvoiceActionBusy(false);
    }
  };

  const handleStatementVoid = async () => {
    if (!invoice) return;
    if (
      !window.confirm(
        'سيتم إلغاء الفاتورة المؤكدة وعكس أثرها على المخزون والقيود المحاسبية قدر الإمكان. هل أنت متأكد؟',
      )
    ) {
      return;
    }
    setInvoiceActionBusy(true);
    try {
      if (invoice.type === 'sale') {
        await voidSalesInvoice(invoice.id);
      } else {
        await voidPurchaseInvoice(invoice.id);
      }
      showToast({ type: 'success', message: 'تم إلغاء الفاتورة' });
      await refetchInvoiceDetail(invoice);
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر إلغاء الفاتورة',
      });
    } finally {
      setInvoiceActionBusy(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchId) {
      navigate(`/invoices/statement/${searchId}`);
    }
  };

  const party = invoice
    ? invoice.type === 'sale'
      ? customers.find((customer) => customer.id === invoice.partyId)
      : suppliers.find((supplier) => supplier.id === invoice.partyId)
    : null;
  const partyName =
    invoice?.partyDisplayName?.trim() ||
    party?.name ||
    (party as { company?: string })?.company ||
    (invoice?.partyId?.trim() ? '—' : arCashPartyFallbackLabel());
  const currency = invoice?.currency || 'USD';
  const exchangeRateToUsd = invoice ? (currency === 'USD' ? 1 : invoice.exchangeRateToUsd ?? 0) : 0;
  const totalAmountUsd =
    invoice && !hideFinancialColumns
      ? currency === 'USD'
        ? invoice.totalAmount
        : invoice.totalAmountUsd ?? (exchangeRateToUsd > 0 ? invoice.totalAmount / exchangeRateToUsd : undefined)
      : undefined;
  const paidAmountUsd =
    invoice && !hideFinancialColumns
      ? currency === 'USD'
        ? invoice.paidAmount ?? 0
        : invoice.paidAmountUsd ?? (exchangeRateToUsd > 0 ? (invoice.paidAmount ?? 0) / exchangeRateToUsd : undefined)
      : undefined;
  const remainingAmountUsd =
    invoice && !hideFinancialColumns
      ? currency === 'USD'
        ? invoice.remainingAmount ?? 0
        : invoice.remainingAmountUsd ??
          (exchangeRateToUsd > 0 ? (invoice.remainingAmount ?? 0) / exchangeRateToUsd : undefined)
      : undefined;

  const summaryLines = useMemo<FabricInvoiceSummaryLine[]>(
    () =>
      invoice?.items.map((item) => ({
        materialName: item.materialName ?? item.fabricName,
        fabricName: item.fabricName,
        designCode: item.designCode,
        colorCode: item.colorCode,
        colorName: item.colorName,
        rollNo: item.rollNo ?? item.rollNumber,
        rollNumber: item.rollNumber,
        barcode: item.barcode,
        lengthMeters: item.quantity,
        weightKg: item.weightKg ?? item.weight,
        pricePerMeter: item.unitPrice,
        lineTotal: item.total,
      })) ?? [],
    [invoice],
  );

  const summary = useMemo(() => calculateFabricInvoiceSummary(summaryLines), [summaryLines]);

  const financialTotals = useMemo(() => {
    if (!invoice) return null;
    const grossFromLines = roundMoney(
      invoice.items.reduce((sum, item) => {
        const gross = item.lineDiscount != null && item.lineDiscount > 0
          ? item.total + item.lineDiscount
          : item.quantity * item.unitPrice;
        return sum + gross;
      }, 0),
    );
    const subtotal = invoice.subtotal != null && invoice.subtotal > 0 ? invoice.subtotal : grossFromLines;
    const discount = Math.max(0, invoice.discountTotal ?? 0);
    const tax = Math.max(0, invoice.taxTotal ?? 0);
    const total = invoice.totalAmount;
    return { subtotal, discount, tax, total, grossFromLines };
  }, [invoice]);

  function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  const rowsByGroup = useMemo(() => {
    if (!invoice) return [];
    return summary.groups.map((group) => ({
      group,
      rows: invoice.items.filter((item) => {
        const materialName = (item.materialName || item.fabricName || 'غير محدد').trim() || 'غير محدد';
        const designCode = (item.designCode || 'غير محدد').trim() || 'غير محدد';
        return materialName === group.materialName && designCode === group.designCode && Number(item.unitPrice || 0) === group.pricePerMeter;
      }),
    }));
  }, [invoice, summary.groups]);

  const buildA4Html = () => {
    if (!invoice) return '';
    return renderInvoiceStatementA4Html({
      invoice,
      partyName,
      hideFinancialColumns,
      title: AR_INVOICE_STATEMENT.printTitle,
      subtitle: AR_INVOICE_STATEMENT.printSubtitle,
    });
  };

  const defaultPdfFileName = invoice
    ? `كشف_فاتورة_${displayStoredInvoiceNo(invoice.invoiceNumber).replace(/[<>:"/\\|?*]/g, '_').trim()}.pdf`
    : 'كشف_فاتورة.pdf';

  const handlePrint = async () => {
    if (!invoice) return;
    setPreviewOpen(true);
    return;
    if (window.fabricApp?.isElectron) {
      setPrinting(true);
      try {
        const html = renderInvoiceStatementA4Html({
          invoice,
          partyName,
          hideFinancialColumns,
          title: AR_INVOICE_STATEMENT.printTitle,
          subtitle: AR_INVOICE_STATEMENT.printSubtitle,
        });
        const settings = await window.fabricApp.getSettings();
        const result = await window.fabricApp.printHtml(html, {
          pageSize: 'A4',
          silent: Boolean(settings.silentA4PrintingEnabled),
          printerName: settings.defaultA4PrinterName ?? undefined,
          printBackground: true,
        });
        if (result.ok) {
          showToast({ type: 'success', message: 'تم إرسال كشف الفاتورة إلى الطابعة' });
        } else {
          showToast({ type: 'error', message: result.error || 'تعذر طباعة كشف الفاتورة' });
        }
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'تعذر طباعة كشف الفاتورة' });
      } finally {
        setPrinting(false);
      }
      return;
    }
    window.print();
  };

  const handleExportPdf = async () => {
    if (!invoice) return;
    if (!window.fabricApp?.isElectron) {
      showToast({ type: 'warning', message: 'تصدير PDF متاح عبر نسخة سطح المكتب' });
      return;
    }
    setExportingPdf(true);
    try {
      const safeInvoiceNo = displayStoredInvoiceNo(invoice.invoiceNumber).replace(/[<>:"/\\|?*]/g, '_').trim();
      const defaultFileName = `كشف_فاتورة_${safeInvoiceNo}.pdf`;
      const html = renderInvoiceStatementA4Html({
        invoice,
        partyName,
        hideFinancialColumns,
        title: AR_INVOICE_STATEMENT.printTitle,
        subtitle: AR_INVOICE_STATEMENT.printSubtitle,
      });
      const result = await window.fabricApp.printToPdf(html, { pageSize: 'A4', defaultFileName });
      if (result.ok) {
        showToast({ type: 'success', message: `تم حفظ PDF: ${result.filePath}` });
      } else {
        showToast({ type: 'error', message: result.error || 'تم إلغاء حفظ PDF' });
      }
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : 'تعذر تصدير PDF' });
    } finally {
      setExportingPdf(false);
    }
  };

  const handleShareWhatsApp = () => {
    if (!invoice) return;
    const text = `فاتورة: ${displayStoredInvoiceNo(invoice.invoiceNumber)}%0Aالتاريخ: ${invoice.date}%0Aالإجمالي: ${formatMoney(invoice.totalAmount, currency)}`;
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  if (apiLoading && id) {
    return (
      <div className="max-w-7xl mx-auto p-6 text-center text-slate-600">جاري تحميل الفاتورة...</div>
    );
  }

  if (!invoice && id && !apiLoading) {
    return (
      <div className="max-w-7xl mx-auto p-6 text-center">
        <h2 className="text-2xl font-bold text-slate-800">لم يتم العثور على الفاتورة</h2>
        <button onClick={() => navigate(-1)} className="mt-4 text-indigo-600 hover:underline">العودة للخلف</button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 print:m-0 print:p-0 print:max-w-none">
      <A4PreviewModal
        open={previewOpen}
        title="معاينة كشف الفاتورة A4"
        html={buildA4Html()}
        pageSize="A4"
        defaultFileName={defaultPdfFileName}
        onClose={() => setPreviewOpen(false)}
        onPrinted={() => setPreviewOpen(false)}
        onExported={() => setPreviewOpen(false)}
      />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden border-b border-slate-200 pb-4">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">كشف فاتورة أقمشة</h2>
            <p className="text-slate-500 mt-1">عرض طباعة مجمع حسب الخامة والتصميم والسعر</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={handleSearch} className="flex bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden text-sm">
            <input type="text" placeholder="ابحث برقم الفاتورة..." value={searchId} onChange={(e) => setSearchId(e.target.value)} className="px-3 py-2 w-48 outline-none" />
            <button type="submit" className="bg-slate-100 hover:bg-slate-200 px-3 text-slate-700 font-medium border-r border-slate-200 transition">بحث</button>
          </form>

          <button onClick={handleShareWhatsApp} disabled={!invoice} className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-100 transition shadow-sm font-medium disabled:opacity-50">
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">مشاركة</span>
          </button>
          <button
            type="button"
            onClick={() => setHideFinancialColumns((value) => !value)}
            className={`border px-4 py-2 rounded-lg flex items-center gap-2 transition shadow-sm font-medium ${
              hideFinancialColumns
                ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span className="hidden sm:inline">{hideFinancialColumns ? 'إظهار المبالغ' : 'إخفاء المبالغ'}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={!invoice || exportingPdf}
            className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition shadow-sm font-medium disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">{exportingPdf ? 'جاري التصدير…' : 'PDF'}</span>
          </button>
          <button onClick={handlePrint} disabled={!invoice} className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition shadow-sm font-medium disabled:opacity-50">
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">{printing ? 'جاري الطباعة…' : 'طباعة'}</span>
          </button>
        </div>
      </div>

      <section className="print:hidden">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-bold text-slate-900">كل الفواتير (بيع + شراء)</h3>
          <span className="text-xs text-slate-500">{filteredInvoices.length} نتيجة</span>
        </div>
        <table className="w-full text-sm bg-transparent">
          <thead className="text-slate-600 border-b border-slate-200">
            <tr>
              <th className="px-2 py-2 text-right">النوع</th>
              <th className="px-2 py-2 text-right">رقم الفاتورة</th>
              <th className="px-2 py-2 text-right">التاريخ</th>
              <th className="px-2 py-2 text-right">الجهة</th>
              <th className="px-2 py-2 text-right">الإجمالي</th>
              <th className="px-2 py-2 text-right">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {allInvoicesLoading ? (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-slate-400">جاري تحميل الفواتير...</td>
              </tr>
            ) : filteredInvoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-slate-400">لا توجد نتائج مطابقة.</td>
              </tr>
            ) : (
              filteredInvoices.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="px-2 py-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${row.invoiceType === 'sale' ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-indigo-700'}`}>
                      {row.invoiceType === 'sale' ? 'بيع' : 'شراء'}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-mono">{row.invoiceNo || '—'}</td>
                  <td className="px-2 py-2">{row.invoiceDate || '—'}</td>
                  <td className="px-2 py-2">{row.partyName || '—'}</td>
                  <td className="px-2 py-2 font-mono">{formatMoney(row.totalAmount || 0, row.currencyCode || 'USD')}</td>
                  <td className="px-2 py-2">
                    <button
                      onClick={() => navigate(`/invoices/statement/${row.id}`)}
                      className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-bold"
                    >
                      عرض الكشف
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {invoice ? (
        <>
          <div
            className="print:hidden rounded-xl border border-slate-200 bg-amber-50/40 px-4 py-3 flex flex-wrap items-center gap-3 justify-between mb-4 shadow-sm"
            dir="rtl"
          >
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
              <span className="font-bold text-slate-600">إجراءات الفاتورة</span>
              {documentStatus === 'DRAFT' ? (
                <span className="text-xs text-amber-900 bg-amber-100 px-2 py-0.5 rounded font-bold">مسودة — يمكن التعديل أو التأكيد</span>
              ) : null}
              {documentStatus === 'CONFIRMED' ? (
                <span className="text-xs text-emerald-900 bg-emerald-100 px-2 py-0.5 rounded font-bold">مؤكدة</span>
              ) : null}
              {documentStatus === 'VOIDED' ? (
                <span className="text-xs text-slate-700 bg-slate-200 px-2 py-0.5 rounded font-bold">ملغاة — عرض فقط</span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              {documentStatus === 'DRAFT' && draftEditPath ? (
                <Link
                  to={draftEditPath}
                  className="text-amber-900 font-bold bg-amber-100 px-3 py-2 rounded-lg hover:bg-amber-200 transition text-sm"
                >
                  تعديل المسودة
                </Link>
              ) : null}
              {documentStatus === 'DRAFT' && Number(invoice.paidAmount ?? 0) > 1e-4 ? (
                <select
                  value={confirmCashboxId}
                  onChange={(e) => setConfirmCashboxId(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">-- اختر الصندوق --</option>
                  {cashboxOptions.map((box) => (
                    <option key={box.id} value={box.id}>
                      {box.name} ({box.code})
                    </option>
                  ))}
                </select>
              ) : null}
              {documentStatus === 'DRAFT' ? (
                <>
                  <button
                    type="button"
                    disabled={invoiceActionBusy}
                    onClick={() => void handleStatementConfirmDraft()}
                    className="text-white font-bold bg-indigo-600 px-3 py-2 rounded-lg hover:bg-indigo-700 transition text-sm disabled:opacity-50"
                  >
                    تأكيد الفاتورة
                  </button>
                  <button
                    type="button"
                    disabled={invoiceActionBusy}
                    onClick={() => void handleStatementDeleteDraft()}
                    className="text-rose-900 font-bold bg-rose-100 px-3 py-2 rounded-lg hover:bg-rose-200 transition text-sm disabled:opacity-50"
                  >
                    حذف المسودة
                  </button>
                </>
              ) : null}
              {documentStatus === 'CONFIRMED' ? (
                <button
                  type="button"
                  disabled={invoiceActionBusy}
                  onClick={() => void handleStatementVoid()}
                  className="text-slate-900 font-bold bg-slate-200 px-3 py-2 rounded-lg hover:bg-slate-300 transition text-sm disabled:opacity-50"
                >
                  إلغاء الفاتورة
                </button>
              ) : null}
            </div>
          </div>

          <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm print:border-none print:shadow-none print:p-0 print:text-[11px]" dir="rtl">
          <header className="flex justify-between items-start border-b-2 border-slate-900 pb-5 mb-5">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-lg bg-slate-900 text-white flex items-center justify-center font-black text-xl">ERP</div>
              <div>
                <h1 className="text-2xl font-black text-slate-950">{AR_INVOICE_STATEMENT.printTitle}</h1>
                <p className="text-sm text-slate-600">{AR_INVOICE_STATEMENT.printSubtitle}</p>
              </div>
            </div>
            <div className="text-right space-y-1">
              <QRCodeSVG value={hideFinancialColumns ? `INV:${invoice.id}` : `INV:${invoice.id}|AMT:${invoice.totalAmount}`} size={68} level="M" />
              <p className="text-xs font-mono text-slate-500">{displayStoredInvoiceNo(invoice.invoiceNumber)}</p>
            </div>
          </header>

          <section className="mb-4 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 pb-2">
              <InfoBox label={AR_INVOICE_STATEMENT.customerSupplier} value={partyName} />
              <InfoBox label={AR_INVOICE_STATEMENT.serialInvoiceNo} value={displayStoredInvoiceNo(invoice.invoiceNumber)} />
              <InfoBox label={AR_INVOICE_STATEMENT.date} value={invoice.date} />
              <InfoBox label={AR_INVOICE_STATEMENT.currency} value={currency} />
              <InfoBox label={AR_INVOICE_STATEMENT.warehouse} value={invoice.warehouse || '-'} />
              <InfoBox label="حالة المستند" value={arDocumentStatus(documentStatus)} />
              {!hideFinancialColumns && (
                <>
                  <InfoBox
                    label="سعر الصرف مقابل الدولار"
                    value={currency === 'USD' ? '1' : exchangeRateToUsd > 0 ? formatRate(exchangeRateToUsd) : '—'}
                  />
                  <InfoBox label="حالة الدفع" value={arInvoicePaymentStatusCode(paymentCode)} />
                  <InfoBox label={AR_INVOICE_STATEMENT.saleTerms} value={arSaleTermsFromInvoice(invoice)} />
                </>
              )}
            </div>
            {invoice.notes?.trim() ? (
              <div className="mt-2 border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-700">
                <span className="font-bold text-slate-600">{AR_INVOICE_STATEMENT.notes}:</span> {invoice.notes.trim()}
              </div>
            ) : null}
          </section>

          <section className="mb-6">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="p-2 border border-slate-700">{AR_INVOICE_STATEMENT.fabricMaterial}</th>
                  <th className="p-2 border border-slate-700">{AR_INVOICE_STATEMENT.design}</th>
                  <th className="p-2 border border-slate-700">{AR_INVOICE_STATEMENT.rollNo}</th>
                  <th className="p-2 border border-slate-700">{AR_INVOICE_STATEMENT.barcode}</th>
                  <th className="p-2 border border-slate-700">{AR_INVOICE_STATEMENT.colorCode}</th>
                  <th className="p-2 border border-slate-700">{AR_INVOICE_STATEMENT.colorName}</th>
                  <th className="p-2 border border-slate-700 text-right">{AR_INVOICE_STATEMENT.meters}</th>
                  <th className="p-2 border border-slate-700 text-right">{AR_INVOICE_STATEMENT.kg}</th>
                  {!hideFinancialColumns && <th className="p-2 border border-slate-700 text-right">{AR_INVOICE_STATEMENT.pricePerM}</th>}
                  {!hideFinancialColumns && <th className="p-2 border border-slate-700 text-right">{AR_INVOICE_STATEMENT.total}</th>}
                </tr>
              </thead>
              <tbody>
                {rowsByGroup.map(({ group, rows }) => (
                  <React.Fragment key={`${group.materialName}-${group.designCode}-${group.pricePerMeter}`}>
                    <tr className="bg-slate-100">
                      <td colSpan={hideFinancialColumns ? 8 : 10} className="p-2 border border-slate-300 font-black">
                        {group.materialName} | {group.designCode} | {group.colorCount} ألوان
                      </td>
                    </tr>
                    {rows.map((item, index) => (
                      <tr key={`${item.rollNumber || item.barcode || index}`} className="odd:bg-white even:bg-slate-50">
                        <td className="p-2 border border-slate-200 font-medium">{item.materialName || item.fabricName || 'غير محدد'}</td>
                        <td className="p-2 border border-slate-200 font-mono">{item.designCode || 'غير محدد'}</td>
                        <td className="p-2 border border-slate-200 font-mono">{item.rollNo || item.rollNumber || '-'}</td>
                        <td className="p-2 border border-slate-200 font-mono">{item.barcode || '-'}</td>
                        <td className="p-2 border border-slate-200 font-mono">{item.colorCode || '-'}</td>
                        <td className="p-2 border border-slate-200">{item.colorName || '-'}</td>
                        <td className="p-2 border border-slate-200 text-right font-mono">{formatNumber(item.quantity)}</td>
                        <td className="p-2 border border-slate-200 text-right font-mono">{formatNumber(item.weightKg ?? item.weight ?? 0)}</td>
                        {!hideFinancialColumns && <td className="p-2 border border-slate-200 text-right font-mono">{formatMoney(item.unitPrice, currency)}</td>}
                        {!hideFinancialColumns && <td className="p-2 border border-slate-200 text-right font-bold font-mono">{formatMoney(item.total, currency)}</td>}
                      </tr>
                    ))}
                    <tr className="bg-indigo-50 text-indigo-950 font-black">
                      <td colSpan={hideFinancialColumns ? 5 : 6} className="p-2 border border-indigo-100 text-right">{AR_INVOICE_STATEMENT.subtotalRow}</td>
                      <td className="p-2 border border-indigo-100 text-right font-mono">{formatNumber(group.totalMeters)}</td>
                      <td className="p-2 border border-indigo-100 text-right font-mono">{formatNumber(group.totalKg)}</td>
                      <td className="p-2 border border-indigo-100 text-right font-mono">{group.rollCount} توب</td>
                      {!hideFinancialColumns && <td className="p-2 border border-indigo-100 text-right font-mono">{formatMoney(group.totalAmount, currency)}</td>}
                    </tr>
                  </React.Fragment>
                ))}
                {invoice.items.length === 0 && (
                  <tr>
                    <td colSpan={hideFinancialColumns ? 8 : 10} className="p-6 text-center text-slate-500 bg-slate-50">{AR_INVOICE_STATEMENT.noInvoiceLines}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <footer className="space-y-5">
            <section>
              <h3 className="text-lg font-black text-slate-950 mb-2">{AR_INVOICE_STATEMENT.invoicePackingSummary}</h3>
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700">
                    <th className="p-2 border border-slate-200">الخامة / القماش</th>
                    <th className="p-2 border border-slate-200">كود التصميم</th>
                    <th className="p-2 border border-slate-200 text-right">عدد الألوان</th>
                    <th className="p-2 border border-slate-200 text-right">عدد الأتواب</th>
                    <th className="p-2 border border-slate-200 text-right">إجمالي الأمتار</th>
                    {!hideFinancialColumns && <th className="p-2 border border-slate-200 text-right">سعر المتر</th>}
                    {!hideFinancialColumns && <th className="p-2 border border-slate-200 text-right">الإجمالي {currency}</th>}
                    <th className="p-2 border border-slate-200 text-right">إجمالي الوزن</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.groups.map((group) => (
                    <tr key={`${group.materialName}-${group.designCode}-${group.pricePerMeter}`}>
                      <td className="p-2 border border-slate-200 font-bold">{group.materialName}</td>
                      <td className="p-2 border border-slate-200 font-mono">{group.designCode}</td>
                      <td className="p-2 border border-slate-200 text-right">{group.colorCount}</td>
                      <td className="p-2 border border-slate-200 text-right">{group.rollCount}</td>
                      <td className="p-2 border border-slate-200 text-right font-mono">{formatNumber(group.totalMeters)}</td>
                      {!hideFinancialColumns && <td className="p-2 border border-slate-200 text-right font-mono">{formatMoney(group.pricePerMeter, currency)}</td>}
                      {!hideFinancialColumns && <td className="p-2 border border-slate-200 text-right font-bold font-mono">{formatMoney(group.totalAmount, currency)}</td>}
                      <td className="p-2 border border-slate-200 text-right font-mono">{formatNumber(group.totalKg)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-900 text-white font-black">
                    <td className="p-2 border border-slate-700" colSpan={3}>{AR_INVOICE_STATEMENT.grandTotals}</td>
                    <td className="p-2 border border-slate-700 text-right">{summary.totals.rollCount}</td>
                    <td className="p-2 border border-slate-700 text-right font-mono">{formatNumber(summary.totals.totalMeters)}</td>
                    {!hideFinancialColumns && <td className="p-2 border border-slate-700 text-right">{summary.totals.groupCount} مجموعات</td>}
                    {!hideFinancialColumns && (
                      <td className="p-2 border border-slate-700 text-right font-mono">
                        {formatMoney(financialTotals?.subtotal ?? summary.totals.totalAmount, currency)}
                      </td>
                    )}
                    <td className="p-2 border border-slate-700 text-right font-mono">{formatNumber(summary.totals.totalKg)}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            {!hideFinancialColumns && financialTotals && (
              <section className="rounded-lg border border-slate-200 bg-white p-4" dir="rtl">
                <h3 className="text-lg font-black text-slate-950 mb-3">ملخص المبالغ</h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm max-w-xl">
                  <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                    <dt className="text-slate-600">المجموع (قبل الخصم)</dt>
                    <dd className="font-mono font-bold">{formatMoney(financialTotals.subtotal, currency)}</dd>
                  </div>
                  {financialTotals.discount > 0 && (
                    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                      <dt className="text-slate-600">الخصم</dt>
                      <dd className="font-mono font-bold text-rose-700">−{formatMoney(financialTotals.discount, currency)}</dd>
                    </div>
                  )}
                  {financialTotals.tax > 0 && (
                    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                      <dt className="text-slate-600">الضريبة</dt>
                      <dd className="font-mono font-bold">{formatMoney(financialTotals.tax, currency)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-4 border-b border-slate-200 pb-2">
                    <dt className="font-black text-slate-900">الإجمالي النهائي</dt>
                    <dd className="font-mono font-black text-slate-900">{formatMoney(financialTotals.total, currency)}</dd>
                  </div>
                </dl>
              </section>
            )}

            {!hideFinancialColumns && (
              <section className="rounded-lg border border-slate-200 bg-slate-50 p-4" dir="rtl">
                <h3 className="text-lg font-black text-slate-950 mb-3">التسوية المالية</h3>
                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <dt className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">إجمالي الفاتورة</dt>
                    <dd className="mt-1 font-mono font-black text-slate-900">{formatMoney(invoice.totalAmount, currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">المدفوع</dt>
                    <dd className="mt-1 font-mono font-black text-emerald-800">{formatMoney(invoice.paidAmount ?? 0, currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">المتبقي</dt>
                    <dd className="mt-1 font-mono font-black text-amber-900">{formatMoney(invoice.remainingAmount ?? 0, currency)}</dd>
                  </div>
                  {currency !== 'USD' && (
                    <>
                      <div>
                        <dt className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">إجمالي الفاتورة بالدولار</dt>
                        <dd className="mt-1 font-mono font-black text-slate-900">
                          {totalAmountUsd != null ? formatMoney(totalAmountUsd, 'USD') : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">المدفوع بالدولار</dt>
                        <dd className="mt-1 font-mono font-black text-emerald-800">
                          {paidAmountUsd != null ? formatMoney(paidAmountUsd, 'USD') : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">المتبقي بالدولار</dt>
                        <dd className="mt-1 font-mono font-black text-amber-900">
                          {remainingAmountUsd != null ? formatMoney(remainingAmountUsd, 'USD') : '—'}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              </section>
            )}

            <section className="grid grid-cols-3 gap-4 pt-6">
              <SignatureBox label={AR_INVOICE_STATEMENT.preparedBy} />
              <SignatureBox label={AR_INVOICE_STATEMENT.deliveredBy} />
              <SignatureBox label={AR_INVOICE_STATEMENT.receivedBy} />
            </section>
          </footer>
        </div>
        </>
      ) : (
        <div className="bg-white p-12 text-center rounded-xl border border-slate-200">
          <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-slate-700 mb-2">يرجى اختيار فاتورة</h3>
          <p className="text-slate-500">قم بإدخال رقم الفاتورة أو اختيارها من القائمة للبدء.</p>
        </div>
      )}
    </div>
  );
};

const InfoBox = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-slate-200 bg-slate-50 px-3 py-2 rounded-lg min-w-0">
    <div className="text-[10px] font-bold text-slate-500 tracking-wide">{label}</div>
    <div className="mt-0.5 font-bold text-slate-900 text-xs break-words">{value}</div>
  </div>
);

const SignatureBox = ({ label }: { label: string }) => (
  <div className="border-t-2 border-slate-900 pt-2 min-h-16">
    <div className="text-xs font-black text-slate-700">{label}</div>
  </div>
);
