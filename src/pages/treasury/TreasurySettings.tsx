import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Loader2 } from 'lucide-react';
import { listCashboxes } from '../../lib/api/cashboxesApi';
import { ApiRequestError } from '../../lib/api/client';

/** إعدادات الخزينة: عرض الصناديق الحقيقية — السياسات المحاسبية المتقدمة تُدار لاحقاً من الخادم. */
export const TreasurySettings = () => {
  const { t } = useTranslation('treasurySettings');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<{ code: string; name: string; currency_code: string; is_active: boolean }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listCashboxes();
      setRows(res.data.map((c) => ({ code: c.code, name: c.name, currency_code: c.currency_code, is_active: c.is_active })));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">{t('pageTitle')}</h2>
        <p className="text-slate-500 mt-1">{t('pageSubtitle')}</p>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{error}</div>}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 space-y-6">
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-900 border-b pb-2">{t('currentSafesTitle')}</h3>
            {loading ? (
              <div className="flex items-center text-slate-500 py-8">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                {t('loading')}
              </div>
            ) : rows.length === 0 ? (
              <p className="text-slate-500 text-sm">{t('noSafes')}</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={r.code} className="flex justify-between items-center border border-slate-100 rounded-lg px-4 py-3 bg-slate-50">
                    <span className="font-medium text-slate-900">{r.name}</span>
                    <span className="text-sm text-slate-500 font-mono">
                      {r.code} · {r.currency_code} · {r.is_active ? t('statusActive') : t('statusSuspended')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-4 mt-8 pt-6 border-t border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 border-b pb-2">{t('futurePoliciesTitle')}</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              {t('futurePoliciesDescription')}
            </p>
            <label className="flex items-center gap-2 font-medium text-slate-400 cursor-not-allowed">
              <input type="checkbox" className="rounded w-4 h-4" disabled />
              {t('allowNegativeBalanceLabel')}
            </label>
          </div>
        </div>
        <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            disabled
            className="bg-slate-300 text-white px-6 py-2 rounded-lg font-medium flex items-center gap-2 cursor-not-allowed"
            title={t('saveDisabledTitle')}
          >
            <Save className="w-4 h-4" />
            {t('saveChanges')}
          </button>
        </div>
      </div>
    </div>
  );
};
