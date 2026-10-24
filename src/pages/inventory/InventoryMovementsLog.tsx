import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search, ArrowUpRight } from 'lucide-react';
import {
  listInventoryMovementsLog,
  type InventoryMovementLogRow,
  type MovementKind,
} from '../../lib/api/inventoryMovementsLogApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { ApiRequestError } from '../../lib/api/client';
import { useToast } from '../../components/NonBlockingToast';

const KIND_BADGE_COLORS: Record<MovementKind, string> = {
  PURCHASE: 'bg-blue-100 text-blue-700',
  SALE: 'bg-emerald-100 text-emerald-700',
  PROCESSING: 'bg-violet-100 text-violet-700',
  RETURN: 'bg-rose-100 text-rose-700',
  TRANSFER: 'bg-amber-100 text-amber-700',
  WASTE: 'bg-slate-200 text-slate-700',
  MANUAL: 'bg-indigo-100 text-indigo-700',
  OTHER: 'bg-slate-100 text-slate-600',
};

const KIND_OPTIONS: MovementKind[] = ['PURCHASE', 'SALE', 'PROCESSING', 'RETURN', 'TRANSFER', 'WASTE', 'MANUAL', 'OTHER'];

export const InventoryMovementsLog: React.FC = () => {
  const { t } = useTranslation('inventoryMovementsLog');
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [rows, setRows] = useState<InventoryMovementLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);

  const [movementKind, setMovementKind] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    listWarehouses({ status: 'active' }).then(setWarehouses).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listInventoryMovementsLog({
        movementKind: (movementKind as MovementKind) || undefined,
        warehouseId: warehouseId || undefined,
        search: search || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        pageSize,
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('loadFailed') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movementKind, warehouseId, dateFrom, dateTo, page]);

  const runSearch = () => {
    setPage(1);
    void load();
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div>
        <h2 className="text-lg font-black text-slate-900">{t('title')}</h2>
        <p className="text-sm text-slate-500">{t('subtitle')}</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px] space-y-1">
          <label className="text-xs font-bold text-slate-600">{t('filterKind')}</label>
          <select
            value={movementKind}
            onChange={(e) => { setMovementKind(e.target.value); setPage(1); }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">{t('filterKindAll')}</option>
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>{t(`kind.${k}`)}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[180px] space-y-1">
          <label className="text-xs font-bold text-slate-600">{t('filterWarehouse')}</label>
          <select
            value={warehouseId}
            onChange={(e) => { setWarehouseId(e.target.value); setPage(1); }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">{t('filterWarehouseAll')}</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600">{t('filterDateFrom')}</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600">{t('filterDateTo')}</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1 min-w-[220px] space-y-1">
          <label className="text-xs font-bold text-slate-600">{t('filterSearch')}</label>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder={t('filterSearchPlaceholder')}
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={runSearch}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-white hover:bg-indigo-700"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3 text-right font-bold">{t('colNo')}</th>
                <th className="p-3 text-right font-bold">{t('colDate')}</th>
                <th className="p-3 text-right font-bold">{t('colKind')}</th>
                <th className="p-3 text-right font-bold">{t('colBarcode')}</th>
                <th className="p-3 text-right font-bold">{t('colItem')}</th>
                <th className="p-3 text-right font-bold">{t('colQuantity')}</th>
                <th className="p-3 text-right font-bold">{t('colWarehouse')}</th>
                <th className="p-3 text-right font-bold">{t('colReference')}</th>
                <th className="p-3 text-center font-bold w-10"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} className="p-6 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline ml-2" />{t('loading')}</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} className="p-6 text-center text-slate-500">{t('emptyState')}</td></tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => navigate(row.source_link)}
                  className="border-t border-slate-100 hover:bg-indigo-50/60 cursor-pointer"
                >
                  <td className="p-3 font-mono font-bold text-slate-700">#{row.movement_no}</td>
                  <td className="p-3 text-slate-600 text-xs">{new Date(row.movement_at).toLocaleString()}</td>
                  <td className="p-3">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${KIND_BADGE_COLORS[row.movement_kind]}`}>
                      {t(`kind.${row.movement_kind}`)}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-indigo-700" dir="ltr">{row.barcode}</td>
                  <td className="p-3 text-slate-800">
                    {row.item_name}
                    {row.color_name && <span className="text-slate-400"> / {row.color_name}</span>}
                  </td>
                  <td className="p-3 font-mono text-slate-600">
                    {row.length_delta_m != null && `${Number(row.length_delta_m).toFixed(2)} ${t('meterUnit')}`}
                    {row.weight_delta_kg != null && ` ${Number(row.weight_delta_kg).toFixed(2)} ${t('kgUnit')}`}
                  </td>
                  <td className="p-3 text-slate-600 text-xs">
                    {row.from_warehouse_name && <div>{t('fromLabel')}: {row.from_warehouse_name}</div>}
                    {row.to_warehouse_name && <div>{t('toLabel')}: {row.to_warehouse_name}</div>}
                  </td>
                  <td className="p-3 font-mono text-slate-500 text-xs">{row.reference_no || '—'}</td>
                  <td className="p-3 text-center text-indigo-500"><ArrowUpRight className="w-4 h-4 inline" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm text-slate-600">
          <span>{t('totalCount', { count: total })}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40"
            >
              {t('prevPage')}
            </button>
            <span>{page} / {totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40"
            >
              {t('nextPage')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InventoryMovementsLog;
