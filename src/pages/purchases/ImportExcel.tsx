import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, FileUp, Loader2, Save, Ship, Calculator, Upload, Wrench } from 'lucide-react';
import { useToast } from '../../components/NonBlockingToast';
import { ApiRequestError } from '../../lib/api/client';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import {
  autoRepairImportBatch,
  confirmImportBatch,
  listImportRows,
  previewPurchaseExcelImport,
  saveImportPricing,
  type ImportPreviewSummary,
  type ImportPricingResult,
  type PurchaseImportRowDto,
  formatImportIssuesMessage,
} from '../../lib/api/purchaseImportApi';

type Step = 'setup' | 'preview' | 'pricing' | 'done';

const todayIso = () => new Date().toISOString().slice(0, 10);

export const ImportExcel = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState<Step>('setup');
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [purchaseInvoiceNo, setPurchaseInvoiceNo] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<ImportPreviewSummary | null>(null);
  const [pricingResult, setPricingResult] = useState<ImportPricingResult | null>(null);
  const [confirmResult, setConfirmResult] = useState<{ invoiceId?: string | null; invoiceNo?: string | null } | null>(null);
  const [issueRows, setIssueRows] = useState<PurchaseImportRowDto[]>([]);
  const [issueRowsTotal, setIssueRowsTotal] = useState(0);
  const [autoRepair, setAutoRepair] = useState(true);
  const [repairSummary, setRepairSummary] = useState<string[]>([]);

  const [basePrice, setBasePrice] = useState('');
  const [priceUnit, setPriceUnit] = useState<'meter' | 'yard'>('meter');
  const [freightCost, setFreightCost] = useState('0');
  const [customsCost, setCustomsCost] = useState('0');
  const [clearanceCost, setClearanceCost] = useState('0');
  const [internalShippingCost, setInternalShippingCost] = useState('0');
  const [otherCost, setOtherCost] = useState('0');

  useEffect(() => {
    void (async () => {
      try {
        const [sup, wh] = await Promise.all([
          listSuppliers({ pageSize: 200, status: 'active' }),
          listWarehouses({ status: 'active' }),
        ]);
        setSuppliers(sup.data ?? []);
        setWarehouses(wh);
        if (sup.data?.[0]?.id) setSupplierId(sup.data[0].id);
        if (wh[0]?.id) setWarehouseId(wh[0].id);
      } catch (e) {
        showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر تحميل الموردين أو المستودعات' });
      }
    })();
  }, [showToast]);

  useEffect(() => {
    if (!preview?.batchId || (preview.errorCount ?? 0) <= 0) {
      setIssueRows([]);
      setIssueRowsTotal(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data, total } = await listImportRows(preview.batchId, { status: 'ERROR', pageSize: 50 });
        if (!cancelled) {
          setIssueRows(data);
          setIssueRowsTotal(total);
        }
      } catch {
        if (!cancelled) {
          setIssueRows([]);
          setIssueRowsTotal(preview.errorCount ?? 0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preview?.batchId, preview?.errorCount]);

  const livePricing = useMemo(() => {
    const totalM = preview?.totalLengthM ?? 0;
    const base = Number(basePrice) || 0;
    const extras =
      (Number(freightCost) || 0) +
      (Number(customsCost) || 0) +
      (Number(clearanceCost) || 0) +
      (Number(internalShippingCost) || 0) +
      (Number(otherCost) || 0);
    const basePerM = priceUnit === 'yard' ? base / 0.9144 : base;
    const landingPerM = totalM > 0 ? extras / totalM : 0;
    const finalUnit = basePerM + landingPerM;
    const supplierInvoiceTotal = basePerM * totalM;
    const inventoryValueTotal = finalUnit * totalM;
    return { basePerM, extras, landingPerM, finalUnit, supplierInvoiceTotal, inventoryValueTotal, totalM };
  }, [basePrice, priceUnit, freightCost, customsCost, clearanceCost, internalShippingCost, otherCost, preview?.totalLengthM]);

  const handlePreview = async () => {
    if (!file) {
      showToast({ type: 'warning', message: 'اختر ملف Excel أولاً' });
      return;
    }
    if (!supplierId || !warehouseId) {
      showToast({ type: 'warning', message: 'اختر المورد والمستودع' });
      return;
    }
    setLoading(true);
    try {
      const summary = await previewPurchaseExcelImport(file, {
        supplierId,
        warehouseId,
        invoiceDate,
        purchaseInvoiceNo: purchaseInvoiceNo.trim() || null,
        currencyCode,
        exchangeRateToUsd: currencyCode === 'USD' ? 1 : undefined,
        notes: notes.trim() || null,
        importMode: 'CREATE_MISSING_MASTER_DATA',
        autoRepair,
      });
      setPreview(summary);
      setRepairSummary([]);
      setStep('preview');
      if (summary.autoRepairedRows && summary.autoRepairedRows > 0) {
        showToast({
          type: 'warning',
          message: `تم إصلاح ${summary.autoRepairedRows} صف تلقائياً — راجع التحذيرات قبل الترحيل`,
        });
      } else if (summary.warnCount > 0 || (summary.metadataWarnings?.length ?? 0) > 0) {
        showToast({ type: 'warning', message: 'تمت المعاينة مع بعض التحذيرات — راجع الملخص قبل التسعير' });
      } else {
        showToast({ type: 'success', message: 'تم تحليل الملف بنجاح' });
      }
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر معاينة ملف الاستيراد',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSavePricing = async () => {
    if (!preview?.batchId) return;
    if (!(Number(basePrice) > 0)) {
      showToast({ type: 'warning', message: 'أدخل سعر الشراء من المورد' });
      return;
    }
    setLoading(true);
    try {
      const result = await saveImportPricing(preview.batchId, {
        purchaseBaseUnitPrice: Number(basePrice),
        priceUnit,
        freightCost: Number(freightCost) || 0,
        customsCost: Number(customsCost) || 0,
        clearanceCost: Number(clearanceCost) || 0,
        internalShippingCost: Number(internalShippingCost) || 0,
        otherCost: Number(otherCost) || 0,
      });
      setPricingResult(result);
      setStep('pricing');
      showToast({ type: 'success', message: 'تم حفظ التسعير وتكاليف الاستيراد' });
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر حفظ التسعير',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAutoRepair = async () => {
    if (!preview?.batchId) return;
    setLoading(true);
    try {
      const result = await autoRepairImportBatch(preview.batchId);
      setPreview((prev) =>
        prev
          ? {
              ...prev,
              validCount: result.validCount,
              warnCount: result.warnCount,
              errorCount: result.errorCount,
              totalLengthM: result.totalLengthM,
              totalActualWeightKg: result.totalActualWeightKg,
              totalCalculatedWeightKg: result.totalCalculatedWeightKg,
              verificationTotal: result.verificationTotal,
            }
          : prev,
      );
      setRepairSummary(result.repairSummary);
      if (result.errorCount === 0) {
        showToast({
          type: 'success',
          message: `تم الإصلاح — ${result.repairedRows} صف. لا توجد أخطاء متبقية.`,
        });
      } else {
        showToast({
          type: 'warning',
          message: `تم إصلاح ${result.repairedRows} صف — يبقى ${result.errorCount} خطأ يحتاج تدخلاً يدوياً`,
          durationMs: 10000,
        });
      }
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر الإصلاح التلقائي',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview?.batchId) return;
    if ((preview.errorCount ?? 0) > 0) {
      showToast({
        type: 'error',
        message: `لا يمكن الترحيل — يوجد ${preview.errorCount} صف بأخطاء. راجع القائمة أدناه وصحّح الملف ثم أعد المعاينة.`,
      });
      return;
    }
    if (!pricingResult) {
      showToast({ type: 'warning', message: 'احفظ التسعير أولاً قبل الحفظ والترحيل' });
      return;
    }
    const allowWarnings = (preview.warnCount ?? 0) > 0;
    if (allowWarnings && !window.confirm('يوجد تحذيرات في بعض الصفوف. هل تريد المتابعة بالحفظ والترحيل؟')) return;
    if (!window.confirm('سيتم إنشاء فاتورة شراء مؤكدة وإضافة الأتواب للمخزون والتصنيفات. هل تريد المتابعة؟')) return;

    setLoading(true);
    try {
      const result = await confirmImportBatch(preview.batchId, { allowWarnings });
      setConfirmResult({ invoiceId: result.createdPurchaseInvoiceId, invoiceNo: result.purchaseInvoiceNo });
      setStep('done');
      showToast({ type: 'success', message: `تم الترحيل — ${result.createdRolls} توب في المخزون` });
    } catch (e) {
      const base = e instanceof ApiRequestError ? e.message : 'تعذر تأكيد الاستيراد';
      const extra =
        e instanceof ApiRequestError ? formatImportIssuesMessage(e.body?.details) : '';
      showToast({
        type: 'error',
        message: extra ? `${base}\n${extra}` : base,
        durationMs: 12000,
      });
    } finally {
      setLoading(false);
    }
  };

  const resetImport = () => {
    setStep('setup');
    setPreview(null);
    setPricingResult(null);
    setConfirmResult(null);
    setIssueRows([]);
    setIssueRowsTotal(0);
    setRepairSummary([]);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const meta = preview?.extractedMetadata;

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-10">
      <div className="flex items-center gap-4">
        <Link to="/invoices/purchases" className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
          <ArrowRight className="w-5 h-5" />
        </Link>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">استيراد فاتورة شراء من Excel</h2>
          <p className="text-slate-500 mt-1 text-sm">
            قوائم التعبئة الصينية (DETAILED PACKING LIST) — معاينة، تسعير، تكاليف شحن وجمارك، ثم ترحيل للمخزون
          </p>
        </div>
      </div>

      {step !== 'done' && (
        <div className="bg-white rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 p-6 space-y-4">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
              <Upload className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">رفع ملف Excel</h3>
              <p className="text-sm text-slate-600 mt-1">يدعم .xls و .xlsx — مثل Roll List / DETAILED PACKING LIST</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="sr-only"
              id="purchase-excel-file-input"
            />
            <label
              htmlFor="purchase-excel-file-input"
              className="cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 shadow-sm transition"
            >
              <FileUp className="w-5 h-5" />
              اختر ملف Excel من جهازك
            </label>
            {file ? (
              <div className="text-sm font-bold text-emerald-900 bg-white border border-emerald-200 rounded-lg px-4 py-2">
                الملف المختار: <span className="font-mono" dir="ltr">{file.name}</span>
              </div>
            ) : (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                لم يُختَر ملف بعد — اضغط الزر الأخضر أعلاه
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'setup' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <h3 className="font-bold text-slate-800 text-sm">بيانات الفاتورة والمورد</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">المورد</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                <option value="">— اختر —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">المستودع</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                <option value="">— اختر —</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">تاريخ الفاتورة</label>
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">رقم فاتورة المورد (اختياري)</label>
              <input value={purchaseInvoiceNo} onChange={(e) => setPurchaseInvoiceNo(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">العملة</label>
              <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                <option value="USD">USD</option>
                <option value="TRY">TRY</option>
                <option value="CNY">CNY</option>
              </select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-bold text-slate-700">ملاحظات</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="اختياري" />
            </div>
            <div className="md:col-span-2">
              <label className="flex items-start gap-2 cursor-pointer text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={autoRepair}
                  onChange={(e) => setAutoRepair(e.target.checked)}
                  className="mt-1 rounded border-slate-300"
                />
                <span>
                  <span className="font-bold">إصلاح تلقائي عند المعاينة</span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    يملأ الحقول الفارغة من بيانات الملف، ويحل تكرار الباركود/السيريال مع الإبقاء على رقم التوب الأصلي
                  </span>
                </span>
              </label>
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handlePreview()}
            className="bg-emerald-600 text-white px-5 py-2.5 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
            تحليل الملف ومعاينة
          </button>
        </div>
      )}

      {(step === 'preview' || step === 'pricing' || step === 'done') && preview && (
        <div className="space-y-4">
          {step !== 'done' && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={resetImport}
                className="text-sm font-bold text-slate-600 hover:text-slate-900 underline"
              >
                رفع ملف آخر
              </button>
            </div>
          )}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
            <h3 className="font-bold text-slate-900">ملخص التحليل — {preview.fileName}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">نوع الخامة</div><div className="font-bold">{(meta as { fabricFamily?: string })?.fabricFamily ?? meta?.materialName ?? '—'}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">كود التصميم</div><div className="font-bold">{meta?.materialName ?? '—'}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">العرض</div><div className="font-bold">{meta?.widthRaw ? `${meta.widthRaw} inch` : '—'}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">عدد الأتواب</div><div className="font-bold">{preview.rowCount}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">إجمالي الأمتار</div><div className="font-bold">{preview.totalLengthM.toLocaleString('ar-EG')}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">صالح / تحذير / خطأ</div><div className="font-bold">{preview.validCount} / {preview.warnCount} / {preview.errorCount}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">خامات / ألوان</div><div className="font-bold">{preview.distinctMaterialsCount ?? 1} / {preview.distinctColorsCount ?? '—'}</div></div>
            </div>
            {(preview.metadataWarnings?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1">
                {preview.metadataWarnings!.map((w) => (
                  <div key={w}>• {w}</div>
                ))}
              </div>
            )}
            {(preview.errorCount ?? 0) > 0 && (
              <div className="rounded-lg border border-red-300 bg-red-50 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold text-red-900">
                    صفوف بها أخطاء — يجب إصلاحها قبل الترحيل ({issueRowsTotal || preview.errorCount})
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void handleAutoRepair()}
                    className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                    محاولة إصلاح تلقائي
                  </button>
                </div>
                <p className="text-sm text-red-800">
                  يمكنك الضغط «إصلاح تلقائي» لملء الفراغات وحل تكرار الباركود، أو صحّح الملف في Excel ثم أعد المعاينة.
                </p>
                <div className="max-h-64 overflow-y-auto rounded border border-red-200 bg-white">
                  <table className="w-full text-sm text-right">
                    <thead className="bg-red-100 text-red-900 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 font-bold">سطر Excel</th>
                        <th className="px-3 py-2 font-bold">رقم التوب</th>
                        <th className="px-3 py-2 font-bold">الباركود</th>
                        <th className="px-3 py-2 font-bold">الخطأ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issueRows.map((row) => (
                        <tr key={row.id} className="border-t border-red-100">
                          <td className="px-3 py-2 font-mono">{row.row_no}</td>
                          <td className="px-3 py-2 font-mono" dir="ltr">
                            {String(row.normalized_data?.rollNo ?? row.normalized_data?.supplierRollRef ?? '—')}
                          </td>
                          <td className="px-3 py-2 font-mono" dir="ltr">
                            {String(row.normalized_data?.barcode ?? '—')}
                          </td>
                          <td className="px-3 py-2 text-red-800">{(row.errors ?? []).join(' — ')}</td>
                        </tr>
                      ))}
                      {issueRows.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                            جاري تحميل تفاصيل الأخطاء...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {repairSummary.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1 max-h-40 overflow-y-auto">
                <div className="font-bold">ملخص الإصلاح التلقائي</div>
                {repairSummary.map((line) => (
                  <div key={line}>• {line}</div>
                ))}
              </div>
            )}
          </div>

          {step !== 'done' && (
            <div className="bg-white rounded-xl border border-indigo-200 shadow-sm p-5 space-y-4">
              <div className="flex items-center gap-2 text-indigo-900 font-bold">
                <Calculator className="w-5 h-5" />
                التسعير وتكاليف الاستيراد
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">سعر الشراء من المورد</label>
                  <input type="number" step="0.0001" min="0" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">وحدة السعر</label>
                  <select value={priceUnit} onChange={(e) => setPriceUnit(e.target.value as 'meter' | 'yard')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    <option value="meter">لكل متر</option>
                    <option value="yard">لكل ياردة</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">شحن دولي</label>
                  <input type="number" step="0.01" min="0" value={freightCost} onChange={(e) => setFreightCost(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">جمارك</label>
                  <input type="number" step="0.01" min="0" value={customsCost} onChange={(e) => setCustomsCost(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">تخليص جمركي</label>
                  <input type="number" step="0.01" min="0" value={clearanceCost} onChange={(e) => setClearanceCost(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">شحن داخلي</label>
                  <input type="number" step="0.01" min="0" value={internalShippingCost} onChange={(e) => setInternalShippingCost(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" dir="ltr" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-slate-700">أجور أخرى</label>
                  <input type="number" step="0.01" min="0" value={otherCost} onChange={(e) => setOtherCost(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" dir="ltr" />
                </div>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <div><div className="text-xs text-emerald-700">تكاليف إضافية</div><div className="font-bold font-mono">{livePricing.extras.toFixed(2)}</div></div>
                <div><div className="text-xs text-emerald-700">توزيع / متر</div><div className="font-bold font-mono">{livePricing.landingPerM.toFixed(4)}</div></div>
                <div><div className="text-xs text-emerald-700">تكلفة نهائية / متر</div><div className="font-bold font-mono text-emerald-900">{livePricing.finalUnit.toFixed(4)}</div></div>
                <div><div className="text-xs text-emerald-700">ذمة المورد</div><div className="font-bold font-mono text-emerald-900">{livePricing.supplierInvoiceTotal.toFixed(2)} {currencyCode}</div></div>
                <div><div className="text-xs text-emerald-700">قيمة المخزون</div><div className="font-bold font-mono">{livePricing.inventoryValueTotal.toFixed(2)} {currencyCode}</div></div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={loading || step === 'done'}
                  onClick={() => void handleSavePricing()}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-indigo-700 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  حفظ التسعير
                </button>
                <button
                  type="button"
                  disabled={loading || !pricingResult || (preview.errorCount ?? 0) > 0}
                  onClick={() => void handleConfirm()}
                  className="bg-emerald-700 text-white px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-emerald-800 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ship className="w-4 h-4" />}
                  حفظ وترحيل للمخزون
                </button>
              </div>
            </div>
          )}

          {step === 'done' && confirmResult && (
            <div className="bg-white rounded-xl border border-emerald-300 shadow-sm p-5 space-y-3">
              <h3 className="font-bold text-emerald-900">تم الاستيراد والترحيل بنجاح</h3>
              <p className="text-sm text-slate-700">
                فاتورة الشراء: <span className="font-mono font-bold">{confirmResult.invoiceNo ?? '—'}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {confirmResult.invoiceId && (
                  <button
                    type="button"
                    onClick={() => navigate(`/invoices/statement/${confirmResult.invoiceId}`)}
                    className="bg-white border border-slate-200 px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-50"
                  >
                    عرض الفاتورة
                  </button>
                )}
                <Link to="/invoices/purchases" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700">
                  فواتير الشراء
                </Link>
                <Link to="/inventory" className="bg-white border border-slate-200 px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-50">
                  المخزون
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
