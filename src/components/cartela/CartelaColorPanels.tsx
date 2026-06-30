import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Loader2, Palette, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react';
import {
  cartelaColorDisplayName,
  createCartelaColor,
  deleteCartelaColor,
  listCartelaColors,
  lookupCartelaScan,
  updateCartelaColor,
  type CartelaColorLookupResult,
  type CartelaColorSwatchDto,
} from '../../lib/api/cartelaColorApi';
import { ApiRequestError } from '../../lib/api/client';
import { loadCartelaColorPrintSettings } from '../../lib/cartela/cartelaColorPrintSettings';
import {
  buildCartelaColorStickerHtml,
} from '../../lib/printing/renderCartelaColorBarcode';
import { getPrintAdapter } from '../../lib/printing/printAdapters';
import { useToast } from '../NonBlockingToast';
import { CartelaColorBatchPrintModal } from './CartelaColorBatchPrintModal';

type ColorForm = {
  colorCode: string;
  nameAr: string;
  nameTr: string;
  notes: string;
  imageUrl: string;
};

const emptyColorForm = (): ColorForm => ({
  colorCode: '',
  nameAr: '',
  nameTr: '',
  notes: '',
  imageUrl: '',
});

type Props = {
  onOpenCartela: (cartelaId: string) => void;
  onPrintColor?: (color: CartelaColorSwatchDto, cartela: CartelaColorLookupResult) => void;
};

export const CartelaColorScanPanel: React.FC<Props> = ({ onOpenCartela, onPrintColor }) => {
  const { showToast } = useToast();
  const scanRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CartelaColorLookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runLookup = useCallback(async (raw?: string) => {
    const value = (raw ?? scan).trim();
    if (!value) {
      setError('أدخل باركود اللون');
      return;
    }
    setScan(value);
    setLoading(true);
    setError(null);
    try {
      const data = await lookupCartelaScan(value);
      setResult(data);
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiRequestError ? e.message : 'لم يُعثر على باركود');
    } finally {
      setLoading(false);
    }
  }, [scan]);

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  useEffect(() => {
    const value = scan.trim();
    if (value.length < 3 && !value.includes('-')) return;
    const t = window.setTimeout(() => {
      void runLookup(value);
    }, 280);
    return () => window.clearTimeout(t);
  }, [scan, runLookup]);

  const printColorSticker = async (color: CartelaColorSwatchDto, cartela: CartelaColorLookupResult) => {
    if (onPrintColor) {
      onPrintColor(color, cartela);
      return;
    }
    const settings = loadCartelaColorPrintSettings();
    const html = buildCartelaColorStickerHtml({
      barcodeCode: color.barcode_code,
      displayCode: color.color_code,
      subtitle: settings.showColorName ? cartelaColorDisplayName(color) : undefined,
      settings,
    });
    const adapter = getPrintAdapter();
    const printResult = await adapter.print(html, {
      pageSize: 'label',
      widthMm: settings.cellWidthMm,
      heightMm: settings.cellHeightMm,
      copies: settings.copies,
    });
    showToast({
      type: printResult.ok ? 'success' : 'error',
      message: printResult.ok ? 'تم إرسال ستيكر اللون للطباعة' : printResult.error || 'فشلت الطباعة',
    });
  };

  return (
    <section className="bg-white rounded-xl border border-indigo-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-indigo-100 bg-indigo-50/80 flex items-center gap-2">
        <Search className="w-5 h-5 text-indigo-600" />
        <div>
          <h3 className="font-bold text-slate-900 text-sm">مسح باركود لون الكارتيلة (Code128)</h3>
          <p className="text-xs text-slate-500">مثال: 0013-C01 — يجلب الخامة الكاملة + اللون من السيرفر.</p>
        </div>
      </div>
      <div className="p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            ref={scanRef}
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void runLookup()}
            placeholder="0013-C01"
            dir="ltr"
            autoComplete="off"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={() => void runLookup()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            بحث
          </button>
        </div>

        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-sm">{error}</div>}

        {result && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-indigo-700 uppercase">
                  {result.match_type === 'color' ? 'لون كارتيلة' : 'كارتيلة رئيسية'}
                </p>
                <h4 className="text-lg font-black text-slate-900">{result.art_code || result.title}</h4>
                <p className="text-sm text-slate-600">
                  DESIGN: {result.design_no || '—'} · SERIAL: {result.serial_no || '—'}
                </p>
                {result.color && (
                  <p className="text-sm font-bold text-emerald-700 mt-1">
                    اللون: {cartelaColorDisplayName(result.color)} ({result.color.color_code})
                  </p>
                )}
              </div>
              {result.color?.image_url && (
                <img
                  src={result.color.image_url}
                  alt={cartelaColorDisplayName(result.color)}
                  className="w-20 h-20 rounded-lg border border-slate-200 object-cover bg-white"
                />
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-slate-700">
              <div>WIDTH: {result.width_value} {result.width_unit}</div>
              <div>WEIGHT: {result.weight_value} {result.weight_unit}</div>
              <div className="sm:col-span-2">COMP: {result.composition || '—'}</div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => onOpenCartela(result.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                <Pencil className="w-3.5 h-3.5" />
                تعديل الكارتيلة
              </button>
              {result.color && (
                <button
                  type="button"
                  onClick={() => void printColorSticker(result.color!, result)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-black"
                >
                  <Printer className="w-3.5 h-3.5" />
                  طباعة باركود اللون
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

type SwatchPanelProps = {
  cartelaId: string;
  serialNo: string;
  onChanged?: () => void;
};

export const CartelaColorSwatchesPanel: React.FC<SwatchPanelProps> = ({ cartelaId, serialNo, onChanged }) => {
  const { showToast } = useToast();
  const [rows, setRows] = useState<CartelaColorSwatchDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ColorForm>(() => emptyColorForm());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);

  const selectedColors = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listCartelaColors(cartelaId);
      setRows(data);
      setSelectedIds((prev) => {
        const valid = new Set(data.map((row) => row.id));
        return new Set([...prev].filter((id) => valid.has(id)));
      });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : 'تعذر تحميل الألوان' });
    } finally {
      setLoading(false);
    }
  }, [cartelaId, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setEditId(null);
    setForm(emptyColorForm());
    setFormOpen(true);
  };

  const openEdit = (row: CartelaColorSwatchDto) => {
    setEditId(row.id);
    setForm({
      colorCode: row.color_code,
      nameAr: row.name_ar,
      nameTr: row.name_tr,
      notes: row.notes || '',
      imageUrl: row.image_url || '',
    });
    setFormOpen(true);
  };

  const submit = async () => {
    if (!form.colorCode.trim()) {
      showToast({ type: 'warning', message: 'كود اللون مطلوب — مثال C-01' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        colorCode: form.colorCode.trim(),
        nameAr: form.nameAr.trim(),
        nameTr: form.nameTr.trim(),
        notes: form.notes.trim() || null,
        imageUrl: form.imageUrl.trim() || null,
      };
      if (editId) await updateCartelaColor(editId, payload);
      else {
        const created = await createCartelaColor(cartelaId, payload);
        setSelectedIds((prev) => new Set(prev).add(created.id));
      }
      setFormOpen(false);
      await load();
      onChanged?.();
      showToast({ type: 'success', message: editId ? 'تم تحديث اللون' : 'تمت إضافة اللون' });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : 'تعذر الحفظ' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: CartelaColorSwatchDto) => {
    if (!window.confirm(`حذف اللون ${row.color_code}؟`)) return;
    try {
      await deleteCartelaColor(row.id);
      await load();
      onChanged?.();
      showToast({ type: 'success', message: 'تم الحذف' });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : 'تعذر الحذف' });
    }
  };

  const printOne = async (row: CartelaColorSwatchDto) => {
    setPrintingId(row.id);
    try {
      const settings = loadCartelaColorPrintSettings();
      const html = buildCartelaColorStickerHtml({
        barcodeCode: row.barcode_code,
        displayCode: row.color_code,
        subtitle: settings.showColorName ? cartelaColorDisplayName(row) : undefined,
        settings,
      });
      const adapter = getPrintAdapter();
      const result = await adapter.print(html, {
        pageSize: 'label',
        widthMm: settings.cellWidthMm,
        heightMm: settings.cellHeightMm,
        copies: settings.copies,
      });
      showToast({
        type: result.ok ? 'success' : 'error',
        message: result.ok ? 'تم إرسال ستيكر اللون للطباعة' : result.error || 'فشلت الطباعة',
      });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'فشلت الطباعة' });
    } finally {
      setPrintingId(null);
    }
  };

  const serialReady = Boolean(serialNo.trim());

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (rows.length > 0 && rows.every((row) => prev.has(row.id))) return new Set();
      return new Set(rows.map((row) => row.id));
    });
  };

  const openBatchPrint = () => {
    if (selectedColors.length === 0) {
      showToast({ type: 'warning', message: 'اختر لوناً واحداً على الأقل للطباعة 3×1' });
      return;
    }
    setBatchOpen(true);
  };

  return (
    <section id="cartela-colors-panel" className="bg-white rounded-xl border border-violet-200 shadow-sm overflow-hidden scroll-mt-24">
      <div className="px-4 py-3 border-b border-violet-100 bg-violet-50/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-violet-600" />
          <div>
            <h3 className="font-bold text-slate-900 text-sm">كارتيلة الألوان</h3>
            <p className="text-xs text-slate-500">ألوان فرعية — باركود Code128 قصير لكل لون (بدون QR).</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openBatchPrint}
            disabled={!serialReady || rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-black disabled:opacity-40"
          >
            <Layers className="w-3.5 h-3.5" />
            طباعة باركود الألوان (3×1)
          </button>
          <button
            type="button"
            onClick={openNew}
            disabled={!serialReady}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            إضافة لون
          </button>
        </div>
      </div>

      {!serialReady && (
        <div className="px-4 py-3 text-sm text-amber-800 bg-amber-50 border-b border-amber-100">
          احفظ الكارتيلة برقم تسلسلي (SERIAL) قبل إضافة ألوان — الباركود يكون مثل{' '}
          <span className="font-mono font-bold" dir="ltr">
            {serialNo.trim() ? `${serialNo.trim()}-C01` : '{SERIAL}-C01'}
          </span>
          .
        </div>
      )}

      {serialReady && rows.length === 0 && !loading && (
        <div className="px-4 py-3 text-sm text-violet-900 bg-violet-50 border-b border-violet-100">
          الخطوة التالية: أضف ألواناً (C-01, C-02…) ثم حدّدها واضغط «طباعة باركود الألوان (3×1)».
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 w-10 text-center">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && rows.every((row) => selectedIds.has(row.id))}
                  onChange={toggleAll}
                  className="accent-violet-600"
                  aria-label="تحديد كل الألوان"
                />
              </th>
              <th className="p-3 text-right font-bold">#</th>
              <th className="p-3 text-right font-bold">كود اللون</th>
              <th className="p-3 text-right font-bold">الاسم</th>
              <th className="p-3 text-right font-bold">الباركود</th>
              <th className="p-3 text-right font-bold w-44">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin inline ml-2" />
                  جاري التحميل...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">
                  لا توجد ألوان — أضف ألواناً يدوياً لهذه الكارتيلة.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                <td className="p-3 text-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                    className="accent-violet-600"
                    aria-label={`تحديد ${row.color_code}`}
                  />
                </td>
                <td className="p-3 font-mono font-bold text-slate-700">{row.color_no}</td>
                <td className="p-3 font-mono font-bold text-slate-900" dir="ltr">
                  {row.color_code}
                </td>
                <td className="p-3 text-slate-700">{cartelaColorDisplayName(row)}</td>
                <td className="p-3 font-mono text-xs text-indigo-700" dir="ltr">
                  {row.barcode_code}
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => void printOne(row)}
                      disabled={printingId === row.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-black disabled:opacity-50"
                    >
                      {printingId === row.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Printer className="w-3.5 h-3.5" />
                      )}
                      طباعة
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(row)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-white"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      تعديل
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(row)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      حذف
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {batchOpen && (
        <CartelaColorBatchPrintModal colors={selectedColors} onClose={() => setBatchOpen(false)} />
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-violet-50">
              <h4 className="font-bold text-slate-900">{editId ? 'تعديل لون' : 'إضافة لون للكارتيلة'}</h4>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 block sm:col-span-2">
                <span className="text-xs font-bold text-slate-600">كود اللون *</span>
                <input
                  value={form.colorCode}
                  onChange={(e) => setForm((prev) => ({ ...prev, colorCode: e.target.value }))}
                  placeholder="C-01"
                  dir="ltr"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-600">الاسم (عربي)</span>
                <input
                  value={form.nameAr}
                  onChange={(e) => setForm((prev) => ({ ...prev, nameAr: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-600">الاسم (تركي)</span>
                <input
                  value={form.nameTr}
                  onChange={(e) => setForm((prev) => ({ ...prev, nameTr: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 block sm:col-span-2">
                <span className="text-xs font-bold text-slate-600">رابط صورة اللون (اختياري)</span>
                <input
                  value={form.imageUrl}
                  onChange={(e) => setForm((prev) => ({ ...prev, imageUrl: e.target.value }))}
                  placeholder="https://..."
                  dir="ltr"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 block sm:col-span-2">
                <span className="text-xs font-bold text-slate-600">ملاحظة</span>
                <input
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submit()}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
