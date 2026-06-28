import React, { useMemo, useState } from 'react';
import { Eye, Loader2, Printer, Save, VolumeX, X } from 'lucide-react';
import type { CartelaColorSwatchDto } from '../../lib/api/cartelaColorApi';
import { cartelaColorDisplayName } from '../../lib/api/cartelaColorApi';
import {
  DEFAULT_CARTELA_COLOR_PRINT_SETTINGS,
  loadCartelaColorPrintSettings,
  normalizeCartelaColorPrintSettings,
  saveCartelaColorPrintSettings,
  stripPageHeightMm,
  stripPageWidthMm,
  type CartelaColorPrintSettings,
} from '../../lib/cartela/cartelaColorPrintSettings';
import {
  buildCartelaColorStripPreviewHtml,
  buildCartelaColorStripRowsHtml,
  chunkCartelaColorCells,
  type CartelaColorStickerCell,
} from '../../lib/printing/renderCartelaColorBarcode';
import { canUseSilentLabelPrinting, getPrintAdapter, isElectronRenderer } from '../../lib/printing/printAdapters';
import { useElectronSettings } from '../../lib/electron/useElectronSettings';
import { useToast } from '../NonBlockingToast';

type PrintMode = 'dialog' | 'silent';

type Props = {
  colors: CartelaColorSwatchDto[];
  onClose: () => void;
};

function PreviewFrame({ html }: { html: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-100 p-3 overflow-auto max-h-[320px]">
      <iframe
        title="معاينة باركود الألوان"
        srcDoc={html}
        className="w-full min-h-[120px] bg-white border-0"
        style={{ height: '200px' }}
      />
    </div>
  );
}

export const CartelaColorBatchPrintModal: React.FC<Props> = ({ colors, onClose }) => {
  const { showToast } = useToast();
  const { settings: electronSettings } = useElectronSettings();
  const canSilent = canUseSilentLabelPrinting({
    silentLabelPrintingEnabled: electronSettings?.silentLabelPrintingEnabled,
    defaultLabelPrinterName: electronSettings?.defaultLabelPrinterName,
  });

  const [printSettings, setPrintSettings] = useState<CartelaColorPrintSettings>(() => loadCartelaColorPrintSettings());
  const [busy, setBusy] = useState<PrintMode | null>(null);

  const cells = useMemo<CartelaColorStickerCell[]>(
    () =>
      colors.map((color) => ({
        barcodeCode: color.barcode_code,
        displayCode: color.color_code,
        subtitle: printSettings.showColorName ? cartelaColorDisplayName(color) : undefined,
      })),
    [colors, printSettings.showColorName],
  );

  const rows = useMemo(() => chunkCartelaColorCells(cells), [cells]);
  const previewHtml = useMemo(
    () => buildCartelaColorStripPreviewHtml(rows, printSettings),
    [rows, printSettings],
  );
  const stripCount = rows.length;
  const pageWidth = stripPageWidthMm(printSettings);
  const pageHeight = stripPageHeightMm(printSettings);

  const patchSetting = <K extends keyof CartelaColorPrintSettings>(key: K, value: CartelaColorPrintSettings[K]) => {
    setPrintSettings((prev) => normalizeCartelaColorPrintSettings({ ...prev, [key]: value }));
  };

  const handleSaveDefaults = () => {
    const saved = saveCartelaColorPrintSettings(printSettings);
    setPrintSettings(saved);
    showToast({ type: 'success', message: 'تم حفظ إعدادات طباعة الألوان كافتراضي' });
  };

  const runPrint = async (mode: PrintMode) => {
    if (!colors.length) {
      showToast({ type: 'warning', message: 'اختر لوناً واحداً على الأقل' });
      return;
    }
    setBusy(mode);
    try {
      let html = buildCartelaColorStripRowsHtml(rows, printSettings);
      if (printSettings.copies > 1) {
        const repeatedRows = Array.from({ length: printSettings.copies }, () => rows).flat();
        html = buildCartelaColorStripRowsHtml(repeatedRows, printSettings);
      }
      const adapter = getPrintAdapter();
      const result = await adapter.print(html, {
        pageSize: 'label',
        widthMm: pageWidth,
        heightMm: pageHeight,
        copies: 1,
        silent: mode === 'silent',
        printerName: mode === 'silent' ? electronSettings?.defaultLabelPrinterName || undefined : undefined,
      });
      showToast({
        type: result.ok ? 'success' : 'error',
        message: result.ok
          ? `تم إرسال ${stripCount} سطر (3×1) للطباعة`
          : result.error || 'فشلت الطباعة',
      });
      if (result.ok) onClose();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'فشلت الطباعة' });
    } finally {
      setBusy(null);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[95vh] overflow-hidden border border-slate-200 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 bg-violet-50 flex items-center justify-between gap-3">
          <div>
            <h4 className="font-bold text-slate-900">طباعة باركود الألوان — 3 مربعات في السطر</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              {colors.length} لون · {stripCount} سطر/ستيكer · Code128 فقط · {pageWidth.toFixed(1)}×{pageHeight.toFixed(1)} mm
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/80 text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5 overflow-y-auto">
          <div className="space-y-3">
            <h5 className="text-sm font-bold text-slate-800">إعدادات الطباعة</h5>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-600">عرض المربع (mm)</span>
                <input
                  type="number"
                  min={12}
                  max={40}
                  step={0.5}
                  value={printSettings.cellWidthMm}
                  onChange={(e) => patchSetting('cellWidthMm', Number(e.target.value))}
                  className={inputCls}
                  dir="ltr"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-600">ارتفاع المربع (mm)</span>
                <input
                  type="number"
                  min={8}
                  max={25}
                  step={0.5}
                  value={printSettings.cellHeightMm}
                  onChange={(e) => patchSetting('cellHeightMm', Number(e.target.value))}
                  className={inputCls}
                  dir="ltr"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-600">المسافة بين المربعات (mm)</span>
                <input
                  type="number"
                  min={0}
                  max={6}
                  step={0.5}
                  value={printSettings.gapMm}
                  onChange={(e) => patchSetting('gapMm', Number(e.target.value))}
                  className={inputCls}
                  dir="ltr"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-600">ارتفاع الباركود (mm)</span>
                <input
                  type="number"
                  min={4}
                  max={14}
                  step={0.5}
                  value={printSettings.barcodeHeightMm}
                  onChange={(e) => patchSetting('barcodeHeightMm', Number(e.target.value))}
                  className={inputCls}
                  dir="ltr"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-600">حجم خط كود اللون (pt)</span>
                <input
                  type="number"
                  min={4}
                  max={12}
                  step={0.5}
                  value={printSettings.codeFontPt}
                  onChange={(e) => patchSetting('codeFontPt', Number(e.target.value))}
                  className={inputCls}
                  dir="ltr"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-600">عدد النسخ</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={printSettings.copies}
                  onChange={(e) => patchSetting('copies', Number(e.target.value))}
                  className={inputCls}
                  dir="ltr"
                />
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={printSettings.showColorName}
                onChange={(e) => patchSetting('showColorName', e.target.checked)}
                className="accent-violet-600"
              />
              إظهار اسم اللون تحت الكود (اختياري)
            </label>
            <button
              type="button"
              onClick={handleSaveDefaults}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800 hover:bg-violet-100"
            >
              <Save className="w-3.5 h-3.5" />
              حفظ الإعدادات كافتراضي
            </button>
            <button
              type="button"
              onClick={() => setPrintSettings(DEFAULT_CARTELA_COLOR_PRINT_SETTINGS)}
              className="block text-xs text-slate-500 hover:text-slate-700 underline"
            >
              استعادة الافتراضي ({DEFAULT_CARTELA_COLOR_PRINT_SETTINGS.cellWidthMm}×
              {DEFAULT_CARTELA_COLOR_PRINT_SETTINGS.cellHeightMm} mm)
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Eye className="w-4 h-4 text-violet-600" />
              معاينة قبل الطباعة
            </div>
            <PreviewFrame html={previewHtml} />
            <ul className="text-xs text-slate-600 space-y-1 max-h-28 overflow-y-auto">
              {colors.map((color) => (
                <li key={color.id} className="font-mono" dir="ltr">
                  {color.color_code} → {color.barcode_code}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void runPrint('dialog')}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-black disabled:opacity-50"
          >
            {busy === 'dialog' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            طباعة
          </button>
          {canSilent && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void runPrint('silent')}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === 'silent' ? <Loader2 className="w-4 h-4 animate-spin" /> : <VolumeX className="w-4 h-4" />}
              طباعة صامتة (Zebra)
            </button>
          )}
          {!canSilent && isElectronRenderer() && (
            <span className="text-xs text-slate-500 self-center">فعّل الطابعة الافتراضية للصامت</span>
          )}
        </div>
      </div>
    </div>
  );
};
