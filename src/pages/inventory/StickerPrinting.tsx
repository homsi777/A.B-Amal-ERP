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
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/config';
import {
   Printer, Search, Package, CheckSquare, Square, RefreshCw,
   ArrowRight, ArrowUp, ArrowDown, FileSpreadsheet, Eye, Tags, ScanLine, CheckCircle2, XCircle, AlertTriangle, X,
   VolumeX, FileDown, Settings,
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
import { displayLabelMaterialCode } from '../../lib/importDisplay';
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
  rollLayout?: 'auto' | 'normal' | 'wide';
}

async function triggerPrint(
  rolls: RollLabelPreviewDto[],
  opts: PrintTriggerOptions,
): Promise<PrintResult> {
  const qrSvgs = await generateQrSvgMap(rolls);
  const widthMm = opts.widthMm ?? 100;
  const heightMm = opts.heightMm ?? 80;
  /** Wide roll rotation is for Electron silent print; browser must stay normal or multi-page breaks. */
  const rollLayout =
    opts.rollLayout ??
    (isElectronRenderer() && widthMm > heightMm ? 'auto' : 'normal');
  const html = buildPrintDocument(rolls, { ...opts, widthMm, heightMm, qrSvgs, rollLayout });
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
    return { ok: false, usedSilent: false, error: i18n.t('stickerPrinting:error.pdfExportElectronOnly') };
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
      iframe.onerror = () => reject(new Error(i18n.t('stickerPrinting:error.loadPreviewFailed')));
      iframe.srcdoc = html;
    });

    // Give layout/inline SVG enough time to settle before capture.
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');

    const targetDoc = iframe.contentDocument;
    const targetBody = targetDoc?.body;
    if (!targetDoc || !targetBody) {
      throw new Error(i18n.t('stickerPrinting:error.readPreviewFailed'));
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
          ? i18n.t('stickerPrinting:error.noA4PagesFound')
          : i18n.t('stickerPrinting:error.noLabelElementsFound'),
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
        throw new Error(i18n.t('stickerPrinting:error.captureFailed'));
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
}) => {
  const { t } = useTranslation('stickerPrinting');
  return (
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
    <td className="py-2 px-3 font-mono text-xs text-slate-600">
      {displayLabelMaterialCode({
        internal_code: roll.internal_code,
        supplier_code_item: roll.supplier_code_item,
      }) || '—'}
    </td>
    <td className="py-2 px-3 text-slate-500">{roll.color_name_ar ?? roll.color_name_tr ?? '—'}</td>
    <td className="py-2 px-3 font-mono text-slate-600">
      {roll.length_m ? `${parseFloat(roll.length_m).toFixed(2)} ${t('units.meterAbbr')}` : '—'}
    </td>
    <td className="py-2 px-3">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${
        (roll.label_print_count ?? 0) > 0
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-amber-50 text-amber-700 border-amber-200'
      }`}>
        {(roll.label_print_count ?? 0) > 0 ? t('status.printedCount', { count: roll.label_print_count }) : t('status.notPrinted')}
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
};

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
}) => {
  const { t } = useTranslation('stickerPrinting');
  return (
  <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl">
    <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
          <Printer className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h3 className="font-bold text-slate-900">{t('confirmDialog.title')}</h3>
          <p className="text-sm text-slate-500">{t('confirmDialog.printingCount', { count: rollCount })}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onConfirm}
          className="flex items-center justify-center gap-2 bg-emerald-600 text-white rounded-xl py-3 font-bold hover:bg-emerald-700 transition"
        >
          <CheckCircle2 className="w-4 h-4" /> {t('confirmDialog.yesConfirm')}
        </button>
        <button
          onClick={onFail}
          className="flex items-center justify-center gap-2 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl py-3 font-bold hover:bg-rose-100 transition"
        >
          <XCircle className="w-4 h-4" /> {t('confirmDialog.failed')}
        </button>
      </div>
      <button onClick={onClose} className="w-full text-center text-sm text-slate-400 hover:text-slate-600 transition">
        {t('confirmDialog.ignore')}
      </button>
    </div>
  </div>
  );
};

// â”€â”€â”€ Main page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type Mode = 'selection' | 'batch' | 'single';
type PrintStep = 'select' | 'preview' | 'done';
type LabelPrintSortKey = 'none' | 'fabric' | 'color' | 'fabricCode';

function getLabelPrintSortOptions(): Array<{ value: LabelPrintSortKey; label: string }> {
  return [
    { value: 'color', label: i18n.t('stickerPrinting:sortOptions.color') },
    { value: 'fabricCode', label: i18n.t('stickerPrinting:sortOptions.fabricCode') },
  ];
}

const normalizeSortText = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLocaleLowerCase('ar');

const getLabelPrintSortValue = (roll: RollLabelPreviewDto, key: LabelPrintSortKey) => {
  if (key === 'fabric') return roll.itemName;
  if (key === 'color') return roll.colorNameAr || roll.colorNameTr || roll.colorCode;
  if (key === 'fabricCode') {
    return displayLabelMaterialCode({ internalCode: roll.internalCode, supplierCode: roll.supplierCode });
  }
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
  if (key === 'fabricCode') {
    return displayLabelMaterialCode({
      internal_code: roll.internal_code,
      supplier_code_item: roll.supplier_code_item,
    });
  }
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
  const { t } = useTranslation('stickerPrinting');
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
    if (!rollIds.length) { setPreviewError(t('error.selectAtLeastOneRoll')); return; }
    setPreviewing(true); setPreviewError('');
    try {
      const res = await previewRollLabels(rollIds, template?.id);
      if (!res.data.length) {
        setPreviewError(t('error.noAvailableRollsSelection'));
        return;
      }
      if (res.data.length < rollIds.length) {
        showToast(
          'info',
          t('toast.excludedRolls', { count: rollIds.length - res.data.length }),
        );
      }
      setPreviewRolls(res.data);
      setTemplate(res.template);
      setStep('preview');
    } catch (e: unknown) {
      setPreviewError((e as { message?: string }).message ?? t('error.loadDataFailed'));
    } finally {
      setPreviewing(false);
    }
  };

  const handleBatchPreview = async () => {
    if (!selectedBatchId) { setPreviewError(t('error.chooseImportBatch')); return; }
    setPreviewing(true); setPreviewError('');
    try {
      const res = await previewBatchLabels(selectedBatchId, template?.id);
      if (!res.data.length) {
        setPreviewError(t('error.noAvailableRollsBatch'));
        return;
      }
      setPreviewRolls(res.data);
      setTemplate(res.template);
      setStep('preview');
    } catch (e: unknown) {
      setPreviewError((e as { message?: string }).message ?? t('error.loadDataFailed'));
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
      setPreviewError((e as { message?: string }).message ?? t('error.printFailed'));
    } finally {
      setPrinting(false);
    }
  };

  // â”€â”€ Silent / Electron print (auto-updates job status, no confirm dialog) â”€â”€
  const handleSilentPrint = async () => {
    if (!previewRolls.length) return;

    if (!settings?.defaultLabelPrinterName) {
      showToast('error', t('toast.silentPrintNoDefaultPrinter'));
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

      showToast('info', t('toast.sendingToPrinter', { printer: settings.defaultLabelPrinterName }));

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
        showToast('success', t('toast.silentPrintSuccess', { count: orderedPreviewRolls.length }));
      } else {
        await updatePrintJobStatus(jobId, 'FAILED', result.error ?? t('error.electronFailed')).catch(() => {});
        setPrintSuccess(false);
        setStep('done');
        showToast('error', result.error ?? t('error.silentPrintFailed'));
      }
    } catch (e: unknown) {
      const errMsg = (e as { message?: string }).message ?? t('error.silentPrintError');
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
        showToast('success', t('toast.pdfExportedFromPreview'));
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
        showToast('success', t('toast.pdfExportSuccess'));
      } else {
        showToast('error', result.error ?? t('error.pdfExportFailed'));
      }
    } catch (e: unknown) {
      showToast('error', (e as { message?: string }).message ?? t('error.pdfExportError'));
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
    if (printJobId) await updatePrintJobStatus(printJobId, 'FAILED', t('status.userReportedFailure')).catch(() => {});
    setShowConfirmDialog(false);
    setPrintSuccess(false);
    setStep('done');
  };

  const inputCls = 'p-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm';
  const effectiveLabelConfig: LabelConfig = {
    ...((template?.content_config as LabelConfig | undefined) ?? {}),
    showBrandLogo,
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
              <Tags className="w-6 h-6 text-indigo-600" /> {t('page.title')}
            </h2>
            <p className="text-slate-500 mt-1 text-sm">{t('page.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Silent print status badge */}
          {isElectronRenderer() && (
            canSilent
              ? (
                <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full text-xs font-bold">
                  <VolumeX className="w-3 h-3" /> {t('header.silentPrintBadge', { printer: settings?.defaultLabelPrinterName })}
                </span>
              ) : (
                <Link
                  to="/settings?tab=desktop"
                  className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 border border-slate-200 text-slate-600 rounded-full text-xs hover:bg-slate-200 transition"
                >
                  <Settings className="w-3 h-3" /> {t('header.setupDefaultPrinter')}
                </Link>
              )
          )}
          <Link to="/inventory/print-jobs" className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition text-sm font-medium">
            <Printer className="w-4 h-4" /> {t('common.printLog')}
          </Link>
        </div>
      </div>

      {/* â”€â”€ Mode tabs (step = select) â”€â”€ */}
      {step === 'select' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex border-b border-slate-200">
            {([
              ['selection', t('tabs.rollSelection'), ScanLine],
              ['batch',     t('tabs.importBatch'), FileSpreadsheet],
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
                    placeholder={t('selection.searchPlaceholder')}
                    className={`${inputCls} w-full pr-9`}
                  />
                </div>
                <select value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)} className={inputCls}>
                  <option value="">{t('selection.allWarehouses')}</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <select value={purchaseScopeFilter} onChange={e => setPurchaseScopeFilter(e.target.value as 'all' | 'purchased' | 'recent')} className={inputCls}>
                  <option value="all">{t('selection.allRolls')}</option>
                  <option value="purchased">{t('selection.purchasedOnly')}</option>
                  <option value="recent">{t('selection.recentPurchases')}</option>
                </select>
                {purchaseScopeFilter === 'recent' && (
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={recentDaysFilter}
                    onChange={e => setRecentDaysFilter(Math.min(365, Math.max(1, Number(e.target.value) || 30)))}
                    className={`${inputCls} w-24`}
                    title={t('selection.daysCountTitle')}
                  />
                )}
                <select value={labelPrintedFilter} onChange={e => setLabelPrintedFilter(e.target.value as '' | 'true' | 'false')} className={inputCls}>
                   <option value="">{t('selection.allPrintStatuses')}</option>
                   <option value="false">{t('selection.unprintedOnly')}</option>
                   <option value="true">{t('selection.printedBefore')}</option>
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
                    {t('common.printByFabric')}
                  </button>
                  {showPrintSortControls && (
                    <select
                      value={printSortBy}
                      onChange={(event) => setPrintSortBy(event.target.value as LabelPrintSortKey)}
                      className={`${inputCls} py-1.5`}
                      title={t('common.sortWithinFabricTitle')}
                    >
                      {getLabelPrintSortOptions().map((option) => (
                        <option key={option.value} value={option.value}>
                          {t('common.thenBySortLabel', { label: option.label })}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                  <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition">
                   {t('common.search')}
                 </button>
              </form>

              {/* Actions bar — أعلى الجدول (ثابت عند التمرير مع آلاف الأتواب) */}
              <div className="sticky top-0 z-20 -mx-4 px-4 py-3 bg-white/95 backdrop-blur-sm border-y border-slate-200 shadow-sm">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <span className="font-bold text-indigo-700">{selectedIds.size}</span> {t('selection.rollsSelectedCount')}
                    <span className="text-slate-400">|</span>
                    <span>{visibleRolls.length.toLocaleString('ar')} {t('selection.rollsAvailableCount')}</span>
                  </div>
                  <div className="flex gap-3 items-center flex-wrap">
                    <button
                      type="button"
                      onClick={toggleAll}
                      disabled={!visibleRolls.length}
                      className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-bold hover:bg-slate-50 disabled:opacity-50"
                    >
                      {t('selection.selectAllVisible')}
                    </button>
                    <button
                      type="button"
                      onClick={selectVisibleUnprinted}
                      disabled={!visibleRolls.some((roll) => (roll.label_print_count ?? 0) === 0)}
                      className="px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-sm font-bold hover:bg-amber-100 disabled:opacity-50"
                    >
                      {t('selection.selectUnprinted')}
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-600">{t('common.pageSizeLabel')}</span>
                      <select value={pageSize} onChange={e => setPageSize(e.target.value as 'label' | 'A4' | 'A4_SHEET_6')} className={`${inputCls} py-1.5`}>
                        <option value="label">{t('pageSize.singleLabel')}</option>
                        <option value="A4">{t('pageSize.a4MultiFlow')}</option>
                        <option value="A4_SHEET_6">{t('pageSize.a4Sheet6')}</option>
                      </select>
                    </div>
                    {previewError && <p className="text-rose-600 text-sm font-bold">{previewError}</p>}
                    <button
                      onClick={() => handlePreview()}
                      disabled={selectedIds.size === 0 || previewing}
                      className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-xl font-bold hover:bg-indigo-700 transition disabled:opacity-50 text-sm"
                    >
                      {previewing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                      {t('selection.previewLabels')}
                    </button>
                  </div>
                </div>
              </div>

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
                      <th className="text-right py-2 px-3 font-bold text-slate-600">{t('table.colBarcode')}</th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">
                        <button onClick={() => handleSort('item_name')} className="flex items-center gap-1 hover:text-indigo-600">
                          {t('table.colFabric')}
                          {sortBy === 'item_name' && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </button>
                      </th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">{t('table.colFabricCode')}</th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">
                        <button onClick={() => handleSort('color_name_ar')} className="flex items-center gap-1 hover:text-indigo-600">
                          {t('table.colColor')}
                          {sortBy === 'color_name_ar' && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </button>
                      </th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">{t('table.colLength')}</th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">{t('table.colStickerPrint')}</th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">{t('table.colWarehouse')}</th>
                      <th className="text-right py-2 px-3 font-bold text-slate-600">{t('table.colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rollsLoading && (
                      <tr><td colSpan={9} className="py-8 text-center text-slate-400"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                    )}
                    {!rollsLoading && visibleRolls.length === 0 && (
                      <tr><td colSpan={9} className="py-8 text-center text-slate-400">{t('table.noRolls')}</td></tr>
                    )}
                    {!rollsLoading && visibleRolls.map(r => (
                      <RollRow key={r.id} roll={r} selected={selectedIds.has(r.id)} onToggle={() => toggleRoll(r.id)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* â”€â”€ Batch mode â”€â”€ */}
          {mode === 'batch' && (
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700">{t('batch.importBatchLabel')}</label>
                <select value={selectedBatchId} onChange={e => setSelectedBatchId(e.target.value)} className={`${inputCls} w-full md:w-96`}>
                  <option value="">{t('batch.chooseConfirmedBatch')}</option>
                  {batches.map(b => (
                    <option key={b.id} value={b.id}>
                      {t('batch.optionLabel', { fileName: b.file_name, count: b.created_roll_count, date: new Date(b.created_at).toLocaleDateString('ar-SA') })}
                    </option>
                  ))}
                </select>
                {batches.length === 0 && (
                  <p className="text-sm text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" /> {t('batch.noConfirmedBatches')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">{t('common.pageSizeLabel')}</span>
                  <select value={pageSize} onChange={e => setPageSize(e.target.value as 'label' | 'A4' | 'A4_SHEET_6')} className={`${inputCls} py-1.5`}>
                    <option value="label">{t('pageSize.singleLabel')}</option>
                    <option value="A4">{t('pageSize.a4MultiFlow')}</option>
                    <option value="A4_SHEET_6">{t('pageSize.a4Sheet6')}</option>
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
                    {t('common.printByFabric')}
                  </button>
                  {showPrintSortControls && (
                    <select
                      value={printSortBy}
                      onChange={(event) => setPrintSortBy(event.target.value as LabelPrintSortKey)}
                      className={`${inputCls} py-1.5`}
                      title={t('common.sortWithinFabricTitle')}
                    >
                      {getLabelPrintSortOptions().map((option) => (
                        <option key={option.value} value={option.value}>
                          {t('common.thenBySortLabel', { label: option.label })}
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
                  {t('batch.previewBatchLabels')}
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
                <p className="font-bold text-slate-900">{t('preview.readyCount', { count: orderedPreviewRolls.length })}</p>
                {template && (
                  <p className="text-xs text-slate-500">{t('preview.templateInfo', { name: template.name, width: template.width_mm, height: template.height_mm })}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-600">{t('preview.sizeLabel')}</span>
                <select value={pageSize} onChange={e => setPageSize(e.target.value as 'label' | 'A4' | 'A4_SHEET_6')} className={`${inputCls} py-1.5`}>
                  <option value="label">{t('pageSize.singleLabel')}</option>
                  <option value="A4">{t('pageSize.a4Multi')}</option>
                  <option value="A4_SHEET_6">{t('pageSize.a4Sheet6')}</option>
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
                  {t('common.printByFabric')}
                </button>
                {showPrintSortControls && (
                  <select
                    value={printSortBy}
                    onChange={(event) => setPrintSortBy(event.target.value as LabelPrintSortKey)}
                    className={`${inputCls} py-1.5`}
                    title={t('common.sortWithinFabricTitle')}
                  >
                    {getLabelPrintSortOptions().map((option) => (
                      <option key={option.value} value={option.value}>
                        {t('common.thenBySortLabel', { label: option.label })}
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
                {showBrandLogo ? t('preview.hideLogo') : t('preview.showLogo')}
              </button>

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
                  {printing ? t('common.printing') : t('preview.silentPrintButton')}
                </button>
              )}

              {/* Silent possible but no printer */}
              {isElectronRenderer() && !canSilent && settings?.silentLabelPrintingEnabled && !settings?.defaultLabelPrinterName && (
                <span className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-xl">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t('preview.noDefaultPrinterWarning')}
                  <Link to="/settings?tab=desktop" className="underline font-bold">{t('common.settingsLink')}</Link>
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
                {printing ? t('common.printing') : isElectronRenderer() ? t('preview.printViaWindows') : t('common.printButton')}
              </button>

              <button
                onClick={handlePdfExport}
                disabled={exportingPdf}
                className="flex items-center gap-2 border border-slate-200 text-slate-700 px-4 py-2 rounded-xl font-bold hover:bg-slate-50 transition disabled:opacity-50 text-sm"
              >
                {exportingPdf
                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : <FileDown className="w-4 h-4" />}
                {isElectronRenderer() ? t('common.exportPdf') : t('preview.exportPdfPreview')}
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
                      <span>{t('sheet.pageLabel', { index: sheetIdx + 1, total: sheets.length })}</span>
                      <span>{t('sheet.stickerCount', { count: sheet.length })}</span>
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
                          {t('sheet.empty')}
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
            {printSuccess ? t('done.success') : t('done.failed')}
          </h3>
          <p className="text-slate-500 text-sm">
            {t('done.jobRecorded', { count: orderedPreviewRolls.length })}
          </p>
          <div className="flex justify-center gap-3 flex-wrap">
            <button
              onClick={() => { setStep('select'); setPreviewRolls([]); setSelectedIds(new Set()); setPrintJobId(null); setPrintSuccess(null); }}
              className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition text-sm"
            >
              <Tags className="w-4 h-4" /> {t('done.newPrint')}
            </button>
            <Link to="/inventory/print-jobs" className="flex items-center gap-2 border border-slate-200 text-slate-700 px-5 py-2.5 rounded-xl font-bold hover:bg-slate-50 transition text-sm">
              <Printer className="w-4 h-4" /> {t('common.printLog')}
            </Link>
            <Link to="/inventory" className="flex items-center gap-2 border border-slate-200 text-slate-700 px-5 py-2.5 rounded-xl font-bold hover:bg-slate-50 transition text-sm">
              <Package className="w-4 h-4" /> {t('done.inventory')}
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
