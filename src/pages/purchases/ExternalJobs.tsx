import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Loader2, Scissors, Search } from 'lucide-react';
import {
  listExternalJobs,
  type ExternalJob, type ExternalJobKind,
} from '../../lib/api/externalJobsApi';
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
  const [kindFilter, setKindFilter] = useState<'' | ExternalJobKind>('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listExternalJobs({
        search: search || undefined,
        documentStatus: statusFilter || undefined,
        jobKind: kindFilter || undefined,
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
  }, [search, statusFilter, kindFilter, page, showToast, t]);

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/purchases/external-jobs/processing/new')}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-emerald-700 transition"
          >
            <Scissors className="w-4 h-4" /> {t('page.newProcessingJob')}
          </button>
        </div>
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
          <select
            value={kindFilter}
            onChange={(e) => { setKindFilter(e.target.value as typeof kindFilter); setPage(1); }}
            className="border border-slate-200 rounded-lg px-3 py-2 bg-white text-sm"
          >
            <option value="">{t('filters.allKinds')}</option>
            <option value="GENERAL">{t('kind.general')}</option>
            <option value="PROCESSING">{t('kind.processing')}</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-4 py-3">{t('table.colJobNo')}</th>
                <th className="px-4 py-3">{t('table.colKind')}</th>
                <th className="px-4 py-3">{t('table.colDate')}</th>
                <th className="px-4 py-3">{t('table.colSupplier')}</th>
                <th className="px-4 py-3">{t('table.colLines')}</th>
                <th className="px-4 py-3">{t('table.colFee')}</th>
                <th className="px-4 py-3">{t('table.colStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-400" /></td></tr>
              ) : jobs.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">{t('table.noJobs')}</td></tr>
              ) : jobs.map((job) => (
                <tr
                  key={job.id}
                  onClick={() => navigate(`/purchases/external-jobs/${job.id}`)}
                  className="hover:bg-slate-50 cursor-pointer bg-white"
                >
                  <td className="px-4 py-3 font-mono font-medium text-indigo-700">{job.job_no}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${job.job_kind === 'PROCESSING' ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-indigo-700'}`}>
                      {job.job_kind === 'PROCESSING' ? t('kind.processing') : t('kind.general')}
                    </span>
                    {job.job_kind === 'PROCESSING' && job.supplier_order_no != null && (
                      <span className="block text-[11px] text-slate-400 mt-0.5 font-mono">#{job.supplier_order_no}</span>
                    )}
                  </td>
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
    </div>
  );
};
