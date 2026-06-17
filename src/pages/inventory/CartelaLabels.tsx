import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  FileDown,
  Plus,
  Printer,
  RefreshCw,
  Save,
  ScrollText,
  Trash2,
  VolumeX,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  cartelaDtoToPayload,
  cartelaListLabel,
  createCartelaLabel,
  deleteCartelaLabel,
  getCartelaLabel,
  listCartelaLabels,
  updateCartelaLabel,
  type CartelaLabelListItem,
  type CartelaLabelPayload,
} from '../../lib/api/cartelaApi';
import { generateQrSvg } from '../../lib/printing/qrGenerator';
import {
  buildCartelaLabelHtml,
  cartelaQrPayload,
  CARTELA_HEIGHT_MM,
  CARTELA_WIDTH_MM,
  type CartelaLabelData,
} from '../../lib/printing/renderCartelaLabel';
import { ElectronPrintAdapter } from '../../lib/printing/electronPrintAdapter';
import { canUseSilentLabelPrinting, getPrintAdapter, isElectronRenderer } from '../../lib/printing/printAdapters';
import { useElectronSettings } from '../../lib/electron/useElectronSettings';
import { useToast } from '../../components/NonBlockingToast';

type PrintMode = 'dialog' | 'silent' | 'pdf';

const emptyPayload = (): CartelaLabelPayload => ({
  title: '',
  artCode: '',
  designNo: '',
  colour: '',
  widthValue: '',
  widthUnit: 'cm',
  widthToleranceEnabled: true,
  widthTolerancePercent: 3,
  weightValue: '',
  weightUnit: 'gr/m²',
  weightToleranceEnabled: true,
  weightTolerancePercent: 5,
  composition: '',
  serialNo: '',
  showLogo: true,
});

export const CartelaLabels: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { settings } = useElectronSettings();
  const canSilent = canUseSilentLabelPrinting({
    silentLabelPrintingEnabled: settings?.silentLabelPrintingEnabled,
    defaultLabelPrinterName: settings?.defaultLabelPrinterName,
  });

  const [items, setItems] = useState<CartelaLabelListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<CartelaLabelPayload>(emptyPayload());
  const [qrSvg, setQrSvg] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<PrintMode | null>(null);

  const labelData: CartelaLabelData = useMemo(
    () => ({
      artCode: form.artCode,
      designNo: form.designNo,
      colour: form.colour,
      widthValue: form.widthValue,
      widthUnit: form.widthUnit,
      widthToleranceEnabled: form.widthToleranceEnabled,
      widthTolerancePercent: form.widthTolerancePercent,
      weightValue: form.weightValue,
      weightUnit: form.weightUnit,
      weightToleranceEnabled: form.weightToleranceEnabled,
      weightTolerancePercent: form.weightTolerancePercent,
      composition: form.composition,
      serialNo: form.serialNo,
      showLogo: form.showLogo,
      qrSvg,
    }),
    [form, qrSvg],
  );

  const previewHtml = useMemo(() => buildCartelaLabelHtml(labelData), [labelData]);

  const loadList = async () => {
    setListLoading(true);
    try {
      const rows = await listCartelaLabels(search);
      setItems(rows);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر تحميل الكارتيلات' });
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    void generateQrSvg(cartelaQrPayload(form), { size: 96, margin: 0 }).then((svg) => {
      if (!cancelled) setQrSvg(svg);
    });
    return () => {
      cancelled = true;
    };
  }, [form.artCode, form.designNo, form.serialNo]);

  const patchForm = (patch: Partial<CartelaLabelPayload>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const startNew = () => {
    setSelectedId(null);
    setForm(emptyPayload());
  };

  const loadOne = async (id: string) => {
    try {
      const row = await getCartelaLabel(id);
      setSelectedId(id);
      setForm(cartelaDtoToPayload(row));
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر تحميل الكارتيلا' });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (selectedId) {
        const row = await updateCartelaLabel(selectedId, form);
        setForm(cartelaDtoToPayload(row));
        showToast({ type: 'success', message: 'تم حفظ الكارتيلا' });
      } else {
        const row = await createCartelaLabel(form);
        setSelectedId(row.id);
        setForm(cartelaDtoToPayload(row));
        showToast({ type: 'success', message: 'تم إنشاء الكارتيلا' });
      }
      await loadList();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر الحفظ' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!window.confirm('حذف هذه الكارتيلا؟')) return;
    try {
      await deleteCartelaLabel(selectedId);
      startNew();
      await loadList();
      showToast({ type: 'success', message: 'تم الحذف' });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر الحذف' });
    }
  };

  const runPrint = async (mode: PrintMode) => {
    setBusy(mode);
    try {
      if (mode === 'pdf') {
        if (!isElectronRenderer()) {
          showToast({ type: 'warning', message: 'تصدير PDF متاح داخل تطبيق Windows فقط.' });
          return;
        }
        const adapter = new ElectronPrintAdapter();
        const result = await adapter.exportToPdf(previewHtml, {
          pageSize: 'ROLL_LABEL',
          widthMm: CARTELA_WIDTH_MM,
          heightMm: CARTELA_HEIGHT_MM,
          defaultFileName: `cartela-${form.serialNo || 'label'}.pdf`,
        });
        showToast({
          type: result.ok ? 'success' : 'error',
          message: result.ok ? 'تم تصدير PDF' : result.error || 'فشل تصدير PDF',
        });
        return;
      }

      const adapter = getPrintAdapter();
      const result = await adapter.print(previewHtml, {
        pageSize: 'label',
        widthMm: CARTELA_WIDTH_MM,
        heightMm: CARTELA_HEIGHT_MM,
        copies: 1,
        silent: mode === 'silent',
        printerName: mode === 'silent' ? settings?.defaultLabelPrinterName || undefined : undefined,
      });
      showToast({
        type: result.ok ? 'success' : 'error',
        message: result.ok ? 'تم إرسال اللصاقة للطباعة الحرارية' : result.error || 'فشلت الطباعة',
      });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'حدث خطأ أثناء الطباعة' });
    } finally {
      setBusy(null);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="max-w-[1400px] mx-auto space-y-6" dir="rtl">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <ScrollText className="w-6 h-6 text-indigo-600" />
              كارتيله
            </h2>
            <p className="text-slate-500 mt-1 text-sm">
              لصاقة مستقلة 80×50 مم — طباعة حرارية أبيض/أسود — بدون ربط بالمخزون.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => patchForm({ showLogo: !form.showLogo })}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-bold transition ${
              form.showLogo
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            {form.showLogo ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            {form.showLogo ? 'إخفاء شعار CLOTEX' : 'إظهار شعار CLOTEX'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_minmax(300px,420px)] gap-6 items-start">
        <aside className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-slate-900 text-sm">محفوظات الكارتيله</h3>
            <button
              type="button"
              onClick={startNew}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
            >
              <Plus className="w-3.5 h-3.5" />
              جديد
            </button>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void loadList()}
            placeholder="بحث..."
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => void loadList()}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            تحديث القائمة
          </button>
          <div className="max-h-[520px] overflow-y-auto space-y-1">
            {listLoading && <p className="text-xs text-slate-500 p-2">جاري التحميل...</p>}
            {!listLoading && items.length === 0 && (
              <p className="text-xs text-slate-500 p-2">لا توجد كارتيلات محفوظة بعد.</p>
            )}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void loadOne(item.id)}
                className={`w-full text-right rounded-lg border px-3 py-2 transition ${
                  selectedId === item.id
                    ? 'border-indigo-300 bg-indigo-50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="font-bold text-sm text-slate-900">{cartelaListLabel(item)}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{item.serial_no || 'بدون رقم'}</div>
              </button>
            ))}
          </div>
        </aside>

        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <h3 className="font-bold text-slate-900">بيانات اللصاقة</h3>

          <label className="space-y-1 block">
            <span className="text-sm font-bold text-slate-700">اسم مختصر (اختياري)</span>
            <input value={form.title} onChange={(e) => patchForm({ title: e.target.value })} className={inputCls} />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1 block">
              <span className="text-sm font-bold text-slate-700">ART CODE — اسم الخامة</span>
              <input value={form.artCode} onChange={(e) => patchForm({ artCode: e.target.value })} className={inputCls} />
            </label>
            <label className="space-y-1 block">
              <span className="text-sm font-bold text-slate-700">DESIGN NO — كود الدسان</span>
              <input value={form.designNo} onChange={(e) => patchForm({ designNo: e.target.value })} className={inputCls} />
            </label>
            <label className="space-y-1 block">
              <span className="text-sm font-bold text-slate-700">COLOUR — اللون</span>
              <input value={form.colour} onChange={(e) => patchForm({ colour: e.target.value })} className={inputCls} />
            </label>
            <label className="space-y-1 block">
              <span className="text-sm font-bold text-slate-700">COMP. — خليط الخامة</span>
              <input value={form.composition} onChange={(e) => patchForm({ composition: e.target.value })} className={inputCls} />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <span className="text-sm font-bold text-slate-700">WIDTH — عرض الرول</span>
              <div className="flex gap-2">
                <input
                  value={form.widthValue}
                  onChange={(e) => patchForm({ widthValue: e.target.value })}
                  className={inputCls}
                  placeholder="150"
                />
                <input
                  value={form.widthUnit}
                  onChange={(e) => patchForm({ widthUnit: e.target.value })}
                  className="w-20 rounded-lg border border-slate-200 px-2 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={form.widthToleranceEnabled}
                  onChange={(e) => patchForm({ widthToleranceEnabled: e.target.checked })}
                  className="accent-indigo-600"
                />
                ±
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.widthTolerancePercent}
                  disabled={!form.widthToleranceEnabled}
                  onChange={(e) => patchForm({ widthTolerancePercent: Number(e.target.value) || 0 })}
                  className="w-16 rounded border border-slate-200 px-2 py-1"
                />
                % على اللصاقة
              </label>
            </div>

            <div className="space-y-2">
              <span className="text-sm font-bold text-slate-700">WEIGHT — الوزن</span>
              <div className="flex gap-2">
                <input
                  value={form.weightValue}
                  onChange={(e) => patchForm({ weightValue: e.target.value })}
                  className={inputCls}
                  placeholder="200"
                />
                <input
                  value={form.weightUnit}
                  onChange={(e) => patchForm({ weightUnit: e.target.value })}
                  className="w-24 rounded-lg border border-slate-200 px-2 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={form.weightToleranceEnabled}
                  onChange={(e) => patchForm({ weightToleranceEnabled: e.target.checked })}
                  className="accent-indigo-600"
                />
                ±
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.weightTolerancePercent}
                  disabled={!form.weightToleranceEnabled}
                  onChange={(e) => patchForm({ weightTolerancePercent: Number(e.target.value) || 0 })}
                  className="w-16 rounded border border-slate-200 px-2 py-1"
                />
                % على اللصاقة
              </label>
            </div>
          </div>

          <label className="space-y-1 block">
            <span className="text-sm font-bold text-slate-700">رقم تسلسلي / باركود (اختياري)</span>
            <input value={form.serialNo} onChange={(e) => patchForm({ serialNo: e.target.value })} className={inputCls} placeholder="222109" />
          </label>

          <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ
            </button>
            <button
              type="button"
              onClick={() => void runPrint('dialog')}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-black disabled:opacity-50"
            >
              {busy === 'dialog' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              طباعة
            </button>
            {canSilent && (
              <button
                type="button"
                onClick={() => void runPrint('silent')}
                disabled={Boolean(busy)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy === 'silent' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <VolumeX className="w-4 h-4" />}
                طباعة صامتة
              </button>
            )}
            {isElectronRenderer() && (
              <button
                type="button"
                onClick={() => void runPrint('pdf')}
                disabled={Boolean(busy)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {busy === 'pdf' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                PDF
              </button>
            )}
            {selectedId && (
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-5 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-100"
              >
                <Trash2 className="w-4 h-4" />
                حذف
              </button>
            )}
          </div>
        </section>

        <aside className="bg-slate-100 rounded-xl border border-slate-200 p-4 overflow-auto sticky top-4">
          <div className="mb-3 flex items-center justify-between gap-2 text-sm">
            <span className="font-bold text-slate-800">معاينة قبل الطباعة</span>
            <span className="font-mono text-xs text-slate-500" dir="ltr">
              {CARTELA_WIDTH_MM}×{CARTELA_HEIGHT_MM} mm
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mb-3">محسّنة للطابعة الحرارية — أسود فقط على خلفية بيضاء.</p>
          <div className="flex justify-center">
            <iframe
              title="cartela-preview"
              srcDoc={previewHtml}
              className="bg-white border border-slate-300"
              style={{
                width: `${CARTELA_WIDTH_MM}mm`,
                height: `${CARTELA_HEIGHT_MM}mm`,
                maxWidth: '100%',
              }}
            />
          </div>
        </aside>
      </div>
    </div>
  );
};
