import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Package, Palette, Printer, Search, X } from 'lucide-react';
import { listFabricRolls, type FabricRollDto } from '../../lib/api/fabricRollsApi';
import { listFabricItems, type ApiFabricItem } from '../../lib/api/fabricItemsApi';
import { lookupCartelaScan, type CartelaColorLookupResult } from '../../lib/api/cartelaColorApi';
import { renderInventoryRollsAuditA4Html } from '../../lib/printing/renderInventoryRollsAuditA4';
import { openDocumentPrintWindow } from '../../lib/printing/documentPrint';

type Props = {
  open: boolean;
  onClose: () => void;
};

type Bucket = { key: string; label: string; rollCount: number; totalMeters: number };

/** حد عرض للحفاظ على سرعة ووضوح البطاقة عند بحث واسع (مثل اسم لون يطابق عشرات الخامات). */
const MAX_GROUPS_SHOWN = 12;
const MAX_BUCKET_ROWS = 12;

type MaterialGroup = {
  name: string;
  rollCount: number;
  totalMeters: number;
  byCode: Bucket[];
  byColor: Bucket[];
  rolls: FabricRollDto[];
};

const rollMeters = (roll: FabricRollDto) => Number.parseFloat(roll.length_m ?? '0') || 0;

function buildBuckets(rolls: FabricRollDto[], pick: (roll: FabricRollDto) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const roll of rolls) {
    const label = pick(roll);
    const current = map.get(label) ?? { key: label, label, rollCount: 0, totalMeters: 0 };
    current.rollCount += 1;
    current.totalMeters += rollMeters(roll);
    map.set(label, current);
  }
  return [...map.values()].sort((a, b) => b.totalMeters - a.totalMeters);
}

export const MaterialInquiryModal: React.FC<Props> = ({ open, onClose }) => {
  const { t } = useTranslation('materialInquiry');
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [rolls, setRolls] = useState<FabricRollDto[]>([]);
  const [items, setItems] = useState<ApiFabricItem[]>([]);
  const [cartela, setCartela] = useState<CartelaColorLookupResult | null>(null);
  /** تصفية داخلية بنفس البطاقة (كود أو لون) — لا انتقال لأي شاشة. */
  const [focus, setFocus] = useState<{ kind: 'code' | 'color'; value: string } | null>(null);

  const runSearch = useCallback(async (raw: string) => {
    const value = raw.trim();
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setFocus(null);
    try {
      const [rollsRes, itemsRes, cartelaRes] = await Promise.allSettled([
        listFabricRolls({ search: value, onlyAvailable: true, pageSize: 500 }),
        listFabricItems({ search: value, pageSize: 100 }),
        lookupCartelaScan(value),
      ]);
      if (requestId !== requestIdRef.current) return;
      setRolls(rollsRes.status === 'fulfilled' ? rollsRes.value.data : []);
      setItems(itemsRes.status === 'fulfilled' ? itemsRes.value.data : []);
      setCartela(cartelaRes.status === 'fulfilled' ? cartelaRes.value : null);
      setSearched(true);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  // بحث فوري بلا زر — نفس نمط لوحة مسح الكارتيلا المعتمد بالمشروع.
  useEffect(() => {
    if (!open) return;
    const value = query.trim();
    if (value.length < 2 && !value.includes('-')) {
      setSearched(false);
      setRolls([]);
      setItems([]);
      setCartela(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void runSearch(value);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query, open, runSearch]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) return;
    setQuery('');
    setRolls([]);
    setItems([]);
    setCartela(null);
    setSearched(false);
    setFocus(null);
  }, [open]);

  const materials = useMemo<MaterialGroup[]>(() => {
    const map = new Map<string, FabricRollDto[]>();
    for (const roll of rolls) {
      const name = (roll.item_name ?? '').trim() || (roll.internal_code ?? '').trim() || '—';
      const list = map.get(name) ?? [];
      list.push(roll);
      map.set(name, list);
    }
    return [...map.entries()]
      .map(([name, groupRolls]) => ({
        name,
        rollCount: groupRolls.length,
        totalMeters: groupRolls.reduce((sum, r) => sum + rollMeters(r), 0),
        byCode: buildBuckets(groupRolls, (r) => (r.internal_code ?? '').trim() || '—'),
        byColor: buildBuckets(groupRolls, (r) => (r.color_name_ar ?? '').trim() || t('material.noColor')),
        rolls: groupRolls,
      }))
      .sort((a, b) => b.totalMeters - a.totalMeters);
  }, [rolls, t]);

  /** الأتواب المعروضة فعلاً بعد التصفية الداخلية — تُستخدم للطباعة أيضاً. */
  const visibleRolls = useMemo(() => {
    if (!focus) return rolls;
    if (focus.kind === 'code') {
      return rolls.filter((r) => ((r.internal_code ?? '').trim() || '—') === focus.value);
    }
    return rolls.filter((r) => ((r.color_name_ar ?? '').trim() || t('material.noColor')) === focus.value);
  }, [rolls, focus, t]);

  /** توب واحد مطابق تماماً للباركود المكتوب — يُبرز أعلى النتائج. */
  const exactRoll = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    if (!value) return null;
    return rolls.find((r) => (r.barcode ?? '').trim().toLocaleLowerCase() === value) ?? null;
  }, [rolls, query]);

  /** أصناف معرَّفة بالنظام لكن بلا أي أتواب متوفرة بنتيجة البحث. */
  const itemsWithoutStock = useMemo(() => {
    const stocked = new Set(rolls.map((r) => (r.internal_code ?? '').trim()));
    return items.filter((item) => !stocked.has(item.internal_code.trim()));
  }, [items, rolls]);

  const cartelaMaterialHasStock = useMemo(() => {
    if (!cartela) return false;
    const art = cartela.art_code.trim().toLocaleLowerCase();
    if (!art) return false;
    return rolls.some((r) => (r.item_name ?? '').trim().toLocaleLowerCase() === art);
  }, [cartela, rolls]);

  const handlePrint = () => {
    if (visibleRolls.length === 0) return;
    const html = renderInventoryRollsAuditA4Html({
      rolls: visibleRolls,
      searchQuery: query.trim(),
      scopeLabel: t('print.scopeLabel'),
      warehouseLabel: '',
      printedAt: new Date(),
    });
    const ok = openDocumentPrintWindow(html, t('print.scopeLabel'));
    if (!ok) window.alert(t('print.popupBlocked'));
  };

  if (!open) return null;

  const hasAnyResult = Boolean(cartela) || rolls.length > 0 || itemsWithoutStock.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto"
      dir="rtl"
      role="dialog"
      aria-modal="true"
    >
      <div className="my-6 w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-2">
            <Search className="mt-0.5 h-5 w-5 text-emerald-700" />
            <div>
              <h3 className="text-lg font-black text-slate-900">{t('modal.title')}</h3>
              <p className="mt-0.5 text-xs text-slate-600">{t('modal.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={t('modal.close')}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-white hover:text-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-3 h-5 w-5 text-slate-400" />
              {loading && <Loader2 className="absolute left-3 top-3 h-5 w-5 animate-spin text-emerald-600" />}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('search.placeholder')}
                autoComplete="off"
                className="w-full rounded-xl border-2 border-emerald-200 bg-white py-3 pr-11 pl-11 text-base font-bold text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {loading ? t('search.searching') : t('search.hint')}
            </p>
          </div>

          {cartela && (
            <section className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/60 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-black text-fuchsia-700">
                <Palette className="h-4 w-4" />
                {t('color.sectionTitle')}
              </div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h4 className="text-lg font-black text-slate-900">{cartela.art_code || cartela.title}</h4>
                  <p className="text-sm text-slate-600">
                    {t('color.designSerial', { design: cartela.design_no || '—', serial: cartela.serial_no || '—' })}
                  </p>
                  {cartela.color && (
                    <p className="text-sm font-bold text-fuchsia-800">
                      {t('color.colorLine', {
                        name: (cartela.color.name_ar || cartela.color.name_tr || cartela.color.color_code).trim(),
                        code: cartela.color.color_code,
                      })}
                    </p>
                  )}
                  <p className="text-xs text-slate-600">
                    {t('color.width')}: {cartela.width_value || '—'} {cartela.width_unit} · {t('color.weight')}:{' '}
                    {cartela.weight_value || '—'} {cartela.weight_unit}
                  </p>
                  <p className="text-xs text-slate-600">
                    {t('color.composition')}: {cartela.composition || '—'}
                  </p>
                </div>
                {cartela.color?.image_url && (
                  <img
                    src={cartela.color.image_url}
                    alt={cartela.color.color_code}
                    className="h-20 w-20 rounded-lg border border-slate-200 bg-white object-cover"
                  />
                )}
              </div>

              {cartela.art_code.trim() && (
                <div className="mt-3 rounded-lg border border-fuchsia-200 bg-white p-3">
                  <p className="text-xs font-bold text-slate-600">{t('color.belongsTo')}</p>
                  <button
                    type="button"
                    onClick={() => setQuery(cartela.art_code.trim())}
                    className="mt-1 text-base font-black text-indigo-700 underline decoration-indigo-300 decoration-2 underline-offset-4 hover:text-indigo-900"
                  >
                    {cartela.art_code.trim()}
                  </button>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {cartelaMaterialHasStock ? t('color.belongsToHint') : t('color.noStockForMaterial')}
                  </p>
                </div>
              )}
            </section>
          )}

          {exactRoll && (
            <section className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-black text-indigo-700">
                <Package className="h-4 w-4" />
                {t('roll.sectionTitle')}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <div><span className="text-slate-500">{t('roll.barcode')}: </span><span className="font-mono font-bold">{exactRoll.barcode}</span></div>
                <div><span className="text-slate-500">{t('roll.material')}: </span><span className="font-bold">{exactRoll.item_name || '—'}</span></div>
                <div><span className="text-slate-500">{t('roll.code')}: </span><span className="font-mono font-bold">{exactRoll.internal_code || '—'}</span></div>
                <div><span className="text-slate-500">{t('roll.color')}: </span><span className="font-bold">{exactRoll.color_name_ar || '—'}</span></div>
                <div><span className="text-slate-500">{t('roll.meters')}: </span><span className="font-mono font-bold">{rollMeters(exactRoll).toFixed(2)}</span></div>
                <div><span className="text-slate-500">{t('roll.warehouse')}: </span><span className="font-bold">{exactRoll.warehouse_name || '—'}</span></div>
              </div>
            </section>
          )}

          {materials.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-black text-slate-800">{t('material.sectionTitle')}</h4>
                <div className="flex items-center gap-2">
                  {focus && (
                    <span className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                      {t('material.filterActive', { label: focus.value })}
                      <button type="button" onClick={() => setFocus(null)} className="text-rose-600 hover:text-rose-800">
                        {t('material.clearFilter')}
                      </button>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handlePrint}
                    disabled={visibleRolls.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-40"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    {t('material.print')}
                  </button>
                </div>
              </div>

              {materials.length > MAX_GROUPS_SHOWN && (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                  {t('material.groupsShown', { shown: MAX_GROUPS_SHOWN, total: materials.length })}
                </p>
              )}

              {materials.slice(0, MAX_GROUPS_SHOWN).map((group) => (
                <div key={group.name} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h5 className="text-base font-black text-slate-900">{group.name}</h5>
                  <p className="mt-0.5 text-sm font-bold text-emerald-800">
                    {t('material.totals', { count: group.rollCount, meters: group.totalMeters.toFixed(2) })}
                  </p>

                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <BucketTable
                      title={t('material.byCodeTitle')}
                      firstColLabel={t('material.colCode')}
                      rollsLabel={t('material.colRolls')}
                      metersLabel={t('material.colMeters')}
                      buckets={group.byCode}
                      activeValue={focus?.kind === 'code' ? focus.value : null}
                      onPick={(value) =>
                        setFocus((prev) =>
                          prev?.kind === 'code' && prev.value === value ? null : { kind: 'code', value },
                        )
                      }
                      mono
                    />
                    <BucketTable
                      title={t('material.byColorTitle')}
                      firstColLabel={t('material.colColor')}
                      rollsLabel={t('material.colRolls')}
                      metersLabel={t('material.colMeters')}
                      buckets={group.byColor}
                      activeValue={focus?.kind === 'color' ? focus.value : null}
                      onPick={(value) =>
                        setFocus((prev) =>
                          prev?.kind === 'color' && prev.value === value ? null : { kind: 'color', value },
                        )
                      }
                    />
                  </div>
                </div>
              ))}
            </section>
          )}

          {itemsWithoutStock.length > 0 && (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <h4 className="mb-1.5 text-xs font-black text-amber-800">{t('noStock.sectionTitle')}</h4>
              <ul className="space-y-0.5 text-xs text-amber-900">
                {itemsWithoutStock.slice(0, 20).map((item) => (
                  <li key={item.id}>{t('noStock.line', { name: item.name, code: item.internal_code })}</li>
                ))}
              </ul>
            </section>
          )}

          {searched && !loading && !hasAnyResult && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm font-bold text-slate-500">
              {t('search.noResults')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const BucketTable: React.FC<{
  title: string;
  firstColLabel: string;
  rollsLabel: string;
  metersLabel: string;
  buckets: Bucket[];
  activeValue: string | null;
  onPick: (value: string) => void;
  mono?: boolean;
}> = ({ title, firstColLabel, rollsLabel, metersLabel, buckets, activeValue, onPick, mono }) => (
  <div className="overflow-hidden rounded-lg border border-slate-200">
    <p className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-black text-slate-600">{title}</p>
    <table className="w-full text-xs">
      <thead>
        <tr className="bg-slate-50/70 text-slate-500 font-bold">
          <th className="px-2 py-1 text-right">{firstColLabel}</th>
          <th className="px-2 py-1 text-right">{rollsLabel}</th>
          <th className="px-2 py-1 text-right">{metersLabel}</th>
        </tr>
      </thead>
      <tbody>
        {buckets.slice(0, MAX_BUCKET_ROWS).map((bucket) => (
          <tr
            key={bucket.key}
            onClick={() => onPick(bucket.label)}
            className={`cursor-pointer border-t border-slate-100 transition hover:bg-emerald-50 ${
              activeValue === bucket.label ? 'bg-emerald-50 font-black' : ''
            }`}
          >
            <td className={`px-2 py-1.5 text-slate-800 font-bold ${mono ? 'font-mono' : ''}`}>{bucket.label}</td>
            <td className="px-2 py-1.5 font-mono text-slate-600">{bucket.rollCount}</td>
            <td className="px-2 py-1.5 font-mono text-slate-600">{bucket.totalMeters.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
