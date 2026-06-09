import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { CheckCircle2, FileUp, Plus, Search, Filter, X, AlertTriangle, History } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import {
  ImportedPurchaseRoll,
  PurchaseInvoiceImportPreview,
  importedRollToInventoryItem,
  importedRollToInvoiceItem,
  parsePurchaseInvoiceExcelFile,
  normalizePurchaseBarcode,
  buildPurchaseRollBarcodeIndex,
} from '../lib/purchaseInvoiceExcelImport';
import {
  listPurchaseInvoices,
  confirmPurchaseInvoice,
  deletePurchaseInvoice,
  voidPurchaseInvoice,
} from '../lib/api/purchaseInvoicesApi';
import { displayStoredInvoiceNo, mapPurchaseListRowToInvoice, type ListedPurchaseInvoice } from '../lib/invoiceDbMappers';
import { arInvoicePaymentStatusCode, arDocumentStatus } from '../lib/i18n/arTerminology';
import { useToast } from '../components/NonBlockingToast';
import { ApiRequestError } from '../lib/api/client';

const SCAN_DEBOUNCE_MS = 300;
/** Minimum normalized length to auto-fire after debounce (warehouse scanners). */
const MIN_BARCODE_AUTO_LEN = 4;

type ScanFeedback = { tone: 'success' | 'warn' | 'error'; text: string } | null;
type DocFilter = '' | 'DRAFT' | 'CONFIRMED' | 'VOIDED';

export const Purchases = () => {
  const { showToast } = useToast();
  const { suppliers, importConfirmedPurchaseInvoice } = useStore();
  const [purchaseInvoices, setPurchaseInvoices] = useState<ListedPurchaseInvoice[]>([]);
  const [piLoading, setPiLoading] = useState(true);
  const [piError, setPiError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [documentStatus, setDocumentStatus] = useState<DocFilter>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const scanDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importPreviewRef = useRef<PurchaseInvoiceImportPreview | null>(null);
  const [importPreview, setImportPreview] = useState<PurchaseInvoiceImportPreview | null>(null);
  const [scanValue, setScanValue] = useState('');
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>(null);
  const [isImporting, setIsImporting] = useState(false);
  
  const refreshPurchaseList = useCallback(async () => {
    setPiLoading(true);
    setPiError(null);
    try {
      const res = await listPurchaseInvoices({
        search: search.trim() || undefined,
        pageSize: 200,
        documentStatus: documentStatus || undefined,
      });
      setPurchaseInvoices(res.rows.map((row) => mapPurchaseListRowToInvoice(row as Record<string, unknown>)));
    } catch (e) {
      setPiError(e instanceof Error ? e.message : 'تعذر تحميل فواتير الشراء');
      setPurchaseInvoices([]);
    } finally {
      setPiLoading(false);
    }
  }, [search, documentStatus]);

  const payStatus = (inv: ListedPurchaseInvoice) => inv.paymentStatus ?? inv.status;

  const handleConfirmPurchase = async (id: string) => {
    if (!window.confirm('سيتم ترحيل الفاتورة وسيؤثر ذلك على المخزون والحسابات، هل أنت متأكد؟')) return;
    try {
      await confirmPurchaseInvoice(id, {});
      showToast({ type: 'success', message: 'تم تأكيد فاتورة الشراء' });
      void refreshPurchaseList();
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر تأكيد الفاتورة',
      });
    }
  };

  const handleDeletePurchaseDraft = async (id: string) => {
    if (!window.confirm('سيتم حذف المسودة فقط ولن يؤثر ذلك على المخزون أو الحسابات. هل تريد المتابعة؟')) return;
    try {
      await deletePurchaseInvoice(id);
      showToast({ type: 'success', message: 'تم حذف المسودة' });
      void refreshPurchaseList();
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر حذف المسودة',
      });
    }
  };

  const handleVoidPurchase = async (id: string) => {
    if (
      !window.confirm(
        'سيتم إلغاء الفاتورة المؤكدة وعكس أثرها على المخزون والقيود المحاسبية قدر الإمكان. هل أنت متأكد؟',
      )
    ) {
      return;
    }
    try {
      await voidPurchaseInvoice(id);
      showToast({ type: 'success', message: 'تم إلغاء الفاتورة' });
      void refreshPurchaseList();
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر إلغاء الفاتورة',
      });
    }
  };

  useEffect(() => {
    const t = window.setTimeout(() => void refreshPurchaseList(), 320);
    return () => window.clearTimeout(t);
  }, [refreshPurchaseList]);

  const confirmedCount = importPreview?.rolls.filter((roll) => roll.confirmed).length || 0;
  const totalImportedCount = importPreview?.rolls.length || 0;
  const remainingCount = totalImportedCount - confirmedCount;
  const confirmedMeters = useMemo(
    () => importPreview?.rolls.filter((roll) => roll.confirmed).reduce((sum, roll) => sum + roll.meters, 0) || 0,
    [importPreview],
  );

  useEffect(() => {
    importPreviewRef.current = importPreview;
  }, [importPreview]);

  const refocusScanInput = useCallback(() => {
    requestAnimationFrame(() => {
      scanInputRef.current?.focus();
      requestAnimationFrame(() => scanInputRef.current?.focus());
    });
  }, []);

  useEffect(() => {
    if (!importPreview) return;
    const t = window.setTimeout(() => refocusScanInput(), 120);
    return () => window.clearTimeout(t);
  }, [importPreview, refocusScanInput]);

  useEffect(
    () => () => {
      if (scanDebounceRef.current) window.clearTimeout(scanDebounceRef.current);
    },
    [],
  );

  const clearScanDebounce = useCallback(() => {
    if (scanDebounceRef.current) {
      window.clearTimeout(scanDebounceRef.current);
      scanDebounceRef.current = null;
    }
  }, []);

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsImporting(true);
    setScanFeedback(null);
    try {
      const preview = await parsePurchaseInvoiceExcelFile(file);
      setImportPreview(preview);
      setTimeout(() => scanInputRef.current?.focus(), 80);
    } catch (error) {
      console.error('Purchase invoice Excel import failed', error);
      showToast({ type: 'error', message: 'تعذر قراءة ملف فاتورة الشراء. تأكد أن الملف Excel صالح.' });
    } finally {
      setIsImporting(false);
    }
  };

  const confirmBarcode = useCallback(
    (raw: string) => {
      clearScanDebounce();
      const barcode = normalizePurchaseBarcode(raw);
      if (!barcode) return;

      const prev = importPreviewRef.current;
      if (!prev) return;

      const idx = buildPurchaseRollBarcodeIndex(prev.rolls);
      const target = idx.get(barcode);
      if (!target) {
        setScanFeedback({
          tone: 'error',
          text: 'لم يتم العثور على باركود مطابق ضمن هذه الدفعة',
        });
        setScanValue('');
        refocusScanInput();
        return;
      }

      if (target.confirmed) {
        setScanFeedback({ tone: 'warn', text: 'هذا الثوب مؤكد مسبقاً' });
        setScanValue('');
        refocusScanInput();
        return;
      }

      const next: PurchaseInvoiceImportPreview = {
        ...prev,
        rolls: prev.rolls.map((roll) => (roll.id === target.id ? { ...roll, confirmed: true } : roll)),
      };
      importPreviewRef.current = next;
      setImportPreview(next);
      setScanFeedback({
        tone: 'success',
        text: `تم تأكيد الثوب: ${target.barcode}`,
      });
      setScanValue('');
      refocusScanInput();
    },
    [refocusScanInput, clearScanDebounce],
  );

  const scheduleAutoConfirm = useCallback(
    (value: string) => {
      clearScanDebounce();
      const normalized = normalizePurchaseBarcode(value);
      if (normalized.length < MIN_BARCODE_AUTO_LEN) return;
      scanDebounceRef.current = window.setTimeout(() => {
        scanDebounceRef.current = null;
        confirmBarcode(value);
      }, SCAN_DEBOUNCE_MS);
    },
    [clearScanDebounce, confirmBarcode],
  );

  const handleScanChange = (value: string) => {
    setScanValue(value);
    if (normalizePurchaseBarcode(value).length === 0) {
      clearScanDebounce();
      return;
    }
    scheduleAutoConfirm(value);
  };

  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      clearScanDebounce();
      confirmBarcode(e.currentTarget.value);
    }
  };

  const handleCommitAllWithoutVerification = () => {
    if (!importPreview) return;
    if (!importPreview.rolls.length) {
      showToast({ type: 'warning', message: 'لا توجد أتواب قابلة للاستيراد داخل الملف.' });
      return;
    }

    const ok = window.confirm(
      `سيتم استيراد كل الأتواب (${importPreview.rolls.length}) بدون توثيق بالباركود. استخدم هذا الخيار فقط بناء على طلب صاحب المشروع. هل تريد المتابعة؟`,
    );
    if (!ok) return;

    const date = new Date().toISOString().split('T')[0];
    const supplierId = suppliers[0]?.id || '';
    const internalIds = importPreview.rolls.map((_, index) => `TXR-${new Date().getFullYear()}-${String(Date.now() + index).slice(-6)}`);
    const fabrics = importPreview.rolls.map((roll, index) =>
      importedRollToInventoryItem(roll, { warehouseId: 'main', internalRollId: internalIds[index] }),
    );
    const items = importPreview.rolls.map((roll, index) => ({
      ...importedRollToInvoiceItem(roll, internalIds[index]),
      note: 'Imported purchase invoice roll without barcode verification by owner request',
    }));

    clearScanDebounce();

    importConfirmedPurchaseInvoice(
      {
        date,
        partyId: supplierId,
        invoiceNumber: `IMP-${importPreview.fileName.replace(/\.[^.]+$/, '')}`,
        currency: 'USD',
        warehouse: 'main',
        notes: `Imported from ${importPreview.fileName}. Imported ${importPreview.rolls.length}/${importPreview.rolls.length} rolls without barcode verification by owner request.`,
        totalAmount: 0,
        paidAmount: 0,
        remainingAmount: 0,
        status: 'unpaid',
        items,
      },
      fabrics,
    );

    setImportPreview(null);
    setScanValue('');
    setScanFeedback(null);
  };

  const handleCommitImport = () => {
    if (!importPreview) return;
    const confirmedRolls = importPreview.rolls.filter((roll) => roll.confirmed);
    if (!confirmedRolls.length) {
      showToast({ type: 'warning', message: 'لا يوجد أي طوب مؤكد بالباركود حتى الآن.' });
      return;
    }

    if (confirmedRolls.length < importPreview.rolls.length) {
      const ok = window.confirm(`تم تأكيد ${confirmedRolls.length} من أصل ${importPreview.rolls.length}. هل تريد ترحيل المؤكد فقط وترك ${importPreview.rolls.length - confirmedRolls.length} غير مؤكد؟`);
      if (!ok) return;
    }

    const date = new Date().toISOString().split('T')[0];
    const supplierId = suppliers[0]?.id || '';
    const internalIds = confirmedRolls.map((_, index) => `TXR-${new Date().getFullYear()}-${String(Date.now() + index).slice(-6)}`);
    const fabrics = confirmedRolls.map((roll, index) =>
      importedRollToInventoryItem(roll, { warehouseId: 'main', internalRollId: internalIds[index] }),
    );
    const items = confirmedRolls.map((roll, index) => importedRollToInvoiceItem(roll, internalIds[index]));

    clearScanDebounce();

    importConfirmedPurchaseInvoice(
      {
        date,
        partyId: supplierId,
        invoiceNumber: `IMP-${importPreview.fileName.replace(/\.[^.]+$/, '')}`,
        currency: 'USD',
        warehouse: 'main',
        notes: `Imported from ${importPreview.fileName}. Confirmed ${confirmedRolls.length}/${importPreview.rolls.length} rolls by barcode scan.`,
        totalAmount: 0,
        paidAmount: 0,
        remainingAmount: 0,
        status: 'unpaid',
        items,
      },
      fabrics,
    );

    setImportPreview(null);
    setScanValue('');
    setScanFeedback(null);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">فواتير الشراء</h2>
          <p className="text-slate-500 mt-1">إدارة فواتير المشتريات من الموردين</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/purchases/import-batches"
            className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition font-medium text-sm"
          >
            <History className="w-4 h-4" />
            <span>سجل استيراد فواتير الشراء</span>
          </Link>
          <Link
            to="/purchases/import-excel"
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700 transition font-medium text-sm"
          >
            <FileUp className="w-4 h-4" />
            <span>استيراد فاتورة شراء</span>
          </Link>
          <Link
            to="/invoices/purchases/new"
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition font-medium text-sm"
          >
            <Plus className="w-4 h-4" />
            <span>فاتورة مشتريات جديدة</span>
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between bg-slate-50">
          <div className="relative flex-1 max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input 
              type="text" 
              placeholder="بحث برقم الفاتورة، أو اسم المورد..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
          </div>
          <div className="flex items-center gap-2 bg-white border border-slate-200 px-3 py-2 rounded-lg shadow-sm">
            <Filter className="w-4 h-4 text-slate-500" />
            <label className="text-sm font-bold text-slate-700 whitespace-nowrap">حالة المستند</label>
            <select
              value={documentStatus}
              onChange={(e) => setDocumentStatus(e.target.value as DocFilter)}
              className="text-sm font-medium text-slate-800 bg-transparent border-none outline-none cursor-pointer"
            >
              <option value="">الكل</option>
              <option value="DRAFT">مسودة</option>
              <option value="CONFIRMED">مؤكدة</option>
              <option value="VOIDED">ملغاة</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          {piError && (
            <div className="px-6 py-3 text-sm text-rose-700 bg-rose-50 border-b border-rose-100">{piError}</div>
          )}
          {piLoading && !piError ? (
            <div className="px-6 py-12 text-center text-slate-500">جاري تحميل فواتير الشراء...</div>
          ) : (
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">رقم الفاتورة</th>
                <th className="px-6 py-4">التاريخ</th>
                <th className="px-6 py-4">المورد</th>
                <th className="px-6 py-4">الإجمالي ($)</th>
                <th className="px-6 py-4">المدفوع ($)</th>
                <th className="px-6 py-4">المتبقي ($)</th>
                <th className="px-6 py-4">حالة المستند</th>
                <th className="px-6 py-4">حالة الدفع</th>
                <th className="px-6 py-4">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {purchaseInvoices.map((invoice) => {
                const supplier = suppliers.find((s) => s.id === invoice.partyId);
                const partyName = invoice.partyLabel || supplier?.name || supplier?.company || '-';
                const doc = invoice.documentStatus ?? '';
                const ps = payStatus(invoice);
                return (
                  <tr key={invoice.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-mono font-medium text-indigo-600">{displayStoredInvoiceNo(invoice.invoiceNumber)}</td>
                    <td className="px-6 py-4 text-slate-500 font-medium">
                      {format(new Date(invoice.date), 'PP', { locale: ar })}
                    </td>
                    <td className="px-6 py-4 text-slate-700 font-bold">{partyName}</td>
                    <td className="px-6 py-4 font-semibold text-slate-900">{invoice.totalAmount.toFixed(2)}</td>
                    <td className="px-6 py-4 font-semibold text-emerald-600">{invoice.paidAmount.toFixed(2)}</td>
                    <td className="px-6 py-4 font-semibold text-rose-600">{invoice.remainingAmount.toFixed(2)}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-bold ${
                          doc === 'DRAFT'
                            ? 'bg-amber-100 text-amber-800'
                            : doc === 'CONFIRMED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : doc === 'VOIDED'
                                ? 'bg-slate-200 text-slate-700'
                                : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {arDocumentStatus(doc)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-bold ${
                          ps === 'paid'
                            ? 'bg-emerald-100 text-emerald-700'
                            : ps === 'partial'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {arInvoicePaymentStatusCode(ps)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1.5 justify-end">
                        {doc === 'DRAFT' ? (
                          <>
                            <Link
                              to={`/invoices/purchases/${invoice.id}/edit`}
                              className="text-amber-800 hover:text-amber-950 font-medium bg-amber-50 px-2 py-1 rounded-lg hover:bg-amber-100 transition text-xs"
                            >
                              متابعة المسودة
                            </Link>
                            <button
                              type="button"
                              onClick={() => void handleConfirmPurchase(invoice.id)}
                              className="text-white font-medium bg-indigo-600 px-2 py-1 rounded-lg hover:bg-indigo-700 transition text-xs"
                            >
                              تأكيد
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeletePurchaseDraft(invoice.id)}
                              className="text-rose-800 font-medium bg-rose-50 px-2 py-1 rounded-lg hover:bg-rose-100 transition text-xs"
                            >
                              حذف المسودة
                            </button>
                          </>
                        ) : null}
                        {doc === 'CONFIRMED' || doc === 'VOIDED' ? (
                          <Link
                            to={`/invoices/statement/${invoice.id}`}
                            className="text-indigo-600 hover:text-indigo-800 font-medium bg-indigo-50 px-2 py-1 rounded-lg hover:bg-indigo-100 transition text-xs"
                          >
                            كشف الفاتورة
                          </Link>
                        ) : null}
                        {doc === 'CONFIRMED' ? (
                          <button
                            type="button"
                            onClick={() => void handleVoidPurchase(invoice.id)}
                            className="text-slate-800 font-medium bg-slate-100 px-2 py-1 rounded-lg hover:bg-slate-200 transition text-xs"
                          >
                            إلغاء
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {purchaseInvoices.length === 0 && !piLoading && (
                 <tr>
                 <td colSpan={9} className="px-6 py-12 text-center text-slate-500">لا يوجد فواتير شراء في الخادم ضمن البحث الحالي.</td>
               </tr>
              )}
            </tbody>
          </table>
          )}
        </div>
      </div>

      {importPreview && (
        <div className="fixed inset-0 z-[220] bg-slate-950/60 backdrop-blur-sm p-4 flex items-center justify-center" dir="rtl">
          <div className="bg-white w-full max-w-6xl max-h-[92vh] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-black text-slate-900">تأكيد استلام فاتورة الشراء من Excel</h3>
                <p className="text-sm text-slate-500 mt-1">{importPreview.fileName} · الشيت: {importPreview.sheetName}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  clearScanDebounce();
                  setImportPreview(null);
                }}
                className="p-2 rounded-lg hover:bg-white text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <ImportStat title="إجمالي الأتواب" value={totalImportedCount} color="slate" />
                <ImportStat title="تم تأكيده" value={confirmedCount} color="emerald" />
                <ImportStat title="غير مؤكد" value={remainingCount} color={remainingCount ? 'rose' : 'emerald'} />
                <ImportStat title="الأمتار المؤكدة" value={confirmedMeters.toFixed(2)} color="indigo" />
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <label className="block text-sm font-bold text-slate-700 mb-2">بحث / تأكيد عن طريق رقم الباركود</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="w-5 h-5 absolute right-3 top-2.5 text-slate-400" />
                    <input
                      ref={scanInputRef}
                      value={scanValue}
                      onChange={(e) => handleScanChange(e.target.value)}
                      onKeyDown={handleScanKeyDown}
                      placeholder="امسح الباركود — يُؤكَّد تلقائياً (أو Enter)"
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full pr-10 pl-4 py-2 border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      dir="ltr"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => confirmBarcode(scanValue)}
                    className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700"
                  >
                    تأكيد
                  </button>
                </div>
                {scanFeedback && (
                  <div
                    className={`mt-2 text-sm font-bold rounded-lg px-3 py-2 ${
                      scanFeedback.tone === 'success'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : scanFeedback.tone === 'warn'
                          ? 'bg-amber-50 text-amber-900 border border-amber-200'
                          : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}
                  >
                    {scanFeedback.text}
                  </div>
                )}
              </div>

              {importPreview.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 space-y-1">
                  {importPreview.warnings.map((warning) => (
                    <div key={warning} className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {importPreview.rolls.map((roll) => (
                  <div key={roll.id}>
                    <ImportedRollCard roll={roll} />
                  </div>
                ))}
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-bold text-slate-700">
                تم تأكيد {confirmedCount} من أصل {totalImportedCount} · بقي {remainingCount} غير مؤكد
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    clearScanDebounce();
                    setImportPreview(null);
                  }}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold"
                >
                  إلغاء الاستيراد
                </button>
                <button
                  type="button"
                  onClick={handleCommitAllWithoutVerification}
                  className="px-5 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 font-bold"
                >
                  استيراد الكل بدون توثيق
                </button>
                <button onClick={handleCommitImport} className="px-5 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-bold">
                  تأكيد وترحيل المؤكد
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function ImportStat({ title, value, color }: { title: string; value: string | number; color: 'slate' | 'emerald' | 'rose' | 'indigo' }) {
  const classes = {
    slate: 'bg-slate-50 border-slate-200 text-slate-800',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    rose: 'bg-rose-50 border-rose-200 text-rose-800',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-800',
  };

  return (
    <div className={`rounded-xl border p-4 ${classes[color]}`}>
      <div className="text-xs font-bold opacity-75">{title}</div>
      <div className="text-2xl font-black mt-1">{value}</div>
    </div>
  );
}

function ImportedRollCard({ roll }: { roll: ImportedPurchaseRoll }) {
  return (
    <div className={`rounded-xl border p-4 transition ${roll.confirmed ? 'bg-emerald-50 border-emerald-300 ring-1 ring-emerald-200' : 'bg-white border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-black text-slate-900">{roll.materialName}</div>
          <div className="text-sm text-slate-500 mt-1">{roll.designCode || '-'} · {roll.colorName || '-'}</div>
        </div>
        {roll.confirmed && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
      </div>
      <div className={`mt-3 rounded-lg border px-3 py-2 font-mono text-sm font-bold ${roll.confirmed ? 'bg-emerald-100 border-emerald-300 text-emerald-800' : 'bg-slate-50 border-slate-200 text-slate-700'}`} dir="ltr">
        {roll.barcode}
      </div>
      <div className="mt-3 text-sm font-bold text-slate-700">{roll.meters.toFixed(2)} متر</div>
      <div className={`mt-2 text-xs font-black ${roll.confirmed ? 'text-emerald-700' : 'text-rose-600'}`}>
        {roll.confirmed ? 'تم تأكيد الاستلام' : 'بانتظار المسح'}
      </div>
    </div>
  );
}
