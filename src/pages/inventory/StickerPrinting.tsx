/**
 * StickerPrinting â€” Label printing page (Phase 5 + Phase 7 Electron silent print)
 *
 * Modes:
 *  A. Roll selection â€” search/filter/select rolls then preview+print
 *  B. Import batch   â€” print all rolls from a confirmed import batch
 *  C. Single roll    â€” auto-load from ?rollId=<uuid> query param
 *
 * Phase 7 additions:
 *  - Silent label printing (Electron) â€” no Windows print dialog
 *  - PDF export via Electron native save dialog
 *  - Print job status auto-updated from Electron result (PRINTED/FAILED)
 *  - Inline toast result â€” no confirmation dialog for silent prints
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
   Printer, Search, Package, CheckSquare, Square, RefreshCw,
   ArrowRight, ArrowUp, ArrowDown, FileSpreadsheet, Eye, Tags, ScanLine, CheckCircle2, XCircle, AlertTriangle, X,
   VolumeX, FileDown, Settings, Languages,
} from 'lucide-react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  previewRollLabels, previewBatchLabels,
  createPrintJob, updatePrintJobStatus,
  type RollLabelPreviewDto, type LabelTemplateDto,
} from '../../lib/api/labelsApi';
import {
   listFabricRolls,
   type FabricRollDto,
   type FabricRollListFilters,
 } from '../../lib/api/fabricRollsApi';
 import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
 import { listImportBatches, type PurchaseImportBatchDto } from '../../lib/api/purchaseImportApi';
import { LabelCard, buildPrintDocument, type LabelConfig } from '../../components/labels/LabelCard';
import { generateQrSvgMap } from '../../lib/printing/qrGenerator';
import { getPrintAdapter, isElectronRenderer, canUseSilentLabelPrinting } from '../../lib/printing/printAdapters';
import { ElectronPrintAdapter } from '../../lib/printing/electronPrintAdapter';
import { useElectronSettings } from '../../lib/electron/useElectronSettings';
import type { PrintResult } from '../../lib/printing/printAdapters';

// â”€â”€â”€ Toast â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type ToastType = 'success' | 'error' | 'info';
interface Toast { id: number; type: ToastType; message: string }

const ToastNotification: React.FC<{ toast: Toast; onClose: () => void }> = ({ toast, onClose }) => (
  <div
    className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-bold max-w-sm
      ${toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
        toast.type === 'error'   ? 'bg-rose-50 border-rose-200 text-rose-800' :
        'bg-blue-50 border-blue-200 text-blue-800'}`}
  >
    {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 flex-shrink-0" />}
    {toast.type === 'error'   && <XCircle className="w-4 h-4 flex-shrink-0" />}
    {toast.type === 'info'    && <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
    <span className="flex-1">{toast.message}</span>
    <button onClick={onClose} className="opacity-60 hover:opacity-100 flex-shrink-0">
      <X className="w-3.5 h-3.5" />
    </button>
  </div>
);

// â”€â”€â”€ Print helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface PrintTriggerOptions {
  config?: LabelConfig;
  widthMm?: number;
  heightMm?: number;
  pageSize?: 'label' | 'A4' | 'A4_SHEET_6';
  printerName?: string;
  silent?: boolean;
  copies?: number;
}

async function triggerPrint(
  rolls: RollLabelPreviewDto[],
  opts: PrintTriggerOptions,
): Promise<PrintResult> {
  const qrSvgs = await generateQrSvgMap(rolls);
  const html = buildPrintDocument(rolls, { ...opts, qrSvgs });
  const adapter = getPrintAdapter();
  return adapter.print(html, {
    pageSize: opts.pageSize,
    widthMm: opts.widthMm,
    heightMm: opts.heightMm,
    printerName: opts.printerName,
    silent: opts.silent ?? false,
    copies: opts.copies,
  });
}

async function triggerPdfExport(
  rolls: RollLabelPreviewDto[],
  opts: PrintTriggerOptions & { defaultFileName?: string },
): Promise<PrintResult & { filePath?: string }> {
  if (!isElectronRenderer()) {
    return { ok: false, usedSilent: false, error: 'تصدير PDF متاح داخل تطبيق Windows فقط' };
  }
  const qrSvgs = await generateQrSvgMap(rolls);
  const html = buildPrintDocument(rolls, { ...opts, qrSvgs });
  const adapter = new ElectronPrintAdapter();
  // Both A4 modes share the same physical A4 paper â€” the 2أ—3 grid is encoded
  // entirely in the HTML/CSS produced by buildPrintDocument.
  const electronPageSize: 'A4' | 'ROLL_LABEL' =
    opts.pageSize === 'A4' || opts.pageSize === 'A4_SHEET_6' ? 'A4' : 'ROLL_LABEL';
  return adapter.exportToPdf(html, {
    pageSize: electronPageSize,
    widthMm: opts.widthMm,
    heightMm: opts.heightMm,
    defaultFileName: opts.defaultFileName ?? 'labels.pdf',
  });
}

async function exportPdfInBrowserFromHtml(
  rolls: RollLabelPreviewDto[],
  opts: PrintTriggerOptions & { defaultFileName?: string },
): Promise<void> {
  const qrSvgs = await generateQrSvgMap(rolls);
  // Preserve A4_SHEET_6 when explicitly requested (so 2أ—3 sheets are exported
  // as-is); otherwise rasterize on A4 for stability with custom label sizes.
  const htmlPageSize: 'A4' | 'A4_SHEET_6' =
    opts.pageSize === 'A4_SHEET_6' ? 'A4_SHEET_6' : 'A4';
  const html = buildPrintDocument(rolls, {
    ...opts,
    pageSize: htmlPageSize,
    qrSvgs,
  });

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = '1200px';
  iframe.style.height = '1800px';
  // Keep iframe off-screen but visible for rasterization.
  // Setting opacity:0 causes html2canvas to capture transparent output.
  iframe.style.opacity = '1';
  iframe.style.pointerEvents = 'none';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  try {
    await new Promise<void>((resolve, reject) => {
      iframe.onload = () => resolve();
      iframe.onerror = () => reject(new Error('تعذر تحميل مستند المعاينة للتصدير'));
      iframe.srcdoc = html;
    });

    // Give layout/inline SVG enough time to settle before capture.
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');

    const targetDoc = iframe.contentDocument;
    const targetBody = targetDoc?.body;
    if (!targetDoc || !targetBody) {
      throw new Error('تعذر قراءة محتوى المعاينة للتصدير');
    }
    // For A4_SHEET_6 we capture each 2أ—3 grid sheet as a single A4 page so the
    // exported PDF mirrors the printed sheets exactly. Otherwise we fall back
    // to one-label-per-page (legacy behavior for thermal/single-label flows).
    const useSheetCapture = htmlPageSize === 'A4_SHEET_6';
    const targets = useSheetCapture
      ? Array.from(targetDoc.querySelectorAll<HTMLElement>('.a4-sheet'))
      : Array.from(targetDoc.querySelectorAll<HTMLElement>('.lbl'));

    if (!targets.length) {
      throw new Error(
        useSheetCapture
          ? 'تعذر العثور على صفحات A4 داخل المعاينة'
          : 'تعذر العثور على عناصر اللصاقات داخل المعاينة',
      );
    }

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = 210;
    const pageH = 297;
    const margin = 8;
    const innerW = pageW - margin * 2;
    const innerH = pageH - margin * 2;

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const canvas = await html2canvas(target, {
        scale: 3,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });

      if (canvas.width <= 0 || canvas.height <= 0) {
        throw new Error('فشل التقاط إحدى الصفحات');
      }

      const img = canvas.toDataURL('image/png');
      const ratio = canvas.width / canvas.height;
      let drawW = innerW;
      let drawH = drawW / ratio;
      if (drawH > innerH) {
        drawH = innerH;
        drawW = drawH * ratio;
      }
      const x = (pageW - drawW) / 2;
      const y = useSheetCapture ? margin : (pageH - drawH) / 2;

      if (i > 0) pdf.addPage('a4', 'portrait');
      pdf.addImage(img, 'PNG', x, y, drawW, drawH, undefined, 'FAST');
    }

    pdf.save(opts.defaultFileName ?? 'labels-preview.pdf');
  } finally {
    iframe.remove();
  }
}


// â”€â”€â”€ Roll row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const RollRow = ({
  roll,
  selected,
  onToggle,
}: {
  roll: FabricRollDto;
  selected: boolean;
  onToggle: () => void;
  key?: React.Key;
}) => (
  <tr
    onClick={onToggle}
    className={`border-b border-slate-100 cursor-pointer transition text-sm
      ${selected ? 'bg-indigo-50' : 'hover:bg-slate-50/60'}`}
  >
    <td className="py-2 px-3">
      {selected
        ? <CheckSquare className="w-4 h-4 text-indigo-600" />
        : <Square className="w-4 h-4 text-slate-300" />}
    </td>
    <td className="py-2 px-3 font-mono text-xs text-slate-600">{roll.barcode}</td>
    <td className="py-2 px-3 font-medium text-slate-800">{roll.item_name ?? '—'}</td>
    <td className="py-2 px-3 font-mono text-xs text-slate-600">{roll.internal_code ?? roll.supplier_code_item ?? '—'}</td>
    <td className="py-2 px-3 text-slate-500">{roll.color_name_ar ?? roll.color_name_tr ?? '—'}</td>
    <td className="py-2 px-3 font-mono text-slate-600">
      {roll.length_m ? `${parseFloat(roll.length_m).toFixed(2)} م` : '—'}
    </td>
    <td className="py-2 px-3">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${
        (roll.label_print_count ?? 0) > 0
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-amber-50 text-amber-700 border-amber-200'
      }`}>
        {(roll.label_print_count ?? 0) > 0 ? `مطبوع ${roll.label_print_count}x` : 'غير مطبوع'}
      </span>
      {roll.last_label_printed_at && (
        <div className="text-[11px] text-slate-400 mt-1">{new Date(roll.last_label_printed_at).toLocaleDateString('ar-SA')}</div>
      )}
    </td>
    <td className="py-2 px-3 text-slate-500">{roll.warehouse_name ?? '—'}</td>
    <td className="py-2 px-3">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border
        ${roll.status === 'AVAILABLE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
          roll.status === 'SOLD' ? 'bg-rose-50 text-rose-600 border-rose-200' :
          'bg-slate-50 text-slate-600 border-slate-200'}`}>
        {roll.status}
      </span>
    </td>
  </tr>
);

// â”€â”€â”€ Browser print confirm dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Only shown for non-silent browser prints (browser cannot confirm physical result)

const PrintConfirmDialog = ({
  rollCount,
  onConfirm,
  onFail,
  onClose,
}: {
  rollCount: number;
  onConfirm: () => void;
  onFail: () => void;
  onClose: () => void;
}) => (
  <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl">
    <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
          <Printer className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h3 className="font-bold text-slate-900">هل تمت الطباعة بنجاح؟</h3>
          <p className="text-sm text-slate-500">طباعة {rollCount} لصاقة</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onConfirm}
          className="flex items-center justify-center gap-2 bg-emerald-600 text-white rounded-xl py-3 font-bold hover:bg-emerald-700 transition"
        >
          <CheckCircle2 className="w-4 h-4" /> نعم، تمت
        </button>
        <button
          onClick={onFail}
          className="flex items-center justify-center gap-2 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl py-3 font-bold hover:bg-rose-100 transition"
        >
          <XCircle className="w-4 h-4" /> فشلت
        </button>
      </div>
      <button onClick={onClose} className="w-full text-center text-sm text-slate-400 hover:text-slate-600 transition">
        تجاهل
      </button>
    </div>
  </div>
);

// â”€â”€â”€ Main page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type Mode = 'selection' | 'batch' | 'single';
type PrintStep = 'select' | 'preview' | 'done';
type LabelPrintSortKey = 'none' | 'fabric' | 'color' | 'fabricCode';

const labelPrintSortOptions: Array<{ value: LabelPrintSortKey; label: string }> = [
  { value: 'color', label: 'اللون' },
  { value: 'fabricCode', label: 'كود خامة' },
];

const normalizeSortText = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLocaleLowerCase('ar');

const getLabelPrintSortValue = (roll: RollLabelPreviewDto, key: LabelPrintSortKey) => {
  if (key === 'fabric') return roll.itemName;
  if (key === 'color') return roll.colorNameAr || roll.colorNameTr || roll.colorCode;
  if (key === 'fabricCode') return roll.internalCode || roll.supplierCode;
  return '';
};

const sortLabelPreviewRolls = (rolls: RollLabelPreviewDto[], key: LabelPrintSortKey) => {
  if (key === 'none') return rolls;
  return [...rolls].sort((a, b) => {
    const byFabric = normalizeSortText(a.itemName).localeCompare(normalizeSortText(b.itemName), 'ar', {
      numeric: true,
      sensitivity: 'base',
    });
    if (byFabric !== 0) return byFabric;

    const primary = normalizeSortText(getLabelPrintSortValue(a, key)).localeCompare(
      normalizeSortText(getLabelPrintSortValue(b, key)),
      'ar',
      { numeric: true, sensitivity: 'base' },
    );
    if (primary !== 0) return primary;

    const byColor = normalizeSortText(a.colorNameAr || a.colorNameTr || a.colorCode).localeCompare(
      normalizeSortText(b.colorNameAr || b.colorNameTr || b.colorCode),
      'ar',
      { numeric: true, sensitivity: 'base' },
    );
    if (byColor !== 0) return byColor;

    return normalizeSortText(a.barcode).localeCompare(normalizeSortText(b.barcode), 'ar', {
      numeric: true,
      sensitivity: 'base',
    });
  });
};

const getFabricRollSortValue = (roll: FabricRollDto, key: LabelPrintSortKey) => {
  if (key === 'fabric') return roll.item_name;
  if (key === 'color') return roll.color_name_ar || roll.color_name_tr || roll.color_code;
  if (key === 'fabricCode') return roll.internal_code || roll.supplier_code_item;
  return '';
};

const sortFabricRollRows = (rolls: FabricRollDto[], key: LabelPrintSortKey) => {
  if (key === 'none') return rolls;
  return [...rolls].sort((a, b) => {
    const byFabric = normalizeSortText(a.item_name).localeCompare(normalizeSortText(b.item_name), 'ar', {
      numeric: true,
      sensitivity: 'base',
    });
    if (byFabric !== 0) return byFabric;

    const primary = normalizeSortText(getFabricRollSortValue(a, key)).localeCompare(
      normalizeSortText(getFabricRollSortValue(b, key)),
      'ar',
      { numeric: true, sensitivity: 'base' },
    );
    if (primary !== 0) return primary;

    const byColor = normalizeSortText(a.color_name_ar || a.color_name_tr || a.color_code).localeCompare(
      normalizeSortText(b.color_name_ar || b.color_name_tr || b.color_code),
      'ar',
      { numeric: true, sensitivity: 'base' },
    );
    if (byColor !== 0) return byColor;

    return normalizeSortText(a.barcode).localeCompare(normalizeSortText(b.barcode), 'ar', {
      numeric: true,
      sensitivity: 'base',
    });
  });
};

export const StickerPrinting: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const initialRollId  = searchParams.get('rollId')  ?? '';
  const initialBatchId = searchParams.get('batchId') ?? '';
  const autoSilent     = searchParams.get('silent')  === '1';

  const [mode, setMode] = useState<Mode>(
    initialRollId ? 'single' : initialBatchId ? 'batch' : 'selection',
  );
  const [step, setStep] = useState<PrintStep>('select');

  // Electron settings
  const { settings } = useElectronSettings();
  const canSilent = canUseSilentLabelPrinting({
    silentLabelPrintingEnabled: settings?.silentLabelPrintingEnabled,
    defaultLabelPrinterName: settings?.defaultLabelPrinterName,
  });

  // Toast stack
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastCounter = React.useRef(0);
  const showToast = useCallback((type: ToastType, message: string) => {
    const id = ++toastCounter.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

// Roll selection state
   const [rolls, setRolls] = useState<FabricRollDto[]>([]);
   const [rollsLoading, setRollsLoading] = useState(false);
   const [searchText, setSearchText] = useState('');
   const [warehouseFilter, setWarehouseFilter] = useState('');
   const [labelPrintedFilter, setLabelPrintedFilter] = useState<'' | 'true' | 'false'>('');
   const [purchaseScopeFilter, setPurchaseScopeFilter] = useState<'all' | 'purchased' | 'recent'>('all');
   const [recentDaysFilter, setRecentDaysFilter] = useState(30);
   const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
   const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
   const [sortBy, setSortBy] = useState<'item_name' | 'color_name_ar' | null>(null);
   const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
   const [showPrintSortControls, setShowPrintSortControls] = useState(false);
   const [printSortBy, setPrintSortBy] = useState<LabelPrintSortKey>('color');

   // Batch mode state
  const [batches, setBatches] = useState<PurchaseImportBatchDto[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState(initialBatchId);

  // Preview state
  const [previewRolls, setPreviewRolls] = useState<RollLabelPreviewDto[]>([]);
  const [template, setTemplate] = useState<LabelTemplateDto | null>(null);
  const [pageSize, setPageSize] = useState<'label' | 'A4' | 'A4_SHEET_6'>('label');
  const [showBrandLogo, setShowBrandLogo] = useState(true);
  const [labelTextDirection, setLabelTextDirection] = useState<'rtl' | 'ltr'>('rtl');
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // Print job state
  const [printing, setPrinting] = useState(false);
  const [printJobId, setPrintJobId] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [printSuccess, setPrintSuccess] = useState<boolean | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const orderedPreviewRolls = React.useMemo(
    () => sortLabelPreviewRolls(previewRolls, showPrintSortControls ? printSortBy : 'none'),
    [previewRolls, showPrintSortControls, printSortBy],
  );
  const visibleRolls = React.useMemo(
    () => sortFabricRollRows(rolls, showPrintSortControls ? printSortBy : 'none'),
    [rolls, showPrintSortControls, printSortBy],
  );

// Load warehouses
   useEffect(() => {
     listWarehouses().then(setWarehouses).catch(() => {});
   }, []);

   // Load batches for batch mode
  useEffect(() => {
    if (mode === 'batch') {
      listImportBatches({ pageSize: 100 }).then(r => {
        setBatches(r.data.filter(b => b.status === 'CONFIRMED'));
      }).catch(() => {});
    }
  }, [mode]);

// Load rolls for selection mode â€” ط¬ظ„ط¨ ظƒظ„ ط§ظ„ط£طھظˆط§ط¨ ط§ظ„ظ…طھط§ط­ط© (ط£ظƒط«ط± ظ…ظ† ط­ط¯ ط§ظ„طµظپط­ط© ط¹ظ„ظ‰ ط§ظ„ط®ط§ط¯ظ… ط¹ظ†ط¯ ط§ظ„ط­ط§ط¬ط©)
   const loadRolls = useCallback(async (_page: number, search: string, wh: string) => {
     setRollsLoading(true);
     try {
       const chunkSize = 50000;
       const merged: FabricRollDto[] = [];
       let p = 1;
       let reportedTotal = 0;
       for (;;) {
         const filters: FabricRollListFilters = { page: p, pageSize: chunkSize, onlyAvailable: true };
         if (search) filters.search = search;
         if (wh) filters.warehouseId = wh;
         if (labelPrintedFilter) filters.labelPrinted = labelPrintedFilter;
         if (purchaseScopeFilter !== 'all') filters.purchaseScope = purchaseScopeFilter;
         if (purchaseScopeFilter === 'recent') filters.recentDays = recentDaysFilter;
         const res = await listFabricRolls(filters);
         if (p === 1) reportedTotal = res.total;
         merged.push(...res.data);
         if (merged.length >= reportedTotal || res.data.length === 0) break;
         if (res.data.length < chunkSize) break;
         p++;
         if (p > 50) break;
       }
       let sorted = [...merged];
       if (sortBy === 'item_name') {
         sorted.sort((a, b) => {
           const aName = (a.item_name || '').toLowerCase();
           const bName = (b.item_name || '').toLowerCase();
           return sortDir === 'asc' ? aName.localeCompare(bName, 'ar') : bName.localeCompare(aName, 'ar');
         });
       } else if (sortBy === 'color_name_ar') {
         sorted.sort((a, b) => {
           const aColor = (a.color_name_ar || a.color_name_tr || '').toLowerCase();
           const bColor = (b.color_name_ar || b.color_name_tr || '').toLowerCase();
           return sortDir === 'asc' ? aColor.localeCompare(bColor, 'ar') : bColor.localeCompare(aColor, 'ar');
         });
       }
       setRolls(sorted);
     } catch { /* ignore */ }
     finally { setRollsLoading(false); }
   }, [labelPrintedFilter, purchaseScopeFilter, recentDaysFilter, sortBy, sortDir]);

useEffect(() => {
     if (mode === 'selection') loadRolls(1, searchText, warehouseFilter);
   }, [mode, loadRolls]);

   // Reload when sort changes
   useEffect(() => {
     if (mode === 'selection' && sortBy) loadRolls(1, searchText, warehouseFilter);
   }, [sortBy, sortDir]);

  // Auto-load from URL params
  useEffect(() => {
    if (mode === 'single' && initialRollId) handlePreview([initialRollId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode === 'batch' && initialBatchId) setSelectedBatchId(initialBatchId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSort = (field: 'item_name' | 'color_name_ar') => {
    if (sortBy === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSelectedIds(new Set());
    loadRolls(1, searchText, warehouseFilter);
  };

  const toggleRoll = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (visibleRolls.every(r => selectedIds.has(r.id)) && visibleRolls.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleRolls.map(r => r.id)));
    }
  };

  const selectVisibleUnprinted = () => {
    setSelectedIds(new Set(visibleRolls.filter((roll) => (roll.label_print_count ?? 0) === 0).map((roll) => roll.id)));
  };

  const handlePreview = async (ids?: string[]) => {
    const rollIds = ids ?? Array.from(selectedIds);
    if (!rollIds.length) { setPreviewError('اختر ثوباً واحداً على الأقل'); return; }
    setPreviewing(true); setPreviewError('');
    try {
      const res = await previewRollLabels(rollIds, template?.id);
      if (!res.data.length) {
        setPreviewError('لا توجد أتواب متاحة للطباعة (حالة متوفر وطول أكبر من صفر) ضمن الاختيار.');
        return;
      }
      if (res.data.length < rollIds.length) {
        showToast(
          'info',
          `تم استبعاد ${rollIds.length - res.data.length} ثوباً (مباع أو غير متوفر أو طوله صفر) من المعاينة.`,
        );
      }
      setPreviewRolls(res.data);
      setTemplate(res.template);
      setStep('preview');
    } catch (e: unknown) {
      setPreviewError((e as { message?: string }).message ?? 'فشل تحميل البيانات');
    } finally {
      setPreviewing(false);
    }
  };

  const handleBatchPreview = async () => {
    if (!selectedBatchId) { setPreviewError('اختر دفعة استيراد'); return; }
    setPreviewing(true); setPreviewError('');
    try {
      const res = await previewBatchLabels(selectedBatchId, template?.id);
      if (!res.data.length) {
        setPreviewError('لا توجد أتواب متاحة للطباعة في هذه الدفعة (متوفرة وبطول أكبر من صفر).');
        return;
      }
      setPreviewRolls(res.data);
      setTemplate(res.template);
      setStep('preview');
    } catch (e: unknown) {
      setPreviewError((e as { message?: string }).message ?? 'فشل تحميل البيانات');
    } finally {
      setPreviewing(false);
    }
  };

  // â”€â”€ Browser print (shows confirmation dialog) â”€â”€
  const handleBrowserPrint = async () => {
    if (!previewRolls.length) return;
    setPrinting(true);
    try {
      const sourceType = mode === 'batch' ? 'IMPORT_BATCH'
        : mode === 'single' ? 'SINGLE_ROLL' : 'ROLL_SELECTION';
      const job = await createPrintJob({
        rollIds: orderedPreviewRolls.map(r => r.rollId),
        templateId: template?.id,
        sourceType,
        sourceId: mode === 'batch' ? selectedBatchId : undefined,
        pageSize,
      });
      setPrintJobId(job.jobId);

      const result = await triggerPrint(orderedPreviewRolls, {
        config: effectiveLabelConfig,
        widthMm: template?.width_mm ?? settings?.labelWidthMm ?? 100,
        heightMm: template?.height_mm ?? settings?.labelHeightMm ?? 80,
        pageSize,
      });

      if (!result.ok && result.error) {
        setPreviewError(result.error);
        return;
      }
      setShowConfirmDialog(true);
    } catch (e: unknown) {
      setPreviewError((e as { message?: string }).message ?? 'فشلت الطباعة');
    } finally {
      setPrinting(false);
    }
  };

  // â”€â”€ Silent / Electron print (auto-updates job status, no confirm dialog) â”€â”€
  const handleSilentPrint = async () => {
    if (!previewRolls.length) return;

    if (!settings?.defaultLabelPrinterName) {
      showToast('error', 'الطباعة الصامتة مفعلة لكن لم يتم تحديد طابعة لصاقات افتراضية. افتح إعدادات النظام → تطبيق سطح المكتب.');
      return;
    }

    setPrinting(true);
    let jobId: string | null = null;

    try {
      const sourceType = mode === 'batch' ? 'IMPORT_BATCH'
        : mode === 'single' ? 'SINGLE_ROLL' : 'ROLL_SELECTION';
      const job = await createPrintJob({
        rollIds: orderedPreviewRolls.map(r => r.rollId),
        templateId: template?.id,
        sourceType,
        sourceId: mode === 'batch' ? selectedBatchId : undefined,
        pageSize,
      });
      jobId = job.jobId;
      setPrintJobId(job.jobId);

      showToast('info', `جاري الإرسال إلى ${settings.defaultLabelPrinterName}...`);

      const result = await triggerPrint(orderedPreviewRolls, {
        config: effectiveLabelConfig,
        widthMm: template?.width_mm ?? settings.labelWidthMm ?? 100,
        heightMm: template?.height_mm ?? settings.labelHeightMm ?? 80,
        pageSize,
        printerName: settings.defaultLabelPrinterName,
        silent: true,
      });

      // Auto-update print job status â€” no confirmation dialog needed
      if (result.ok) {
        await updatePrintJobStatus(jobId, 'PRINTED').catch(() => {});
        setPrintSuccess(true);
        setStep('done');
        showToast('success', `تمت الطباعة الصامتة بنجاح ✓ — ${orderedPreviewRolls.length} لصاقة`);
      } else {
        await updatePrintJobStatus(jobId, 'FAILED', result.error ?? 'فشل Electron').catch(() => {});
        setPrintSuccess(false);
        setStep('done');
        showToast('error', result.error ?? 'فشلت الطباعة الصامتة');
      }
    } catch (e: unknown) {
      const errMsg = (e as { message?: string }).message ?? 'خطأ في الطباعة الصامتة';
      if (jobId) await updatePrintJobStatus(jobId, 'FAILED', errMsg).catch(() => {});
      setPrintSuccess(false);
      setStep('done');
      showToast('error', errMsg);
    } finally {
      setPrinting(false);
    }
  };

  // â”€â”€ PDF export â”€â”€
  const handlePdfExport = async () => {
    if (!previewRolls.length) return;
    setExportingPdf(true);
    try {
      const fileName = mode === 'batch' && selectedBatchId
        ? `labels-batch-${selectedBatchId.slice(0, 8)}.pdf`
        : `labels-${new Date().toISOString().slice(0, 10)}.pdf`;
      const widthMm = template?.width_mm ?? settings?.labelWidthMm ?? 100;
      const heightMm = template?.height_mm ?? settings?.labelHeightMm ?? 80;

      if (!isElectronRenderer()) {
        await exportPdfInBrowserFromHtml(orderedPreviewRolls, {
          config: effectiveLabelConfig,
          widthMm,
          heightMm,
          pageSize,
          defaultFileName: fileName,
        });
        showToast('success', 'تم تصدير PDF من المعاينة بنجاح');
        return;
      }

      const result = await triggerPdfExport(orderedPreviewRolls, {
        config: effectiveLabelConfig,
        widthMm,
        heightMm,
        // Root fix: Electron printToPDF with custom ROLL_LABEL size can generate
        // a virtually blank page on some environments/drivers. Export as A4
        // for reliable PDF preview while keeping label content/layout. The 2x3
        // A4 sheet mode is already A4-sized, so preserve its sheet layout.
        pageSize: pageSize === 'A4_SHEET_6' ? 'A4_SHEET_6' : 'A4',
        defaultFileName: fileName,
      });
      if (result.ok) {
        showToast('success', `تم تصدير PDF بنجاح`);
      } else {
        showToast('error', result.error ?? 'فشل تصدير PDF');
      }
    } catch (e: unknown) {
      showToast('error', (e as { message?: string }).message ?? 'خطأ في تصدير PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const confirmPrintSuccess = async () => {
    if (printJobId) await updatePrintJobStatus(printJobId, 'PRINTED').catch(() => {});
    setShowConfirmDialog(false);
    setPrintSuccess(true);
    setStep('done');
  };

  const confirmPrintFail = async () => {
    if (printJobId) await updatePrintJobStatus(printJobId, 'FAILED', 'أفاد المستخدم بفشل الطباعة').catch(() => {});
    setShowConfirmDialog(false);
    setPrintSuccess(false);
    setStep('done');
  };

  const inputCls = 'p-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm';
  const effectiveLabelConfig: LabelConfig = {
    ...((template?.content_config as LabelConfig | undefined) ?? {}),
    showBrandLogo,
    textDirection: labelTextDirection,
  };

  // Auto-trigger silent print if ?silent=1 and settings loaded
  useEffect(() => {
    if (autoSilent && step === 'preview' && previewRolls.length > 0 && canSilent && !printing) {
      handleSilentPrint();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSilent, step, previewRolls.length, canSilent]);

  return (
    <div className="max-w-7xl mx-auto space-y-5" dir="rtl">
      {/* â”€â”€ Toast container â”€â”€ */}
      <div className="fixed bottom-4 left-4 z-50 space-y-2">
        {toasts.map((t) => (
          <ToastNotification
            key={t.id}
            toast={t}
            onClose={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          />
        ))}
      </div>

      {/* â”€â”€ Header â”€â”€ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Tags className="w-6 h-6 text-indigo-600" /> طباعة لصاقات الأتواب
            </h2>
            <p className="text-slate-500 mt-1 text-sm">بيانات حقيقية من PostgreSQL — لا بيانات مؤقتة</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Silent print status badge */}
          {isElectronRenderer() && (
            canSilent
              ? (
                <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full text-xs font-bold">
                  <VolumeX className="w-3 h-3" /> طباعة صامتة: {settings?.defaultLabelPrinterName}
                </span>
              ) : (
                <Link
                  to="/settings?tab=desktop"
                  className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 border border-slate-200 text-slate-600 rounded-full text-xs hover:bg-slate-200 transition"
                >
                  <Settings className="w-3 h-3" /> إعداد طابعة افتراضية
                </Link>
              )
          )}
          <Link to="/inventory/print-jobs" className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition text-sm font-medium">
            <Printer className="w-4 h-4" /> سجل الطباعة
          </Link>
        </div>
      </div>

      {/* â”€â”€ Mode tabs (step = select) â”€â”€ */}
      {step === 'select' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex border-b border-slate-200">
            {([
              ['selection', 'اختيار أتواب', ScanLine],
              ['batch',     'دفعة استيراد', FileSpreadsheet],
            ] as [Mode, string, React.FC<{className?: string}>][]).map(([m, label, Icon]) => (
              <button
                key={m}
                onClick={() => { setMode(m); setPreviewError(''); setSelectedIds(new Set()); }}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition
                  ${mode === m
                    ? 'border-indigo-600 text-indigo-700 bg-indigo-50/30'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>

          {/* â”€â”€ Selection mode â”€â”€ */}
          {mode === 'selection' && (
            <div className="p-4 space-y-4">
              <form onSubmit={handleSearch} className="flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                    placeholder="بحث بالباركود أو اسم الخامة..."
                    className={`${inputCls} w-full pr-9`}
                  />
                </div>
                <select value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)} className={inputCls}>
                  <option value="">كل المستودعات</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <select value={purchaseScopeFilter} onChange={e => setPurchaseScopeFilter(e.target.value as 'all' | 'purchased' | 'recent')} className={inputCls}>
                  <option value="all">كل الأتواب</option>
                  <option value="purchased">مواد مشترية فقط</option>
                  <option value="recent">آخر مشتريات</option>
                </select>
                {purchaseScopeFilter === 'recent' && (
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={recentDaysFilter}
                    onChange={e => setRecentDaysFilter(Math.min(365, Math.max(1, Number(e.target.value) || 30)))}
                    className={`${inputCls} w-24`}
                    title="عدد الأيام"
                  />
                )}
                <select value={labelPrintedFilter} onChange={e => setLabelPrintedFilter(e.target.value as '' | 'true' | 'false')} className={inputCls}>
                   <option value="">كل حالات الطباعة</option>
                   <option value="false">غير مطبوع فقط</option>
                   <option value="true">مطبوع سابقاً</option>
                 </select>
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setShowPrintSortControls((value) => !value)}
                    className={`px-3 py-2 rounded-lg text-sm font-bold transition ${
                      showPrintSortControls
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    طباعة حسب الخامة
                  </button>
                  {showPrintSortControls && (
                    <select
                      value={printSortBy}
                      onChange={(event) => setPrintSortBy(event.target.value as LabelPrintSortKey)}
                      className={`${inputCls} py-1.5`}
                      title="ترتيب داخل الخامة"
                    >
                      {labelPrintSortOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          ثم حسب {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                  <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition">
                   بحث
                 </button>
              </form>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="py-2 px-3">
                        <button onClick={toggleAll} className="text-slate-400 hover:text-slate-700">
                          {visibleRolls.every(r => selectedIds.has(r.id)) && visibleRolls.length > 0
                            ? <CheckSquare className="w-4 h-4 text-indigo-600" />
                            : <Square className="w-4 h-4" />}
                        </button>
                      </th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">الباركود</th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">
                        <button onClick={() => handleSort('item_name')} className="flex items-center gap-1 hover:text-indigo-600">
                          الخامة
                          {sortBy === 'item_name' && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </button>
                      </th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">كود الخامة</th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">
                        <button onClick={() => handleSort('color_name_ar')} className="flex items-center gap-1 hover:text-indigo-600">
                          اللون
                          {sortBy === 'color_name_ar' && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </button>
                      </th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">الطول</th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">طباعة الستيكر</th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">المستودع</th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rollsLoading && (
                      <tr><td colSpan={9} className="py-8 text-center text-slate-400"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                    )}
                    {!rollsLoading && visibleRolls.length === 0 && (
                      <tr><td colSpan={9} className="py-8 text-center text-slate-400">لا توجد أتواب</td></tr>
                    )}
                    {!rollsLoading && visibleRolls.map(r => (
                      <RollRow key={r.id} roll={r} selected={selectedIds.has(r.id)} onToggle={() => toggleRoll(r.id)} />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Actions bar */}
              <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-slate-200">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="font-bold text-indigo-700">{selectedIds.size}</span> ثوب مختار
                  <span className="text-slate-400">|</span>
                  <span>{visibleRolls.length.toLocaleString('ar')} ثوب متاح في القائمة</span>
                </div>
                <div className="flex gap-3 items-center flex-wrap">
                  <button
                    type="button"
                    onClick={toggleAll}
                    disabled={!visibleRolls.length}
                    className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-bold hover:bg-slate-50 disabled:opacity-50"
                  >
                    اختيار كل الظاهر
                  </button>
                  <button
                    type="button"
                    onClick={selectVisibleUnprinted}
                    disabled={!visibleRolls.some((roll) => (roll.label_print_count ?? 0) === 0)}
                    className="px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-sm font-bold hover:bg-amber-100 disabled:opacity-50"
                  >
                    اختيار غير المطبوع
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-600">حجم الورقة:</span>
                    <select value={pageSize} onChange={e => setPageSize(e.target.value as 'label' | 'A4' | 'A4_SHEET_6')} className={`${inputCls} py-1.5`}>
                      <option value="label">لصاقة منفصلة (حرارية)</option>
                      <option value="A4">A4 (متعدد - متدفق)</option>
                      <option value="A4_SHEET_6">A4 — 6 ستيكرات/ورقة (2×3)</option>
                    </select>
                  </div>
                  {previewError && <p className="text-rose-600 text-sm font-bold">{previewError}</p>}
                  <button
                    onClick={() => handlePreview()}
                    disabled={selectedIds.size === 0 || previewing}
                    className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-xl font-bold hover:bg-indigo-700 transition disabled:opacity-50 text-sm"
                  >
                    {previewing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                    معاينة اللصاقات
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* â”€â”€ Batch mode â”€â”€ */}
          {mode === 'batch' && (
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700">دفعة الاستيراد</label>
                <select value={selectedBatchId} onChange={e => setSelectedBatchId(e.target.value)} className={`${inputCls} w-full md:w-96`}>
                  <option value="">— اختر دفعة مؤكدة —</option>
                  {batches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.file_name} — {b.created_roll_count} ثوب — {new Date(b.created_at).toLocaleDateString('ar-SA')}
                    </option>
                  ))}
                </select>
                {batches.length === 0 && (
                  <p className="text-sm text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" /> لا توجد دفعات استيراد مؤكدة.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">حجم الورقة:</span>
                  <select value={pageSize} onChange={e => setPageSize(e.target.value as 'label' | 'A4' | 'A4_SHEET_6')} className={`${inputCls} py-1.5`}>
                    <option value="label">لصاقة منفصلة (حرارية)</option>
                    <option value="A4">A4 (متعدد - متدفق)</option>
                    <option value="A4_SHEET_6">A4 — 6 ستيكرات/ورقة (2×3)</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPrintSortControls((value) => !value)}
                    className={`px-3 py-2 rounded-lg border text-sm font-bold transition ${
                      showPrintSortControls
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    طباعة حسب الخامة
                  </button>
                  {showPrintSortControls && (
                    <select
                      value={printSortBy}
                      onChange={(event) => setPrintSortBy(event.target.value as LabelPrintSortKey)}
                      className={`${inputCls} py-1.5`}
                      title="ترتيب داخل الخامة"
                    >
                      {labelPrintSortOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          ثم حسب {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {previewError && <p className="text-rose-600 text-sm font-bold">{previewError}</p>}
                <button
                  onClick={handleBatchPreview}
                  disabled={!selectedBatchId || previewing}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-xl font-bold hover:bg-indigo-700 transition disabled:opacity-50 text-sm"
                >
                  {previewing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                  معاينة لصاقات الدفعة
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* â”€â”€ Step 2: Preview â”€â”€ */}
      {step === 'preview' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <button onClick={() => setStep('select')} className="p-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition">
                <ArrowRight className="w-4 h-4" />
              </button>
              <div>
                <p className="font-bold text-slate-900">{orderedPreviewRolls.length} لصاقة جاهزة للطباعة</p>
                {template && (
                  <p className="text-xs text-slate-500">القالب: {template.name} — {template.width_mm}×{template.height_mm}mm</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-600">الحجم:</span>
                <select value={pageSize} onChange={e => setPageSize(e.target.value as 'label' | 'A4' | 'A4_SHEET_6')} className={`${inputCls} py-1.5`}>
                  <option value="label">لصاقة منفصلة (حرارية)</option>
                  <option value="A4">A4 (متعدد)</option>
                  <option value="A4_SHEET_6">A4 — 6 ستيكرات/ورقة (2×3)</option>
                </select>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setShowPrintSortControls((value) => !value)}
                  className={`px-3 py-2 rounded-xl border font-bold transition ${
                    showPrintSortControls
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  طباعة حسب الخامة
                </button>
                {showPrintSortControls && (
                  <select
                    value={printSortBy}
                    onChange={(event) => setPrintSortBy(event.target.value as LabelPrintSortKey)}
                    className={`${inputCls} py-1.5`}
                    title="ترتيب داخل الخامة"
                  >
                    {labelPrintSortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        ثم حسب {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowBrandLogo((value) => !value)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold border text-sm transition ${
                  showBrandLogo
                    ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {showBrandLogo ? 'إخفاء اللوغو' : 'إظهار اللوغو'}
              </button>

              <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                <Languages className="w-4 h-4 text-indigo-600 ms-1 hidden sm:block" />
                <button
                  type="button"
                  onClick={() => setLabelTextDirection('rtl')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    labelTextDirection === 'rtl'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  يمين ← يسار
                </button>
                <button
                  type="button"
                  onClick={() => setLabelTextDirection('ltr')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    labelTextDirection === 'ltr'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  يسار → يمين
                </button>
              </div>

              {/* Silent print button â€” Electron only, requires default printer */}
              {canSilent && (
                <button
                  onClick={handleSilentPrint}
                  disabled={printing}
                  className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2 rounded-xl font-bold hover:bg-emerald-700 transition disabled:opacity-50 text-sm"
                >
                  {printing
                    ? <RefreshCw className="w-4 h-4 animate-spin" />
                    : <VolumeX className="w-4 h-4" />}
                  {printing ? 'جاري الطباعة...' : 'طباعة صامتة'}
                </button>
              )}

              {/* Silent possible but no printer */}
              {isElectronRenderer() && !canSilent && settings?.silentLabelPrintingEnabled && !settings?.defaultLabelPrinterName && (
                <span className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-xl">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  لم تُحدَّد طابعة لصاقات افتراضية
                  <Link to="/settings?tab=desktop" className="underline font-bold">إعدادات</Link>
                </span>
              )}

              {/* Standard print button */}
              <button
                onClick={handleBrowserPrint}
                disabled={printing}
                className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-xl font-bold hover:bg-indigo-700 transition disabled:opacity-50 text-sm"
              >
                {printing
                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : <Printer className="w-4 h-4" />}
                {printing ? 'جاري الطباعة...' : isElectronRenderer() ? 'طباعة عبر Windows' : 'طباعة'}
              </button>

              <button
                onClick={handlePdfExport}
                disabled={exportingPdf}
                className="flex items-center gap-2 border border-slate-200 text-slate-700 px-4 py-2 rounded-xl font-bold hover:bg-slate-50 transition disabled:opacity-50 text-sm"
              >
                {exportingPdf
                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : <FileDown className="w-4 h-4" />}
                {isElectronRenderer() ? 'تصدير PDF' : 'تصدير PDF (معاينة)'}
              </button>
            </div>
          </div>

          {previewError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 font-bold text-sm">{previewError}</div>
          )}

          {/* Labels preview â€” A4_SHEET_6 mirrors the printed 2أ—3 sheets so the
              user sees exactly how each A4 page will look (page break per sheet). */}
          {pageSize === 'A4_SHEET_6' ? (
            <div className="space-y-4">
              {(() => {
                const SHEET_SIZE = 6;
                const sheets: RollLabelPreviewDto[][] = [];
                for (let i = 0; i < orderedPreviewRolls.length; i += SHEET_SIZE) {
                  sheets.push(orderedPreviewRolls.slice(i, i + SHEET_SIZE));
                }
                return sheets.map((sheet, sheetIdx) => (
                  <div
                    key={`sheet-${sheetIdx}`}
                    className="bg-white rounded-xl border-2 border-slate-300 shadow-sm p-4 mx-auto"
                    style={{ maxWidth: '220mm' }}
                  >
                    <div className="flex items-center justify-between mb-3 text-xs text-slate-500 font-bold">
                      <span>صفحة A4 رقم {sheetIdx + 1} من {sheets.length}</span>
                      <span>{sheet.length} ستيكر</span>
                    </div>
                    <div
                      className="grid bg-slate-100 rounded p-2"
                      style={{
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gridTemplateRows: 'repeat(3, minmax(0, 1fr))',
                        gridAutoFlow: 'column',
                        gap: '3mm',
                        minHeight: '260mm',
                      }}
                    >
                      {sheet.map(roll => (
                        <LabelCard
                          key={roll.rollId}
                          roll={roll}
                          config={effectiveLabelConfig}
                          widthMm={94}
                          heightMm={91}
                        />
                      ))}
                      {/* Empty cells for visual completeness when last sheet < 6 */}
                      {Array.from({ length: SHEET_SIZE - sheet.length }).map((_, i) => (
                        <div
                          key={`empty-${i}`}
                          className="border-2 border-dashed border-slate-200 rounded bg-white/40 flex items-center justify-center text-slate-300 text-xs"
                          style={{ minHeight: '85mm' }}
                        >
                          فارغ
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          ) : (
            <div
              className="grid gap-4 p-4 bg-slate-100 rounded-xl border border-slate-200 overflow-x-auto"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100mm, 1fr))' }}
            >
              {orderedPreviewRolls.map(roll => (
                <LabelCard
                  key={roll.rollId}
                  roll={roll}
                  config={effectiveLabelConfig}
                  widthMm={template?.width_mm ?? 100}
                  heightMm={template?.height_mm ?? 80}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* â”€â”€ Step 3: Done â”€â”€ */}
      {step === 'done' && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-4">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${printSuccess ? 'bg-emerald-100' : 'bg-rose-100'}`}>
            {printSuccess
              ? <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              : <XCircle className="w-8 h-8 text-rose-600" />}
          </div>
          <h3 className="text-xl font-bold text-slate-900">
            {printSuccess ? 'تمت الطباعة بنجاح!' : 'فشلت الطباعة'}
          </h3>
          <p className="text-slate-500 text-sm">
            {orderedPreviewRolls.length} لصاقة — مهمة الطباعة مسجلة
          </p>
          <div className="flex justify-center gap-3 flex-wrap">
            <button
              onClick={() => { setStep('select'); setPreviewRolls([]); setSelectedIds(new Set()); setPrintJobId(null); setPrintSuccess(null); }}
              className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition text-sm"
            >
              <Tags className="w-4 h-4" /> طباعة جديدة
            </button>
            <Link to="/inventory/print-jobs" className="flex items-center gap-2 border border-slate-200 text-slate-700 px-5 py-2.5 rounded-xl font-bold hover:bg-slate-50 transition text-sm">
              <Printer className="w-4 h-4" /> سجل الطباعة
            </Link>
            <Link to="/inventory" className="flex items-center gap-2 border border-slate-200 text-slate-700 px-5 py-2.5 rounded-xl font-bold hover:bg-slate-50 transition text-sm">
              <Package className="w-4 h-4" /> المخزون
            </Link>
          </div>
        </div>
      )}

      {/* â”€â”€ Browser print confirm dialog (non-silent only) â”€â”€ */}
      {showConfirmDialog && (
        <PrintConfirmDialog
          rollCount={orderedPreviewRolls.length}
          onConfirm={confirmPrintSuccess}
          onFail={confirmPrintFail}
          onClose={() => setShowConfirmDialog(false)}
        />
      )}
    </div>
  );
};
