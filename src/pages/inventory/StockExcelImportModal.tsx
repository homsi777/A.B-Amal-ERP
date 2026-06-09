import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, FileSpreadsheet, Loader2, AlertTriangle,
  Package, Palette, Ruler, Hash, ListChecks,
  ChevronDown, ChevronUp, Search, Layers,
  Warehouse, CheckCircle2,
} from 'lucide-react';
import {
  isSupplierPurchaseInvoiceHeaders,
  parseStockWorkbook,
  pickDefaultSheet,
  stockRowColorLabel,
  STOCK_SHEET_KIND_LABEL,
  type StockSheetPreview,
  type StockWorkbookPreview,
} from '../../lib/stockExcelImport';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import {
  getStockImportStatus,
  startStockImport,
  type StockImportResult,
  type StockImportRow,
} from '../../lib/api/stockImportApi';
import { ApiRequestError, getApiBaseUrl } from '../../lib/api/client';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number, digits = 2): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtInt = (n: number): string => n.toLocaleString('en-US');
const fmtBytes = (size: number): string => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
};

function emptyImportResult(): StockImportResult {
  return {
    warehouseId: '',
    warehouseName: '',
    supplierId: null,
    supplierName: null,
    purchaseInvoiceNo: null,
    batchTag: '',
    totalRows: 0,
    createdRolls: 0,
    createdItems: 0,
    createdColors: 0,
    createdCategories: 0,
    skippedRows: 0,
    clampedValues: 0,
    errorCount: 0,
    errors: [],
    elapsedMs: 0,
  };
}

async function waitForApiLive(timeoutMs = 45_000): Promise<boolean> {
  const base = getApiBaseUrl();
  if (!base) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health/live`, {
        method: 'GET',
        signal: AbortSignal.timeout(2500),
      });
      if (response.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  return false;
}

async function recoverLocalApiForImport(): Promise<boolean> {
  if (await waitForApiLive(2500)) return true;
  const bridge = typeof window !== 'undefined' ? window.fabricApp : undefined;
  if (!bridge?.retryDeliveryTunnel) return false;
  const restarted = await bridge.retryDeliveryTunnel();
  if (!restarted?.ok) return false;
  return waitForApiLive(45_000);
}

// ─── Stat card ───────────────────────────────────────────────────────────────

const Stat = ({
  icon, label, value, hint, accent = 'indigo',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'sky' | 'violet';
}) => {
  const palette: Record<string, string> = {
    indigo:  'bg-indigo-50 text-indigo-600 ring-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    amber:   'bg-amber-50 text-amber-600 ring-amber-100',
    rose:    'bg-rose-50 text-rose-600 ring-rose-100',
    sky:     'bg-sky-50 text-sky-600 ring-sky-100',
    violet:  'bg-violet-50 text-violet-600 ring-violet-100',
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
      <div className={`w-11 h-11 rounded-xl ring-1 flex items-center justify-center ${palette[accent]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        <p className="text-lg font-extrabold text-slate-900 leading-snug">{value}</p>
        {hint && <p className="text-[11px] text-slate-400 truncate">{hint}</p>}
      </div>
    </div>
  );
};

// ─── Section wrapper ─────────────────────────────────────────────────────────

const Section = ({
  title, count, children, defaultOpen = true,
}: {
  title: string;
  count?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition border-b border-slate-100"
      >
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800">{title}</span>
          {count && <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{count}</span>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
};

// ─── Modal ───────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional callback fired after a successful import so the parent can refresh. */
  onImported?: (result: StockImportResult) => void;
}

export const StockExcelImportModal: React.FC<Props> = ({ open, onClose, onImported }) => {
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<StockWorkbookPreview | null>(null);
  const [activeSheet, setActiveSheet] = useState<StockSheetPreview | null>(null);
  const [rowSearch, setRowSearch] = useState('');
  const [maxRows, setMaxRows] = useState(50);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Warehouse selection — defaults to "auto" which lets the backend pick MAIN.
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [whLoading, setWhLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [supLoading, setSupLoading] = useState(false);
  const [ignorePrices, setIgnorePrices] = useState(true);
  const [sourceType, setSourceType] = useState<'OPENING_STOCK' | 'DIRECT_STOCK_IMPORT' | 'PURCHASE_INVOICE'>('OPENING_STOCK');

  // Import flow state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<StockImportResult | null>(null);
  const [importError, setImportError] = useState('');
  const [importProgress, setImportProgress] = useState<{
    currentChunk: number;
    totalChunks: number;
    processedRows: number;
    totalRows: number;
  } | null>(null);

  const reset = useCallback(() => {
    setError('');
    setPreview(null);
    setActiveSheet(null);
    setRowSearch('');
    setMaxRows(50);
    setImportResult(null);
    setImportError('');
    setImportProgress(null);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  // Load warehouses lazily when modal opens.
  useEffect(() => {
    if (!open || warehouses.length > 0) return;
    let cancelled = false;
    setWhLoading(true);
    listWarehouses({ status: 'active' })
      .then((rows) => {
        if (cancelled) return;
        setWarehouses(rows);
        const main = rows.find((w) => w.code === 'MAIN') ?? rows[0];
        if (main) setSelectedWarehouseId(main.id);
      })
      .catch(() => { /* keep auto-mode if listing fails */ })
      .finally(() => { if (!cancelled) setWhLoading(false); });
    return () => { cancelled = true; };
  }, [open, warehouses.length]);

  useEffect(() => {
    if (!open || suppliers.length > 0) return;
    let cancelled = false;
    setSupLoading(true);
    listSuppliers({ status: 'active', pageSize: 500 })
      .then((result) => {
        if (cancelled) return;
        setSuppliers(result.data);
      })
      .catch(() => { /* import can continue without supplier selection */ })
      .finally(() => { if (!cancelled) setSupLoading(false); });
    return () => { cancelled = true; };
  }, [open, suppliers.length]);

  const handleClose = useCallback(() => {
    if (parsing) return;
    reset();
    onClose();
  }, [onClose, parsing, reset]);

  const handleFile = useCallback(async (file: File) => {
    setParsing(true);
    setError('');
    setPreview(null);
    setActiveSheet(null);
    try {
      const result = await parseStockWorkbook(file);
      setPreview(result);
      setActiveSheet(pickDefaultSheet(result));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'تعذر قراءة ملف Excel';
      setError(msg);
    } finally {
      setParsing(false);
    }
  }, []);

  const onPick = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && /\.xlsx?$/i.test(file.name)) handleFile(file);
  }, [handleFile]);

  const filteredRows = useMemo(() => {
    if (!activeSheet) return [];
    const q = rowSearch.trim().toLowerCase();
    if (!q) return activeSheet.rows;
    return activeSheet.rows.filter((r) =>
      [r.itemName, r.itemCode, r.colorName, r.colorNameTr, r.colorCode, r.unit, r.date ?? '']
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [activeSheet, rowSearch]);

  /**
   * Rows that will actually be imported. The customer requirement is to
   * import every row that has at least an `itemName` — quantity, price,
   * weight, and color may be missing without skipping the row.
   */
  const importableRows = useMemo<StockImportRow[]>(() => {
    if (!activeSheet) return [];
    return activeSheet.rows
      .filter((r) => Boolean(r.itemName))
      .map((r) => ({
        itemName:          r.itemName,
        itemCode:          r.itemCode,
        barcode:           r.barcode,
        colorName:         r.colorName,
        colorNameTr:       r.colorNameTr,
        colorCode:         r.colorCode,
        unit:              r.unit,
        quantity:          Number(r.quantity) || 0,
        price:             ignorePrices ? 0 : (Number(r.price) || 0),
        costPrice:         ignorePrices ? 0 : (Number(r.costPrice || r.price) || 0),
        widthCm:           Number(r.widthCm) || 0,
        gsm:               Number(r.gsm) || 0,
        actualWeightKg:    Number(r.actualWeightKg) || 0,
        date:              r.date ?? '',
        purchaseInvoiceNo: '',
      }));
  }, [activeSheet, ignorePrices]);

  const importAllowed = Boolean(
    activeSheet &&
    importableRows.length > 0 &&
    (
      activeSheet.kind === 'incoming' ||
      isSupplierPurchaseInvoiceHeaders(activeSheet.rawHeaders)
    ),
  );

  const readImportStatus = useCallback(async (batchId: string): Promise<StockImportResult> => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await getStockImportStatus(batchId);
      } catch (error) {
        const recoverable =
          error instanceof ApiRequestError &&
          error.statusCode === 0 &&
          (error.body?.code === 'TIMEOUT' || error.body?.code === 'NETWORK');
        if (!recoverable || attempt === 3) throw error;
        setImportError('تأخر تحديث حالة الاستيراد. أحاول إعادة الاتصال بالخادم ومتابعة العملية دون فقدان الدفعة...');
        await recoverLocalApiForImport();
        await new Promise((resolve) => window.setTimeout(resolve, 1200 * attempt));
      }
    }
    throw new Error('تعذر قراءة حالة الاستيراد');
  }, []);

  const handleConfirmImport = useCallback(async () => {
    const canImportSheet = Boolean(
      activeSheet &&
      (activeSheet.kind === 'incoming' || isSupplierPurchaseInvoiceHeaders(activeSheet.rawHeaders)),
    );
    if (!canImportSheet || importableRows.length === 0 || importing) return;
    setImporting(true);
    setImportError('');
    setImportResult(null);
    setImportProgress(null);
    try {
      const payload = {
        warehouseId: selectedWarehouseId || undefined,
        supplierId: selectedSupplierId || undefined,
        sourceType,
        fileName: preview?.fileName,
        sheetName: activeSheet.sheetName,
        detectedColumns: activeSheet.rawHeaders.map((col, colIndex) => ({ col, colIndex })),
        extractedMetadata: { headerRowIndex: activeSheet.headerRowIndex, sheetKind: activeSheet.kind },
        sourceLabel: (preview ? `${preview.fileName} · ${activeSheet.sheetName}` : activeSheet.sheetName).slice(0, 110),
        rows: importableRows,
      } satisfies {
        warehouseId?: string;
        supplierId?: string;
        sourceType: 'OPENING_STOCK' | 'DIRECT_STOCK_IMPORT' | 'PURCHASE_INVOICE';
        fileName?: string;
        sheetName?: string;
        detectedColumns?: Array<Record<string, unknown>>;
        extractedMetadata?: Record<string, unknown>;
        sourceLabel: string;
        rows: StockImportRow[];
      };

      setImportProgress({
        currentChunk: 0,
        totalChunks: 1,
        processedRows: 0,
        totalRows: importableRows.length,
      });
      setImportError('جاري رفع ملف الاستيراد وبدء المعالجة في الخلفية...');

      let started: StockImportResult;
      try {
        started = await startStockImport(payload);
      } catch (firstError) {
        const isRecoverableNetworkFailure =
          firstError instanceof ApiRequestError &&
          firstError.statusCode === 0 &&
          firstError.body?.code !== 'TIMEOUT';
        if (!isRecoverableNetworkFailure) throw firstError;
        setImportError('انقطع اتصال الخادم أثناء بدء الاستيراد. جاري إعادة تشغيل الاتصال ثم إعادة المحاولة...');
        const recovered = await recoverLocalApiForImport();
        if (!recovered) throw firstError;
        started = await startStockImport(payload);
      }

      const finalStatuses = new Set(['CONFIRMED', 'PARTIALLY_CONFIRMED', 'FAILED', 'CANCELLED']);
      let latest = started;
      while (!finalStatuses.has(String(latest.status || ''))) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        latest = await readImportStatus(String(started.batchId));
        const processedRows = Math.min(
          latest.createdRolls + latest.errorCount + (latest.skippedRows ?? 0),
          latest.totalRows || importableRows.length,
        );
        setImportProgress({
          currentChunk: finalStatuses.has(String(latest.status || '')) ? 1 : 0,
          totalChunks: 1,
          processedRows,
          totalRows: latest.totalRows || importableRows.length,
        });
        setImportError(
          latest.status === 'FAILED'
            ? (latest.errorMessage || 'فشل الاستيراد')
            : `جاري تنفيذ الاستيراد في الخلفية... تمت معالجة ${fmtInt(processedRows)} من ${fmtInt(latest.totalRows || importableRows.length)} صف.`,
        );
      }

      if (latest.status === 'FAILED' || latest.status === 'CANCELLED') {
        throw new Error(latest.errorMessage || 'فشل الاستيراد');
      }

      setImportResult(latest);
      setImportProgress({
        currentChunk: 1,
        totalChunks: 1,
        processedRows: latest.totalRows || importableRows.length,
        totalRows: latest.totalRows || importableRows.length,
      });
      setImportError('');
      if (onImported) onImported(latest);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'فشل الاستيراد';
      setImportError(msg);
    } finally {
      setImportProgress(null);
      setImporting(false);
    }
  }, [activeSheet, importableRows, importing, onImported, preview, readImportStatus, selectedSupplierId, selectedWarehouseId, sourceType]);

  if (!open) return null;

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[200] flex items-stretch justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stock-import-title"
      onClick={handleClose}
    >
      <div
        className="relative flex min-h-0 w-full max-w-[1180px] flex-1 flex-col max-h-[calc(100dvh-1rem)] bg-slate-50 rounded-2xl border border-slate-200 shadow-2xl overflow-hidden mx-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 id="stock-import-title" className="font-bold text-slate-900 text-lg leading-tight">
                استيراد المخزون من ملف Excel
              </h3>
              <p className="text-xs text-slate-500 truncate">
                معاينة محتوى الملف قبل الاستيراد — كميات، أطوال، خامات، ألوان، أعداد
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={parsing}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 disabled:opacity-50 transition"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Picker / drop zone */}
          {!preview && !parsing && (
            <div
              onClick={onPick}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className="cursor-pointer bg-white rounded-2xl border-2 border-dashed border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/40 transition p-10 flex flex-col items-center text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center text-emerald-600 mb-4">
                <FileSpreadsheet className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-extrabold text-slate-800 mb-1">اختر ملف Excel للاستيراد</h4>
              <p className="text-sm text-slate-500 mb-5">
                اسحب الملف هنا أو اضغط للاختيار — يدعم <span className="font-mono text-emerald-700">.xlsx</span>،{' '}
                <span className="font-mono text-emerald-700">.xls</span>
              </p>
              <span className="inline-flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-lg font-bold text-sm hover:bg-emerald-700 transition">
                <FileSpreadsheet className="w-4 h-4" />
                اختيار ملف
              </span>
              <p className="text-[11px] text-slate-400 mt-4">
                الملف لن يُرفع لأي خادم في هذه المرحلة — تتم القراءة محلياً داخل التطبيق فقط للمعاينة.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={onChange}
                className="hidden"
              />
            </div>
          )}

          {parsing && (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 flex flex-col items-center text-center">
              <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mb-3" />
              <p className="text-slate-700 font-bold">جاري قراءة الملف...</p>
              <p className="text-xs text-slate-500 mt-1">قد يستغرق الأمر بضع ثوانٍ للملفات الكبيرة</p>
            </div>
          )}

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold">خطأ في قراءة الملف</p>
                <p className="text-sm mt-0.5">{error}</p>
              </div>
              <button
                onClick={reset}
                className="px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 text-sm font-bold hover:bg-rose-100 transition"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

          {/* Import result success panel */}
          {importResult && (
            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-lg font-extrabold text-emerald-900">تم الاستيراد بنجاح</h4>
                  <p className="text-sm text-emerald-700">
                    إلى المستودع: <span className="font-bold">{importResult.warehouseName}</span> ·
                    دفعة: <span className="font-mono text-xs">{importResult.batchTag}</span>
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mb-3">
                <Stat icon={<Package className="w-5 h-5" />} label="أتواب أُنشئت" value={fmtInt(importResult.createdRolls)} accent="emerald" />
                <Stat icon={<Layers className="w-5 h-5" />} label="خامات جديدة" value={fmtInt(importResult.createdItems)} accent="violet" />
                <Stat icon={<Palette className="w-5 h-5" />} label="ألوان جديدة" value={fmtInt(importResult.createdColors)} accent="amber" />
                <Stat icon={<Layers className="w-5 h-5" />} label="تصنيفات جديدة" value={fmtInt(importResult.createdCategories ?? 0)} accent="sky" />
                <Stat icon={<Hash className="w-5 h-5" />} label="صفوف مُتجاوزة" value={fmtInt(importResult.skippedRows)} accent="sky" />
                <Stat icon={<AlertTriangle className="w-5 h-5" />} label="أخطاء" value={fmtInt(importResult.errorCount)} accent={importResult.errorCount ? 'rose' : 'indigo'} />
              </div>
              <div className="flex items-center justify-between text-xs text-emerald-800/80 mb-2">
                {typeof importResult.elapsedMs === 'number' && (
                  <span>⏱ زمن المعالجة: {(importResult.elapsedMs / 1000).toFixed(2)} ث</span>
                )}
                {(importResult.clampedValues ?? 0) > 0 && (
                  <span>⚙ قيم مضبوطة لنطاق آمن: {fmtInt(importResult.clampedValues!)}</span>
                )}
              </div>
              {importResult.errors.length > 0 && (
                <div className="bg-white rounded-lg border border-rose-200 p-3 max-h-40 overflow-y-auto">
                  <p className="text-xs font-bold text-rose-700 mb-2">صفوف فشلت:</p>
                  <ul className="text-xs space-y-1 list-disc pr-5 text-rose-700">
                    {importResult.errors.slice(0, 12).map((e) => (
                      <li key={e.rowIndex}>صف #{e.rowIndex} — {e.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {importing && importProgress && (
            <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-bold">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>
                    جاري تنفيذ الاستيراد في الخلفية
                  </span>
                </div>
                <span className="text-xs font-mono">
                  {fmtInt(importProgress.processedRows)} / {fmtInt(importProgress.totalRows)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-white overflow-hidden border border-indigo-100">
                <div
                  className="h-full bg-indigo-600 transition-all"
                  style={{
                    width: `${Math.max(
                      3,
                      Math.min(100, (importProgress.processedRows / Math.max(1, importProgress.totalRows)) * 100),
                    )}%`,
                  }}
                />
              </div>
              <p className="text-xs text-indigo-700">
                تم بدء دفعة الاستيراد بنجاح، وتجري الآن المعالجة على الخادم مع متابعة الحالة تلقائياً.
              </p>
            </div>
          )}

          {importError && (!importResult || !importing) && (
            <div className={`${importing ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-rose-50 border-rose-200 text-rose-700'} border rounded-xl p-4 flex items-start gap-3`}>
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold">{importing ? 'تنبيه أثناء الاستيراد' : 'فشل الاستيراد'}</p>
                <p className="text-sm mt-0.5">{importError}</p>
              </div>
            </div>
          )}

          {preview && activeSheet && (
            <>
              {/* Warehouse target selector */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 ring-1 ring-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                      <Warehouse className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">المستودع المستهدف للاستيراد</p>
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {whLoading
                          ? 'جارٍ تحميل المستودعات...'
                          : warehouses.length === 0
                            ? 'سيُستخدم المستودع الرئيسي تلقائياً (سيُنشَأ إن لم يوجد)'
                            : 'اختاري المستودع — أو اتركيه على الرئيسي'}
                      </p>
                    </div>
                  </div>
                  <select
                    value={selectedWarehouseId}
                    onChange={(e) => setSelectedWarehouseId(e.target.value)}
                    disabled={whLoading || warehouses.length === 0 || importing}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 min-w-[200px]"
                  >
                    {warehouses.length === 0 && (
                      <option value="">المستودع الرئيسي (تلقائي)</option>
                    )}
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}{w.code === 'MAIN' ? ' — الرئيسي' : ''}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    disabled={supLoading || importing}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 min-w-[220px]"
                    title="اختيار المورد لربط الاستيراد بكشفه المحاسبي"
                  >
                    <option value="">{supLoading ? 'جاري تحميل الموردين...' : 'بدون مورد محاسبي'}</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name} {supplier.code ? `(${supplier.code})` : ''}
                      </option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm font-bold text-amber-800">
                      <input
                        type="checkbox"
                        checked={ignorePrices}
                        onChange={(e) => setIgnorePrices(e.target.checked)}
                        disabled={importing}
                        className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
                      />
                      استيراد بدون تسعير
                    </label>
                  </div>
                  <div className="w-full flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                    {[
                      { value: 'OPENING_STOCK', label: 'مواد أول مدة', hint: 'لا تنشئ ديناً على المورد' },
                      { value: 'PURCHASE_INVOICE', label: 'فاتورة شراء', hint: 'تتبع كمصدر شراء' },
                      { value: 'DIRECT_STOCK_IMPORT', label: 'مخزون مباشر', hint: 'للحالات الخاصة فقط' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={importing}
                        onClick={() => setSourceType(option.value as typeof sourceType)}
                        className={`px-3 py-2 rounded-lg border text-xs font-bold transition ${
                          sourceType === option.value
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <span>{option.label}</span>
                        <span className={`block mt-0.5 font-normal ${sourceType === option.value ? 'text-indigo-100' : 'text-slate-400'}`}>
                          {option.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
                  💡 الاستيراد ذكي: ستتم إضافة أيّ خامة أو لون أو رمز خامة أو رمز لون
                  غير موجود في النظام تلقائياً، وسيُولَّد باركود فريد لكل ثوب.
                  أيّ صف فيه اسم خامة سيُستورد حتى لو غابت الكمّية أو السعر أو اللون
                  — يمكن إكمال البيانات الناقصة لاحقاً من شاشة المخزون.
                </p>
              </div>

              {/* File info + sheet selector */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-slate-800">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="font-bold truncate">{preview.fileName}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      الحجم: {fmtBytes(preview.fileSize)} · عدد الأوراق: {preview.sheets.length}
                    </p>
                  </div>
                  <button
                    onClick={reset}
                    className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-100 transition"
                  >
                    اختيار ملف آخر
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 mt-4 border-t border-slate-100 pt-3">
                  {preview.sheets.map((sheet) => {
                    const isActive = sheet.sheetName === activeSheet.sheetName;
                    return (
                      <button
                        key={sheet.sheetName}
                        type="button"
                        onClick={() => setActiveSheet(sheet)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-bold transition border ${
                          isActive
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span>{sheet.sheetName}</span>
                        <span className={`mr-2 text-[11px] font-mono ${isActive ? 'text-indigo-100' : 'text-slate-400'}`}>
                          ({fmtInt(sheet.totalRows)}) — {STOCK_SHEET_KIND_LABEL[sheet.kind]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {activeSheet.warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm">
                  <div className="flex items-center gap-2 font-bold mb-1">
                    <AlertTriangle className="w-4 h-4" />
                    تنبيهات
                  </div>
                  <ul className="list-disc pr-5 space-y-0.5">
                    {activeSheet.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              {activeSheet.kind !== 'incoming' && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 text-sm">
                  يتم السماح بالاستيراد من ورقة <span className="font-bold">وارد</span> فقط. يمكنك معاينة باقي الأوراق، لكن زر التأكيد سيبقى معطلاً خارج هذه الورقة.
                </div>
              )}

              {/* Stat cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <Stat
                  icon={<Hash className="w-5 h-5" />}
                  label="عدد الصفوف"
                  value={fmtInt(activeSheet.totalRows)}
                  hint={activeSheet.skippedRows ? `تم تخطي ${fmtInt(activeSheet.skippedRows)} صف فارغ` : 'لا توجد صفوف فارغة'}
                  accent="indigo"
                />
                <Stat
                  icon={<Ruler className="w-5 h-5" />}
                  label="إجمالي الكمية"
                  value={fmt(activeSheet.totalQuantity, 2)}
                  hint={activeSheet.distinctUnits.join(' · ') || 'بدون وحدة'}
                  accent="emerald"
                />
                <Stat
                  icon={<Package className="w-5 h-5" />}
                  label="عدد الخامات المختلفة"
                  value={fmtInt(activeSheet.distinctItemCount)}
                  hint="حسب اسم الصنف"
                  accent="violet"
                />
                <Stat
                  icon={<Palette className="w-5 h-5" />}
                  label="عدد الألوان المختلفة"
                  value={fmtInt(activeSheet.distinctColorCount)}
                  hint="حسب اسم اللون"
                  accent="amber"
                />
                <Stat
                  icon={<Layers className="w-5 h-5" />}
                  label="إجمالي القيمة"
                  value={fmt(activeSheet.totalValue, 2)}
                  hint="مجموع عمود الإجمالي"
                  accent="sky"
                />
                <Stat
                  icon={<ListChecks className="w-5 h-5" />}
                  label="نوع الورقة"
                  value={STOCK_SHEET_KIND_LABEL[activeSheet.kind]}
                  hint={`صف العنوان: ${activeSheet.headerRowIndex + 1}`}
                  accent="rose"
                />
              </div>

              {/* Detected columns */}
              <Section title="الأعمدة المكتشفة في الملف" count={`${activeSheet.rawHeaders.length} عمود`} defaultOpen>
                <div className="flex flex-wrap gap-2">
                  {activeSheet.rawHeaders.map((h, idx) => (
                    <span
                      key={`${h}-${idx}`}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-mono border border-slate-200"
                    >
                      {h || `(فارغ ${idx + 1})`}
                    </span>
                  ))}
                </div>
              </Section>

              {/* Per-item breakdown */}
              {activeSheet.itemBreakdown.length > 0 && (
                <Section
                  title="تفصيل حسب الخامة"
                  count={`أعلى ${Math.min(20, activeSheet.itemBreakdown.length)} من ${fmtInt(activeSheet.itemBreakdown.length)}`}
                >
                  <div className="overflow-x-auto -mx-4 px-4">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="text-right py-2 px-3 font-bold text-slate-600">اسم الخامة</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-600">رمز الصنف</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-600">عدد الأتواب</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-600">إجمالي الكمية</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-600">إجمالي القيمة</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-600">الألوان</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeSheet.itemBreakdown.slice(0, 20).map((it) => (
                          <tr key={it.itemName} className="border-b border-slate-100 hover:bg-slate-50/50">
                            <td className="py-2 px-3 font-medium text-slate-800">{it.itemName}</td>
                            <td className="py-2 px-3 font-mono text-xs text-slate-500">{it.itemCode || '—'}</td>
                            <td className="py-2 px-3 font-mono text-slate-700">{fmtInt(it.rollCount)}</td>
                            <td className="py-2 px-3 font-mono font-bold text-emerald-700">{fmt(it.totalQuantity, 2)}</td>
                            <td className="py-2 px-3 font-mono text-slate-600">{fmt(it.totalValue, 2)}</td>
                            <td className="py-2 px-3 text-xs text-slate-500">
                              {it.colors.length === 0 ? '—' : it.colors.join('، ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {/* Per-color breakdown */}
              {activeSheet.colorBreakdown.length > 0 && (
                <Section
                  title="تفصيل حسب اللون"
                  count={`أعلى ${Math.min(20, activeSheet.colorBreakdown.length)} من ${fmtInt(activeSheet.colorBreakdown.length)}`}
                  defaultOpen={false}
                >
                  <div className="overflow-x-auto -mx-4 px-4">
                    <table className="w-full text-sm min-w-[480px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="text-right py-2 px-3 font-bold text-slate-600">اسم اللون</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-600">رمز اللون</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-600">عدد الأتواب</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-600">إجمالي الكمية</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeSheet.colorBreakdown.slice(0, 20).map((c) => (
                          <tr key={c.colorName} className="border-b border-slate-100 hover:bg-slate-50/50">
                            <td className="py-2 px-3 font-medium text-slate-800">{c.colorName}</td>
                            <td className="py-2 px-3 font-mono text-xs text-slate-500">{c.colorCode || '—'}</td>
                            <td className="py-2 px-3 font-mono text-slate-700">{fmtInt(c.rollCount)}</td>
                            <td className="py-2 px-3 font-mono font-bold text-amber-700">{fmt(c.totalQuantity, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {/* Raw rows */}
              <Section
                title="الصفوف التفصيلية"
                count={`${fmtInt(filteredRows.length)} من ${fmtInt(activeSheet.totalRows)}`}
                defaultOpen
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="relative flex-1">
                    <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={rowSearch}
                      onChange={(e) => setRowSearch(e.target.value)}
                      placeholder="بحث في الخامة، اللون، الكود، التاريخ..."
                      className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <select
                    value={maxRows}
                    onChange={(e) => setMaxRows(Number(e.target.value))}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value={50}>أول 50</option>
                    <option value={100}>أول 100</option>
                    <option value={250}>أول 250</option>
                    <option value={1000}>أول 1000</option>
                    <option value={Number.MAX_SAFE_INTEGER}>عرض الكل</option>
                  </select>
                </div>
                <div className="overflow-x-auto -mx-4 px-4">
                  <table className="w-full text-sm min-w-[1120px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-right py-2 px-3 font-bold text-slate-600">#</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-600">التاريخ</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-600">اسم الخامة</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-600">رمز الصنف</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-600">الوحدة</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-600">اللون</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-600">رمز اللون</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-600">الكمية</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-600">الوزن</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-600">العرض</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-600">GSM</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-600">التكلفة</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-600">السعر</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-600">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.slice(0, maxRows).map((r) => (
                        <tr key={r.rowIndex} className="border-b border-slate-100 hover:bg-slate-50/50">
                          <td className="py-1.5 px-3 font-mono text-xs text-slate-400">{r.rowIndex}</td>
                          <td className="py-1.5 px-3 text-xs text-slate-600 whitespace-nowrap">{r.date ?? '—'}</td>
                          <td className="py-1.5 px-3 font-medium text-slate-800">{r.itemName || '—'}</td>
                          <td className="py-1.5 px-3 font-mono text-xs text-slate-500">{r.itemCode || '—'}</td>
                          <td className="py-1.5 px-3 text-slate-600">{r.unit || '—'}</td>
                          <td className="py-1.5 px-3 text-slate-700">{stockRowColorLabel(r) || '—'}</td>
                          <td className="py-1.5 px-3 font-mono text-xs text-slate-500">{r.colorCode || '—'}</td>
                          <td className="py-1.5 px-3 font-mono font-bold text-emerald-700">{r.quantity ? fmt(r.quantity, 2) : '—'}</td>
                          <td className="py-1.5 px-3 font-mono text-slate-600">{r.actualWeightKg ? fmt(r.actualWeightKg, 2) : '—'}</td>
                          <td className="py-1.5 px-3 font-mono text-slate-600">{r.widthCm ? fmt(r.widthCm, 2) : '—'}</td>
                          <td className="py-1.5 px-3 font-mono text-slate-600">{r.gsm ? fmt(r.gsm, 2) : '—'}</td>
                          <td className="py-1.5 px-3 font-mono text-slate-600">{r.costPrice ? fmt(r.costPrice, 2) : '—'}</td>
                          <td className="py-1.5 px-3 font-mono text-slate-600">{r.price ? fmt(r.price, 2) : '—'}</td>
                          <td className="py-1.5 px-3 font-mono text-slate-600">{r.total ? fmt(r.total, 2) : '—'}</td>
                        </tr>
                      ))}
                      {filteredRows.length === 0 && (
                        <tr>
                          <td colSpan={14} className="py-8 text-center text-slate-400 text-sm">
                            لا توجد صفوف مطابقة
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {filteredRows.length > maxRows && (
                  <p className="text-center text-xs text-slate-500 mt-3">
                    يتم عرض {fmtInt(maxRows)} صف فقط — استخدم خيار عرض الكل لرؤية البقية ({fmtInt(filteredRows.length - maxRows)}+)
                  </p>
                )}
              </Section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-white flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 leading-snug">
            {importResult ? (
              <>
                تم إنشاء {fmtInt(importResult.createdRolls)} ثوب في المستودع{' '}
                <span className="font-bold text-emerald-700">{importResult.warehouseName}</span>
                {importResult.createdItems > 0 && <> — مع {fmtInt(importResult.createdItems)} خامة جديدة</>}
                {importResult.createdColors > 0 && <> و {fmtInt(importResult.createdColors)} لون جديد</>}
                {(importResult.createdCategories ?? 0) > 0 && <> و {fmtInt(importResult.createdCategories ?? 0)} تصنيف جديد</>}.
              </>
            ) : preview && activeSheet ? (
              <>
                جاهز للاستيراد:{' '}
                <span className="font-bold text-emerald-700">{fmtInt(importableRows.length)} ثوب</span>
                {' '}من ورقة <span className="font-mono">{activeSheet.sheetName}</span>.
                {importAllowed
                  ? ' سيبدأ الاستيراد مباشرة في الخلفية بدون إبقاء الطلب مفتوحاً حتى نهاية المعالجة.'
                  : ' هذه الورقة للمعاينة فقط — يجب أن تحتوي أعمدة خامة + لون + طول (أو باركود + خامة + متر لفاتورة المورد).'}
              </>
            ) : (
              <>قبل الاستيراد سيتم عرض معاينة كاملة (كميات، أطوال، خامات، ألوان، أعداد).</>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleClose}
              disabled={parsing || importing}
              className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 disabled:opacity-50 transition"
            >
              {importResult ? 'تم — إغلاق' : 'إغلاق'}
            </button>
            {!importResult && (
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={!preview || !activeSheet || !importAllowed || importing || parsing}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {importProgress
                      ? `دفعة ${fmtInt(importProgress.currentChunk)} / ${fmtInt(importProgress.totalChunks)}`
                      : 'جارٍ الاستيراد...'}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    تأكيد استيراد {importableRows.length > 0 ? fmtInt(importableRows.length) : ''} ثوب
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
