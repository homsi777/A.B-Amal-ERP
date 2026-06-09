import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Filter, Plus, Loader2, Trash2, X } from 'lucide-react';
import { listFabricRolls, type FabricRollDto } from '../../lib/api/fabricRollsApi';
import { listLocations, listWarehouses, type ApiWarehouse, type ApiWarehouseLocation } from '../../lib/api/warehousesApi';
import {
  listInventoryWaste,
  createInventoryWaste,
  confirmInventoryWaste,
  cancelInventoryWaste,
  type InventoryWasteRow,
  type WasteType,
} from '../../lib/api/inventoryWasteApi';
import { ApiRequestError } from '../../lib/api/client';

const WASTE_TYPE_AR: Record<WasteType, string> = {
  DAMAGE: 'تلف',
  SHORTAGE: 'نقص',
  CUTTING_WASTE: 'هدر قص',
  QUALITY_REJECT: 'رفض جودة',
  LOST: 'مفقود',
  OTHER: 'أخرى',
};

const STATUS_AR: Record<string, string> = {
  DRAFT: 'مسودة',
  CONFIRMED: 'مؤكدة',
  CANCELLED: 'ملغاة',
};

const STATUS_CLASS: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-rose-100 text-rose-800',
  CANCELLED: 'bg-slate-200 text-slate-700',
};

type LineDraft = { rollId: string; wasteLengthM: string };

async function loadRollsForWarehouse(warehouseId: string): Promise<FabricRollDto[]> {
  const all: FabricRollDto[] = [];
  let page = 1;
  const pageSize = 200;
  while (page <= 30) {
    const r = await listFabricRolls({ warehouseId, page, pageSize, onlyAvailable: true });
    all.push(...r.data);
    if (all.length >= r.total || r.data.length === 0) break;
    page += 1;
  }
  return all;
}

export const Depreciation = () => {
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [rows, setRows] = useState<InventoryWasteRow[]>([]);
  const [total, setTotal] = useState(0);
  const [draftTotal, setDraftTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [bus, setBus] = useState({ list: false, create: false, act: null as string | null });
  const [err, setErr] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [wasteType, setWasteType] = useState<WasteType>('DAMAGE');
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<ApiWarehouseLocation[]>([]);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [rollsPick, setRollsPick] = useState<FabricRollDto[]>([]);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [pickRollId, setPickRollId] = useState('');
  const [pickWasteLen, setPickWasteLen] = useState('');

  const loadList = useCallback(async () => {
    setErr(null);
    setBus((b) => ({ ...b, list: true }));
    try {
      const [all, drafts] = await Promise.all([
        listInventoryWaste({
          search: search.trim() || undefined,
          status: (statusFilter || undefined) as 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | undefined,
          page: 1,
          pageSize: 50,
        }),
        listInventoryWaste({ status: 'DRAFT', page: 1, pageSize: 1 }),
      ]);
      setRows(all.data);
      setTotal(all.total);
      setDraftTotal(drafts.total);
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : 'تعذر تحميل السجلات');
    } finally {
      setBus((b) => ({ ...b, list: false }));
    }
  }, [search, statusFilter]);

  useEffect(() => {
    void (async () => {
      try {
        const w = await listWarehouses({ status: 'active' });
        setWarehouses(w);
      } catch {
        setWarehouses([]);
      }
    })();
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!warehouseId) {
      setLocations([]);
      setLocationId('');
      setRollsPick([]);
      setLines([]);
      setPickRollId('');
      return;
    }
    void (async () => {
      try {
        const locs = await listLocations(warehouseId);
        setLocations(locs);
        setLocationId('');
        const rolls = await loadRollsForWarehouse(warehouseId);
        setRollsPick(rolls);
        setLines([]);
        setPickRollId('');
      } catch {
        setLocations([]);
        setRollsPick([]);
      }
    })();
  }, [warehouseId]);

  const rollLabel = useMemo(() => {
    const m = new Map<string, FabricRollDto>(rollsPick.map((r) => [r.id, r]));
    return (id: string) => {
      const r = m.get(id);
      if (!r) return id;
      return `${r.barcode} — ${r.item_name ?? 'ثوب'}`;
    };
  }, [rollsPick]);

  const addLine = () => {
    if (!pickRollId || !warehouseId) return;
    if (lines.some((l) => l.rollId === pickRollId)) return;
    const wasteM = pickWasteLen.trim() ? parseFloat(pickWasteLen.replace(',', '.')) : NaN;
    setLines((x) => [...x, { rollId: pickRollId, wasteLengthM: Number.isFinite(wasteM) ? pickWasteLen.trim() : '' }]);
    setPickRollId('');
    setPickWasteLen('');
  };

  const removeLine = (rollId: string) => setLines((x) => x.filter((l) => l.rollId !== rollId));

  const handleCreate = async () => {
    setErr(null);
    if (!warehouseId) {
      setErr('اختر المستودع الذي يقع فيه التوالف');
      return;
    }
    if (lines.length === 0) {
      setErr('أضف ثوباً واحداً على الأقل');
      return;
    }
    setBus((b) => ({ ...b, create: true }));
    try {
      await createInventoryWaste({
        wasteType,
        warehouseId,
        locationId: locationId || null,
        reason: reason.trim() || null,
        notes: notes.trim() || null,
        lines: lines.map((l) => ({
          fabricRollId: l.rollId,
          quantity: 1,
          wasteLengthM: l.wasteLengthM.trim()
            ? parseFloat(l.wasteLengthM.replace(',', '.'))
            : null,
        })),
      });
      setReason('');
      setNotes('');
      setLines([]);
      setShowForm(false);
      await loadList();
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : 'تعذر إنشاء السجل');
    } finally {
      setBus((b) => ({ ...b, create: false }));
    }
  };

  const handleConfirm = async (id: string) => {
    setErr(null);
    setBus((b) => ({ ...b, act: id }));
    try {
      await confirmInventoryWaste(id);
      await loadList();
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : 'تعذر التأكيد');
    } finally {
      setBus((b) => ({ ...b, act: null }));
    }
  };

  const handleCancel = async (id: string) => {
    setErr(null);
    setBus((b) => ({ ...b, act: id }));
    try {
      await cancelInventoryWaste(id);
      await loadList();
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : 'تعذر الإلغاء');
    } finally {
      setBus((b) => ({ ...b, act: null }));
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">إهلاك مادي (توالف)</h2>
          <p className="text-slate-500 mt-1">تسجيل التوالف والمنسوجات التالفة أو المفقودة — بيانات من PostgreSQL</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowForm((v) => !v);
            setErr(null);
          }}
          className="bg-rose-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-rose-700 transition shadow-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          <span>تسجيل توالف جديد</span>
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{err}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-2">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center">
            <Trash2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-500">إجمالي السجلات</p>
            <p className="text-2xl font-bold text-slate-900">{total.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center">
            <Filter className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-500">مسودات قيد المعالجة</p>
            <p className="text-2xl font-bold text-slate-900">{draftTotal.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {showForm ? (
        <div className="bg-white p-6 rounded-xl border border-rose-100 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 border-b pb-2">مسودة توالف جديدة</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">نوع التوالف</label>
              <select
                value={wasteType}
                onChange={(e) => setWasteType(e.target.value as WasteType)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm"
              >
                {(Object.keys(WASTE_TYPE_AR) as WasteType[]).map((k) => (
                  <option key={k} value={k}>
                    {WASTE_TYPE_AR[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">المستودع</label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm"
              >
                <option value="">— اختر —</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">الموقع (اختياري)</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                disabled={!warehouseId}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm"
              >
                <option value="">—</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-bold text-slate-500">السبب</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                placeholder="مثال: رطوبة، قص، رفض جودة..."
              />
            </div>
            <div className="space-y-1 md:col-span-3">
              <label className="text-xs font-bold text-slate-500">ملاحظات</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm"
              />
            </div>
          </div>

          <div className="border border-slate-100 rounded-lg p-4 space-y-3">
            <p className="text-sm font-bold text-slate-800">أثواب التوالف</p>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[200px] space-y-1">
                <label className="text-xs text-slate-500">ثوب</label>
                <select
                  value={pickRollId}
                  onChange={(e) => setPickRollId(e.target.value)}
                  disabled={!warehouseId}
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-sm"
                >
                  <option value="">اختر باركود...</option>
                  {rollsPick
                    .filter((r) => !lines.some((l) => l.rollId === r.id))
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.barcode} — {r.item_name ?? ''}
                      </option>
                    ))}
                </select>
              </div>
              <div className="w-32 space-y-1">
                <label className="text-xs text-slate-500">طول مُهْلك (م) اختياري</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={pickWasteLen}
                  onChange={(e) => setPickWasteLen(e.target.value)}
                  placeholder="كامل إن فارغ"
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <button
                type="button"
                onClick={addLine}
                disabled={!pickRollId}
                className="px-4 py-2.5 bg-rose-600 text-white rounded-lg text-sm font-medium hover:bg-rose-700 disabled:opacity-50"
              >
                إضافة
              </button>
            </div>
            {lines.length > 0 ? (
              <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
                {lines.map((l) => (
                  <li key={l.rollId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="truncate">{rollLabel(l.rollId)}</span>
                    <span className="text-slate-500 shrink-0">
                      {l.wasteLengthM ? `${l.wasteLengthM} م` : 'تلف كامل'}
                    </span>
                    <button type="button" onClick={() => removeLine(l.rollId)} className="text-rose-600">
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">لم تُضف أثواب بعد</p>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-sm"
            >
              إغلاق
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={bus.create}
              className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {bus.create ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              حفظ مسودة
            </button>
          </div>
        </div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between bg-slate-50">
          <div className="relative flex-1 max-w-md min-w-[200px]">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم السجل أو السبب..."
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition shadow-sm font-medium"
            >
              <Filter className="w-4 h-4" />
              <span>تصفية الحالة</span>
            </button>
            {filterOpen ? (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="p-2 border border-slate-200 rounded-lg text-sm bg-white"
              >
                <option value="">كل الحالات</option>
                <option value="DRAFT">مسودة</option>
                <option value="CONFIRMED">مؤكدة</option>
                <option value="CANCELLED">ملغاة</option>
              </select>
            ) : null}
            <button
              type="button"
              onClick={() => void loadList()}
              className="text-sm px-3 py-2 border border-slate-200 rounded-lg bg-white"
            >
              تحديث
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-6 py-4">رقم السجل</th>
                <th className="px-6 py-4">التاريخ</th>
                <th className="px-6 py-4">المستودع</th>
                <th className="px-6 py-4">النوع</th>
                <th className="px-6 py-4">الأثواب</th>
                <th className="px-6 py-4">السبب</th>
                <th className="px-6 py-4">الحالة</th>
                <th className="px-6 py-4 w-36">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bus.list ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    <Loader2 className="w-8 h-8 animate-spin inline text-rose-500" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-600 font-medium">
                    لا توجد توالف أو إهلاكات مسجلة بعد
                  </td>
                </tr>
              ) : (
                rows.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50 transition-colors bg-white">
                    <td className="px-6 py-4 font-mono font-medium text-slate-700">{record.waste_no}</td>
                    <td className="px-6 py-4 font-medium text-slate-600">{record.waste_date}</td>
                    <td className="px-6 py-4 text-indigo-700 font-medium">{record.warehouse_name ?? '—'}</td>
                    <td className="px-6 py-4">{WASTE_TYPE_AR[record.waste_type] ?? record.waste_type}</td>
                    <td className="px-6 py-4 font-bold text-slate-800">
                      {(record.line_count ?? 0).toLocaleString()} ثوب
                    </td>
                    <td className="px-6 py-4 text-slate-600 max-w-[180px] truncate">{record.reason ?? '—'}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-bold ${STATUS_CLASS[record.status] ?? 'bg-slate-100'}`}
                      >
                        {STATUS_AR[record.status] ?? record.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {record.status === 'DRAFT' ? (
                        <div className="flex flex-wrap gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => void handleConfirm(record.id)}
                            disabled={bus.act === record.id}
                            className="text-xs px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                          >
                            تأكيد
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCancel(record.id)}
                            disabled={bus.act === record.id}
                            className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
