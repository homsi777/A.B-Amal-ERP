import React, { useMemo, useState } from 'react';
import { ArrowRight, FileDown, Languages, Printer, RefreshCw, Settings, Tags, Type, VolumeX } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { BRAND } from '../../branding';
import { thermalBrandLogoBlockCss, thermalBrandLogoHtml } from '../../lib/printing/thermalBrandLogo';
import { ElectronPrintAdapter } from '../../lib/printing/electronPrintAdapter';
import { canUseSilentLabelPrinting, getPrintAdapter, isElectronRenderer } from '../../lib/printing/printAdapters';
import { useElectronSettings } from '../../lib/electron/useElectronSettings';

type CustomStickerField = {
  id: string;
  label: string;
  value: string;
};

type PrintMode = 'dialog' | 'silent' | 'pdf';
type StickerInputMode = 'fields' | 'free';
type StickerTextDirection = 'rtl' | 'ltr';

const FONT_SCALE_MIN = 80;
const FONT_SCALE_MAX = 160;
const FONT_SCALE_DEFAULT = 115;

/** Base font sizes (pt) before user scale is applied. */
const FONT_BASE = {
  title: 10,
  label: 8,
  sep: 8,
  value: 10.5,
  free: 10,
  note: 8,
  footer: 6,
} as const;

function scaledPt(base: number, fontScale: number): string {
  return `${((base * fontScale) / 100).toFixed(2)}pt`;
}

const defaultFields: CustomStickerField[] = [
  { id: 'article', label: 'Article Code', value: 'VISKON KETEN' },
  { id: 'color', label: 'Colour', value: 'KASAR / 11' },
  { id: 'meters', label: 'Meters', value: '125.00 MTS.' },
  { id: 'weight', label: 'Net Weight', value: '35.20 KGS.' },
  { id: 'lot', label: 'Lot Nr', value: 'LOT 1' },
];

const esc = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] || char));

function buildCustomStickerHtml(input: {
  widthMm: number;
  heightMm: number;
  useBrandLogo: boolean;
  brandName: string;
  subtitle: string;
  title: string;
  inputMode: StickerInputMode;
  freeText: string;
  fields: CustomStickerField[];
  note: string;
  footer: string;
  textDirection: StickerTextDirection;
  fontScale: number;
}) {
  const compact = input.heightMm <= 65;
  const isRtl = input.textDirection === 'rtl';
  const textAlign = isRtl ? 'right' : 'left';
  const fs = input.fontScale / 100;
  const brandBlock = input.useBrandLogo
    ? `<header class="brand">${thermalBrandLogoHtml({ compact, maxWidthMm: Math.min(input.widthMm - 8, 82) })}</header>`
    : `<header class="brand">
        <div class="brand-name">${esc(input.brandName)}</div>
        <div class="subtitle">${esc(input.subtitle)}</div>
      </header>`;

  const rows = input.fields
    .filter((field) => field.label.trim() || field.value.trim())
    .map((field) => `
      <div class="row row-${input.textDirection}">
        <span class="label">${esc(field.label)}</span>
        <span class="sep">:</span>
        <span class="value">${esc(field.value)}</span>
      </div>
    `)
    .join('');

  const modeClass = isRtl ? 'mode-rtl' : 'mode-ltr';

  return `<!doctype html>
<html lang="${isRtl ? 'ar' : 'en'}" dir="${input.textDirection}">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: ${input.widthMm}mm ${input.heightMm}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; direction: ${input.textDirection}; }
    body { background: #fff; font-family: Tahoma, Arial, 'Segoe UI', 'Noto Sans Arabic', sans-serif; color: #050505; text-align: ${textAlign}; }
    .sheet { width: ${input.widthMm}mm; height: ${input.heightMm}mm; padding: 2mm; page-break-after: always; direction: ${input.textDirection}; }
    .label-box {
      width: 100%; height: 100%; border: 0.45mm solid #000; padding: 2mm;
      display: flex; flex-direction: column; overflow: hidden;
      direction: ${input.textDirection}; text-align: ${textAlign};
    }
    .label-box.${modeClass} { align-items: stretch; }
    .label-box.mode-rtl .rows { align-items: flex-end; }
    .label-box.mode-ltr .rows { align-items: flex-start; }
    ${input.useBrandLogo ? thermalBrandLogoBlockCss({ compact, maxWidthMm: Math.min(input.widthMm - 8, 82) }) : '.brand { text-align: center; border-bottom: 0.25mm solid #000; padding-bottom: 1.2mm; margin-bottom: 1.4mm; }'}
    .brand-name { font-size: ${scaledPt(17, input.fontScale)}; font-weight: 900; letter-spacing: 2px; line-height: 1; }
    .subtitle { font-size: ${scaledPt(6.5, input.fontScale)}; font-weight: 700; letter-spacing: 2px; margin-top: 0.7mm; }
    .title { text-align: center; font-size: ${scaledPt(FONT_BASE.title, input.fontScale)}; font-weight: 900; border-bottom: 0.25mm solid #000; padding-bottom: 1.2mm; margin-bottom: 1.5mm; direction: ${input.textDirection}; unicode-bidi: plaintext; }
    .rows { flex: 1; display: flex; flex-direction: column; gap: ${(1.2 * fs).toFixed(2)}mm; min-height: 0; justify-content: flex-start; width: 100%; }
    .row { display: flex; align-items: baseline; gap: ${(1 * fs).toFixed(2)}mm; width: 100%; }
    /* RTL: اسم الحقل يمين، ثم :، ثم القيمة — قراءة من اليمين لليسار */
    .row-rtl {
      flex-direction: row;
      direction: rtl;
      justify-content: flex-start;
      width: fit-content;
      max-width: 100%;
      margin-inline-end: auto;
    }
    .row-ltr {
      flex-direction: row;
      direction: ltr;
      justify-content: flex-start;
    }
    .label { flex: 0 0 auto; font-size: ${scaledPt(FONT_BASE.label, input.fontScale)}; font-weight: 700; color: #1f2937; white-space: nowrap; unicode-bidi: plaintext; }
    .sep { flex: 0 0 auto; font-size: ${scaledPt(FONT_BASE.sep, input.fontScale)}; font-weight: 700; }
    .row-rtl .label { text-align: right; }
    .row-rtl .value { flex: 0 1 auto; min-width: 0; text-align: right; unicode-bidi: plaintext; }
    .row-ltr .label { text-align: left; }
    .row-ltr .value { flex: 1 1 auto; min-width: 0; text-align: left; unicode-bidi: plaintext; }
    .value { font-size: ${scaledPt(FONT_BASE.value, input.fontScale)}; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .free { flex: 1; min-height: 0; font-size: ${scaledPt(FONT_BASE.free, input.fontScale)}; font-weight: 700; line-height: 1.45; white-space: pre-wrap; overflow: hidden; direction: ${input.textDirection}; text-align: ${textAlign}; unicode-bidi: plaintext; }
    .note { min-height: 10mm; border-top: 0.25mm solid #000; margin-top: 1.5mm; padding-top: 1mm; font-size: ${scaledPt(FONT_BASE.note, input.fontScale)}; font-weight: 700; line-height: 1.35; overflow: hidden; white-space: pre-wrap; direction: ${input.textDirection}; text-align: ${textAlign}; unicode-bidi: plaintext; }
    .footer { border-top: 0.25mm solid #000; text-align: center; font-size: ${scaledPt(FONT_BASE.footer, input.fontScale)}; font-weight: 800; padding-top: 0.8mm; margin-top: 1mm; letter-spacing: 0.4px; direction: ${input.textDirection}; unicode-bidi: plaintext; }
    @media screen {
      body { background: #e2e8f0; padding: 16px; }
      .sheet { background: #fff; box-shadow: 0 18px 45px rgba(15,23,42,.18); }
    }
  </style>
</head>
<body dir="${input.textDirection}">
  <main class="sheet">
    <section class="label-box ${modeClass}">
      ${brandBlock}
      <div class="title">${esc(input.title)}</div>
      ${
        input.inputMode === 'free'
          ? `<section class="free">${esc(input.freeText)}</section>`
          : `<section class="rows">${rows}</section>`
      }
      ${input.note.trim() ? `<section class="note">${esc(input.note)}</section>` : ''}
      ${input.footer.trim() ? `<footer class="footer">${esc(input.footer)}</footer>` : ''}
    </section>
  </main>
</body>
</html>`;
}

export const CustomStickerPrinting: React.FC = () => {
  const navigate = useNavigate();
  const { settings } = useElectronSettings();
  const canSilent = canUseSilentLabelPrinting({
    silentLabelPrintingEnabled: settings?.silentLabelPrintingEnabled,
    defaultLabelPrinterName: settings?.defaultLabelPrinterName,
  });

  const [useBrandLogo, setUseBrandLogo] = useState(true);
  const [brandName, setBrandName] = useState(BRAND.name);
  const [subtitle, setSubtitle] = useState(BRAND.tagline);
  const [title, setTitle] = useState('CUSTOM FABRIC LABEL');
  const [note, setNote] = useState('Special customer label - owner custom data');
  const [footer, setFooter] = useState('THE CLAIMS WILL NOT BE ACCEPTABLE AFTER GOODS WERE CUT');
  const [inputMode, setInputMode] = useState<StickerInputMode>('fields');
  const [textDirection, setTextDirection] = useState<StickerTextDirection>('rtl');
  const [fontScale, setFontScale] = useState(FONT_SCALE_DEFAULT);
  const [freeText, setFreeText] = useState('اكتب هنا أي نص حر يريده المحاسب.\nيمكن كتابة عدة أسطر بدون قيود حقول.');
  const [widthMm, setWidthMm] = useState(100);
  const [heightMm, setHeightMm] = useState(80);
  const [copies, setCopies] = useState(1);
  const [fields, setFields] = useState<CustomStickerField[]>(defaultFields);
  const [busy, setBusy] = useState<PrintMode | null>(null);
  const [message, setMessage] = useState('');

  const html = useMemo(
    () => buildCustomStickerHtml({ widthMm, heightMm, useBrandLogo, brandName, subtitle, title, inputMode, freeText, fields, note, footer, textDirection, fontScale }),
    [brandName, fields, footer, fontScale, freeText, heightMm, inputMode, note, subtitle, textDirection, title, useBrandLogo, widthMm],
  );

  const updateField = (id: string, patch: Partial<CustomStickerField>) => {
    setFields((current) => current.map((field) => (field.id === id ? { ...field, ...patch } : field)));
  };

  const addField = () => {
    const id = `custom-${Date.now()}`;
    setFields((current) => [...current, { id, label: 'Label', value: 'Value' }]);
  };

  const removeField = (id: string) => {
    setFields((current) => (current.length <= 1 ? current : current.filter((field) => field.id !== id)));
  };

  const resetDefaults = () => {
    setUseBrandLogo(true);
    setBrandName(BRAND.name);
    setSubtitle(BRAND.tagline);
    setTitle('CUSTOM FABRIC LABEL');
    setNote('Special customer label - owner custom data');
    setFooter('THE CLAIMS WILL NOT BE ACCEPTABLE AFTER GOODS WERE CUT');
    setInputMode('fields');
    setTextDirection('rtl');
    setFontScale(FONT_SCALE_DEFAULT);
    setFreeText('اكتب هنا أي نص حر يريده المحاسب.\nيمكن كتابة عدة أسطر بدون قيود حقول.');
    setWidthMm(100);
    setHeightMm(80);
    setCopies(1);
    setFields(defaultFields);
    setMessage('');
  };

  const runPrint = async (mode: PrintMode) => {
    setBusy(mode);
    setMessage('');
    try {
      if (mode === 'pdf') {
        if (!isElectronRenderer()) {
          setMessage('تصدير PDF متاح داخل تطبيق Windows فقط.');
          return;
        }
        const adapter = new ElectronPrintAdapter();
        const result = await adapter.exportToPdf(html, {
          pageSize: 'ROLL_LABEL',
          widthMm,
          heightMm,
          defaultFileName: `custom-label-${new Date().toISOString().slice(0, 10)}.pdf`,
        });
        setMessage(result.ok ? 'تم تصدير PDF بنجاح.' : result.error || 'فشل تصدير PDF.');
        return;
      }

      const adapter = getPrintAdapter();
      const result = await adapter.print(html, {
        pageSize: 'label',
        widthMm,
        heightMm,
        copies,
        silent: mode === 'silent',
        printerName: mode === 'silent' ? settings?.defaultLabelPrinterName || undefined : undefined,
      });
      setMessage(result.ok ? 'تم إرسال الستيكر للطباعة.' : result.error || 'فشلت الطباعة.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'حدث خطأ أثناء الطباعة.');
    } finally {
      setBusy(null);
    }
  };

  const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="max-w-7xl mx-auto space-y-6" dir="rtl">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Tags className="w-6 h-6 text-indigo-600" />
              طباعة ستيكر خاص
            </h2>
            <p className="text-slate-500 mt-1 text-sm">حقول مخصصة ومعاينة حية بمقاس افتراضي 100×80 مم.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canSilent ? (
            <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full text-xs font-bold">
              <VolumeX className="w-3 h-3" /> طباعة صامتة: {settings?.defaultLabelPrinterName}
            </span>
          ) : (
            <Link to="/settings?tab=desktop" className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 border border-slate-200 text-slate-600 rounded-full text-xs hover:bg-slate-200 transition">
              <Settings className="w-3 h-3" /> إعداد طابعة افتراضية
            </Link>
          )}
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(360px,520px)] gap-6 items-start">
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={useBrandLogo}
                onChange={(e) => setUseBrandLogo(e.target.checked)}
                className="accent-indigo-600"
              />
              شعار CLOTEX الرسمي (مناسب للطباعة الحرارية — حرف X يظهر أسود)
            </label>
            {!useBrandLogo && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                <label className="space-y-1.5">
                  <span className="text-sm font-bold text-slate-700">اسم العلامة (نص بديل)</span>
                  <input value={brandName} onChange={(e) => setBrandName(e.target.value)} className={inputCls} />
                </label>
                <label className="space-y-1.5">
                  <span className="text-sm font-bold text-slate-700">السطر الفرعي</span>
                  <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className={inputCls} />
                </label>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1.5 md:col-span-2">
              <span className="text-sm font-bold text-slate-700">عنوان الستيكر</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} dir={textDirection} />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="space-y-1.5">
              <span className="text-sm font-bold text-slate-700">العرض mm</span>
              <input type="number" min={30} max={210} value={widthMm} onChange={(e) => setWidthMm(Math.max(30, Number(e.target.value) || 100))} className={inputCls} />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-bold text-slate-700">الارتفاع mm</span>
              <input type="number" min={20} max={297} value={heightMm} onChange={(e) => setHeightMm(Math.max(20, Number(e.target.value) || 80))} className={inputCls} />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-bold text-slate-700">عدد النسخ</span>
              <input type="number" min={1} max={100} value={copies} onChange={(e) => setCopies(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} className={inputCls} />
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Languages className="w-4 h-4 text-indigo-600" />
              اتجاه النص على الستيكر
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1.5">
              <button
                type="button"
                onClick={() => setTextDirection('rtl')}
                className={`rounded-md px-3 py-1.5 text-sm font-bold transition ${
                  textDirection === 'rtl'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                يمين ← يسار (عربي)
              </button>
              <button
                type="button"
                onClick={() => setTextDirection('ltr')}
                className={`rounded-md px-3 py-1.5 text-sm font-bold transition ${
                  textDirection === 'ltr'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                يسار → يمين (إنجليزي)
              </button>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <Type className="w-4 h-4 text-indigo-600" />
                حجم الخط على الستيكر
              </div>
              <span className="rounded-full bg-white border border-slate-200 px-2.5 py-0.5 text-xs font-bold text-indigo-700" dir="ltr">
                {fontScale}%
              </span>
            </div>
            <input
              type="range"
              min={FONT_SCALE_MIN}
              max={FONT_SCALE_MAX}
              step={5}
              value={fontScale}
              onChange={(e) => setFontScale(Number(e.target.value))}
              className="w-full accent-indigo-600"
            />
            <div className="flex justify-between text-[11px] font-bold text-slate-500">
              <span>أصغر ({FONT_SCALE_MIN}%)</span>
              <span>افتراضي ({FONT_SCALE_DEFAULT}%)</span>
              <span>أكبر ({FONT_SCALE_MAX}%)</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1.5">
              <button
                type="button"
                onClick={() => setInputMode('fields')}
                className={`rounded-md px-3 py-1.5 text-sm font-bold transition ${
                  inputMode === 'fields'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                كتابة بالخانات
              </button>
              <button
                type="button"
                onClick={() => setInputMode('free')}
                className={`rounded-md px-3 py-1.5 text-sm font-bold transition ${
                  inputMode === 'free'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                كتابة حرة
              </button>
            </div>

            {inputMode === 'free' && (
              <label className="space-y-1.5 block">
                <span className="text-sm font-bold text-slate-700">النص الحر (بدون أسطر حقول)</span>
                <textarea
                  rows={8}
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  className={inputCls}
                  dir={textDirection}
                  placeholder="اكتب أي نص تريده هنا، وسيتم طباعته كما هو داخل الستيكر."
                />
              </label>
            )}

            {inputMode === 'fields' && (
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Type className="w-4 h-4 text-indigo-600" />
                الحقول المخصصة
              </h3>
              <button type="button" onClick={addField} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700">
                إضافة حقل
              </button>
            </div>
            )}

            {inputMode === 'fields' && (
            <div className="space-y-2">
              {fields.map((field) => (
                <div key={field.id} className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-2">
                  <input value={field.label} onChange={(e) => updateField(field.id, { label: e.target.value })} className={inputCls} placeholder="اسم الحقل" dir={textDirection} />
                  <input value={field.value} onChange={(e) => updateField(field.id, { value: e.target.value })} className={inputCls} placeholder="القيمة" dir={textDirection} />
                  <button type="button" onClick={() => removeField(field.id)} className="px-3 py-2 rounded-lg border border-rose-200 text-rose-600 text-sm font-bold hover:bg-rose-50">
                    حذف
                  </button>
                </div>
              ))}
            </div>
            )}
          </div>

          <label className="space-y-1.5 block">
            <span className="text-sm font-bold text-slate-700">ملاحظات داخل الستيكر</span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} dir={textDirection} />
          </label>

          <label className="space-y-1.5 block">
            <span className="text-sm font-bold text-slate-700">سطر أسفل الستيكر</span>
            <input value={footer} onChange={(e) => setFooter(e.target.value)} className={inputCls} dir={textDirection} />
          </label>

          <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
            <button type="button" onClick={() => void runPrint('dialog')} disabled={Boolean(busy)} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy === 'dialog' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              طباعة
            </button>
            {canSilent && (
              <button type="button" onClick={() => void runPrint('silent')} disabled={Boolean(busy)} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy === 'silent' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <VolumeX className="w-4 h-4" />}
                طباعة صامتة
              </button>
            )}
            {isElectronRenderer() && (
              <button type="button" onClick={() => void runPrint('pdf')} disabled={Boolean(busy)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {busy === 'pdf' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                تصدير PDF
              </button>
            )}
            <button type="button" onClick={resetDefaults} disabled={Boolean(busy)} className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              استعادة الافتراضي
            </button>
          </div>
        </section>

        <aside className="bg-slate-100 rounded-xl border border-slate-200 p-4 overflow-auto">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-bold text-slate-800">معاينة حية</span>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {textDirection === 'rtl' ? 'RTL عربي' : 'LTR إنجليزي'}
              </span>
              <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600" dir="ltr">
                {fontScale}%
              </span>
              <span className="font-mono text-xs text-slate-500" dir="ltr">{widthMm}mm × {heightMm}mm</span>
            </div>
          </div>
          <div className="origin-top-right" style={{ width: `${widthMm}mm`, maxWidth: '100%' }}>
            <iframe
              title="custom-sticker-preview"
              srcDoc={html}
              className="bg-white border border-slate-300"
              style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, maxWidth: '100%' }}
            />
          </div>
        </aside>
      </div>
    </div>
  );
};
