import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search, ArrowUpRight, ArrowRight } from 'lucide-react';
import {
  listInventoryMovementsLog,
  listInventoryMovementDocuments,
  type InventoryMovementLogRow,
  type InventoryMovementDocumentRow,
  type MovementKind,
  type DocKind,
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
  INTAKE: 'bg-cyan-100 text-cyan-700',
  OTHER: 'bg-slate-100 text-slate-600',
};

const KIND_OPTIONS: MovementKind[] = ['PURCHASE', 'SALE', 'PROCESSING', 'RETURN', 'TRANSFER', 'WASTE', 'MANUAL', 'INTAKE', 'OTHER'];

const DOC_KIND_BADGE_COLORS: Record<DocKind, string> = {
  INTAKE_STOCK: 'bg-cyan-100 text-cyan-700',
  INTAKE_PURCHASE: 'bg-blue-100 text-blue-700',
  INTAKE_PROCESSING: 'bg-violet-100 text-violet-700',
  INTAKE_RETURN: 'bg-rose-100 text-rose-700',
  SALE: 'bg-emerald-100 text-emerald-700',
};

const DOC_KIND_OPTIONS: DocKind[] = ['INTAKE_STOCK', 'INTAKE_PURCHASE', 'INTAKE_PROCESSING', 'INTAKE_RETURN', 'SALE'];

type ViewMode = 'documents' | 'detail';

type DocFilter = { referenceType: string; referenceId: string; docNo: string };

export const InventoryMovementsLog: React.FC = () => {
  const { t } = useTranslation('inventoryMovementsLog');
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [viewMode, setViewMode] = useState<ViewMode>('documents');
  const [docFilter, setDocFilter] = useState<DocFilter | null>(null);

  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);

  // فلاتر مشتركة
  const [warehouseId, setWarehouseId] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  // عرض المستندات (الافتراضي)
  const [docKind, setDocKind] = useState('');
  const [docRows, setDocRows] = useState<InventoryMovementDocumentRow[]>([]);
  const [docTotal, setDocTotal] = useState(0);
  const [docLoading, setDocLoading] = useState(true);
  const docPageSize = 30;

  // عرض تفصيلي لكل توب
  const [movementKind, setMovementKind] = useState('');
  const [rows, setRows] = useState<InventoryMovementLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  useEffect(() => {
    listWarehouses({ status: 'active' }).then(setWarehouses).catch(() => {});
  }, []);

  const loadDocuments = async () => {
    setDocLoading(true);
    try {
      const res = await listInventoryMovementDocuments({
        docKind: (docKind as DocKind) || undefined,
        warehouseId: warehouseId || undefined,
        search: search || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        pageSize: docPageSize,
      });
      setDocRows(res.rows);
      setDocTotal(res.total);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('loadFailed') });
    } finally {
      setDocLoading(false);
    }
  };

  const loadDetail = async (filter?: DocFilter | null) => {
    setLoading(true);
    try {
      const res = await listInventoryMovementsLog({
        movementKind: (movementKind as MovementKind) || undefined,
        warehouseId: warehouseId || undefined,
        search: search || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        referenceType: filter?.referenceType,
        referenceId: filter?.referenceId,
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
    if (viewMode === 'documents') {
      void loadDocuments();
    } else {
      void loadDetail(docFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, docKind, movementKind, warehouseId, dateFrom, dateTo, page, docFilter]);

  const runSearch = () => {
    setPage(1);
    if (viewMode === 'documents') void loadDocuments();
    else void loadDetail(docFilter);
  };

  const openDocumentDetail = (doc: InventoryMovementDocumentRow) => {
    setDocFilter({ referenceType: doc.reference_type, referenceId: doc.reference_id, docNo: doc.doc_no });
    setPage(1);
    setViewMode('detail');
  };

  const backToDocuments = () => {
    setDocFilter(null);
    setPage(1);
    setViewMode('documents');
  };

  const docTotalPages = Math.max(1, Math.ceil(docTotal / docPageSize));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">{t('title')}</h2>
          <p className="text-sm text-slate-500">{viewMode === 'documents' ? t('docSubtitle') : t('subtitle')}</p>
        </div>
        {viewMode === 'detail' && docFilter ? (
          <button
            type="button"
            onClick={backToDocuments}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <ArrowRight className="w-4 h-4" />
            {t('backToDocuments')}
          </button>
        ) : (
          <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden text-sm font-bold">
            <button
              type="button"
              onClick={() => { setPage(1); setViewMode('documents'); }}
              className={`px-3 py-2 ${viewMode === 'documents' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {t('viewDocuments')}
            </button>
            <button
              type="button"
              onClick={() => { setDocFilter(null); setPage(1); setViewMode('detail'); }}
              className={`px-3 py-2 ${viewMode === 'detail' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {t('viewDetail')}
            </button>
          </div>
        )}
      </div>

      {viewMode === 'detail' && docFilter && (
        <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-4 py-2 text-sm font-bold text-indigo-800">
          {t('detailForDoc', { docNo: docFilter.docNo || '—' })}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        {viewMode === 'documents' ? (
          <div className="flex-1 min-w-[180px] space-y-1">
            <label className="text-xs font-bold text-slate-600">{t('filterDocKind')}</label>
            <select
              value={docKind}
              onChange={(e) => { setDocKind(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">{t('filterDocKindAll')}</option>
              {DOC_KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>{t(`docKind.${k}`)}</option>
              ))}
            </select>
          </div>
        ) : !docFilter ? (
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
        ) : null}
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

      {viewMode === 'documents' ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-3 text-right font-bold">{t('colDate')}</th>
                  <th className="p-3 text-right font-bold">{t('colDocKind')}</th>
                  <th className="p-3 text-right font-bold">{t('colDocNo')}</th>
                  <th className="p-3 text-right font-bold">{t('colParty')}</th>
                  <th className="p-3 text-right font-bold">{t('colRollCount')}</th>
                  <th className="p-3 text-right font-bold">{t('colTotalLength')}</th>
                  <th className="p-3 text-center font-bold w-10"></th>
                </tr>
              </thead>
              <tbody>
                {docLoading && (
                  <tr><td colSpan={7} className="p-6 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline ml-2" />{t('loading')}</td></tr>
                )}
                {!docLoading && docRows.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-slate-500">{t('emptyState')}</td></tr>
                )}
                {docRows.map((doc) => (
                  <tr
                    key={`${doc.reference_type}:${doc.reference_id}`}
                    onClick={() => openDocumentDetail(doc)}
                    className="border-t border-slate-100 hover:bg-indigo-50/60 cursor-pointer"
                  >
                    <td className="p-3 text-slate-600 text-xs">{new Date(doc.doc_date).toLocaleString()}</td>
                    <td className="p-3">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${DOC_KIND_BADGE_COLORS[doc.doc_kind]}`}>
                        {t(`docKind.${doc.doc_kind}`)}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-700">{doc.doc_no || '—'}</td>
                    <td className="p-3 text-slate-800">{doc.party_name || t('noParty')}</td>
                    <td className="p-3 font-mono text-slate-600">{doc.roll_count}</td>
                    <td className="p-3 font-mono text-slate-600">{Number(doc.total_length_m).toFixed(2)} {t('meterUnit')}</td>
                    <td className="p-3 text-center text-indigo-500"><ArrowUpRight className="w-4 h-4 inline" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm text-slate-600">
            <span>{t('totalDocsCount', { count: docTotal })}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40"
              >
                {t('prevPage')}
              </button>
              <span>{page} / {docTotalPages}</span>
              <button
                type="button"
                disabled={page >= docTotalPages}
                onClick={() => setPage((p) => Math.min(docTotalPages, p + 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40"
              >
                {t('nextPage')}
              </button>
            </div>
          </div>
        </div>
      ) : (
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
      )}
    </div>
  );
};

export default InventoryMovementsLog;
