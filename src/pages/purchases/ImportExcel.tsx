import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Upload, ArrowRight, CheckCircle2, AlertTriangle, XCircle,
  RefreshCw, ChevronDown, FileSpreadsheet, Package, Eye, Tags,
} from 'lucide-react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  previewPurchaseExcelImport, listImportRows, confirmImportBatch, cancelImportBatch,
  scanVerifyImportBatch, getImportBatch,
  type ImportPreviewSummary, type PurchaseImportRowDto, type ImportMode, type RowStatus, type PurchaseImportBatchDto,
} from '../../lib/api/purchaseImportApi';
import { formatImportNumber } from '../../lib/importNumberParse';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listWarehouses, listLocations, type ApiWarehouse, type ApiWarehouseLocation } from '../../lib/api/warehousesApi';
import { useToast } from '../../components/NonBlockingToast';

// ─── Status helpers ──────────────────────────────────────────────────────────

const ROW_STATUS_LABEL: Record<RowStatus, string> = {
  PENDING: 'جاري',
  VALID:   'صالح',
  WARNING: 'تحذير',
  ERROR:   'خطأ',
  IMPORTED:'مستورد',
  SKIPPED: 'متخطى',
};
const ROW_STATUS_COLOR: Record<RowStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  VALID:   'bg-emerald-100 text-emerald-800',
  WARNING: 'bg-amber-100 text-amber-800',
  ERROR:   'bg-rose-100 text-rose-700',
  IMPORTED:'bg-indigo-100 text-indigo-700',
  SKIPPED: 'bg-slate-100 text-slate-400',
};

const RowStatusBadge = ({ status }: { status: RowStatus }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${ROW_STATUS_COLOR[status] ?? ''}`}>
    {ROW_STATUS_LABEL[status] ?? status}
  </span>
);

// ─── Step indicator ───────────────────────────────────────────────────────────

const Steps = ({ current }: { current: 1 | 2 | 3 }) => {
  const steps = [
    { n: 1, label: 'رفع الملف' },
    { n: 2, label: 'مراجعة البيانات' },
    { n: 3, label: 'تأكيد الاستيراد' },
  ];
  return (
    <div className="flex items-center gap-0">
      {steps.map((s, i) => (
        <React.Fragment key={s.n}>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition
            ${current === s.n ? 'bg-indigo-600 text-white' :
              current > s.n ? 'bg-emerald-100 text-emerald-700' :
              'bg-slate-100 text-slate-400'}`}
          >
            {current > s.n ? <CheckCircle2 className="w-4 h-4" /> :
              <span className="w-5 h-5 rounded-full border-2 border-current flex items-center justify-center text-xs">{s.n}</span>}
            {s.label}
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 w-8 ${current > s.n + 1 ? 'bg-emerald-400' : current > s.n ? 'bg-indigo-300' : 'bg-slate-200'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

// ─── Summary card ─────────────────────────────────────────────────────────────

const SummaryCard = ({ label, value, color = 'slate' }: { label: string; value: string | number; color?: string }) => {
  const colorMap: Record<string, string> = {
    slate: 'bg-slate-50 border-slate-200 text-slate-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    rose: 'bg-rose-50 border-rose-200 text-rose-900',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-900',
  };
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] ?? colorMap.slate}`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
};

// ─── Main page ───────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

const toNumber = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const batchToPreviewSummary = (batch: PurchaseImportBatchDto): ImportPreviewSummary => {
  const extractedMetadata = batch.extracted_metadata ?? null;
  const metadataWarnings = Array.isArray(extractedMetadata?.warnings)
    ? extractedMetadata.warnings.filter((w): w is string => typeof w === 'string')
    : [];

  return {
    batchId: batch.id,
    fileName: batch.file_name,
    sheetName: batch.sheet_name ?? undefined,
    importMode: batch.import_mode,
    invoiceDate: batch.invoice_date ?? undefined,
    purchaseInvoiceNo: batch.invoice_no ?? batch.supplier_invoice_no ?? null,
    currencyCode: batch.currency_code ?? undefined,
    exchangeRateToUsd: batch.exchange_rate_to_usd ? toNumber(batch.exchange_rate_to_usd) : undefined,
    rowCount: batch.row_count,
    validCount: batch.valid_count,
    warnCount: batch.warning_count,
    errorCount: batch.error_count,
    totalLengthM: toNumber(batch.total_length_m),
    totalActualWeightKg: toNumber(batch.total_actual_weight_kg),
    totalCalculatedWeightKg: toNumber(batch.total_calculated_weight_kg),
    verificationTotal: batch.verification_total ?? 0,
    verificationVerified: batch.verification_verified ?? 0,
    detectedColumns: Array.isArray(batch.detected_columns) ? batch.detected_columns : [],
    extractedMetadata,
    metadataWarnings,
  };
};

export const ImportExcel = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const [step, setStep] = useState<Step>(1);

  // Master data
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [locations, setLocations] = useState<ApiWarehouseLocation[]>([]);

  // Step 1 form
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });
  const [purchaseInvoiceNo, setPurchaseInvoiceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [exchangeRateToUsd, setExchangeRateToUsd] = useState('');
  const [importMode, setImportMode] = useState<ImportMode>('MATCH_ONLY');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [importMessage, setImportMessage] = useState('');

  // Step 2 state
  const [preview, setPreview] = useState<ImportPreviewSummary | null>(null);
  const [rows, setRows] = useState<PurchaseImportRowDto[]>([]);
  const [rowsTotal, setRowsTotal] = useState(0);
  const [rowsPage, setRowsPage] = useState(1);
  const [rowsFilter, setRowsFilter] = useState<RowStatus | ''>('');
  const [rowsLoading, setRowsLoading] = useState(false);
  const [allowWarnings, setAllowWarnings] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Optional verification (scan barcodes before confirm)
  const [verificationMode, setVerificationMode] = useState<'NONE' | 'SCAN'>('NONE');
  const [verificationTotal, setVerificationTotal] = useState(0);
  const [verificationVerified, setVerificationVerified] = useState(0);
  const [scanValue, setScanValue] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 3 state
  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<{
    createdRolls: number; createdItems: number; createdColors: number;
    createdVariants: number; totalLengthM: number;
    totalActualWeightKg: number;
    totalCalculatedWeightKg: number;
    createdPurchaseInvoiceId?: string | null;
    purchaseInvoiceNo?: string | null;
  } | null>(null);

  const PAGE_SIZE = 50;
  const resumeBatchId = searchParams.get('batchId')?.trim() || '';

  useEffect(() => {
    Promise.all([
      listSuppliers({ pageSize: 500 }),
      listWarehouses(),
    ]).then(([sRes, whs]) => {
      setSuppliers(sRes.data);
      setWarehouses(whs);
      if (whs.length > 0 && !warehouseId) setWarehouseId(whs[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!warehouseId) { setLocations([]); setLocationId(''); return; }
    listLocations(warehouseId).then(setLocations).catch(() => setLocations([]));
    if (!resumeBatchId) setLocationId('');
  }, [warehouseId, resumeBatchId]);

  const loadRows = useCallback(async (batchId: string, page: number, filter: RowStatus | '') => {
    setRowsLoading(true);
    try {
      const res = await listImportRows(batchId, {
        status: filter || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setRows(res.data);
      setRowsTotal(res.total);
    } catch {
      // ignore
    } finally {
      setRowsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!resumeBatchId) return;
    let cancelled = false;

    const loadExistingBatch = async () => {
      setResumeLoading(true);
      setImportMessage('جاري فتح الدفعة المعلّقة...');
      try {
        const batch = await getImportBatch(resumeBatchId);
        if (cancelled) return;
        if (batch.status === 'CONFIRMED') {
          showToast({ type: 'warning', message: 'هذه الدفعة مؤكدة مسبقاً ولا تحتاج توثيق استلام.' });
          navigate('/purchases/import-batches');
          return;
        }
        if (batch.status === 'CANCELLED') {
          showToast({ type: 'error', message: 'هذه الدفعة ملغاة ولا يمكن استكمالها.' });
          navigate('/purchases/import-batches');
          return;
        }

        const summary = batchToPreviewSummary(batch);
        setSupplierId(batch.supplier_id ?? '');
        setWarehouseId(batch.warehouse_id ?? '');
        setLocationId(batch.default_location_id ?? '');
        setCurrencyCode(batch.currency_code ?? '');
        setInvoiceDate(batch.invoice_date ? String(batch.invoice_date).slice(0, 10) : invoiceDate);
        setPurchaseInvoiceNo(batch.invoice_no ?? batch.supplier_invoice_no ?? '');
        setNotes(batch.notes ?? '');
        setExchangeRateToUsd(batch.exchange_rate_to_usd ? String(batch.exchange_rate_to_usd) : '');
        setImportMode(batch.import_mode);
        setSelectedFile(null);
        setPreview(summary);
        setVerificationMode((summary.verificationTotal ?? 0) > 0 ? 'SCAN' : 'NONE');
        setVerificationTotal(summary.verificationTotal ?? 0);
        setVerificationVerified(summary.verificationVerified ?? 0);
        setScanValue('');
        setRowsPage(1);
        setRowsFilter('');
        await loadRows(batch.id, 1, '');
        if (cancelled) return;
        setStep(2);
        setTimeout(() => scanInputRef.current?.focus(), 0);
      } catch (e: unknown) {
        if (!cancelled) {
          showToast({ type: 'error', message: (e as { message?: string }).message ?? 'تعذر فتح الدفعة المعلّقة' });
          navigate('/purchases/import-batches');
        }
      } finally {
        if (!cancelled) {
          setResumeLoading(false);
          setImportMessage('');
        }
      }
    };

    void loadExistingBatch();
    return () => { cancelled = true; };
  }, [resumeBatchId, loadRows, navigate, showToast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setSelectedFile(f);
  };

  const handleUpload = async () => {
    if (!supplierId) return showToast({ type: 'error', message: 'يرجى اختيار المورد' });
    if (!warehouseId) return showToast({ type: 'error', message: 'يرجى اختيار المستودع' });
    if (!invoiceDate) return showToast({ type: 'error', message: 'يرجى تحديد تاريخ الفاتورة' });
    if (!selectedFile) return showToast({ type: 'error', message: 'يرجى اختيار ملف Excel' });
    const ccy = currencyCode.trim().toUpperCase();
    if (ccy && ccy.length !== 3) return showToast({ type: 'error', message: 'رمز العملة غير صالح' });
    if (exchangeRateToUsd.trim()) {
      const v = Number(exchangeRateToUsd);
      if (!Number.isFinite(v) || v <= 0) return showToast({ type: 'error', message: 'سعر الصرف غير صالح' });
    }
    setUploading(true);
    setImportMessage('جارٍ قراءة ملف Excel...');
    try {
      window.setTimeout(() => setImportMessage((msg) => msg || 'جارٍ تحليل الصفوف...'), 300);
      const result = await previewPurchaseExcelImport(selectedFile, {
        supplierId,
        warehouseId,
        defaultLocationId: locationId || null,
        currencyCode: ccy || null,
        invoiceDate,
        purchaseInvoiceNo: purchaseInvoiceNo.trim() || null,
        notes: notes.trim() || null,
        exchangeRateToUsd: exchangeRateToUsd.trim() ? Number(exchangeRateToUsd) : null,
        importMode,
      });
      setPreview(result);
      setVerificationMode('NONE');
      setVerificationTotal(result.verificationTotal ?? 0);
      setVerificationVerified(result.verificationVerified ?? 0);
      setScanValue('');
      await loadRows(result.batchId, 1, '');
      setRowsPage(1);
      setRowsFilter('');
      setStep(2);
      setImportMessage('');
      showToast({ type: 'success', message: 'تم تحميل الملف بنجاح' });
    } catch (e: unknown) {
      showToast({ type: 'error', message: (e as { message?: string }).message ?? 'تعذر استيراد ملف Excel' });
    } finally {
      setImportMessage('');
      setUploading(false);
    }
  };

  const handleFilterChange = async (f: RowStatus | '') => {
    if (!preview) return;
    setRowsFilter(f);
    setRowsPage(1);
    await loadRows(preview.batchId, 1, f);
  };

  const handlePageChange = async (p: number) => {
    if (!preview) return;
    setRowsPage(p);
    await loadRows(preview.batchId, p, rowsFilter);
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setConfirming(true);
    setImportMessage('جارٍ تأكيد الاستيراد وإنشاء الأتواب في المخزون...');
    try {
      const result = await confirmImportBatch(preview.batchId, { allowWarnings });
      setConfirmResult(result);
      setStep(3);
      setImportMessage('');
      showToast({ type: 'success', message: 'تم استيراد فاتورة الشراء بنجاح' });
    } catch (e: unknown) {
      showToast({ type: 'error', message: (e as { message?: string }).message ?? 'تعذر تأكيد الاستيراد' });
    } finally {
      setImportMessage('');
      setConfirming(false);
    }
  };

  const runScanVerify = useCallback(async (barcodeRaw: string) => {
    if (!preview) return;
    const barcode = barcodeRaw.trim();
    if (!barcode) return;
    setScanBusy(true);
    try {
      const res = await scanVerifyImportBatch(preview.batchId, barcode);
      setVerificationTotal(res.verificationTotal);
      setVerificationVerified(res.verificationVerified);
      if (res.didVerify) {
        showToast({ type: 'success', message: `تم توثيق الباركود: ${res.barcode}` });
      } else {
        showToast({ type: 'warning', message: `هذا الباركود موثَّق مسبقاً: ${res.barcode}` });
      }
    } catch (e: unknown) {
      showToast({ type: 'error', message: (e as { message?: string }).message ?? 'تعذر توثيق الباركود' });
    } finally {
      setScanBusy(false);
      setScanValue('');
      scanInputRef.current?.focus();
    }
  }, [preview, showToast]);

  const onScanValueChange = (v: string) => {
    setScanValue(v);
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    scanTimerRef.current = setTimeout(() => {
      void runScanVerify(v);
    }, 150);
  };

  const handleCancel = async () => {
    if (!preview) return;
    try {
      await cancelImportBatch(preview.batchId);
    } catch {
      // ignore
    }
    setPreview(null);
    setRows([]);
    setVerificationMode('NONE');
    setVerificationTotal(0);
    setVerificationVerified(0);
    setScanValue('');
    setStep(1);
  };

  const inputCls = 'w-full p-2.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm';
  const totalPages = Math.ceil(rowsTotal / PAGE_SIZE);

  return (
    <div className="max-w-7xl mx-auto space-y-6" dir="rtl">
      {resumeLoading && (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-xl px-4 py-3 text-sm font-bold flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          جاري فتح فاتورة الشراء المعلّقة...
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">استيراد فاتورة شراء من Excel</h2>
            <p className="text-slate-500 mt-1">رفع، مراجعة، وتأكيد — الأتواب تُضاف لـ PostgreSQL فقط بعد التأكيد</p>
          </div>
        </div>
        <Link to="/purchases/import-batches" className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition text-sm font-medium">
          <FileSpreadsheet className="w-4 h-4" />
          سجل الاستيرادات
        </Link>
      </div>

      {/* Step indicator */}
      <div className="flex justify-center">
        <Steps current={step} />
      </div>

      {/* ── STEP 1: Upload ─────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 bg-slate-50 border-b border-slate-200">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Upload className="w-5 h-5 text-indigo-600" />
              إعدادات الاستيراد
            </h3>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">المورد <span className="text-rose-500">*</span></label>
              <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className={inputCls}>
                <option value="">— اختر المورد —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">المستودع <span className="text-rose-500">*</span></label>
              <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={inputCls}>
                <option value="">— اختر المستودع —</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">الموقع الافتراضي</label>
              <select value={locationId} onChange={e => setLocationId(e.target.value)} className={inputCls}>
                <option value="">— بدون موقع —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">تاريخ الفاتورة <span className="text-rose-500">*</span></label>
              <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className={inputCls} dir="ltr" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">رقم فاتورة الشراء</label>
              <input type="text" value={purchaseInvoiceNo} onChange={e => setPurchaseInvoiceNo(e.target.value)} placeholder="اختياري (سيتم توليد رقم تلقائياً إذا تركته فارغاً)" className={inputCls} dir="ltr" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">العملة</label>
              <input type="text" value={currencyCode} onChange={e => setCurrencyCode(e.target.value.toUpperCase())} placeholder="USD / EUR / TRY" maxLength={3} className={inputCls} dir="ltr" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">سعر الصرف مقابل الدولار</label>
              <input type="number" value={exchangeRateToUsd} onChange={e => setExchangeRateToUsd(e.target.value)} placeholder="اختياري (يُستخدم عند العملة غير USD)" className={inputCls} dir="ltr" step="0.000001" min="0" />
            </div>

            <div className="space-y-1.5 col-span-full md:col-span-2">
              <label className="text-sm font-bold text-slate-700">ملاحظات</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="اختياري" className={inputCls} />
            </div>

            <div className="space-y-1.5 col-span-full md:col-span-2">
              <label className="text-sm font-bold text-slate-700">وضع الاستيراد</label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ['MATCH_ONLY', 'مطابقة فقط', 'استيراد الخامات الموجودة فقط — رفض الجديدة'],
                  ['CREATE_MISSING_MASTER_DATA', 'إنشاء التعريفات الناقصة', 'إنشاء الخامات والألوان الجديدة تلقائياً'],
                ] as const).map(([val, label, desc]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setImportMode(val)}
                    className={`p-4 rounded-xl border-2 text-right transition ${importMode === val
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-slate-200 hover:border-slate-300'}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`w-4 h-4 rounded-full border-2 ${importMode === val ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300'}`} />
                    </div>
                    <p className="font-bold text-sm text-slate-800">{label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="col-span-full space-y-1.5">
              <label className="text-sm font-bold text-slate-700">ملف Excel <span className="text-rose-500">*</span></label>
              <div className={`relative border-2 border-dashed rounded-xl p-8 text-center transition cursor-pointer
                ${selectedFile ? 'border-emerald-300 bg-emerald-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/30'}`}
                onClick={() => document.getElementById('excel-file-input')?.click()}
              >
                <input id="excel-file-input" type="file" accept=".xlsx,.xls" onChange={handleFileChange} className="hidden" />
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileSpreadsheet className="w-8 h-8 text-emerald-600" />
                    <div className="text-right">
                      <p className="font-bold text-emerald-800">{selectedFile.name}</p>
                      <p className="text-sm text-emerald-600">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="font-bold text-slate-600">اضغط لاختيار ملف Excel</p>
                    <p className="text-sm text-slate-400 mt-1">.xlsx أو .xls — الحد الأقصى 5000 صف</p>
                  </>
                )}
              </div>
            </div>

            <div className="col-span-full flex justify-end">
              <button
                onClick={handleUpload}
                disabled={resumeLoading || uploading || !selectedFile || !warehouseId || !supplierId || !invoiceDate}
                className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition disabled:opacity-50 text-sm"
              >
                {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? 'جاري التحليل...' : 'رفع وتحليل الملف'}
              </button>
              {importMessage && (
                <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                  {importMessage}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: Preview ────────────────────────────────────────────────── */}
      {step === 2 && preview && (
        <div className="space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <SummaryCard label="إجمالي الصفوف" value={preview.rowCount} color="slate" />
            <SummaryCard label="صالح" value={preview.validCount} color="emerald" />
            <SummaryCard label="تحذيرات" value={preview.warnCount} color="amber" />
            <SummaryCard label="أخطاء" value={preview.errorCount} color="rose" />
            <SummaryCard label="إجمالي الأمتار" value={preview.totalLengthM.toFixed(2)} color="indigo" />
            {!!preview.totalLengthYard && (
              <SummaryCard label="إجمالي اليارد" value={preview.totalLengthYard.toFixed(2)} color="indigo" />
            )}
            {!!preview.distinctMaterialsCount && (
              <SummaryCard label="عدد الخامات" value={preview.distinctMaterialsCount} color="slate" />
            )}
            {!!preview.subtotalAmount && preview.subtotalAmount > 0 && (
              <SummaryCard label="إجمالي التكلفة" value={preview.subtotalAmount.toFixed(2)} color="slate" />
            )}
            <SummaryCard label="وزن فعلي (كجم)" value={preview.totalActualWeightKg.toFixed(2)} color="indigo" />
            <SummaryCard label="وزن محسوب (كجم)" value={preview.totalCalculatedWeightKg.toFixed(2)} color="slate" />
          </div>

          {/* Detected columns */}
          {preview.detectedColumns.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <p className="text-sm font-bold text-indigo-700 mb-2">الأعمدة المكتشفة تلقائياً:</p>
              <div className="flex flex-wrap gap-2">
                {preview.detectedColumns.map(c => (
                  <span key={c.col} className="bg-white border border-indigo-200 rounded px-2 py-1 text-xs text-indigo-700">
                    <span className="font-mono">{c.col}</span> ← {c.field}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Row filter tabs */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 flex items-center justify-between px-4">
              <div className="flex">
                {([
                  ['', 'الكل'],
                  ['VALID', 'صالح'],
                  ['WARNING', 'تحذيرات'],
                  ['ERROR', 'أخطاء'],
                ] as [RowStatus | '', string][]).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => handleFilterChange(val)}
                    className={`px-4 py-3 text-sm font-bold border-b-2 transition
                      ${rowsFilter === val
                        ? 'border-indigo-600 text-indigo-700'
                        : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                  >
                    {label}
                    {val === '' && <span className="mr-1.5 bg-slate-100 text-slate-600 text-xs rounded-full px-2">{preview.rowCount}</span>}
                    {val === 'VALID' && <span className="mr-1.5 bg-emerald-100 text-emerald-700 text-xs rounded-full px-2">{preview.validCount}</span>}
                    {val === 'WARNING' && <span className="mr-1.5 bg-amber-100 text-amber-700 text-xs rounded-full px-2">{preview.warnCount}</span>}
                    {val === 'ERROR' && <span className="mr-1.5 bg-rose-100 text-rose-700 text-xs rounded-full px-2">{preview.errorCount}</span>}
                  </button>
                ))}
              </div>
              {rowsLoading && <RefreshCw className="w-4 h-4 text-slate-400 animate-spin" />}
            </div>

            {/* Dense rows table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-right py-2 px-3 font-bold text-slate-500 whitespace-nowrap">#</th>
                    <th className="text-right py-2 px-3 font-bold text-slate-500">الحالة</th>
                    <th className="text-right py-2 px-3 font-bold text-slate-500">الخامة</th>
                    <th className="text-right py-2 px-3 font-bold text-slate-500 whitespace-nowrap">كود الخامة</th>
                    <th className="text-right py-2 px-3 font-bold text-slate-500">اللون</th>
                    <th className="text-right py-2 px-3 font-bold text-slate-500 whitespace-nowrap">رقم الثوب</th>
                    <th className="text-right py-2 px-3 font-bold text-slate-500">الباركود</th>
                    <th className="text-right py-2 px-3 font-bold text-slate-500 whitespace-nowrap">طول (م)</th>
                    <th className="text-right py-2 px-3 font-bold text-slate-500 whitespace-nowrap">عرض (سم)</th>
                    <th className="text-right py-2 px-3 font-bold text-slate-500">GSM</th>
                    <th className="text-right py-2 px-3 font-bold text-slate-500 whitespace-nowrap">وزن فعلي</th>
                    <th className="text-right py-2 px-3 font-bold text-slate-500 whitespace-nowrap">تحذيرات / أخطاء</th>
                    <th className="text-right py-2 px-3 font-bold text-slate-500"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const nd = row.normalized_data as Record<string, unknown>;
                    const isExpanded = expandedRow === row.id;
                    return (
                      <React.Fragment key={row.id}>
                        <tr className={`border-b border-slate-100 hover:bg-slate-50/50 transition ${
                          row.status === 'ERROR' ? 'bg-rose-50/30' :
                          row.status === 'WARNING' ? 'bg-amber-50/20' : ''
                        }`}>
                          <td className="py-2 px-3 text-slate-400">{row.row_no}</td>
                          <td className="py-2 px-3"><RowStatusBadge status={row.status} /></td>
                          <td className="py-2 px-3 font-medium text-slate-800">
                            {row.item_name ?? String(nd.materialName ?? '—')}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-700">
                            {String(nd.internalMaterialCode ?? nd.supplierMaterialCode ?? '—')}
                          </td>
                          <td className="py-2 px-3 text-slate-600">
                            {row.color_name_ar ?? String(nd.colorName ?? nd.colorNameTr ?? '—')}
                            {row.color_code && <span className="mr-1 font-mono text-slate-400">({row.color_code})</span>}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-500">{String(nd.rollNo ?? '—')}</td>
                          <td className="py-2 px-3 font-mono text-slate-600">
                            {nd.barcode != null && String(nd.barcode).trim() !== ''
                              ? String(nd.barcode)
                              : <em className="text-amber-600">تلقائي</em>}
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-slate-800">{formatImportNumber(nd.lengthM)}</td>
                          <td className="py-2 px-3 font-mono text-slate-600">{formatImportNumber(nd.widthCm, 1)}</td>
                          <td className="py-2 px-3 font-mono text-slate-600">{nd.gsm != null ? formatImportNumber(nd.gsm, 0) : '—'}</td>
                          <td className="py-2 px-3 font-mono text-slate-600">
                            {nd.actualWeightKg != null ? `${formatImportNumber(nd.actualWeightKg)} kg` : '—'}
                          </td>
                          <td className="py-2 px-3 max-w-xs">
                            {row.errors.map((e, i) => (
                              <div key={i} className="flex items-center gap-1 text-rose-600 text-xs">
                                <XCircle className="w-3 h-3 shrink-0" /> {e}
                              </div>
                            ))}
                            {row.warnings.slice(0, 2).map((w, i) => (
                              <div key={i} className="flex items-center gap-1 text-amber-600 text-xs">
                                <AlertTriangle className="w-3 h-3 shrink-0" /> {w}
                              </div>
                            ))}
                            {row.warnings.length > 2 && (
                              <p className="text-amber-500 text-xs">+{row.warnings.length - 2} تحذير</p>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <button
                              onClick={() => setExpandedRow(isExpanded ? null : row.id)}
                              className="p-1 rounded hover:bg-slate-100 text-slate-400"
                            >
                              <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <td colSpan={13} className="py-3 px-6">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs">
                                {Object.entries(nd).filter(([,v]) => v !== null && v !== undefined && String(v).trim() !== '').map(([k,v]) => (
                                  <div key={k} className="flex gap-2">
                                    <span className="text-slate-400 shrink-0">{k}:</span>
                                    <span className="font-medium text-slate-700">{String(v)}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {rows.length === 0 && !rowsLoading && (
                    <tr>
                      <td colSpan={12} className="py-8 text-center text-slate-400 text-sm">لا توجد صفوف</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="p-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                <span>إجمالي: {rowsTotal} صف</span>
                <div className="flex gap-1">
                  <button onClick={() => handlePageChange(rowsPage - 1)} disabled={rowsPage <= 1} className="px-2 py-1 border rounded hover:bg-slate-50 disabled:opacity-40">السابق</button>
                  <span className="px-2 py-1 bg-indigo-50 text-indigo-700 font-bold rounded">{rowsPage}/{totalPages}</span>
                  <button onClick={() => handlePageChange(rowsPage + 1)} disabled={rowsPage >= totalPages} className="px-2 py-1 border rounded hover:bg-slate-50 disabled:opacity-40">التالي</button>
                </div>
              </div>
            )}
          </div>

          {/* Confirm/cancel actions */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            {verificationTotal > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-800">توثيق الفاتورة بالمسح (اختياري)</p>
                    <p className="text-xs text-slate-500 mt-0.5">امسح باركود كل ثوب لتوثيق الاستلام قبل التأكيد</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">التوثيق:</span>
                    <span className="px-3 py-1 rounded-lg bg-white border border-slate-200 font-mono text-slate-800">
                      {verificationTotal}/{verificationVerified}
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => { setVerificationMode('SCAN'); setTimeout(() => scanInputRef.current?.focus(), 0); }}
                    className={`p-3 rounded-xl border-2 text-right transition ${
                      verificationMode === 'SCAN' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <p className="font-bold text-sm text-slate-800">توثيق بالمسح</p>
                    <p className="text-xs text-slate-500 mt-0.5">يتطلب مسح الباركود قبل التأكيد (مع إمكانية التأكيد على أي حال)</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVerificationMode('NONE')}
                    className={`p-3 rounded-xl border-2 text-right transition ${
                      verificationMode === 'NONE' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <p className="font-bold text-sm text-slate-800">تأكيد على أي حال</p>
                    <p className="text-xs text-slate-500 mt-0.5">استيراد بدون توثيق بالمسح</p>
                  </button>
                </div>

                {verificationMode === 'SCAN' && (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <input
                      ref={scanInputRef}
                      value={scanValue}
                      onChange={e => onScanValueChange(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
                          void runScanVerify(scanValue);
                        }
                      }}
                      placeholder="امسح الباركود هنا..."
                      className="w-full md:w-96 p-2.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono"
                      dir="ltr"
                      inputMode="numeric"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      disabled={scanBusy}
                      onClick={() => { if (scanTimerRef.current) clearTimeout(scanTimerRef.current); void runScanVerify(scanValue); }}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 transition disabled:opacity-50"
                    >
                      {scanBusy ? 'جاري التوثيق...' : 'توثيق'}
                    </button>
                    <button
                      type="button"
                      onClick={() => scanInputRef.current?.focus()}
                      className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition text-sm font-medium"
                    >
                      تركيز خانة المسح
                    </button>
                  </div>
                )}
              </div>
            )}

            {preview.errorCount > 0 && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 mb-4 flex items-center gap-3 text-rose-700">
                <XCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm font-bold">يوجد {preview.errorCount} صف بها أخطاء. يجب إصلاح الملف قبل التأكيد.</p>
              </div>
            )}

            {preview.warnCount > 0 && preview.errorCount === 0 && (
              <label className="flex items-center gap-3 cursor-pointer mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <input
                  type="checkbox"
                  checked={allowWarnings}
                  onChange={e => setAllowWarnings(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-600"
                />
                <p className="text-sm font-bold text-amber-800">
                  أوافق على استيراد الصفوف التي تحتوي تحذيرات ({preview.warnCount} صف)
                </p>
              </label>
            )}

            <div className="flex items-center justify-between flex-wrap gap-3">
              <button onClick={handleCancel} className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition text-sm font-medium">
                إلغاء الدفعة
              </button>
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition text-sm">
                  رجوع
                </button>
                <Link
                  to="/purchases/import-batches"
                  className="px-5 py-2.5 rounded-xl font-bold border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 transition text-sm"
                >
                  حفظ كمعلّقة حتى الاستلام
                </Link>
                <button
                  onClick={handleConfirm}
                  disabled={
                    confirming ||
                    preview.errorCount > 0 ||
                    (preview.warnCount > 0 && !allowWarnings && preview.validCount === 0) ||
                    (verificationMode === 'SCAN' && verificationTotal > 0 && verificationVerified < verificationTotal)
                  }
                  className="bg-emerald-600 text-white px-8 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-emerald-700 transition disabled:opacity-50 text-sm"
                >
                  {confirming ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {confirming ? 'جاري الاستيراد...' : (verificationMode === 'SCAN'
                    ? 'تأكيد بعد اكتمال التوثيق'
                    : `تأكيد استيراد ${preview.validCount + (allowWarnings ? preview.warnCount : 0)} ثوب`)}
                </button>
                {importMessage && (
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                    {importMessage}
                  </span>
                )}
                {verificationMode === 'SCAN' && verificationTotal > 0 && verificationVerified < verificationTotal && (
                  <button
                    onClick={handleConfirm}
                    disabled={confirming || preview.errorCount > 0 || (preview.warnCount > 0 && !allowWarnings && preview.validCount === 0)}
                    className="px-5 py-2.5 rounded-xl font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition disabled:opacity-50 text-sm"
                  >
                    تأكيد على أي حال
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 3: Result ─────────────────────────────────────────────────── */}
      {step === 3 && confirmResult && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-8 text-center border-b border-slate-100">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="text-2xl font-bold text-slate-900 mb-2">تم الاستيراد بنجاح!</h3>
            <p className="text-slate-500">تم إضافة الأتواب إلى مخزون PostgreSQL</p>
          </div>
          <div className="p-6 grid grid-cols-2 md:grid-cols-5 gap-4">
            <SummaryCard label="أتواب مُنشأة" value={confirmResult.createdRolls} color="emerald" />
            <SummaryCard label="إجمالي الأمتار" value={confirmResult.totalLengthM.toFixed(2)} color="indigo" />
            <SummaryCard label="وزن إجمالي (كجم)" value={confirmResult.totalActualWeightKg.toFixed(2)} color="indigo" />
            <SummaryCard label="خامات جديدة" value={confirmResult.createdItems} color={confirmResult.createdItems > 0 ? 'amber' : 'slate'} />
            <SummaryCard label="ألوان جديدة" value={confirmResult.createdColors} color={confirmResult.createdColors > 0 ? 'amber' : 'slate'} />
          </div>
          <div className="p-6 border-t border-slate-100 flex justify-center gap-4 flex-wrap">
            <Link
              to="/inventory"
              className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition"
            >
              <Package className="w-5 h-5" />
              عرض المخزون
            </Link>
            {!!confirmResult.createdPurchaseInvoiceId && (
              <Link
                to={`/invoices/statement/${confirmResult.createdPurchaseInvoiceId}`}
                className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-6 py-3 rounded-xl font-bold hover:bg-slate-50 transition"
              >
                <Eye className="w-5 h-5" />
                عرض فاتورة الشراء
              </Link>
            )}
            <Link
              to="/purchases/import-batches"
              className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-6 py-3 rounded-xl font-bold hover:bg-slate-50 transition"
            >
              <Eye className="w-5 h-5" />
              سجل الاستيرادات
            </Link>
            {preview && (
              <Link
                to={`/inventory/labels?batchId=${preview.batchId}`}
                className="flex items-center gap-2 bg-amber-500 text-white px-6 py-3 rounded-xl font-bold hover:bg-amber-600 transition"
              >
                <Tags className="w-5 h-5" />
                طباعة لصاقات الدفعة
              </Link>
            )}
            <button
              onClick={() => { setStep(1); setPreview(null); setRows([]); setSelectedFile(null); setConfirmResult(null); }}
              className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-6 py-3 rounded-xl font-bold hover:bg-slate-50 transition"
            >
              <Upload className="w-5 h-5" />
              استيراد ملف جديد
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
