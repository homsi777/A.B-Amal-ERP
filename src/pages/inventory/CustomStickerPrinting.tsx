import React, { useMemo, useState } from 'react';
import { ArrowRight, FileDown, Printer, RefreshCw, Settings, Tags, Type, VolumeX } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { BRAND } from '../../branding';
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
  brandName: string;
  subtitle: string;
  title: string;
  inputMode: StickerInputMode;
  freeText: string;
  fields: CustomStickerField[];
  note: string;
  footer: string;
}) {
  const rows = input.fields
    .filter((field) => field.label.trim() || field.value.trim())
    .map((field) => `
      <div class="row">
        <span class="label">${esc(field.label)}</span>
        <span class="sep">:</span>
        <span class="value">${esc(field.value)}</span>
      </div>
    `)
    .join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: ${input.widthMm}mm ${input.heightMm}mm; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; font-family: Arial, Tahoma, sans-serif; color: #050505; }
    .sheet { width: ${input.widthMm}mm; height: ${input.heightMm}mm; padding: 2mm; page-break-after: always; }
    .label-box { width: 100%; height: 100%; border: 0.45mm solid #000; padding: 2mm; display: flex; flex-direction: column; overflow: hidden; }
    .brand { text-align: center; border-bottom: 0.25mm solid #000; padding-bottom: 1.2mm; margin-bottom: 1.4mm; }
    .brand-name { font-size: 17pt; font-weight: 900; letter-spacing: 2px; line-height: 1; }
    .subtitle { font-size: 6.5pt; font-weight: 700; letter-spacing: 2px; margin-top: 0.7mm; }
    .title { text-align: center; font-size: 10pt; font-weight: 900; border-bottom: 0.25mm solid #000; padding-bottom: 1.2mm; margin-bottom: 1.5mm; }
    .rows { flex: 1; display: flex; flex-direction: column; gap: 0.8mm; min-height: 0; }
    .row { display: grid; grid-template-columns: 24mm 2.5mm 1fr; gap: 0.8mm; align-items: baseline; direction: ltr; }
    .label { font-size: 7pt; font-weight: 700; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sep { font-size: 7pt; font-weight: 700; text-align: center; }
    .value { font-size: 9pt; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .free { flex: 1; min-height: 0; font-size: 9pt; font-weight: 700; line-height: 1.45; white-space: pre-wrap; overflow: hidden; }
    .note { min-height: 10mm; border-top: 0.25mm solid #000; margin-top: 1.5mm; padding-top: 1mm; font-size: 7.5pt; font-weight: 700; line-height: 1.35; overflow: hidden; white-space: pre-wrap; }
    .footer { border-top: 0.25mm solid #000; text-align: center; font-size: 5.8pt; font-weight: 800; padding-top: 0.8mm; margin-top: 1mm; letter-spacing: 0.4px; }
    @media screen {
      body { background: #e2e8f0; padding: 16px; }
      .sheet { background: #fff; box-shadow: 0 18px 45px rgba(15,23,42,.18); }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <section class="label-box">
      <header class="brand">
        <div class="brand-name">${esc(input.brandName)}</div>
        <div class="subtitle">${esc(input.subtitle)}</div>
      </header>
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

  const [brandName, setBrandName] = useState(BRAND.name);
  const [subtitle, setSubtitle] = useState(BRAND.tagline);
  const [title, setTitle] = useState('CUSTOM FABRIC LABEL');
  const [note, setNote] = useState('Special customer label - owner custom data');
  const [footer, setFooter] = useState('THE CLAIMS WILL NOT BE ACCEPTABLE AFTER GOODS WERE CUT');
  const [inputMode, setInputMode] = useState<StickerInputMode>('fields');
  const [freeText, setFreeText] = useState('اكتب هنا أي نص حر يريده المحاسب.\nيمكن كتابة عدة أسطر بدون قيود حقول.');
  const [widthMm, setWidthMm] = useState(100);
  const [heightMm, setHeightMm] = useState(80);
  const [copies, setCopies] = useState(1);
  const [fields, setFields] = useState<CustomStickerField[]>(defaultFields);
  const [busy, setBusy] = useState<PrintMode | null>(null);
  const [message, setMessage] = useState('');

  const html = useMemo(
    () => buildCustomStickerHtml({ widthMm, heightMm, brandName, subtitle, title, inputMode, freeText, fields, note, footer }),
    [brandName, fields, footer, freeText, heightMm, inputMode, note, subtitle, title, widthMm],
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
    setBrandName(BRAND.name);
    setSubtitle(BRAND.tagline);
    setTitle('CUSTOM FABRIC LABEL');
    setNote('Special customer label - owner custom data');
    setFooter('THE CLAIMS WILL NOT BE ACCEPTABLE AFTER GOODS WERE CUT');
    setInputMode('fields');
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1.5">
              <span className="text-sm font-bold text-slate-700">اسم العلامة</span>
              <input value={brandName} onChange={(e) => setBrandName(e.target.value)} className={inputCls} />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-bold text-slate-700">السطر الفرعي</span>
              <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className={inputCls} />
            </label>
            <label className="space-y-1.5 md:col-span-2">
              <span className="text-sm font-bold text-slate-700">عنوان الستيكر</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
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
                  <input value={field.label} onChange={(e) => updateField(field.id, { label: e.target.value })} className={inputCls} placeholder="اسم الحقل" />
                  <input value={field.value} onChange={(e) => updateField(field.id, { value: e.target.value })} className={inputCls} placeholder="القيمة" />
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
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </label>

          <label className="space-y-1.5 block">
            <span className="text-sm font-bold text-slate-700">سطر أسفل الستيكر</span>
            <input value={footer} onChange={(e) => setFooter(e.target.value)} className={inputCls} />
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
          <div className="mb-3 flex items-center justify-between gap-2 text-sm">
            <span className="font-bold text-slate-800">معاينة حية</span>
            <span className="font-mono text-xs text-slate-500" dir="ltr">{widthMm}mm × {heightMm}mm</span>
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
