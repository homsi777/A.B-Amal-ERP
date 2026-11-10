import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { postCustomerOpeningBalance } from '../../lib/api/customerOpeningBalanceApi';
import i18n from '../../i18n/config';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ns: 'customerLegacyStatement', ...options });

interface Props {
  open: boolean;
  customerId: string;
  initialAmount?: number;
  initialDirection?: 'DEBIT' | 'CREDIT';
  onClose: () => void;
  onPosted: () => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CustomerOpeningBalanceModal({ open, customerId, initialAmount, initialDirection, onClose, onPosted }: Props) {
  const [amount, setAmount] = useState<string>('');
  const [direction, setDirection] = useState<'DEBIT' | 'CREDIT'>('DEBIT');
  const [asOfDate, setAsOfDate] = useState<string>(todayIso());
  const [description, setDescription] = useState<string>('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(initialAmount != null && initialAmount > 0 ? String(initialAmount) : '');
    setDirection(initialDirection ?? 'DEBIT');
    setAsOfDate(todayIso());
    setDescription('');
    setError(null);
    setSuccess(null);
  }, [open, initialAmount, initialDirection]);

  if (!open) return null;

  async function handleConfirm() {
    const amountNum = Number(amount);
    if (!(amountNum > 0)) {
      setError(t('openingBalance.amountLabel'));
      return;
    }
    setPosting(true);
    setError(null);
    try {
      const result = await postCustomerOpeningBalance(customerId, {
        amount: amountNum,
        direction,
        asOfDate,
        description: description.trim() || undefined,
      });
      setSuccess(t('openingBalance.success', { entryNo: result.entryNo }));
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('openingBalance.failed'));
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/55 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">{t('openingBalance.modalTitle')}</h3>
            <p className="mt-1 text-xs text-slate-500">{t('openingBalance.modalSubtitle')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              {success}
            </div>
          )}

          {!success && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-600">{t('openingBalance.amountLabel')}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600">{t('openingBalance.directionLabel')}</label>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDirection('DEBIT')}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold ${
                      direction === 'DEBIT' ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-500'
                    }`}
                  >
                    {t('openingBalance.directionDebit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection('CREDIT')}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold ${
                      direction === 'CREDIT' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'
                    }`}
                  >
                    {t('openingBalance.directionCredit')}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600">{t('openingBalance.dateLabel')}</label>
                <input
                  type="date"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600">{t('openingBalance.descriptionLabel')}</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 font-bold text-slate-600 hover:bg-slate-50">
                  {t('openingBalance.close')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={posting}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {posting ? t('openingBalance.posting') : t('openingBalance.confirm')}
                </button>
              </div>
            </>
          )}

          {success && (
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white hover:bg-indigo-700">
                {t('openingBalance.close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
