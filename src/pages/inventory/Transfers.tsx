import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, Loader2, Search, ArrowRight, X } from 'lucide-react';
import { listFabricRolls, type FabricRollDto } from '../../lib/api/fabricRollsApi';
import { listLocations, listWarehouses, type ApiWarehouse, type ApiWarehouseLocation } from '../../lib/api/warehousesApi';
import {
  listInventoryTransfers,
  createInventoryTransfer,
  confirmInventoryTransfer,
  cancelInventoryTransfer,
  type InventoryTransferRow,
} from '../../lib/api/inventoryTransfersApi';
import { ApiRequestError } from '../../lib/api/client';

const STATUS_AR: Record<string, string> = {
  DRAFT: 'مسودة',
  CONFIRMED: 'مؤكدة',
  CANCELLED: 'ملغاة',
};

const STATUS_CLASS: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-200 text-slate-700',
};

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

export const Transfers = () => {
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [fromLocations, setFromLocations] = useState<ApiWarehouseLocation[]>([]);
  const [toLocations, setToLocations] = useState<ApiWarehouseLocation[]>([]);
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [rollsPick, setRollsPick] = useState<FabricRollDto[]>([]);
  const [pickRollId, setPickRollId] = useState('');
  const [selectedRollIds, setSelectedRollIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<InventoryTransferRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [bus, setBus] = useState({ list: false, create: false, act: null as string | null });
  const [err, setErr] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setErr(null);
    setBus((b) => ({ ...b, list: true }));
    try {
      const res = await listInventoryTransfers({
        search: search.trim() || undefined,
        page: 1,
        pageSize: 50,
      });
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : 'تعذر تحميل المناقلات');
    } finally {
      setBus((b) => ({ ...b, list: false }));
    }
  }, [search]);

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
    if (!fromWarehouseId) {
      setFromLocations([]);
      setFromLocationId('');
      setRollsPick([]);
      setSelectedRollIds([]);
      setPickRollId('');
      return;
    }
    void (async () => {
      try {
        const locs = await listLocations(fromWarehouseId);
        setFromLocations(locs);
        setFromLocationId('');
        const rolls = await loadRollsForWarehouse(fromWarehouseId);
        setRollsPick(rolls);
        setSelectedRollIds([]);
        setPickRollId('');
      } catch {
        setFromLocations([]);
        setRollsPick([]);
      }
    })();
  }, [fromWarehouseId]);

  useEffect(() => {
    if (!toWarehouseId) {
      setToLocations([]);
      setToLocationId('');
      return;
    }
    void (async () => {
      try {
        const locs = await listLocations(toWarehouseId);
        setToLocations(locs);
        setToLocationId('');
      } catch {
        setToLocations([]);
      }
    })();
  }, [toWarehouseId]);

  const addRoll = () => {
    if (!pickRollId) return;
    if (selectedRollIds.includes(pickRollId)) return;
    setSelectedRollIds((x) => [...x, pickRollId]);
    setPickRollId('');
  };

  const removeRoll = (id: string) => {
    setSelectedRollIds((x) => x.filter((r) => r !== id));
  };

  const rollLabel = useMemo(() => {
    const m = new Map<string, FabricRollDto>(rollsPick.map((r) => [r.id, r]));
    return (id: string) => {
      const r = m.get(id);
      if (!r) return id;
      return `${r.barcode} — ${r.item_name ?? 'ثوب'}`;
    };
  }, [rollsPick]);

  const handleCreate = async () => {
    setErr(null);
    if (!fromWarehouseId || !toWarehouseId) {
      setErr('اختر مستودع المصدر والوجهة');
      return;
    }
    if (fromWarehouseId === toWarehouseId && (fromLocationId || '') === (toLocationId || '')) {
      setErr('يجب أن يختلف المستودع أو موقع الوجهة عن المصدر');
      return;
    }
    if (selectedRollIds.length === 0) {
      setErr('أضف ثوباً واحداً على الأقل من قائمة المصدر');
      return;
    }
    setBus((b) => ({ ...b, create: true }));
    try {
      await createInventoryTransfer({
        fromWarehouseId,
        fromLocationId: fromLocationId || null,
        toWarehouseId,
        toLocationId: toLocationId || null,
        notes: notes.trim() || null,
        lines: selectedRollIds.map((fabricRollId) => ({ fabricRollId, quantity: 1 })),
      });
      setNotes('');
      setSelectedRollIds([]);
      await loadList();
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : 'تعذر إنشاء المناقلة');
    } finally {
      setBus((b) => ({ ...b, create: false }));
    }
  };

  const handleConfirm = async (id: string) => {
    setErr(null);
    setBus((b) => ({ ...b, act: id }));
    try {
      await confirmInventoryTransfer(id);
      await loadList();
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : 'تعذر تأكيد المناقلة');
    } finally {
      setBus((b) => ({ ...b, act: null }));
    }
  };

  const handleCancel = async (id: string) => {
    setErr(null);
    setBus((b) => ({ ...b, act: id }));
    try {
      await cancelInventoryTransfer(id);
      await loadList();
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : 'تعذر إلغاء المناقلة');
    } finally {
      setBus((b) => ({ ...b, act: null }));
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">المناقلة بين المستودعات</h2>
          <p className="text-slate-500 mt-1">نقل البضائع والأقمشة والطاقات بين الفروع والمستودعات — بيانات من الخادم</p>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{err}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white p-6 rounded-xl border border-slate-200 shadow-sm self-start space-y-6">
          <h3 className="text-lg font-bold text-slate-900 border-b pb-2">طلب مناقلة جديد (مسودة)</h3>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">المستودع المحول منه (المصدر)</label>
              <select
                value={fromWarehouseId}
                onChange={(e) => setFromWarehouseId(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">— اختر —</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            {fromWarehouseId ? (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">موقع المصدر (اختياري)</label>
                <select
                  value={fromLocationId}
                  onChange={(e) => setFromLocationId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">كل المواقع</option>
                  {fromLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="flex justify-center py-2">
              <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
                <ArrowRight className="w-4 h-4 transform -rotate-90" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">المستودع المحول إليه (الوجهة)</label>
              <select
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">— اختر —</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            {toWarehouseId ? (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">موقع الوجهة (اختياري)</label>
                <select
                  value={toLocationId}
                  onChange={(e) => setToLocationId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">بدون موقع محدد</option>
                  {toLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">إضافة أثواب من المصدر</label>
              <div className="flex gap-2">
                <select
                  value={pickRollId}
                  onChange={(e) => setPickRollId(e.target.value)}
                  disabled={!fromWarehouseId}
                  className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                >
                  <option value="">اختر باركود الثوب...</option>
                  {rollsPick
                    .filter((r) => !selectedRollIds.includes(r.id))
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.barcode} — {r.item_name ?? ''}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={addRoll}
                  disabled={!pickRollId}
                  className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-200"
                >
                  إضافة
                </button>
              </div>
              {selectedRollIds.length > 0 ? (
                <ul className="space-y-1 max-h-36 overflow-y-auto border border-slate-100 rounded-lg p-2 bg-slate-50">
                  {selectedRollIds.map((id) => (
                    <li key={id} className="flex items-center justify-between text-xs gap-2">
                      <span className="truncate">{rollLabel(id)}</span>
                      <button type="button" onClick={() => removeRoll(id)} className="text-rose-600 shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">لا توجد أثواب محددة بعد</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">ملاحظات</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="اختياري"
              />
            </div>

            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={bus.create}
              className="w-full bg-indigo-600 text-white py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-indigo-700 transition font-medium mt-2 disabled:opacity-60"
            >
              {bus.create ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              حفظ مسودة مناقلة
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 flex items-center gap-4 bg-slate-50 flex-wrap">
            <h3 className="font-bold text-slate-900 ml-4">سجل المناقلات</h3>
            <span className="text-xs text-slate-500">({total})</span>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم المناقلة..."
                className="w-full pr-9 pl-4 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => void loadList()}
              className="text-sm px-3 py-2 border border-slate-200 rounded-lg hover:bg-white bg-white"
            >
              تحديث
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-800 text-slate-100 font-medium">
                <tr>
                  <th className="px-4 py-4">رقم المناقلة</th>
                  <th className="px-4 py-4">من مستودع</th>
                  <th className="px-4 py-4">إلى مستودع</th>
                  <th className="px-4 py-4">الأصناف المنقولة</th>
                  <th className="px-4 py-4">الحالة</th>
                  <th className="px-4 py-4 w-40">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bus.list ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                      <Loader2 className="w-8 h-8 animate-spin inline text-indigo-500" />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-600 font-medium">
                      لا توجد مناقلات بين المستودعات بعد
                    </td>
                  </tr>
                ) : (
                  rows.map((tr) => (
                    <tr key={tr.id} className="hover:bg-slate-50 transition-colors bg-white">
                      <td className="px-4 py-4 font-medium text-indigo-600">{tr.transfer_no}</td>
                      <td className="px-4 py-4 font-medium text-slate-700">{tr.from_warehouse_name ?? '—'}</td>
                      <td className="px-4 py-4 font-medium text-slate-700">{tr.to_warehouse_name ?? '—'}</td>
                      <td className="px-4 py-4 text-slate-600">
                        {(tr.line_count ?? 0).toLocaleString()} طاقة
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`px-2 py-1 rounded text-xs font-bold ${STATUS_CLASS[tr.status] ?? 'bg-slate-100'}`}
                        >
                          {STATUS_AR[tr.status] ?? tr.status}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {tr.status === 'DRAFT' ? (
                          <div className="flex flex-wrap gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => void handleConfirm(tr.id)}
                              disabled={bus.act === tr.id}
                              className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              تأكيد
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleCancel(tr.id)}
                              disabled={bus.act === tr.id}
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
    </div>
  );
};
