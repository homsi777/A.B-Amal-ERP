import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Layers, Loader2, Palette, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react';
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
import { listFabricColors, type ApiFabricColor } from '../../lib/api/fabricColorsApi';
import { listFabricRolls, type FabricRollDto } from '../../lib/api/fabricRollsApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { ApiRequestError } from '../../lib/api/client';
import { loadCartelaColorPrintSettings } from '../../lib/cartela/cartelaColorPrintSettings';
import {
  buildCartelaColorStickerHtml,
} from '../../lib/printing/renderCartelaColorBarcode';
import { renderInventoryRollsAuditA4Html } from '../../lib/printing/renderInventoryRollsAuditA4';
import { openDocumentPrintWindow } from '../../lib/printing/documentPrint';
import { getPrintAdapter } from '../../lib/printing/printAdapters';
import { useToast } from '../NonBlockingToast';
import { CartelaColorBatchPrintModal } from './CartelaColorBatchPrintModal';

type ColorForm = {
  colorCode: string;
  nameAr: string;
  nameTr: string;
  notes: string;
};

const emptyColorForm = (): ColorForm => ({
  colorCode: '',
  nameAr: '',
  nameTr: '',
  notes: '',
});

type Props = {
  onOpenCartela: (cartelaId: string) => void;
  onPrintColor?: (color: CartelaColorSwatchDto, cartela: CartelaColorLookupResult) => void;
};

export const CartelaColorScanPanel: React.FC<Props> = ({ onOpenCartela, onPrintColor }) => {
  const { t } = useTranslation('cartelaLabels');
  const { showToast } = useToast();
  const scanRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CartelaColorLookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [auditWarehouseId, setAuditWarehouseId] = useState('');
  const [auditShowAllColors, setAuditShowAllColors] = useState(false);
  const [auditSummary, setAuditSummary] = useState<{
    scope: 'material' | 'color';
    label: string;
    rollCount: number;
    totalMeters: number;
    byColor: { name: string; rollCount: number; totalMeters: number; exhausted: boolean }[];
    rolls: FabricRollDto[];
    scopeLabel: string;
    searchQuery: string;
    warehouseLabel: string;
  } | null>(null);

  useEffect(() => {
    listWarehouses({ status: 'active' }).then(setWarehouses).catch(() => {});
  }, []);

  const runLookup = useCallback(async (raw?: string) => {
    const value = (raw ?? scan).trim();
    if (!value) {
      setError(t('colorPanels.scan.enterBarcode'));
      return;
    }
    setScan(value);
    setLoading(true);
    setError(null);
    setAuditSummary(null);
    try {
      const data = await lookupCartelaScan(value);
      setResult(data);
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiRequestError ? e.message : t('colorPanels.scan.notFound'));
    } finally {
      setLoading(false);
    }
  }, [scan, t]);

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
      message: printResult.ok ? t('colorPanels.colorStickerPrintSent') : printResult.error || t('toast.printFailed'),
    });
  };

  /** إجمالي أمتار الأتواب المتوفرة بقائمة معيّنة — لعرضها مباشرة بنفس بطاقة النتيجة. */
  const sumAvailableRolls = (rows: { length_m?: string | null }[]) =>
    rows.reduce((sum, r) => sum + (Number.parseFloat(r.length_m ?? '0') || 0), 0);

  /** توزيع أتواب الخامة الكاملة على ألوانها — لعرض "كل شيء" بنفس البطاقة دون أي تنقّل. */
  const groupRollsByColor = (rows: FabricRollDto[]) => {
    const groups = new Map<string, { name: string; rollCount: number; totalMeters: number; exhausted: boolean }>();
    for (const roll of rows) {
      const name = (roll.color_name_ar ?? '').trim() || t('colorPanels.scan.auditNoColor');
      const current = groups.get(name) ?? { name, rollCount: 0, totalMeters: 0, exhausted: false };
      current.rollCount += 1;
      current.totalMeters += Number.parseFloat(roll.length_m ?? '0') || 0;
      groups.set(name, current);
    }
    return [...groups.values()].sort((a, b) => b.totalMeters - a.totalMeters);
  };

  /** يضيف ألوان الكارتيلة التي نفد مخزونها بالكامل (غير موجودة ضمن المتوفر حالياً)
   * كصفوف صفرية — فقط عندما تطلب "عرض كل الألوان". المطابقة بالاسم العربي، نفس
   * أسلوب المطابقة المستخدَم أصلاً بـ runAuditColor لأن color_code بكتالوج
   * الكارتيلة غالباً لا يطابق color_code الحقيقي بكتالوج الأصناف. */
  const addExhaustedColors = (
    byColor: { name: string; rollCount: number; totalMeters: number; exhausted: boolean }[],
    cartelaId: string,
  ) =>
    listCartelaColors(cartelaId).then((swatches) => {
      const present = new Set(byColor.map((row) => row.name.trim().toLocaleLowerCase()));
      const missing = swatches
        .filter((s) => !present.has((s.name_ar || s.color_code).trim().toLocaleLowerCase()))
        .map((s) => ({ name: s.name_ar || s.color_code, rollCount: 0, totalMeters: 0, exhausted: true }));
      return [...byColor, ...missing].sort((a, b) => b.totalMeters - a.totalMeters);
    });

  const runAuditMaterial = async (cartela: CartelaColorLookupResult) => {
    const code = cartela.art_code.trim();
    if (!cartela.fabric_item_id && !code) {
      showToast({ type: 'error', message: t('colorPanels.scan.auditNoArtCode') });
      return;
    }
    setAuditBusy(true);
    setAuditSummary(null);
    try {
      // كارتيله مرتبطة بخامة حقيقية (fabric_item_id) — ربط مباشر بقاعدة البيانات، لا
      // مطابقة نصّية لكود التصميم. الفاريانت/اللون محدَّد مسبقاً بالكارتيله نفسها، لذا
      // هذا الاستعلام يعرض أتوابها فقط من البداية (لا حاجة لتجميع بالألوان لاحقاً).
      const res = cartela.fabric_item_id
        ? await listFabricRolls({
            itemId: cartela.fabric_item_id,
            variantId: cartela.fabric_variant_id || undefined,
            onlyAvailable: true,
            warehouseId: auditWarehouseId || undefined,
            pageSize: 500,
          })
        : await listFabricRolls({
            search: code,
            onlyAvailable: true,
            warehouseId: auditWarehouseId || undefined,
            pageSize: 500,
          });
      let byColor = groupRollsByColor(res.data);
      if (auditShowAllColors && !cartela.fabric_item_id) {
        byColor = await addExhaustedColors(byColor, cartela.id);
      }
      setAuditSummary({
        scope: 'material',
        label: code,
        rollCount: res.data.length,
        totalMeters: sumAvailableRolls(res.data),
        byColor,
        rolls: res.data,
        scopeLabel: t('colorPanels.scan.auditResultMaterialTitle'),
        searchQuery: code,
        warehouseLabel: auditWarehouseId
          ? warehouses.find((w) => w.id === auditWarehouseId)?.name ?? ''
          : t('colorPanels.scan.auditWarehouseAll'),
      });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('toast.printFailed') });
    } finally {
      setAuditBusy(false);
    }
  };

  const runAuditColor = async (cartela: CartelaColorLookupResult, color: CartelaColorSwatchDto) => {
    const code = cartela.art_code.trim();
    const colorCode = color.color_code.trim();
    const colorName = color.name_ar.trim();
    if (!code || (!colorCode && !colorName)) {
      showToast({ type: 'error', message: t('colorPanels.scan.auditNoArtCode') });
      return;
    }
    setAuditBusy(true);
    setAuditSummary(null);
    try {
      // كود اللون (color_code) غالباً غير مُستخدَم فعلياً بكتالوج الألوان الحقيقي بهذا النظام —
      // نحاول المطابقة بالكود أولاً كأدق خيار، ثم نرجع لاسم اللون (name_ar) إن لم نجد تطابقاً.
      let candidateIds: string[] = [];
      if (colorCode) {
        const byCode = await listFabricColors({ colorCode, pageSize: 50 });
        candidateIds = byCode.data
          .filter((c) => c.color_code.trim().toLocaleLowerCase() === colorCode.toLocaleLowerCase())
          .map((c) => c.id);
      }
      if (candidateIds.length === 0 && colorName) {
        const byName = await listFabricColors({ search: colorName, pageSize: 50 });
        candidateIds = byName.data
          .filter((c) => c.name_ar.trim().toLocaleLowerCase() === colorName.toLocaleLowerCase())
          .map((c) => c.id);
      }
      if (candidateIds.length === 0) {
        showToast({
          type: 'error',
          message: t('colorPanels.scan.auditColorNotLinked', { code: colorCode || colorName }),
        });
        return;
      }
      const colorIdParam = candidateIds.join(',');
      const res = await listFabricRolls({
        search: code,
        colorId: colorIdParam,
        onlyAvailable: true,
        warehouseId: auditWarehouseId || undefined,
        pageSize: 500,
      });
      setAuditSummary({
        scope: 'color',
        label: colorName || colorCode,
        rollCount: res.data.length,
        totalMeters: sumAvailableRolls(res.data),
        byColor: [],
        rolls: res.data,
        scopeLabel: t('colorPanels.scan.auditResultColorTitle'),
        searchQuery: code,
        warehouseLabel: auditWarehouseId
          ? warehouses.find((w) => w.id === auditWarehouseId)?.name ?? ''
          : t('colorPanels.scan.auditWarehouseAll'),
      });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('toast.printFailed') });
    } finally {
      setAuditBusy(false);
    }
  };

  const printAuditSummary = () => {
    if (!auditSummary) return;
    const html = renderInventoryRollsAuditA4Html({
      rolls: auditSummary.rolls,
      searchQuery: auditSummary.searchQuery,
      scopeLabel: auditSummary.scopeLabel,
      warehouseLabel: auditSummary.warehouseLabel,
      printedAt: new Date(),
    });
    const ok = openDocumentPrintWindow(html, auditSummary.scopeLabel);
    if (!ok) {
      showToast({ type: 'error', message: t('colorPanels.scan.auditPrintPopupBlocked') });
    }
  };

  return (
    <section className="bg-white rounded-xl border border-indigo-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-indigo-100 bg-indigo-50/80 flex items-center gap-2">
        <Search className="w-5 h-5 text-indigo-600" />
        <div>
          <h3 className="font-bold text-slate-900 text-sm">{t('colorPanels.scan.title')}</h3>
          <p className="text-xs text-slate-500">{t('colorPanels.scan.subtitle')}</p>
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
            {t('colorPanels.scan.searchButton')}
          </button>
        </div>

        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-sm">{error}</div>}

        {result && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-indigo-700 uppercase">
                  {result.match_type === 'color' ? t('colorPanels.scan.resultTypeColor') : t('colorPanels.scan.resultTypeMain')}
                </p>
                <h4 className="text-lg font-black text-slate-900">{result.art_code || result.title}</h4>
                <p className="text-sm text-slate-600">
                  DESIGN: {result.design_no || '—'} · SERIAL: {result.serial_no || '—'}
                </p>
                {result.color && (
                  <p className="text-sm font-bold text-emerald-700 mt-1">
                    {t('colorPanels.scan.colorLabel', { name: cartelaColorDisplayName(result.color), code: result.color.color_code })}
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

            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200">
              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                {t('colorPanels.scan.auditWarehouseLabel')}
                <select
                  value={auditWarehouseId}
                  onChange={(e) => setAuditWarehouseId(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold text-slate-700"
                >
                  <option value="">{t('colorPanels.scan.auditWarehouseAll')}</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={auditShowAllColors}
                  onChange={(e) => setAuditShowAllColors(e.target.checked)}
                  className="accent-indigo-600"
                />
                {t('colorPanels.scan.auditShowAllColors')}
              </label>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => onOpenCartela(result.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                <Pencil className="w-3.5 h-3.5" />
                {t('colorPanels.scan.editCartela')}
              </button>
              {result.color && (
                <button
                  type="button"
                  onClick={() => void printColorSticker(result.color!, result)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-black"
                >
                  <Printer className="w-3.5 h-3.5" />
                  {t('colorPanels.scan.printColorBarcode')}
                </button>
              )}
              <button
                type="button"
                onClick={() => void runAuditMaterial(result)}
                disabled={auditBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                {auditBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5" />}
                {t('colorPanels.scan.auditMaterial')}
              </button>
              {result.color && (
                <button
                  type="button"
                  onClick={() => void runAuditColor(result, result.color!)}
                  disabled={auditBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                >
                  {auditBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5" />}
                  {t('colorPanels.scan.auditColor')}
                </button>
              )}
            </div>

            {auditSummary && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-emerald-800">
                      {auditSummary.scopeLabel}
                      <span className="mr-1.5 text-xs font-normal text-emerald-700">({auditSummary.warehouseLabel})</span>
                    </p>
                    <p className="text-emerald-900">
                      {t('colorPanels.scan.auditResultLine', {
                        count: auditSummary.rollCount,
                        meters: auditSummary.totalMeters.toFixed(2),
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={printAuditSummary}
                    disabled={auditSummary.rollCount === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-40 shrink-0"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    {t('colorPanels.scan.auditPrint')}
                  </button>
                </div>

                {auditSummary.byColor.length > 0 && (
                  <div className="rounded-lg border border-emerald-100 bg-white overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-emerald-50 text-emerald-700 font-bold">
                          <th className="px-2 py-1.5 text-right">{t('colorPanels.scan.auditColColor')}</th>
                          <th className="px-2 py-1.5 text-right">{t('colorPanels.scan.auditColRolls')}</th>
                          <th className="px-2 py-1.5 text-right">{t('colorPanels.scan.auditColMeters')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditSummary.byColor.map((row) => (
                          <tr key={row.name} className={`border-t border-emerald-50 ${row.exhausted ? 'opacity-50' : ''}`}>
                            <td className="px-2 py-1.5 text-slate-800 font-bold">
                              {row.name}
                              {row.exhausted && (
                                <span className="mr-1 inline-block rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                                  {t('colorPanels.scan.auditExhausted')}
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-slate-600 font-mono">{row.rollCount}</td>
                            <td className="px-2 py-1.5 text-slate-600 font-mono">{row.totalMeters.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
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
  const { t } = useTranslation('cartelaLabels');
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

  // ربط اختياري بلون حقيقي من كتالوج fabric_colors — بدل رابط صورة نصي حر.
  const [pickedFabricColorId, setPickedFabricColorId] = useState<string | null>(null);
  const [colorQuery, setColorQuery] = useState('');
  const [colorSearching, setColorSearching] = useState(false);
  const [colorResults, setColorResults] = useState<ApiFabricColor[]>([]);

  useEffect(() => {
    const q = colorQuery.trim();
    if (pickedFabricColorId || q.length < 2) {
      setColorResults([]);
      return;
    }
    setColorSearching(true);
    const timer = window.setTimeout(() => {
      listFabricColors({ search: q, status: 'active', pageSize: 20 })
        .then((res) => setColorResults(res.data))
        .catch(() => setColorResults([]))
        .finally(() => setColorSearching(false));
    }, 280);
    return () => window.clearTimeout(timer);
  }, [colorQuery, pickedFabricColorId]);

  const pickCatalogColor = (color: ApiFabricColor) => {
    setPickedFabricColorId(color.id);
    setColorQuery('');
    setColorResults([]);
    setForm((prev) => ({
      ...prev,
      colorCode: color.color_code || prev.colorCode,
      nameAr: color.name_ar || prev.nameAr,
      nameTr: color.name_tr || prev.nameTr,
    }));
  };

  const clearCatalogColor = () => {
    setPickedFabricColorId(null);
    setColorQuery('');
    setColorResults([]);
  };

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
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('colorPanels.swatches.loadFailed') });
    } finally {
      setLoading(false);
    }
  }, [cartelaId, showToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setEditId(null);
    setForm(emptyColorForm());
    clearCatalogColor();
    setFormOpen(true);
  };

  const openEdit = (row: CartelaColorSwatchDto) => {
    setEditId(row.id);
    setForm({
      colorCode: row.color_code,
      nameAr: row.name_ar,
      nameTr: row.name_tr,
      notes: row.notes || '',
    });
    setPickedFabricColorId(row.fabric_color_id);
    setColorQuery('');
    setColorResults([]);
    setFormOpen(true);
  };

  const submit = async () => {
    if (!form.colorCode.trim()) {
      showToast({ type: 'warning', message: t('colorPanels.swatches.colorCodeRequired') });
      return;
    }
    setSaving(true);
    try {
      // imageUrl عمداً غير مُرسَل هنا — النموذج الحالي لا يحمله إطلاقاً، فتبقى
      // قيمته القديمة بالسجل (إن وُجدت) محفوظة دون تغيير عند الخادم.
      const payload = {
        colorCode: form.colorCode.trim(),
        nameAr: form.nameAr.trim(),
        nameTr: form.nameTr.trim(),
        notes: form.notes.trim() || null,
        fabricColorId: pickedFabricColorId,
      };
      if (editId) await updateCartelaColor(editId, payload);
      else {
        const created = await createCartelaColor(cartelaId, payload);
        setSelectedIds((prev) => new Set(prev).add(created.id));
      }
      setFormOpen(false);
      await load();
      onChanged?.();
      showToast({ type: 'success', message: editId ? t('colorPanels.swatches.updated') : t('colorPanels.swatches.added') });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('colorPanels.swatches.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: CartelaColorSwatchDto) => {
    if (!window.confirm(t('colorPanels.swatches.confirmDelete', { code: row.color_code }))) return;
    try {
      await deleteCartelaColor(row.id);
      await load();
      onChanged?.();
      showToast({ type: 'success', message: t('toast.deleted') });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('toast.deleteFailed') });
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
        message: result.ok ? t('colorPanels.colorStickerPrintSent') : result.error || t('toast.printFailed'),
      });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('toast.printFailed') });
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
      showToast({ type: 'warning', message: t('colorPanels.swatches.selectAtLeastOneFor3x1') });
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
            <h3 className="font-bold text-slate-900 text-sm">{t('colorPanels.swatches.title')}</h3>
            <p className="text-xs text-slate-500">{t('colorPanels.swatches.subtitle')}</p>
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
            {t('colorPanels.swatches.batchPrintButton')}
          </button>
          <button
            type="button"
            onClick={openNew}
            disabled={!serialReady}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('colorPanels.swatches.addColorButton')}
          </button>
        </div>
      </div>

      {!serialReady && (
        <div className="px-4 py-3 text-sm text-amber-800 bg-amber-50 border-b border-amber-100">
          {t('colorPanels.swatches.noSerialWarning')}{' '}
          <span className="font-mono font-bold" dir="ltr">
            {serialNo.trim() ? `${serialNo.trim()}-C01` : '{SERIAL}-C01'}
          </span>
          .
        </div>
      )}

      {serialReady && rows.length === 0 && !loading && (
        <div className="px-4 py-3 text-sm text-violet-900 bg-violet-50 border-b border-violet-100">
          {t('colorPanels.swatches.nextStepHint')}
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
                  aria-label={t('colorPanels.swatches.selectAllAria')}
                />
              </th>
              <th className="p-3 text-right font-bold">#</th>
              <th className="p-3 text-right font-bold">{t('colorPanels.swatches.colColorCode')}</th>
              <th className="p-3 text-right font-bold">{t('colorPanels.swatches.colName')}</th>
              <th className="p-3 text-right font-bold">{t('colorPanels.swatches.colBarcode')}</th>
              <th className="p-3 text-right font-bold w-44">{t('registry.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin inline ml-2" />
                  {t('registry.loading')}
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">
                  {t('colorPanels.swatches.emptyState')}
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
                    aria-label={t('colorPanels.swatches.selectRowAria', { code: row.color_code })}
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
                      {t('print')}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(row)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-white"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      {t('registry.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(row)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t('delete')}
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
              <h4 className="font-bold text-slate-900">{editId ? t('colorPanels.swatches.editColorTitle') : t('colorPanels.swatches.addColorTitle')}</h4>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 block sm:col-span-2">
                <span className="text-xs font-bold text-slate-600">{t('colorPanels.swatches.colorCodeLabel')}</span>
                <input
                  value={form.colorCode}
                  onChange={(e) => setForm((prev) => ({ ...prev, colorCode: e.target.value }))}
                  placeholder="C-01"
                  dir="ltr"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-600">{t('colorPanels.swatches.nameArLabel')}</span>
                <input
                  value={form.nameAr}
                  onChange={(e) => setForm((prev) => ({ ...prev, nameAr: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-600">{t('colorPanels.swatches.nameTrLabel')}</span>
                <input
                  value={form.nameTr}
                  onChange={(e) => setForm((prev) => ({ ...prev, nameTr: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <div className="space-y-1.5 sm:col-span-2">
                <span className="text-xs font-bold text-slate-600">{t('colorPanels.swatches.pickFromCatalogLabel')}</span>
                {pickedFabricColorId ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm">
                    <span className="font-bold text-violet-800">{t('colorPanels.swatches.linkedToCatalogHint')}</span>
                    <button
                      type="button"
                      onClick={clearCatalogColor}
                      className="text-xs font-bold text-rose-600 hover:text-rose-700"
                    >
                      {t('colorPanels.swatches.clearCatalogLink')}
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      value={colorQuery}
                      onChange={(e) => setColorQuery(e.target.value)}
                      placeholder={t('colorPanels.swatches.catalogSearchPlaceholder')}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                    {colorSearching && (
                      <Loader2 className="w-4 h-4 animate-spin text-violet-600 absolute left-3 top-1/2 -translate-y-1/2" />
                    )}
                    {colorResults.length > 0 && (
                      <div className="mt-1.5 max-h-48 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white shadow-sm">
                        {colorResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => pickCatalogColor(c)}
                            className="w-full flex items-center gap-2 text-right px-3 py-2 text-sm hover:bg-violet-50 transition"
                          >
                            <span
                              className="w-4 h-4 rounded-full border border-slate-200 shrink-0"
                              style={{ backgroundColor: c.hex_color || '#e5e7eb' }}
                            />
                            <span className="flex-1">
                              <span className="font-bold text-slate-900">{c.name_ar || c.color_code}</span>
                              <span className="text-xs text-slate-500 mr-1.5" dir="ltr">({c.color_code})</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {!colorSearching && colorQuery.trim().length >= 2 && colorResults.length === 0 && (
                      <p className="mt-1 text-xs text-slate-500">{t('colorPanels.swatches.catalogNoResults')}</p>
                    )}
                  </div>
                )}
              </div>
              <label className="space-y-1 block sm:col-span-2">
                <span className="text-xs font-bold text-slate-600">{t('colorPanels.swatches.notesLabel')}</span>
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
                {t('colorPanels.swatches.cancelButton')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submit()}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? t('colorPanels.swatches.saving') : t('colorPanels.swatches.saveButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
