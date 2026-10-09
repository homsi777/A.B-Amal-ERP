import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import i18n from '../../i18n/config';

const getStatusLabels = (): Record<string, string> => ({
  DRAFT: i18n.t('status.draft', { ns: 'transfers' }),
  CONFIRMED: i18n.t('status.confirmed', { ns: 'transfers' }),
  CANCELLED: i18n.t('status.cancelled', { ns: 'transfers' }),
});

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
  const { t } = useTranslation('transfers');
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
      setErr(e instanceof ApiRequestError ? e.message : t('errors.loadListFailed'));
    } finally {
      setBus((b) => ({ ...b, list: false }));
    }
  }, [search, listFromWarehouseId, listToWarehouseId, t]);

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
    setScanHint(t('scan.addedPrefix', { barcode: roll.barcode }));
    setErr(null);
  }, [t]);

  const removeRoll = (id: string) => {
    setSelectedRolls((prev) => prev.filter((r) => r.id !== id));
  };

  const handleScanCommit = async () => {
    const code = scanInput.trim();
    if (!code) return;
    if (!fromWarehouseId) {
      setErr(t('errors.chooseSourceFirst'));
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
        setErr(t('errors.rollNotFound'));
        return;
      }
      if (selectedIds.has(roll.id)) {
        setScanHint(t('scan.alreadyAdded', { barcode: roll.barcode }));
        setScanInput('');
        scanRef.current?.focus();
        return;
      }
      addRoll(roll);
      setScanInput('');
      scanRef.current?.focus();
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : t('errors.searchFailed'));
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
      setErr(t('errors.chooseSourceAndDestination'));
      return;
    }
    if (fromWarehouseId === toWarehouseId && (fromLocationId || '') === (toLocationId || '')) {
      setErr(t('errors.sourceDestinationSame'));
      return;
    }
    if (selectedRolls.length === 0) {
      setErr(t('errors.addAtLeastOneRoll'));
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
      setErr(e instanceof ApiRequestError ? e.message : t('errors.createFailed'));
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
      setErr(e instanceof ApiRequestError ? e.message : t('errors.confirmFailed'));
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
      setErr(e instanceof ApiRequestError ? e.message : t('errors.cancelFailed'));
    } finally {
      setBus((b) => ({ ...b, act: null }));
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('page.title')}</h2>
          <p className="text-slate-500 mt-1">{t('page.subtitle')}</p>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{err}</div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">{t('form.newTransferTitle')}</h3>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">{t('form.sourceWarehouseLabel')}</label>
              <select
                value={fromWarehouseId}
                onChange={(e) => setFromWarehouseId(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">{t('form.chooseOption')}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {warehouseOptionLabel(w)}
                  </option>
                ))}
              </select>
            </div>

            {fromWarehouseId ? (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">{t('form.sourceLocationLabel')}</label>
                <select
                  value={fromLocationId}
                  onChange={(e) => setFromLocationId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">{t('form.allLocationsOption')}</option>
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
              <label className="block text-sm font-medium text-slate-700">{t('form.destinationWarehouseLabel')}</label>
              <select
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
                disabled={!fromWarehouseId}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                <option value="">{t('form.chooseOption')}</option>
                {destinationWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {warehouseOptionLabel(w)}
                  </option>
                ))}
              </select>
            </div>

            {toWarehouseId ? (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">{t('form.destinationLocationLabel')}</label>
                <select
                  value={toLocationId}
                  onChange={(e) => setToLocationId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">{t('form.noSpecificLocationOption')}</option>
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
              {t('form.sameWarehouseWarning')}
            </p>
          ) : null}

          <div className="border-t border-slate-100 pt-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-base font-bold text-slate-900">{t('form.selectRollsTitle')}</h4>
              {fromWarehouseId && availableTotal != null ? (
                <span className="text-xs text-slate-500">
                  {t('form.availableRollsCount', { count: availableTotal.toLocaleString() })}
                  {selectedRolls.length > 0 ? (
                    <span className="text-indigo-600 font-medium mr-2">
                      {t('form.selectedForTransferCount', { count: selectedRolls.length.toLocaleString() })}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700 flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-indigo-600" />
                  {t('form.scanLabel')}
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
                    placeholder={fromWarehouseId ? t('form.scanPlaceholderReady') : t('form.scanPlaceholderChooseSource')}
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
                    {t('form.addButton')}
                  </button>
                </div>
                {scanHint ? <p className="text-xs text-emerald-700">{scanHint}</p> : null}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700 flex items-center gap-2">
                  <Search className="w-4 h-4 text-slate-500" />
                  {t('form.searchLabel')}
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
                  <input
                    type="text"
                    value={rollSearch}
                    onChange={(e) => setRollSearch(e.target.value)}
                    disabled={!fromWarehouseId}
                    placeholder={fromWarehouseId ? t('form.searchPlaceholderReady') : t('form.searchPlaceholderChooseSource')}
                    className="w-full pr-9 pl-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {fromWarehouseId && rollSearchDebounced.length >= 2 ? (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-600 flex justify-between">
                  <span>{t('form.searchResultsLabel')}</span>
                  <span>
                    {searchLoading ? t('form.searching') : t('form.resultsCount', { count: searchTotal.toLocaleString() })}
                  </span>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t('form.colBarcode')}</th>
                        <th className="px-3 py-2 font-medium">{t('form.colMaterial')}</th>
                        <th className="px-3 py-2 font-medium">{t('form.colColor')}</th>
                        <th className="px-3 py-2 font-medium">{t('form.colMeter')}</th>
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
                            {t('form.noResults')}
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
                {t('form.searchHint')}
              </p>
            ) : null}

            {selectedRolls.length > 0 ? (
              <div className="border border-indigo-100 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-100 text-xs font-medium text-indigo-900">
                  {t('form.selectedRollsCount', { count: selectedRolls.length.toLocaleString() })}
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2">{t('form.colBarcode')}</th>
                        <th className="px-3 py-2">{t('form.colMaterial')}</th>
                        <th className="px-3 py-2">{t('form.colMeter')}</th>
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
                              title={t('form.remove')}
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
              <p className="text-xs text-slate-400">{t('form.noRollsSelected')}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end border-t border-slate-100 pt-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">{t('form.notesLabel')}</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder={t('form.notesPlaceholder')}
              />
            </div>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={bus.create || !fromWarehouseId || !toWarehouseId}
              className="md:min-w-[200px] bg-indigo-600 text-white py-3 px-6 rounded-lg flex items-center justify-center gap-2 hover:bg-indigo-700 transition font-medium disabled:opacity-60"
            >
              {bus.create ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              {t('form.saveDraftButton')}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-200 flex items-center gap-3 bg-slate-50 flex-wrap">
          <h3 className="font-bold text-slate-900">{t('list.title')}</h3>
          <span className="text-xs text-slate-500">({total})</span>
          <select
            value={listFromWarehouseId}
            onChange={(e) => setListFromWarehouseId(e.target.value)}
            className="text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg min-w-[140px]"
          >
            <option value="">{t('list.fromAllWarehouses')}</option>
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
            <option value="">{t('list.toAllWarehouses')}</option>
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
              placeholder={t('list.searchPlaceholder')}
              className="w-full pr-9 pl-4 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => void loadList()}
            className="text-sm px-3 py-2 border border-slate-200 rounded-lg hover:bg-white bg-white"
          >
            {t('list.refresh')}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-4 py-4">{t('list.colTransferNo')}</th>
                <th className="px-4 py-4">{t('list.colFromWarehouse')}</th>
                <th className="px-4 py-4">{t('list.colToWarehouse')}</th>
                <th className="px-4 py-4">{t('list.colItemsTransferred')}</th>
                <th className="px-4 py-4">{t('list.colStatus')}</th>
                <th className="px-4 py-4 w-40">{t('list.colActions')}</th>
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
                    {t('list.noTransfers')}
                  </td>
                </tr>
              ) : (
                rows.map((tr) => (
                  <tr key={tr.id} className="hover:bg-slate-50 transition-colors bg-white">
                    <td className="px-4 py-4 font-medium text-indigo-600">{tr.transfer_no}</td>
                    <td className="px-4 py-4 font-medium text-slate-700">{tr.from_warehouse_name ?? '—'}</td>
                    <td className="px-4 py-4 font-medium text-slate-700">{tr.to_warehouse_name ?? '—'}</td>
                    <td className="px-4 py-4 text-slate-600">{t('list.unitCount', { count: (tr.line_count ?? 0).toLocaleString() })}</td>
                    <td className="px-4 py-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-bold ${STATUS_CLASS[tr.status] ?? 'bg-slate-100'}`}
                      >
                        {getStatusLabels()[tr.status] ?? tr.status}
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
                            {t('list.confirmButton')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCancel(tr.id)}
                            disabled={bus.act === tr.id}
                            className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {t('list.cancelButton')}
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
