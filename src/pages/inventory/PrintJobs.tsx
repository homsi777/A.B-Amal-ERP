import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Printer, RefreshCw, ArrowRight, Tags, CheckCircle2, XCircle, Clock,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { listPrintJobs, type PrintJobDto } from '../../lib/api/labelsApi';

const JOB_STATUS_COLOR: Record<string, string> = {
  CREATED:   'bg-blue-100 text-blue-700 border-blue-200',
  PREVIEWED: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  PRINTED:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  FAILED:    'bg-rose-100 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
};

export const PrintJobs: React.FC = () => {
  const { t, i18n } = useTranslation('printJobs');
  const dateLocale = i18n.language === 'ar' ? 'ar-SA' : 'tr-TR';
  const JOB_STATUS_LABEL: Record<string, string> = {
    CREATED:   t('status.created'),
    PREVIEWED: t('status.previewed'),
    PRINTED:   t('status.printed'),
    FAILED:    t('status.failed'),
    CANCELLED: t('status.cancelled'),
  };
  const SOURCE_LABEL: Record<string, string> = {
    ROLL_SELECTION: t('source.rollSelection'),
    IMPORT_BATCH:   t('source.importBatch'),
    SINGLE_ROLL:    t('source.singleRoll'),
  };
  const StatusBadge = ({ status }: { status: string }) => (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${JOB_STATUS_COLOR[status] ?? ''}`}>
      {JOB_STATUS_LABEL[status] ?? status}
    </span>
  );

  const navigate = useNavigate();
  const [jobs, setJobs] = useState<PrintJobDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const PAGE_SIZE = 20;

  const load = useCallback(async (p: number) => {
    setLoading(true); setError('');
    try {
      const res = await listPrintJobs({ page: p, pageSize: PAGE_SIZE });
      setJobs(res.data);
      setTotal(res.total);
    } catch {
      setError(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(1); }, [load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="max-w-7xl mx-auto space-y-5" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Printer className="w-6 h-6 text-indigo-600" /> {t('pageTitle')}
            </h2>
            <p className="text-slate-500 mt-1 text-sm">{t('jobsCount', { count: total })}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load(page)} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition text-sm">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> {t('refresh')}
          </button>
          <Link to="/inventory/labels" className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700 transition">
            <Tags className="w-4 h-4" /> {t('newPrint')}
          </Link>
        </div>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm font-bold">{error}</div>}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-right py-3 px-4 font-bold text-slate-600">{t('colDate')}</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600">{t('colType')}</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600">{t('colSource')}</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600">{t('colStatus')}</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">{t('colLabelCount')}</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">{t('colPrinted')}</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600">{t('colTemplate')}</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600">{t('colPageSize')}</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">{t('colPrintedAt')}</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600">{t('colNotes')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} className="py-10 text-center text-slate-400"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
              )}
              {!loading && jobs.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-16 text-center">
                    <Printer className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-400 font-bold">{t('noJobsYet')}</p>
                    <Link to="/inventory/labels" className="mt-3 inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700 transition">
                      <Tags className="w-4 h-4" /> {t('startPrinting')}
                    </Link>
                  </td>
                </tr>
              )}
              {!loading && jobs.map(job => (
                <tr key={job.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition">
                  <td className="py-3 px-4 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(job.created_at).toLocaleDateString(dateLocale)}
                  </td>
                  <td className="py-3 px-4 text-slate-700">{job.job_type}</td>
                  <td className="py-3 px-4 text-slate-600 text-xs">
                    {job.source_type ? SOURCE_LABEL[job.source_type] ?? job.source_type : '—'}
                  </td>
                  <td className="py-3 px-4"><StatusBadge status={job.status} /></td>
                  <td className="py-3 px-4 font-mono font-bold text-slate-800 text-center">{job.roll_count}</td>
                  <td className="py-3 px-4 text-center">
                    {job.status === 'PRINTED'
                      ? <span className="text-emerald-700 font-bold flex items-center gap-1 justify-center"><CheckCircle2 className="w-3.5 h-3.5" />{job.printed_count}</span>
                      : job.status === 'FAILED'
                      ? <span className="text-rose-600 flex items-center gap-1 justify-center"><XCircle className="w-3.5 h-3.5" />{t('failed')}</span>
                      : <span className="text-slate-400 flex items-center gap-1 justify-center"><Clock className="w-3.5 h-3.5" />—</span>}
                  </td>
                  <td className="py-3 px-4 text-slate-500 text-xs">{job.template_name ?? '—'}</td>
                  <td className="py-3 px-4 text-slate-500 text-xs">{job.page_size ?? '—'}</td>
                  <td className="py-3 px-4 text-xs text-slate-500 whitespace-nowrap">
                    {job.printed_at ? new Date(job.printed_at).toLocaleDateString(dateLocale) : '—'}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-400">{job.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-200 flex items-center justify-between text-sm text-slate-600">
            <span>{t('totalJobs', { count: total })}</span>
            <div className="flex gap-2">
              <button onClick={() => { setPage(p => p - 1); load(page - 1); }} disabled={page <= 1} className="px-3 py-1.5 border rounded-lg hover:bg-slate-50 disabled:opacity-40 transition">{t('previous')}</button>
              <span className="px-3 py-1.5 bg-indigo-50 text-indigo-700 font-bold rounded-lg">{page}/{totalPages}</span>
              <button onClick={() => { setPage(p => p + 1); load(page + 1); }} disabled={page >= totalPages} className="px-3 py-1.5 border rounded-lg hover:bg-slate-50 disabled:opacity-40 transition">{t('next')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
