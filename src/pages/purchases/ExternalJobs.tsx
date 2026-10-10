import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Loader2, Plus, Search, X } from 'lucide-react';
import {
  listExternalJobs, createExternalJob, confirmExternalJob, type ExternalJob, type CreateExternalJobPayload,
} from '../../lib/api/externalJobsApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listFabricRolls, type FabricRollDto } from '../../lib/api/fabricRollsApi';
import { SUPPORTED_CURRENCIES } from '../../lib/currency';
import { useToast } from '../../components/NonBlockingToast';
import { ApiRequestError } from '../../lib/api/client';

export const ExternalJobs = () => {
  const { t } = useTranslation('externalJobs');
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [jobs, setJobs] = useState<ExternalJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'DRAFT' | 'CONFIRMED' | 'VOIDED'>('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listExternalJobs({
        search: search || undefined,
        documentStatus: statusFilter || undefined,
        page,
        pageSize,
      });
      setJobs(res.rows);
      setTotal(res.total);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('toast.loadFailed') });
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page, showToast, t]);

  useEffect(() => { void load(); }, [load]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-indigo-600" /> {t('page.title')}
          </h2>
          <p className="text-slate-500 mt-1 text-sm">{t('page.subtitle')}</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-indigo-700 transition"
        >
          <Plus className="w-4 h-4" /> {t('page.newJob')}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-3 items-center bg-slate-50">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder={t('filters.searchPlaceholder')}
              className="w-full pr-9 pl-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(1); }}
            className="border border-slate-200 rounded-lg px-3 py-2 bg-white text-sm"
          >
            <option value="">{t('filters.allStatuses')}</option>
            <option value="DRAFT">{t('status.draft')}</option>
            <option value="CONFIRMED">{t('status.confirmed')}</option>
            <option value="VOIDED">{t('status.voided')}</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-4 py-3">{t('table.colJobNo')}</th>
                <th className="px-4 py-3">{t('table.colDate')}</th>
                <th className="px-4 py-3">{t('table.colSupplier')}</th>
                <th className="px-4 py-3">{t('table.colLines')}</th>
                <th className="px-4 py-3">{t('table.colFee')}</th>
                <th className="px-4 py-3">{t('table.colStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-400" /></td></tr>
              ) : jobs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">{t('table.noJobs')}</td></tr>
              ) : jobs.map((job) => (
                <tr
                  key={job.id}
                  onClick={() => navigate(`/purchases/external-jobs/${job.id}`)}
                  className="hover:bg-slate-50 cursor-pointer bg-white"
                >
                  <td className="px-4 py-3 font-mono font-medium text-indigo-700">{job.job_no}</td>
                  <td className="px-4 py-3 text-slate-600">{job.sent_date}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{job.supplier_name}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {t('table.linesProgress', { received: job.received_count ?? 0, total: job.line_count ?? 0 })}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {job.fee_amount != null
                      ? `${Number(job.fee_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${job.fee_currency_code}${job.fee_posted_at ? ` — ${t('table.feePosted')}` : ''}`
                      : t('table.feeNotSet')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                      job.document_status === 'CONFIRMED' ? 'bg-emerald-100 text-emerald-700'
                        : job.document_status === 'VOIDED' ? 'bg-rose-100 text-rose-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {job.document_status === 'CONFIRMED' ? t('status.confirmed')
                        : job.document_status === 'VOIDED' ? t('status.voided')
                        : t('status.draft')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between text-sm text-slate-600">
            <span>{t('table.totalCount', { count: total })}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">{t('table.prev')}</button>
              <span className="px-3 py-1.5">{page} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">{t('table.next')}</button>
            </div>
          </div>
        )}
      </div>

      {createOpen && (
        <CreateExternalJobModal
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); void load(); navigate(`/purchases/external-jobs/${id}`); }}
        />
      )}
    </div>
  );
};

const CreateExternalJobModal = ({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) => {
  const { t } = useTranslation('externalJobs');
  const { showToast } = useToast();

  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [sentDate, setSentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [feeAmount, setFeeAmount] = useState('');
  const [feeCurrencyCode, setFeeCurrencyCode] = useState('USD');

  const [rollSearch, setRollSearch] = useState('');
  const [rollResults, setRollResults] = useState<FabricRollDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedRolls, setSelectedRolls] = useState<FabricRollDto[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listSuppliers({ status: 'active', pageSize: 500 }).then((r) => setSuppliers(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const q = rollSearch.trim();
    if (!q) { setRollResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      listFabricRolls({ search: q, onlyAvailable: true, pageSize: 25 })
        .then((res) => { if (!cancelled) setRollResults(res.data); })
        .catch(() => { if (!cancelled) setRollResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [rollSearch]);

  const addRoll = (roll: FabricRollDto) => {
    if (selectedRolls.some((r) => r.id === roll.id)) return;
    setSelectedRolls((prev) => [...prev, roll]);
  };
  const removeRoll = (rollId: string) => {
    setSelectedRolls((prev) => prev.filter((r) => r.id !== rollId));
  };

  const handleSubmit = async () => {
    if (!supplierId) { showToast({ type: 'error', message: t('create.chooseSupplier') }); return; }
    if (selectedRolls.length === 0) { showToast({ type: 'error', message: t('create.chooseAtLeastOneRoll') }); return; }
    setSaving(true);
    try {
      const payload: CreateExternalJobPayload = {
        supplierId,
        sentDate,
        notes: notes.trim() || null,
        feeAmount: feeAmount.trim() ? Number(feeAmount) : null,
        feeCurrencyCode: feeAmount.trim() ? feeCurrencyCode : null,
        lines: selectedRolls.map((r) => ({ rollId: r.id })),
      };
      const res = await createExternalJob(payload);
      await confirmExternalJob(res.data.id);
      showToast({ type: 'success', message: t('toast.createdSuccess') });
      onCreated(res.data.id);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('toast.createFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col border border-slate-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <h3 className="text-lg font-bold text-slate-900">{t('create.title')}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto grow">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">{t('create.supplierLabel')}</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">{t('create.chooseSupplierOption')}</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">{t('create.sentDateLabel')}</label>
              <input
                type="date"
                value={sentDate}
                onChange={(e) => setSentDate(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                dir="ltr"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">{t('create.feeAmountLabel')}</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
                placeholder={t('create.feeAmountPlaceholder')}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">{t('create.feeCurrencyLabel')}</label>
              <select
                value={feeCurrencyCode}
                onChange={(e) => setFeeCurrencyCode(e.target.value)}
                disabled={!feeAmount.trim()}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.nameAr} ({c.code})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-bold text-slate-700">{t('create.notesLabel')}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <label className="text-sm font-bold text-slate-700">{t('create.rollsLabel')}</label>
            <div className="relative">
              <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={rollSearch}
                onChange={(e) => setRollSearch(e.target.value)}
                placeholder={t('create.rollSearchPlaceholder')}
                className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {searching && <p className="text-xs text-slate-400">{t('create.searching')}</p>}
            {rollResults.length > 0 && (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-40 overflow-y-auto">
                {rollResults.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => addRoll(r)}
                    className="w-full text-right px-3 py-2 text-sm hover:bg-indigo-50 flex items-center justify-between gap-2"
                  >
                    <span className="font-mono text-xs text-slate-500">{r.barcode}</span>
                    <span className="font-medium text-slate-800">{r.item_name}</span>
                    <span className="text-xs text-slate-500">{r.color_name_ar}</span>
                    <span className="text-xs text-slate-500">{r.length_m} {t('meterAbbr')}</span>
                  </button>
                ))}
              </div>
            )}

            {selectedRolls.length > 0 && (
              <div className="border border-indigo-200 bg-indigo-50/40 rounded-lg divide-y divide-indigo-100">
                {selectedRolls.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="font-mono text-xs text-slate-500">{r.barcode}</span>
                    <span className="font-medium text-slate-800 flex-1">{r.item_name} — {r.color_name_ar}</span>
                    <span className="text-xs text-slate-500">{r.length_m} {t('meterAbbr')}</span>
                    <button onClick={() => removeRoll(r.id)} className="text-rose-500 hover:text-rose-700">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {selectedRolls.length === 0 && (
              <p className="text-xs text-slate-400">{t('create.noRollsSelected')}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm">
            {t('create.cancel')}
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition disabled:opacity-50 text-sm flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('create.submitAndSend')}
          </button>
        </div>
      </div>
    </div>
  );
};
