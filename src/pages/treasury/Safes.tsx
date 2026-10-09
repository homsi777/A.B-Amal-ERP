import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Wallet, ArrowUpRight, ArrowDownRight, Loader2, ArrowLeftRight } from 'lucide-react';
import { listCashboxes, createCashbox, type CashboxDto } from '../../lib/api/cashboxesApi';
import { ApiRequestError } from '../../lib/api/client';
import {
  confirmCashboxTransfer,
  createCashboxTransfer,
  listCashboxTransfers,
  voidCashboxTransfer,
  type CashboxTransferDto,
} from '../../lib/api/cashboxTransfersApi';
import { useToast } from '../../components/NonBlockingToast';
import { ExchangeRatePopupButton } from '../../components/treasury/ExchangeRatePopupButton';
import { SUPPORTED_CURRENCIES } from '../../lib/currency';

const today = () => new Date().toISOString().slice(0, 10);

export const Safes = () => {
  const { t } = useTranslation('safes');
  const { showToast } = useToast();
  const [safes, setSafes] = useState<CashboxDto[]>([]);
  const [transfers, setTransfers] = useState<CashboxTransferDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [opening, setOpening] = useState('0');
  const [currencyCode, setCurrencyCode] = useState<'USD' | 'SYP' | 'TRY' | 'EGP'>('USD');
  const [saving, setSaving] = useState(false);
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferDate, setTransferDate] = useState(today());
  const [fromCashboxId, setFromCashboxId] = useState('');
  const [toCashboxId, setToCashboxId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNotes, setTransferNotes] = useState('');

  const activeSafes = useMemo(() => safes.filter((safe) => safe.is_active), [safes]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cashboxRes, transferRes] = await Promise.all([
        listCashboxes(),
        listCashboxTransfers({ pageSize: 20 }),
      ]);
      setSafes(cashboxRes.data);
      setTransfers(transferRes.data);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!fromCashboxId && activeSafes[0]) setFromCashboxId(activeSafes[0].id);
    if (!toCashboxId && activeSafes[1]) setToCashboxId(activeSafes[1].id);
  }, [activeSafes, fromCashboxId, toCashboxId]);

  const resetTransferForm = () => {
    setTransferDate(today());
    setFromCashboxId(activeSafes[0]?.id || '');
    setToCashboxId(activeSafes.find((safe) => safe.id !== activeSafes[0]?.id)?.id || '');
    setTransferAmount('');
    setTransferNotes('');
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await createCashbox({
        code: code.trim() || `CB-${Date.now()}`,
        name: name.trim() || t('defaultBoxName'),
        openingBalance: Number(opening) || 0,
        currencyCode,
      });
      setModalOpen(false);
      setCode('');
      setName('');
      setOpening('0');
      showToast({ type: 'success', message: t('createSuccess') });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('createError') });
    } finally {
      setSaving(false);
    }
  };

  const saveTransfer = async (confirmImmediately: boolean) => {
    const amount = Number(transferAmount);
    if (!fromCashboxId || !toCashboxId) {
      showToast({ type: 'warning', message: t('transfer.selectBoxesWarning') });
      return;
    }
    if (fromCashboxId === toCashboxId) {
      showToast({ type: 'warning', message: t('transfer.sameBoxWarning') });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast({ type: 'warning', message: t('transfer.amountWarning') });
      return;
    }
    const source = safes.find((safe) => safe.id === fromCashboxId);
    setTransferSaving(true);
    try {
      const created = await createCashboxTransfer({
        transferDate,
        fromCashboxId,
        toCashboxId,
        amount,
        currencyCode: source?.currency_code || 'USD',
        notes: transferNotes,
      });
      if (confirmImmediately) {
        await confirmCashboxTransfer(created.data.id);
        showToast({ type: 'success', message: t('transfer.confirmSuccess') });
      } else {
        showToast({ type: 'success', message: t('transfer.saveSuccess') });
      }
      setTransferOpen(false);
      resetTransferForm();
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('transfer.saveError') });
    } finally {
      setTransferSaving(false);
    }
  };

  const confirmExistingTransfer = async (id: string) => {
    try {
      await confirmCashboxTransfer(id);
      showToast({ type: 'success', message: t('transfer.confirmSuccess') });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('transfer.confirmError') });
    }
  };

  const voidExistingTransfer = async (id: string) => {
    try {
      await voidCashboxTransfer(id);
      showToast({ type: 'success', message: t('transfer.voidSuccess') });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('transfer.voidError') });
    }
  };

  const statusLabel = (status: CashboxTransferDto['status']) => {
    if (status === 'CONFIRMED') return t('status.confirmed');
    if (status === 'VOID') return t('status.void');
    return t('status.draft');
  };

  const statusClass = (status: CashboxTransferDto['status']) => {
    if (status === 'CONFIRMED') return 'bg-emerald-100 text-emerald-800';
    if (status === 'VOID') return 'bg-rose-100 text-rose-700';
    return 'bg-amber-100 text-amber-800';
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('pageTitle')}</h2>
          <p className="text-slate-500 mt-1">{t('pageSubtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExchangeRatePopupButton />
          <button
            type="button"
            onClick={() => {
              resetTransferForm();
              setTransferOpen(true);
            }}
            className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition shadow-sm"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>{t('transferBetweenBoxes')}</span>
          </button>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>{t('addNewBox')}</span>
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{error}</div>}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <h3 className="text-lg font-bold">{t('modal.newBoxTitle')}</h3>
            <div className="space-y-1">
              <label className="text-sm text-slate-700">{t('modal.codeLabel')}</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder={t('modal.codePlaceholder')} />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-slate-700">{t('modal.nameLabel')}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-slate-700">{t('modal.currencyLabel')}</label>
              <select
                value={currencyCode}
                onChange={(e) => setCurrencyCode(e.target.value as typeof currencyCode)}
                className="w-full border rounded-lg px-3 py-2 bg-white"
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.nameAr} ({c.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm text-slate-700">{t('modal.openingBalanceLabel')}</label>
              <input
                type="number"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border rounded-lg">
                {t('cancel')}
              </button>
              <button type="button" disabled={saving} onClick={() => void submit()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg">
                {saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {transferOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">{t('transferModal.title')}</h3>
              <span className="text-xs text-slate-500">{t('transferModal.hint')}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm text-slate-700">{t('transferModal.fromBoxLabel')}</label>
                <select value={fromCashboxId} onChange={(e) => setFromCashboxId(e.target.value)} className="w-full border rounded-lg px-3 py-2">
                  {activeSafes.map((safe) => (
                    <option key={safe.id} value={safe.id}>
                      {safe.name} - {Number(safe.current_balance).toLocaleString()} {safe.currency_code}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-700">{t('transferModal.toBoxLabel')}</label>
                <select value={toCashboxId} onChange={(e) => setToCashboxId(e.target.value)} className="w-full border rounded-lg px-3 py-2">
                  {activeSafes.map((safe) => (
                    <option key={safe.id} value={safe.id}>
                      {safe.name} - {safe.currency_code}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-700">{t('transferModal.dateLabel')}</label>
                <input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-700">{t('transferModal.amountLabel')}</label>
                <input
                  type="number"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm text-slate-700">{t('transferModal.notesLabel')}</label>
              <textarea value={transferNotes} onChange={(e) => setTransferNotes(e.target.value)} className="w-full border rounded-lg px-3 py-2 min-h-20" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setTransferOpen(false)} className="px-4 py-2 border rounded-lg">
                {t('cancel')}
              </button>
              <button type="button" disabled={transferSaving} onClick={() => void saveTransfer(false)} className="px-4 py-2 border border-indigo-200 text-indigo-700 rounded-lg">
                {t('transferModal.saveDraft')}
              </button>
              <button type="button" disabled={transferSaving} onClick={() => void saveTransfer(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg">
                {transferSaving ? t('saving') : t('transferModal.saveAndConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin mr-2" />
          {t('loading')}
        </div>
      ) : safes.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-500">{t('noBoxesYet')}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {safes.map((safe) => (
            <div key={safe.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 transform translate-x-2 -translate-y-2 group-hover:scale-110 transition-transform">
                <Wallet className="w-24 h-24 text-indigo-600" />
              </div>
              <div className="relative z-10">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-slate-900">{safe.name}</h3>
                  <span
                    className={`px-2 py-1 text-xs rounded-full font-medium ${safe.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}
                  >
                    {safe.is_active ? t('active') : t('suspended')}
                  </span>
                </div>
                <div className="mb-6">
                  <span className="block text-slate-500 text-sm mb-1">{t('currentBalance')}</span>
                  <div className="text-3xl font-bold text-indigo-600">
                    {Number(safe.current_balance).toLocaleString()}{' '}
                    <span className="text-sm text-slate-500 font-normal">{safe.currency_code}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 font-mono">{safe.code}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 bg-slate-50 text-slate-400 py-2 rounded-lg text-sm font-medium border border-slate-200 cursor-not-allowed"
                    disabled
                  >
                    <ArrowDownRight className="w-4 h-4 inline ml-1" />
                    {t('deposit')}
                  </button>
                  <button
                    type="button"
                    className="flex-1 bg-slate-50 text-slate-400 py-2 rounded-lg text-sm font-medium border border-slate-200 cursor-not-allowed"
                    disabled
                  >
                    <ArrowUpRight className="w-4 h-4 inline ml-1" />
                    {t('withdraw')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900">{t('transfersTable.title')}</h3>
            <p className="text-sm text-slate-500 mt-1">{t('transfersTable.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetTransferForm();
              setTransferOpen(true);
            }}
            className="text-sm bg-indigo-50 text-indigo-700 px-3 py-2 rounded-lg hover:bg-indigo-100"
          >
            {t('newTransfer')}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t('table.transferNo')}</th>
                <th className="px-4 py-3 font-semibold">{t('table.date')}</th>
                <th className="px-4 py-3 font-semibold">{t('table.from')}</th>
                <th className="px-4 py-3 font-semibold">{t('table.to')}</th>
                <th className="px-4 py-3 font-semibold">{t('table.amount')}</th>
                <th className="px-4 py-3 font-semibold">{t('table.status')}</th>
                <th className="px-4 py-3 font-semibold">{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transfers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    {t('noTransfersYet')}
                  </td>
                </tr>
              ) : (
                transfers.map((transfer) => (
                  <tr key={transfer.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-700">{transfer.transfer_no}</td>
                    <td className="px-4 py-3 text-slate-600">{String(transfer.transfer_date).slice(0, 10)}</td>
                    <td className="px-4 py-3 text-slate-700">{transfer.from_cashbox_name}</td>
                    <td className="px-4 py-3 text-slate-700">{transfer.to_cashbox_name}</td>
                    <td className="px-4 py-3 font-bold text-slate-900">
                      {Number(transfer.amount).toLocaleString()} {transfer.currency_code}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${statusClass(transfer.status)}`}>
                        {statusLabel(transfer.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {transfer.status === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={() => void confirmExistingTransfer(transfer.id)}
                            className="text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded border border-emerald-100"
                          >
                            {t('confirmAction')}
                          </button>
                        )}
                        {transfer.status === 'CONFIRMED' && (
                          <button
                            type="button"
                            onClick={() => void voidExistingTransfer(transfer.id)}
                            className="text-xs bg-rose-50 text-rose-700 px-2 py-1 rounded border border-rose-100"
                          >
                            {t('voidAction')}
                          </button>
                        )}
                        {transfer.status === 'VOID' && <span className="text-xs text-slate-400">{t('noAction')}</span>}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-2 text-slate-400 text-sm">
        <Search className="w-4 h-4" />
        {t('footerNote')}
      </div>
    </div>
  );
};
