import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Sparkles,
  Trash2,
  VolumeX,
  Pencil,
  Copy,
  List,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  cartelaDtoToPayload,
  cartelaListLabel,
  createCartelaFiberType,
  generateCartelaLabel,
  deleteCartelaFiberType,
  deleteCartelaLabel,
  getCartelaLabel,
  listCartelaFiberTypes,
  listCartelaLabels,
  updateCartelaLabel,
  CARTELA_PERCENT_OPTIONS,
  type CartelaFiberType,
  type CartelaLabelListItem,
  type CartelaLabelPayload,
} from '../../lib/api/cartelaApi';
import {
  CARTELA_CARE_SYMBOLS,
  compositionSum,
  validateCompositionLines,
  type CartelaCareSymbolId,
  type CartelaCompositionLine,
} from '../../lib/cartela/careSymbols';
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

/** mm → CSS px at 96dpi (matches browser mm units in iframe). */
function cartelaLabelSizePx() {
  const pxPerMm = 96 / 25.4;
  return {
    width: CARTELA_WIDTH_MM * pxPerMm,
    height: CARTELA_HEIGHT_MM * pxPerMm,
  };
}

function CartelaPreviewFrame({ html }: { html: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(2.5);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const updateScale = () => {
      const { width: labelW } = cartelaLabelSizePx();
      const next = el.clientWidth / labelW;
      setScale(Math.min(3.5, Math.max(1.8, next)));
    };

    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md"
      style={{ aspectRatio: `${CARTELA_WIDTH_MM} / ${CARTELA_HEIGHT_MM}` }}
    >
      <iframe
        title="cartela-preview"
        srcDoc={html}
        scrolling="no"
        className="absolute top-0 left-0 block border-0 origin-top-left"
        style={{
          width: `${CARTELA_WIDTH_MM}mm`,
          height: `${CARTELA_HEIGHT_MM}mm`,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  );
}

type PrintMode = 'dialog' | 'silent' | 'pdf';
type CartelaTab = 'form' | 'registry';

const emptyCompositionLine = (): CartelaCompositionLine => ({
  percent: 0,
  fiberTypeId: null,
  fiberName: '',
});

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
  compositionLines: [emptyCompositionLine()],
  careSymbols: [],
  serialNo: '',
  showLogo: true,
});

function activeCompositionLines(lines: CartelaCompositionLine[]): CartelaCompositionLine[] {
  return lines.filter((line) => line.percent > 0 && line.fiberName.trim());
}

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
  const [fiberTypes, setFiberTypes] = useState<CartelaFiberType[]>([]);
  const [newFiberName, setNewFiberName] = useState('');
  const [fiberSaving, setFiberSaving] = useState(false);
  const [qrSvg, setQrSvg] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<PrintMode | null>(null);
  const [activeTab, setActiveTab] = useState<CartelaTab>('form');
  const [registryPrintingId, setRegistryPrintingId] = useState<string | null>(null);

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
      compositionLines: activeCompositionLines(form.compositionLines),
      careSymbols: form.careSymbols,
      serialNo: form.serialNo,
      showLogo: form.showLogo,
      qrSvg,
    }),
    [form, qrSvg],
  );

  const previewHtml = useMemo(() => buildCartelaLabelHtml(labelData), [labelData]);

  const compositionTotal = compositionSum(activeCompositionLines(form.compositionLines));
  const compositionError = validateCompositionLines(activeCompositionLines(form.compositionLines));

  const loadFiberTypes = async () => {
    try {
      const rows = await listCartelaFiberTypes();
      setFiberTypes(rows);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر تحميل أنواع الخامة' });
    }
  };

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
    void loadFiberTypes();
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

  const patchCompositionLine = (index: number, patch: Partial<CartelaCompositionLine>) => {
    setForm((current) => ({
      ...current,
      compositionLines: current.compositionLines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  };

  const addCompositionLine = () => {
    if (form.compositionLines.length >= 5) return;
    patchForm({ compositionLines: [...form.compositionLines, emptyCompositionLine()] });
  };

  const removeCompositionLine = (index: number) => {
    if (form.compositionLines.length <= 1) {
      patchForm({ compositionLines: [emptyCompositionLine()] });
      return;
    }
    patchForm({ compositionLines: form.compositionLines.filter((_, i) => i !== index) });
  };

  const toggleCareSymbol = (id: CartelaCareSymbolId) => {
    setForm((current) => ({
      ...current,
      careSymbols: current.careSymbols.includes(id)
        ? current.careSymbols.filter((sym) => sym !== id)
        : [...current.careSymbols, id],
    }));
  };

  const handleAddFiberType = async () => {
    const name = newFiberName.trim();
    if (!name) {
      showToast({ type: 'warning', message: 'اكتب اسم نوع الخامة بالإنجليزي' });
      return;
    }
    setFiberSaving(true);
    try {
      await createCartelaFiberType(name);
      setNewFiberName('');
      await loadFiberTypes();
      showToast({ type: 'success', message: 'تمت إضافة نوع الخامة للقائمة' });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر إضافة نوع الخامة' });
    } finally {
      setFiberSaving(false);
    }
  };

  const handleDeleteFiberType = async (id: string) => {
    if (!window.confirm('حذف نوع الخامة من القائمة؟')) return;
    try {
      await deleteCartelaFiberType(id);
      await loadFiberTypes();
      showToast({ type: 'success', message: 'تم الحذف' });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر الحذف' });
    }
  };

  const buildSavePayload = (): CartelaLabelPayload => ({
    ...form,
    compositionLines: activeCompositionLines(form.compositionLines),
  });

  const validateBeforeSave = (): string | null => {
    const active = activeCompositionLines(form.compositionLines);
    return validateCompositionLines(active);
  };

  const payloadToLabelData = (payload: CartelaLabelPayload, qr: string): CartelaLabelData => ({
    artCode: payload.artCode,
    designNo: payload.designNo,
    colour: payload.colour,
    widthValue: payload.widthValue,
    widthUnit: payload.widthUnit,
    widthToleranceEnabled: payload.widthToleranceEnabled,
    widthTolerancePercent: payload.widthTolerancePercent,
    weightValue: payload.weightValue,
    weightUnit: payload.weightUnit,
    weightToleranceEnabled: payload.weightToleranceEnabled,
    weightTolerancePercent: payload.weightTolerancePercent,
    compositionLines: payload.compositionLines,
    careSymbols: payload.careSymbols,
    serialNo: payload.serialNo,
    showLogo: payload.showLogo,
    qrSvg: qr,
  });

  const startNew = () => {
    setSelectedId(null);
    setForm(emptyPayload());
    setActiveTab('form');
  };

  const printHtml = async (html: string, mode: PrintMode, fileStem: string) => {
    if (mode === 'pdf') {
      if (!isElectronRenderer()) {
        showToast({ type: 'warning', message: 'تصدير PDF متاح داخل تطبيق Windows فقط.' });
        return;
      }
      const adapter = new ElectronPrintAdapter();
      const result = await adapter.exportToPdf(html, {
        pageSize: 'ROLL_LABEL',
        widthMm: CARTELA_WIDTH_MM,
        heightMm: CARTELA_HEIGHT_MM,
        defaultFileName: `${fileStem}.pdf`,
      });
      showToast({
        type: result.ok ? 'success' : 'error',
        message: result.ok ? 'تم تصدير PDF' : result.error || 'فشل تصدير PDF',
      });
      return;
    }

    const adapter = getPrintAdapter();
    const result = await adapter.print(html, {
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
  };

  const printPayload = async (payload: CartelaLabelPayload, mode: PrintMode) => {
    const active = payload.compositionLines;
    const validationError = validateCompositionLines(active);
    if (active.length > 0 && validationError) {
      showToast({ type: 'warning', message: validationError });
      return;
    }
    const qr = await generateQrSvg(cartelaQrPayload(payload), { size: 96, margin: 0 });
    const html = buildCartelaLabelHtml(payloadToLabelData(payload, qr));
    await printHtml(html, mode, `cartela-${payload.serialNo || 'label'}`);
  };

  const loadOne = async (id: string, switchToForm = true) => {
    try {
      const row = await getCartelaLabel(id);
      setSelectedId(id);
      setForm(cartelaDtoToPayload(row));
      if (switchToForm) setActiveTab('form');
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر تحميل الكارتيلا' });
    }
  };

  const handleGenerate = async () => {
    if (selectedId) {
      showToast({ type: 'warning', message: 'لتوليد كارتيلا جديدة استخدم «حفظ ككارتيلا جديدة» أو «كارتيلا جديدة».' });
      return;
    }
    const validationError = validateBeforeSave();
    if (validationError) {
      showToast({ type: 'warning', message: validationError });
      return;
    }

    setSaving(true);
    try {
      const row = await generateCartelaLabel(buildSavePayload());
      setSelectedId(row.id);
      setForm(cartelaDtoToPayload(row));
      await loadList();
      showToast({
        type: 'success',
        message: `تم توليد الكارتيلا${row.serial_no ? ` — رقم ${row.serial_no}` : ''}`,
      });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر توليد الكارتيلا' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveUpdate = async () => {
    if (!selectedId) {
      showToast({ type: 'warning', message: 'لا توجد كارتيلا محفوظة للتعديل — استخدم «توليد الكارتيله».' });
      return;
    }
    const validationError = validateBeforeSave();
    if (validationError) {
      showToast({ type: 'warning', message: validationError });
      return;
    }

    setSaving(true);
    try {
      const row = await updateCartelaLabel(selectedId, buildSavePayload());
      setForm(cartelaDtoToPayload(row));
      await loadList();
      showToast({ type: 'success', message: 'تم حفظ التعديل على نفس الكارتيلا' });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر حفظ التعديل' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAsNew = async () => {
    const validationError = validateBeforeSave();
    if (validationError) {
      showToast({ type: 'warning', message: validationError });
      return;
    }

    setSaving(true);
    try {
      const row = await generateCartelaLabel({ ...buildSavePayload(), serialNo: '' });
      setSelectedId(row.id);
      setForm(cartelaDtoToPayload(row));
      await loadList();
      showToast({
        type: 'success',
        message: `تم حفظ نسخة جديدة${row.serial_no ? ` — رقم ${row.serial_no}` : ''}`,
      });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر حفظ النسخة الجديدة' });
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
      await printPayload(buildSavePayload(), mode);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'حدث خطأ أثناء الطباعة' });
    } finally {
      setBusy(null);
    }
  };

  const handleRegistryPrint = async (id: string) => {
    setRegistryPrintingId(id);
    try {
      const row = await getCartelaLabel(id);
      const payload = cartelaDtoToPayload(row);
      await printPayload(
        { ...payload, compositionLines: activeCompositionLines(payload.compositionLines) },
        'dialog',
      );
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر الطباعة' });
    } finally {
      setRegistryPrintingId(null);
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
            onClick={() => setActiveTab('form')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-bold transition ${
              activeTab === 'form' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            توليد كارتيلا
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('registry')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-bold transition ${
              activeTab === 'registry' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            <List className="w-4 h-4" />
            سجل الكارتيلات
          </button>
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

      {activeTab === 'registry' && (
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900">سجل الكارتيلات</h3>
              <p className="text-xs text-slate-500 mt-1">جميع اللصاقات المُولَّدة — تعديل، حفظ، وإعادة طباعة.</p>
            </div>
            <div className="flex gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void loadList()}
                placeholder="بحث..."
                className={`${inputCls} max-w-xs`}
              />
              <button
                type="button"
                onClick={() => void loadList()}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                تحديث
              </button>
              <button
                type="button"
                onClick={startNew}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700"
              >
                <Plus className="w-3.5 h-3.5" />
                كارتيلا جديدة
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-3 text-right font-bold">الرقم</th>
                  <th className="p-3 text-right font-bold">ART CODE</th>
                  <th className="p-3 text-right font-bold">DESIGN NO</th>
                  <th className="p-3 text-right font-bold">COLOUR</th>
                  <th className="p-3 text-right font-bold">آخر تحديث</th>
                  <th className="p-3 text-right font-bold w-52">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {listLoading && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-500">
                      جاري التحميل...
                    </td>
                  </tr>
                )}
                {!listLoading && items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-500">
                      لا توجد كارتيلات بعد — استخدم «توليد كارتيلا» لإضافة أول لصاقة.
                    </td>
                  </tr>
                )}
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                    <td className="p-3 font-mono font-bold text-slate-900" dir="ltr">
                      {item.serial_no || '—'}
                    </td>
                    <td className="p-3 text-slate-800">{item.art_code || '—'}</td>
                    <td className="p-3 text-slate-800">{item.design_no || '—'}</td>
                    <td className="p-3 text-slate-600">{item.colour || '—'}</td>
                    <td className="p-3 text-slate-500 text-xs">
                      {new Date(item.updated_at).toLocaleString('ar-SY')}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => void loadOne(item.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-white"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          تعديل
                        </button>
                        <button
                          type="button"
                          disabled={registryPrintingId === item.id}
                          onClick={() => void handleRegistryPrint(item.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-black disabled:opacity-50"
                        >
                          {registryPrintingId === item.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Printer className="w-3.5 h-3.5" />
                          )}
                          طباعة
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'form' && (
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(380px,520px)] gap-6 items-start">
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="font-bold text-slate-900">
              {selectedId ? 'تعديل كارتيلا' : 'توليد كارتيلا جديدة'}
            </h3>
            {selectedId && (
              <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-full">
                محفوظة — يمكن التعديل أو الحفظ كنسخة جديدة
              </span>
            )}
          </div>

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
            <label className="space-y-1 block md:col-span-2">
              <span className="text-sm font-bold text-slate-700">COLOUR — اللون</span>
              <input value={form.colour} onChange={(e) => patchForm({ colour: e.target.value })} className={inputCls} />
            </label>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h4 className="font-bold text-slate-900 text-sm">COMP. — خليط الخامة (مجموع 100%)</h4>
              <span
                className={`text-xs font-bold px-2 py-1 rounded-full ${
                  activeCompositionLines(form.compositionLines).length === 0
                    ? 'bg-slate-200 text-slate-600'
                    : compositionTotal === 100
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-rose-100 text-rose-700'
                }`}
              >
                المجموع: {compositionTotal}%
              </span>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
              <div className="text-xs font-bold text-slate-600">قائمة أنواع الخامة (إنجليزي — تُعبّأ يدوياً مرة واحدة)</div>
              <div className="flex flex-wrap gap-1.5">
                {fiberTypes.map((fiber) => (
                  <span
                    key={fiber.id}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-800"
                  >
                    {fiber.name_en}
                    <button
                      type="button"
                      onClick={() => void handleDeleteFiberType(fiber.id)}
                      className="text-rose-500 hover:text-rose-700"
                      title="حذف"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {fiberTypes.length === 0 && <span className="text-xs text-slate-500">أضف أنواعاً مثل COTTON, POLYESTER, ACRYLIC…</span>}
              </div>
              <div className="flex gap-2">
                <input
                  value={newFiberName}
                  onChange={(e) => setNewFiberName(e.target.value)}
                  className={inputCls}
                  placeholder="COTTON"
                  dir="ltr"
                />
                <button
                  type="button"
                  disabled={fiberSaving}
                  onClick={() => void handleAddFiberType()}
                  className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-black disabled:opacity-50"
                >
                  إضافة للقائمة
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {form.compositionLines.map((line, index) => (
                <div key={index} className="grid grid-cols-1 sm:grid-cols-[88px_1fr_auto] gap-2 items-center">
                  <select
                    value={line.percent || ''}
                    onChange={(e) => patchCompositionLine(index, { percent: Number(e.target.value) || 0 })}
                    className={inputCls}
                  >
                    <option value="">%</option>
                    {CARTELA_PERCENT_OPTIONS.map((pct) => (
                      <option key={pct} value={pct}>
                        {pct}%
                      </option>
                    ))}
                  </select>
                  <select
                    value={line.fiberTypeId ?? ''}
                    onChange={(e) => {
                      const fiber = fiberTypes.find((f) => f.id === e.target.value);
                      patchCompositionLine(index, {
                        fiberTypeId: fiber?.id ?? null,
                        fiberName: fiber?.name_en ?? '',
                      });
                    }}
                    className={inputCls}
                  >
                    <option value="">نوع الخامة…</option>
                    {fiberTypes.map((fiber) => (
                      <option key={fiber.id} value={fiber.id}>
                        {fiber.name_en}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeCompositionLine(index)}
                    className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50"
                  >
                    حذف
                  </button>
                </div>
              ))}
            </div>

            {form.compositionLines.length < 5 && (
              <button
                type="button"
                onClick={addCompositionLine}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
              >
                <Plus className="w-3.5 h-3.5" />
                إضافة سطر ({form.compositionLines.length}/5)
              </button>
            )}
            {compositionError && activeCompositionLines(form.compositionLines).length > 0 && (
              <p className="text-xs font-bold text-rose-600">{compositionError}</p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <h4 className="font-bold text-slate-900 text-sm">رموز العناية (اختيار حر — تظهر على اللصاقة بالإنجليزي)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CARTELA_CARE_SYMBOLS.map((sym) => (
                <label
                  key={sym.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={form.careSymbols.includes(sym.id)}
                    onChange={() => toggleCareSymbol(sym.id)}
                    className="accent-indigo-600"
                  />
                  <span className="font-bold text-slate-800">{sym.labelAr}</span>
                  <span className="text-xs text-slate-500" dir="ltr">
                    ({sym.labelEn})
                  </span>
                </label>
              ))}
            </div>
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
            <span className="text-sm font-bold text-slate-700">رقم تسلسلي / باركود</span>
            <input value={form.serialNo} onChange={(e) => patchForm({ serialNo: e.target.value })} className={inputCls} placeholder="222109" dir="ltr" />
            <span className="text-xs text-slate-500">اتركه فارغاً ليُولَّد رقم تلقائي عند «توليد الكارتيله».</span>
          </label>

          <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
            {!selectedId ? (
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                توليد الكارتيله
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void handleSaveUpdate()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  حفظ التعديل
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveAsNew()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-2.5 text-sm font-bold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                  حفظ ككارتيلا جديدة
                </button>
              </>
            )}
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

        <aside className="bg-slate-100 rounded-xl border border-slate-200 p-4 sticky top-4">
          <div className="mb-3 flex items-center justify-between gap-2 text-sm">
            <span className="font-bold text-slate-800">معاينة قبل الطباعة</span>
            <span className="font-mono text-xs text-slate-500" dir="ltr">
              {CARTELA_WIDTH_MM}×{CARTELA_HEIGHT_MM} mm
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mb-3">
            معاينة مكبّرة بنفس النسب — الطباعة الفعلية 80×50 mm حراري.
          </p>
          <div className="relative w-full">
            <CartelaPreviewFrame html={previewHtml} />
          </div>
        </aside>
      </div>
      )}
    </div>
  );
};
