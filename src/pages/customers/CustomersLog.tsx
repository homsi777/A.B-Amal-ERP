import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Filter, User, Loader2 } from 'lucide-react';
import { listPartyLogs, type PartyActivityRow } from '../../lib/api/partyLogsApi';
import { ApiRequestError } from '../../lib/api/client';
import i18n from '../../i18n/config';

export const CustomersLog = () => {
  const { t } = useTranslation('partiesLog');
  const [logs, setLogs] = useState<PartyActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listPartyLogs({ partyType: 'CUSTOMER', pageSize: 100 });
      setLogs(res.data);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('customerTitle')}</h2>
          <p className="text-slate-500 mt-1">{t('subtitle')}</p>
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{error}</div>}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between bg-slate-50">
          <div className="relative flex-1 max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              placeholder={t('customerSearchPlaceholder')}
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              disabled
            />
          </div>
          <button
            type="button"
            className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 opacity-60 cursor-not-allowed"
            disabled
          >
            <Filter className="w-4 h-4" />
            <span>{t('filter')}</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-6 py-4">{t('colId')}</th>
                <th className="px-6 py-4">{t('colDateTime')}</th>
                <th className="px-6 py-4">{t('colCustomer')}</th>
                <th className="px-6 py-4">{t('colActivityType')}</th>
                <th className="px-6 py-4">{t('colReference')}</th>
                <th className="px-6 py-4">{t('colAmount')}</th>
                <th className="px-6 py-4">{t('colDescription')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
                    {t('loading')}
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    {t('noCustomerLogs')}
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors bg-white">
                    <td className="px-6 py-4 font-medium text-slate-500 font-mono text-xs">{log.id.slice(0, 8)}…</td>
                    <td className="px-6 py-4 text-slate-600 font-medium">
                      {new Date(log.activity_at).toLocaleDateString(i18n.language === 'ar' ? 'ar-SY' : 'tr-TR')}
                    </td>
                    <td className="px-6 py-4">
                      <span className="flex items-center gap-2 font-bold text-indigo-600">
                        <User className="w-4 h-4 text-indigo-400" />
                        {log.party_name}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-slate-100 rounded text-slate-700 text-xs font-semibold">{log.activity_type}</span>
                    </td>
                    <td className="px-6 py-4 text-slate-600 font-medium">{log.reference_no || '—'}</td>
                    <td className="px-6 py-4 font-bold text-emerald-600">
                      {log.amount != null ? Number(log.amount).toLocaleString() : '—'}{' '}
                      {log.currency_code || ''}
                    </td>
                    <td className="px-6 py-4 text-slate-600 max-w-xs truncate" title={log.description}>
                      {log.description}
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
