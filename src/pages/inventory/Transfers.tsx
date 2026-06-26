import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Plus, QrCode, Search, ArrowRight, X } from 'lucide-react';
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

function warehouseOptionLabel(w: ApiWarehouse): string {
  return w.code ? `${w.name} (${w.code})` : w.name;
}

function rollDisplayLabel(r: FabricRollDto): string {
  const parts = [r.barcode];
  if (r.item_name) parts.push(r.item_name);
  if (r.color_name_ar) parts.push(r.color_name_ar);
  return parts.join(' — ');
}

function findRollInResults(code: string, rolls: FabricRollDto[]): FabricRollDto | undefined {
  const norm = code.trim().toLowerCase();
  if (!norm) return undefined;
  return (
    rolls.find((r) => r.barcode.toLowerCase() === norm) ??
    rolls.find((r) => r.roll_no?.toLowerCase() === norm) ??
    rolls[0]
  );
}

export const Transfers = () => {
  const scanRef = useRef<HTMLInputElement>(null);

  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [fromLocations, setFromLocations] = useState<ApiWarehouseLocation[]>([]);
  const [toLocations, setToLocations] = useState<ApiWarehouseLocation[]>([]);
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [selectedRolls, setSelectedRolls] = useState<FabricRollDto[]>([]);
  const [availableTotal, setAvailableTotal] = useState<number | null>(null);
  const [scanInput, setScanInput] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [rollSearch, setRollSearch] = useState('');
  const [rollSearchDebounced, setRollSearchDebounced] = useState('');
  const [searchResults, setSearchResults] = useState<FabricRollDto[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<InventoryTransferRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [listFromWarehouseId, setListFromWarehouseId] = useState('');
  const [listToWarehouseId, setListToWarehouseId] = useState('');
  const [bus, setBus] = useState({ list: false, create: false, act: null as string | null });
  const [err, setErr] = useState<string | null>(null);
  const [scanHint, setScanHint] = useState<string | null>(null);

  const selectedIds = useMemo(() => new Set(selectedRolls.map((r) => r.id)), [selectedRolls]);

  const loadList = useCallback(async () => {
    setErr(null);
    setBus((b) => ({ ...b, list: true }));
    try {
      const res = await listInventoryTransfers({
        search: search.trim() || undefined,
        fromWarehouseId: listFromWarehouseId || undefined,
        toWarehouseId: listToWarehouseId || undefined,
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
  }, [search, listFromWarehouseId, listToWarehouseId]);

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
      setSelectedRolls([]);
      setAvailableTotal(null);
      setSearchResults([]);
      setSearchTotal(0);
      setRollSearch('');
      setRollSearchDebounced('');
      return;
    }
    let cancelled = false;
    void listLocations(fromWarehouseId)
      .then((locs) => {
        if (!cancelled) {
          setFromLocations(locs);
          setFromLocationId('');
        }
      })
      .catch(() => {
        if (!cancelled) setFromLocations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fromWarehouseId]);

  useEffect(() => {
    if (!fromWarehouseId) return;
    let cancelled = false;
    void listFabricRolls({
      warehouseId: fromWarehouseId,
      locationId: fromLocationId || undefined,
      onlyAvailable: true,
      page: 1,
      pageSize: 1,
    })
      .then((res) => {
        if (!cancelled) setAvailableTotal(res.total);
      })
      .catch(() => {
        if (!cancelled) setAvailableTotal(null);
      });
    setSelectedRolls([]);
    setSearchResults([]);
    setSearchTotal(0);
    return () => {
      cancelled = true;
    };
  }, [fromWarehouseId, fromLocationId]);

  useEffect(() => {
    const t = window.setTimeout(() => setRollSearchDebounced(rollSearch.trim()), 350);
    return () => window.clearTimeout(t);
  }, [rollSearch]);

  useEffect(() => {
    if (!fromWarehouseId || rollSearchDebounced.length < 2) {
      setSearchResults([]);
      setSearchTotal(0);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    void listFabricRolls({
      warehouseId: fromWarehouseId,
      locationId: fromLocationId || undefined,
      search: rollSearchDebounced,
      onlyAvailable: true,
      page: 1,
      pageSize: 50,
      sortBy: 'barcode',
      sortDir: 'asc',
    })
      .then((res) => {
        if (cancelled) return;
        setSearchResults(res.data);
        setSearchTotal(res.total);
      })
      .catch(() => {
        if (!cancelled) {
          setSearchResults([]);
          setSearchTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromWarehouseId, fromLocationId, rollSearchDebounced]);

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

  const addRoll = useCallback((roll: FabricRollDto) => {
    setSelectedRolls((prev) => {
      if (prev.some((r) => r.id === roll.id)) return prev;
      return [...prev, roll];
    });
    setScanHint(`تمت إضافة: ${roll.barcode}`);
    setErr(null);
  }, []);

  const removeRoll = (id: string) => {
    setSelectedRolls((prev) => prev.filter((r) => r.id !== id));
  };

  const handleScanCommit = async () => {
    const code = scanInput.trim();
    if (!code) return;
    if (!fromWarehouseId) {
      setErr('اختر مستودع المصدر أولاً');
      return;
    }
    setScanBusy(true);
    setScanHint(null);
    try {
      const res = await listFabricRolls({
        warehouseId: fromWarehouseId,
        locationId: fromLocationId || undefined,
        search: code,
        onlyAvailable: true,
        pageSize: 25,
        page: 1,
      });
      const roll = findRollInResults(code, res.data);
      if (!roll) {
        setErr('لم يُعثر على ثوب متاح بهذا الرمز في المستودع المحدد');
        return;
      }
      if (selectedIds.has(roll.id)) {
        setScanHint(`مضاف مسبقاً: ${roll.barcode}`);
        setScanInput('');
        scanRef.current?.focus();
        return;
      }
      addRoll(roll);
      setScanInput('');
      scanRef.current?.focus();
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : 'تعذر البحث عن الثوب');
    } finally {
      setScanBusy(false);
    }
  };

  const destinationWarehouses = useMemo(
    () => warehouses.filter((w) => w.id !== fromWarehouseId || fromLocations.length > 0),
    [warehouses, fromWarehouseId, fromLocations.length],
  );

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
    if (selectedRolls.length === 0) {
      setErr('أضف ثوباً واحداً على الأقل — امسح الباركود أو ابحث في الجدول');
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
        lines: selectedRolls.map((r) => ({ fabricRollId: r.id, quantity: 1 })),
      });
      setNotes('');
      setSelectedRolls([]);
      setScanInput('');
      setRollSearch('');
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
          <p className="text-slate-500 mt-1">نقل الأثواب بين المستودعات — امسح الباركود أو ابحث بالاسم/الكود</p>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{err}</div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">طلب مناقلة جديد (مسودة)</h3>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
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
                    {warehouseOptionLabel(w)}
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
            ) : (
              <div className="hidden xl:block" />
            )}

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">المستودع المحول إليه (الوجهة)</label>
              <select
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
                disabled={!fromWarehouseId}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                <option value="">— اختر —</option>
                {destinationWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {warehouseOptionLabel(w)}
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
          </div>

          {fromWarehouseId && fromWarehouseId === toWarehouseId ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              نقل داخل نفس المستودع — اختر موقع وجهة مختلف عن موقع المصدر.
            </p>
          ) : null}

          <div className="border-t border-slate-100 pt-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-base font-bold text-slate-900">اختيار الأثواب للنقل</h4>
              {fromWarehouseId && availableTotal != null ? (
                <span className="text-xs text-slate-500">
                  {availableTotal.toLocaleString()} ثوب متاح في المصدر
                  {selectedRolls.length > 0 ? (
                    <span className="text-indigo-600 font-medium mr-2">
                      · {selectedRolls.length.toLocaleString()} محدد للنقل
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700 flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-indigo-600" />
                  مسح / إدخال باركود الثوب
                </label>
                <div className="flex gap-2">
                  <input
                    ref={scanRef}
                    type="text"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleScanCommit();
                      }
                    }}
                    disabled={!fromWarehouseId || scanBusy}
                    placeholder={fromWarehouseId ? 'امسح الباركود ثم Enter...' : 'اختر مستودع المصدر أولاً'}
                    className="flex-1 p-3 bg-indigo-50/50 border-2 border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm disabled:opacity-50"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => void handleScanCommit()}
                    disabled={!fromWarehouseId || !scanInput.trim() || scanBusy}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1"
                  >
                    {scanBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    إضافة
                  </button>
                </div>
                {scanHint ? <p className="text-xs text-emerald-700">{scanHint}</p> : null}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700 flex items-center gap-2">
                  <Search className="w-4 h-4 text-slate-500" />
                  بحث بالباركود أو اسم الخامة أو الكود
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
                  <input
                    type="text"
                    value={rollSearch}
                    onChange={(e) => setRollSearch(e.target.value)}
                    disabled={!fromWarehouseId}
                    placeholder={fromWarehouseId ? 'اكتب حرفين على الأقل...' : 'اختر مستودع المصدر أولاً'}
                    className="w-full pr-9 pl-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {fromWarehouseId && rollSearchDebounced.length >= 2 ? (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-600 flex justify-between">
                  <span>نتائج البحث</span>
                  <span>
                    {searchLoading ? 'جاري البحث...' : `${searchTotal.toLocaleString()} نتيجة (أول 50)`}
                  </span>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 font-medium">باركود</th>
                        <th className="px-3 py-2 font-medium">الخامة</th>
                        <th className="px-3 py-2 font-medium">اللون</th>
                        <th className="px-3 py-2 font-medium">متر</th>
                        <th className="px-3 py-2 w-16" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {searchLoading ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                            <Loader2 className="w-5 h-5 animate-spin inline text-indigo-500" />
                          </td>
                        </tr>
                      ) : searchResults.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                            لا توجد نتائج
                          </td>
                        </tr>
                      ) : (
                        searchResults.map((r) => {
                          const picked = selectedIds.has(r.id);
                          return (
                            <tr key={r.id} className={picked ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}>
                              <td className="px-3 py-2 font-mono font-medium text-indigo-700">{r.barcode}</td>
                              <td className="px-3 py-2">{r.item_name ?? '—'}</td>
                              <td className="px-3 py-2">{r.color_name_ar ?? r.color_code ?? '—'}</td>
                              <td className="px-3 py-2">{r.length_m}</td>
                              <td className="px-3 py-2 text-left">
                                <button
                                  type="button"
                                  disabled={picked}
                                  onClick={() => addRoll(r)}
                                  className="text-indigo-600 hover:text-indigo-800 disabled:text-slate-400 font-medium"
                                >
                                  {picked ? '✓' : '+'}
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : fromWarehouseId ? (
              <p className="text-xs text-slate-400">
                للبحث في آلاف الأثواب: اكتب جزءاً من الباركود أو اسم الخامة — أو امسح الباركود مباشرة.
              </p>
            ) : null}

            {selectedRolls.length > 0 ? (
              <div className="border border-indigo-100 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-100 text-xs font-medium text-indigo-900">
                  الأثواب المحددة للنقل ({selectedRolls.length.toLocaleString()})
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2">باركود</th>
                        <th className="px-3 py-2">الخامة</th>
                        <th className="px-3 py-2">متر</th>
                        <th className="px-3 py-2 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedRolls.map((r) => (
                        <tr key={r.id}>
                          <td className="px-3 py-2 font-mono">{r.barcode}</td>
                          <td className="px-3 py-2 truncate max-w-[200px]">{rollDisplayLabel(r)}</td>
                          <td className="px-3 py-2">{r.length_m}</td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => removeRoll(r.id)}
                              className="text-rose-600 hover:text-rose-800"
                              title="إزالة"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">لم تُحدَّد أثواب بعد — امسح الباركود أو اختر من نتائج البحث</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end border-t border-slate-100 pt-4">
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
              disabled={bus.create || !fromWarehouseId || !toWarehouseId}
              className="md:min-w-[200px] bg-indigo-600 text-white py-3 px-6 rounded-lg flex items-center justify-center gap-2 hover:bg-indigo-700 transition font-medium disabled:opacity-60"
            >
              {bus.create ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              حفظ مسودة مناقلة
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-200 flex items-center gap-3 bg-slate-50 flex-wrap">
          <h3 className="font-bold text-slate-900">سجل المناقلات</h3>
          <span className="text-xs text-slate-500">({total})</span>
          <select
            value={listFromWarehouseId}
            onChange={(e) => setListFromWarehouseId(e.target.value)}
            className="text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg min-w-[140px]"
          >
            <option value="">من: كل المستودعات</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {warehouseOptionLabel(w)}
              </option>
            ))}
          </select>
          <select
            value={listToWarehouseId}
            onChange={(e) => setListToWarehouseId(e.target.value)}
            className="text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg min-w-[140px]"
          >
            <option value="">إلى: كل المستودعات</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {warehouseOptionLabel(w)}
              </option>
            ))}
          </select>
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
                    <td className="px-4 py-4 text-slate-600">{(tr.line_count ?? 0).toLocaleString()} طاقة</td>
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
  );
};
