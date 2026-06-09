import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  CheckSquare,
  Filter,
  Loader2,
  Save,
  Search,
  Square,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  finalizeBulkPurchaseAfterPricing,
  listFabricPricingGroups,
  listRecentPurchaseInvoicesForPricing,
  updateFabricBulkPricing,
  type FabricPricingGroupDto,
  type RecentPurchaseInvoiceDto,
} from '../../lib/api/fabricRollsApi';

interface PriceDraft {
  selected: boolean;
  unitCost: string;
  sellingPrice: string;
}

type InvoiceFilterMode = 'last' | 'all' | 'specific';

const toNumberOrUndef = (value: string): number | undefined => {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const fmt = (value: number | string, digits = 2) =>
  Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const fmtPriceOrDash = (value: string | number | null | undefined, digits = 4) => {
  const n = Number(value || 0);
  return n > 0 ? fmt(n, digits) : '—';
};

export const BulkPricing = () => {
  const [searchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState('');
  const [groups, setGroups] = useState<FabricPricingGroupDto[]>([]);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, PriceDraft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'success' | 'error'>('info');

  // Invoice filter (defaults to "آخر فاتورة شراء" unless we are in the import follow-up flow).
  const [invoiceMode, setInvoiceMode] = useState<InvoiceFilterMode>('last');
  const [specificInvoiceId, setSpecificInvoiceId] = useState('');
  const [recentInvoices, setRecentInvoices] = useState<RecentPurchaseInvoiceDto[]>([]);
  const [resolvedInvoiceId, setResolvedInvoiceId] = useState<string | null>(null);

  const importMode = searchParams.get('mode') === 'import';
  const batchTag = searchParams.get('batchTag') || '';
  const supplierId = searchParams.get('supplierId') || '';
  const warehouseId = searchParams.get('warehouseId') || '';

  // In import follow-up flow, batchTag scope wins over invoice filter — surface a clear note.
  useEffect(() => {
    if (importMode) setInvoiceMode('all');
  }, [importMode]);

  useEffect(() => {
    let cancelled = false;
    listRecentPurchaseInvoicesForPricing(100)
      .then((rows) => {
        if (!cancelled) setRecentInvoices(rows);
      })
      .catch(() => {
        if (!cancelled) setRecentInvoices([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pricingFilters = useMemo(() => ({
    search: searchTerm,
    batchTag: importMode ? batchTag : undefined,
    supplierId: importMode ? supplierId : undefined,
    warehouseId: importMode ? warehouseId : undefined,
    purchaseInvoiceId: invoiceMode === 'specific' && specificInvoiceId ? specificInvoiceId : undefined,
    lastInvoice: invoiceMode === 'last' && !importMode,
  }), [batchTag, importMode, invoiceMode, searchTerm, specificInvoiceId, supplierId, warehouseId]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      listFabricPricingGroups(pricingFilters)
        .then((result) => {
          if (cancelled) return;
          setGroups(result.data);
          setResolvedInvoiceId(result.resolvedPurchaseInvoiceId);
        })
        .catch((err) => {
          if (cancelled) return;
          setMessage(err instanceof Error ? err.message : 'تعذر تحميل التسعير الجماعي');
          setMessageType('error');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pricingFilters]);

  const selectedCount = groups.filter((group) => priceDrafts[group.item_id]?.selected).length;

  const getDraft = (group: FabricPricingGroupDto): PriceDraft =>
    priceDrafts[group.item_id] ?? {
      selected: false,
      unitCost: Number(group.avg_unit_cost) > 0 ? String(Number(group.avg_unit_cost).toFixed(4)) : '',
      sellingPrice: group.default_selling_price && Number(group.default_selling_price) > 0
        ? String(Number(group.default_selling_price).toFixed(4))
        : '',
    };

  const updateDraft = (group: FabricPricingGroupDto, patch: Partial<PriceDraft>) => {
    const draft = getDraft(group);
    setPriceDrafts((current) => ({
      ...current,
      [group.item_id]: { ...draft, ...patch },
    }));
    setMessage('');
  };

  const totals = useMemo(() => ({
    rolls: groups.reduce((sum, group) => sum + Number(group.roll_count || 0), 0),
    available: groups.reduce((sum, group) => sum + Number(group.available_roll_count || 0), 0),
    meters: groups.reduce((sum, group) => sum + Number(group.total_meters || 0), 0),
  }), [groups]);

  const toggleAllVisible = () => {
    const shouldSelect = selectedCount !== groups.length;
    const nextDrafts = { ...priceDrafts };
    groups.forEach((group) => {
      const draft = getDraft(group);
      nextDrafts[group.item_id] = { ...draft, selected: shouldSelect };
    });
    setPriceDrafts(nextDrafts);
    setMessage('');
  };

  const activeInvoiceScopeId = useMemo(() => {
    if (invoiceMode === 'specific') return specificInvoiceId || null;
    if (invoiceMode === 'last') return resolvedInvoiceId;
    return null;
  }, [invoiceMode, resolvedInvoiceId, specificInvoiceId]);

  const activeInvoice = useMemo(
    () => (activeInvoiceScopeId ? recentInvoices.find((inv) => inv.id === activeInvoiceScopeId) ?? null : null),
    [activeInvoiceScopeId, recentInvoices],
  );

  const handleSaveBulkPrices = async () => {
    const updates = groups
      .map((group) => {
        const draft = getDraft(group);
        return {
          group,
          selected: draft.selected,
          unitCost: toNumberOrUndef(draft.unitCost),
          sellingPrice: toNumberOrUndef(draft.sellingPrice),
        };
      })
      .filter((u) => u.selected && (u.unitCost != null || u.sellingPrice != null));

    if (updates.length === 0) {
      setMessage('يرجى تحديد خامة واحدة على الأقل وإدخال سعر تكلفة أو سعر بيع قبل الحفظ.');
      setMessageType('error');
      return;
    }

    setSaving(true);
    setMessage('');
    setMessageType('info');
    try {
      let updatedRolls = 0;
      let updatedDraftInvoices = 0;
      let updatedDraftVouchers = 0;
      let updatedConfirmedInvoices = 0;
      let repostedGlEntries = 0;
      let updatedSellingItems = 0;
      for (const update of updates) {
        const result = await updateFabricBulkPricing({
          itemId: update.group.item_id,
          unitCost: update.unitCost,
          sellingPrice: update.sellingPrice,
          onlyAvailable,
          batchTag: importMode ? batchTag : undefined,
          supplierId: importMode ? supplierId : undefined,
          warehouseId: importMode ? warehouseId : undefined,
          purchaseInvoiceId: activeInvoiceScopeId ?? undefined,
          cascadeToInvoices: true,
        });
        updatedRolls += result.updatedCount;
        updatedDraftInvoices += result.updatedDraftInvoices;
        updatedDraftVouchers += result.updatedDraftVouchers;
        updatedConfirmedInvoices += result.updatedConfirmedInvoices ?? 0;
        repostedGlEntries += result.repostedGlEntries ?? 0;
        if (result.updatedSellingPriceOnItem) updatedSellingItems++;
      }

      const parts: string[] = [];
      if (updatedRolls > 0) parts.push(`تم تحديث سعر التكلفة لـ ${updatedRolls.toLocaleString('en-US')} ثوب`);
      if (updatedSellingItems > 0) parts.push(`تم تحديث سعر البيع لـ ${updatedSellingItems.toLocaleString('en-US')} خامة`);
      if (updatedDraftInvoices > 0) parts.push(`تم تحديث ${updatedDraftInvoices.toLocaleString('en-US')} فاتورة شراء (مسودة)`);
      if (updatedDraftVouchers > 0) parts.push(`تم تحديث ${updatedDraftVouchers.toLocaleString('en-US')} سند مرتبط`);
      if (updatedConfirmedInvoices > 0) {
        const glHint = repostedGlEntries > 0
          ? ` (مع إعادة ترحيل ${repostedGlEntries.toLocaleString('en-US')} قيد محاسبي)`
          : '';
        parts.push(`تم تحديث ${updatedConfirmedInvoices.toLocaleString('en-US')} فاتورة مؤكدة تلقائياً${glHint}`);
      }
      setMessage(parts.join(' · ') || 'لم يتم تنفيذ أي تغيير.');
      setMessageType('success');

      if (importMode && batchTag && supplierId) {
        const invoice = await finalizeBulkPurchaseAfterPricing({
          batchTag,
          supplierId,
          warehouseId: warehouseId || undefined,
          currencyCode: 'USD',
        });
        setMessage((current) =>
          `${current} · تم إنشاء فاتورة شراء مؤكدة رقم ${invoice.invoiceNo} للمورد ${invoice.supplierName} بقيمة USD ${fmt(invoice.totalAmount)}.`,
        );
      }

      const refreshed = await listFabricPricingGroups(pricingFilters);
      setGroups(refreshed.data);
      setResolvedInvoiceId(refreshed.resolvedPurchaseInvoiceId);
      // Reset drafts so users see persisted values.
      setPriceDrafts({});
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'فشل حفظ التسعير الجماعي');
      setMessageType('error');
    } finally {
      setSaving(false);
    }
  };

  const noInvoicesYet = recentInvoices.length === 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">التسعير الجماعي حسب الخامة</h2>
          <p className="text-slate-500 mt-1">
            تحديث سعر تكلفة الأثواب وسعر البيع الافتراضي مباشرة من قاعدة البيانات، مع مزامنة فواتير الشراء غير المؤكدة والسندات المرتبطة بها.
          </p>
        </div>
      </div>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <BadgeDollarSign className="w-5 h-5 text-emerald-600" />
                فلترة وتسعير حسب الفاتورة أو اسم الخامة
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                اختر نطاق التسعير (آخر فاتورة شراء، كل المواد، أو فاتورة محددة)، ثم أدخل أسعار التكلفة/البيع للخامات المحددة.
              </p>
            </div>

            <div className="flex flex-col gap-3 w-full lg:w-auto">
              <label className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={onlyAvailable}
                  onChange={(event) => setOnlyAvailable(event.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                تطبيق على الأتواب المتاحة فقط
              </label>
              <div className="relative w-full lg:w-80">
                <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="بحث باسم الخامة أو كودها..."
                  className="w-full pr-10 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Invoice filter bar */}
          {!importMode && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <Filter className="w-4 h-4 text-indigo-600" />
                <span>الفلتر حسب الفاتورة:</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInvoiceMode('last')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                    invoiceMode === 'last'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  آخر فاتورة شراء
                </button>
                <button
                  type="button"
                  onClick={() => setInvoiceMode('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                    invoiceMode === 'all'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  كل المواد
                </button>
                <select
                  value={invoiceMode === 'specific' ? specificInvoiceId : ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value) {
                      setSpecificInvoiceId(value);
                      setInvoiceMode('specific');
                    } else {
                      setInvoiceMode('last');
                      setSpecificInvoiceId('');
                    }
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border bg-white text-slate-700 border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    invoiceMode === 'specific' ? 'border-indigo-600 ring-2 ring-indigo-200' : ''
                  }`}
                >
                  <option value="">— اختيار فاتورة محددة —</option>
                  {recentInvoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoice_no} · {inv.invoice_date.slice(0, 10)} · {inv.supplier_name ?? '—'} · {inv.roll_count} ثوب
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {importMode && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-800">
              أنت في وضع متابعة استيراد المخزون — يتم عرض المواد لدفعة الاستيراد فقط (batchTag: <span className="font-mono">{batchTag}</span>).
            </div>
          )}

          {!importMode && activeInvoice && (
            <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
              <span>الفاتورة الحالية:</span>
              <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">{activeInvoice.invoice_no}</span>
              <span>·</span>
              <span>{activeInvoice.invoice_date.slice(0, 10)}</span>
              <span>·</span>
              <span>{activeInvoice.supplier_name ?? 'بدون مورد'}</span>
              <span>·</span>
              <span>{activeInvoice.document_status}</span>
              <span>·</span>
              <span>{activeInvoice.roll_count} ثوب</span>
            </div>
          )}

          {!importMode && invoiceMode === 'last' && noInvoicesYet && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              لا توجد فواتير شراء سابقة بعد — يمكنك التبديل إلى "كل المواد" لعرض جميع المخزون.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <BulkStat label="عدد الخامات" value={groups.length.toLocaleString('en-US')} />
            <BulkStat label="الخامات المحددة" value={selectedCount.toLocaleString('en-US')} />
            <BulkStat label="إجمالي الأثواب" value={totals.rolls.toLocaleString('en-US')} />
            <BulkStat label="الأمتار المتاحة" value={fmt(totals.meters)} />
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-3 w-12 text-center">
                    <button onClick={toggleAllVisible} className="inline-flex items-center justify-center text-indigo-600 hover:text-indigo-700">
                      {selectedCount === groups.length && groups.length > 0 ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                    </button>
                  </th>
                  <th className="p-3">الخامة</th>
                  <th className="p-3">الكود</th>
                  <th className="p-3">الأثواب</th>
                  <th className="p-3">المتاح</th>
                  <th className="p-3">الألوان</th>
                  <th className="p-3">إجمالي متر</th>
                  <th className="p-3">آخر فاتورة شراء</th>
                  <th className="p-3">سعر التكلفة الحالي</th>
                  <th className="p-3">سعر التكلفة الجديد</th>
                  <th className="p-3">سعر البيع الحالي</th>
                  <th className="p-3">سعر البيع الجديد</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={12} className="p-8 text-center text-slate-500 bg-slate-50">
                      <Loader2 className="w-5 h-5 animate-spin inline-block ml-2" />
                      جاري تحميل بيانات المخزون...
                    </td>
                  </tr>
                )}
                {!loading && groups.map((group) => {
                  const draft = getDraft(group);
                  return (
                    <tr key={group.item_id} className="border-t border-slate-100 hover:bg-slate-50 align-top">
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={draft.selected}
                          onChange={(event) => updateDraft(group, { selected: event.target.checked })}
                          className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="p-3 font-bold text-slate-900">{group.item_name}</td>
                      <td className="p-3 font-mono text-xs">{group.internal_code}</td>
                      <td className="p-3 font-mono">{group.roll_count}</td>
                      <td className="p-3 font-mono">{group.available_roll_count}</td>
                      <td className="p-3 font-mono">{group.color_count}</td>
                      <td className="p-3 font-mono">{fmt(group.total_meters)}</td>
                      <td className="p-3 text-xs text-slate-600">
                        {group.last_purchase_invoice_no ? (
                          <span>
                            <span className="font-mono">{group.last_purchase_invoice_no}</span>
                            {group.last_purchase_invoice_date && (
                              <span className="text-slate-400 block">{group.last_purchase_invoice_date.slice(0, 10)}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-3 font-mono">{fmtPriceOrDash(group.avg_unit_cost, 4)}</td>
                      <td className="p-3">
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={draft.unitCost}
                          onChange={(event) => updateDraft(group, { selected: true, unitCost: event.target.value })}
                          className="w-32 bg-white border border-slate-200 rounded px-2 py-1.5 text-left font-mono focus:outline-none focus:border-indigo-500"
                          dir="ltr"
                          placeholder="0.0000"
                        />
                      </td>
                      <td className="p-3 font-mono">{fmtPriceOrDash(group.default_selling_price, 4)}</td>
                      <td className="p-3">
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={draft.sellingPrice}
                          onChange={(event) => updateDraft(group, { selected: true, sellingPrice: event.target.value })}
                          className="w-32 bg-white border border-emerald-200 rounded px-2 py-1.5 text-left font-mono focus:outline-none focus:border-emerald-500"
                          dir="ltr"
                          placeholder="0.0000"
                        />
                      </td>
                    </tr>
                  );
                })}
                {!loading && groups.length === 0 && (
                  <tr>
                    <td colSpan={12} className="p-8 text-center text-slate-500 bg-slate-50">
                      لا توجد خامات مطابقة للفلتر.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {message && (
            <div
              className={`rounded-lg p-3 text-sm font-bold border ${
                messageType === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : messageType === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-indigo-50 border-indigo-200 text-indigo-700'
              }`}
            >
              {message}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleSaveBulkPrices}
              disabled={saving || loading}
              className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-indigo-700 transition flex items-center gap-2 shadow-sm disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ التسعير الجماعي
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

const BulkStat = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
    <p className="text-xs font-bold text-slate-500 mb-1">{label}</p>
    <p className="font-black text-slate-900 font-mono">{value}</p>
  </div>
);
