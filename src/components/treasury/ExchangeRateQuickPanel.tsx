import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import {
  listExchangeRates,
  updateExchangeRate,
  type ExchangeRateDto,
  type SupportedCurrencyCode,
} from '../../lib/api/exchangeRatesApi';
import { ApiRequestError } from '../../lib/api/client';
import { useToast } from '../NonBlockingToast';

type Draft = Record<string, { rate: string; isActive: boolean }>;

export interface ExchangeRateQuickPanelProps {
  title?: string;
  className?: string;
  embedded?: boolean;
  onRatesChange?: (rates: ExchangeRateDto[]) => void;
}

export function ExchangeRateQuickPanel({
  title = 'أسعار الصرف مقابل الدولار',
  className = '',
  embedded = false,
  onRatesChange,
}: ExchangeRateQuickPanelProps) {
  const { showToast } = useToast();
  const [rates, setRates] = useState<ExchangeRateDto[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listExchangeRates();
      setRates(res.data);
      setDraft(
        Object.fromEntries(
          res.data.map((row) => [
            row.currency_code,
            { rate: String(row.exchange_rate_to_usd), isActive: row.is_active },
          ]),
        ),
      );
      onRatesChange?.(res.data);
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر تحميل أسعار الصرف',
      });
    } finally {
      setLoading(false);
    }
  }, [onRatesChange, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveRow = async (currencyCode: SupportedCurrencyCode) => {
    if (currencyCode === 'USD') return;
    const rowDraft = draft[currencyCode];
    const rate = Number(String(rowDraft?.rate ?? '').replace(/,/g, '').trim());
    if (!Number.isFinite(rate) || rate <= 0) {
      showToast({ type: 'error', message: 'أدخل سعر صرف صحيحاً' });
      return;
    }
    setSaving((prev) => ({ ...prev, [currencyCode]: true }));
    try {
      const res = await updateExchangeRate(currencyCode, {
        exchangeRateToUsd: rate,
        isActive: rowDraft?.isActive ?? true,
      });
      const nextRates = rates.map((r) => (r.currency_code === currencyCode ? res.data : r));
      setRates(nextRates);
      onRatesChange?.(nextRates);
      showToast({ type: 'success', message: `تم تحديث سعر صرف ${currencyCode}` });
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر حفظ سعر الصرف',
      });
    } finally {
      setSaving((prev) => ({ ...prev, [currencyCode]: false }));
    }
  };

  return (
    <div
      className={
        embedded
          ? `overflow-hidden ${className}`
          : `rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden ${className}`
      }
    >
      {!embedded ? (
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">عدد وحدات العملة مقابل 1 دولار — مثال: 15000 ل.س = 1$</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>
      ) : (
        <div className="px-4 py-2 flex justify-end border-b border-slate-100">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-100 text-slate-600 text-xs">
            <tr>
              <th className="px-3 py-2 font-bold">العملة</th>
              <th className="px-3 py-2 font-bold">سعر الصرف</th>
              <th className="px-3 py-2 font-bold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin inline ml-2" />
                  جاري التحميل...
                </td>
              </tr>
            ) : (
              rates.map((row) => {
                const rowDraft = draft[row.currency_code] ?? {
                  rate: String(row.exchange_rate_to_usd),
                  isActive: row.is_active,
                };
                const busy = Boolean(saving[row.currency_code]);
                return (
                  <tr key={row.currency_code}>
                    <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">
                      {row.currency_name_ar} ({row.currency_code})
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step="0.000001"
                        value={row.currency_code === 'USD' ? '1' : rowDraft.rate}
                        disabled={row.currency_code === 'USD'}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [row.currency_code]: { ...rowDraft, rate: e.target.value },
                          }))
                        }
                        className="w-full max-w-[180px] border border-slate-200 rounded-lg px-2 py-1.5 font-mono text-left text-sm"
                        dir="ltr"
                      />
                    </td>
                    <td className="px-3 py-2">
                      {row.currency_code === 'USD' ? (
                        <span className="text-xs text-slate-400">ثابت</span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void saveRow(row.currency_code)}
                          className="text-xs font-bold text-indigo-700 hover:bg-indigo-50 px-2 py-1 rounded-lg disabled:opacity-50"
                        >
                          {busy ? 'جاري الحفظ…' : 'حفظ'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
