import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, FileUp, Loader2, Save, Ship, Calculator } from 'lucide-react';
import { useToast } from '../../components/NonBlockingToast';
import { ApiRequestError } from '../../lib/api/client';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import {
  confirmImportBatch,
  previewPurchaseExcelImport,
  saveImportPricing,
  type ImportPreviewSummary,
  type ImportPricingResult,
} from '../../lib/api/purchaseImportApi';

type Step = 'setup' | 'preview' | 'pricing' | 'done';

const todayIso = () => new Date().toISOString().slice(0, 10);

export const ImportExcel = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
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
    const invoiceTotal = finalUnit * totalM;
    return { basePerM, extras, landingPerM, finalUnit, invoiceTotal, totalM };
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
      });
      setPreview(summary);
      setStep('preview');
      if (summary.warnCount > 0 || (summary.metadataWarnings?.length ?? 0) > 0) {
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

  const handleConfirm = async () => {
    if (!preview?.batchId) return;
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
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر تأكيد الاستيراد',
      });
    } finally {
      setLoading(false);
    }
  };

  const meta = preview?.extractedMetadata;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/purchases" className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
          <ArrowRight className="w-5 h-5" />
        </Link>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">استيراد فاتورة شراء من Excel</h2>
          <p className="text-slate-500 mt-1 text-sm">
            قوائم التعبئة الصينية (DETAILED PACKING LIST) — معاينة، تسعير، تكاليف شحن وجمارك، ثم ترحيل للمخزون
          </p>
        </div>
      </div>

      {step === 'setup' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-bold text-slate-700">ملف Excel</label>
              <input
                type="file"
                accept=".xls,.xlsx,.csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm"
              />
              {file && <div className="text-xs text-slate-500">{file.name}</div>}
            </div>
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
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
            <h3 className="font-bold text-slate-900">ملخص التحليل — {preview.fileName}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">الخامة</div><div className="font-bold">{meta?.materialName ?? '—'}</div></div>
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

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><div className="text-xs text-emerald-700">تكاليف إضافية</div><div className="font-bold font-mono">{livePricing.extras.toFixed(2)}</div></div>
                <div><div className="text-xs text-emerald-700">توزيع / متر</div><div className="font-bold font-mono">{livePricing.landingPerM.toFixed(4)}</div></div>
                <div><div className="text-xs text-emerald-700">تكلفة نهائية / متر</div><div className="font-bold font-mono text-emerald-900">{livePricing.finalUnit.toFixed(4)}</div></div>
                <div><div className="text-xs text-emerald-700">إجمالي الفاتورة</div><div className="font-bold font-mono text-emerald-900">{livePricing.invoiceTotal.toFixed(2)} {currencyCode}</div></div>
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
                  disabled={loading || !pricingResult}
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
                <Link to="/purchases" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700">
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
