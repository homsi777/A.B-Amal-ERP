import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowDownRight, ArrowUpRight, Loader2, Printer } from 'lucide-react';
import { ApiRequestError } from '../lib/api/client';
import { cancelVoucher, confirmVoucher, getVoucher, type VoucherRow } from '../lib/api/vouchersApi';
import { useToast } from '../components/NonBlockingToast';
import { VoucherPrintModal } from '../components/VoucherPrintModal';
import { TelegramSendButton } from '../components/telegram/TelegramSendButton';
import { sendTelegramVoucherFromRow } from '../lib/telegramVoucher';
import { voucherPurposeAr } from '../lib/voucherPurpose';

function typeLabel(t: ReturnType<typeof useTranslation>['t'], voucherType: string) {
  return voucherType === 'RECEIPT' ? t('type.receipt') : t('type.payment');
}

function partyTypeLabel(t: ReturnType<typeof useTranslation>['t'], partyType: string | null | undefined) {
  if (partyType === 'CUSTOMER') return t('partyType.customer');
  if (partyType === 'SUPPLIER') return t('partyType.supplier');
  if (partyType === 'EMPLOYEE') return t('partyType.employee');
  if (partyType === 'OTHER') return t('partyType.other');
  return partyType || '—';
}

function statusLabel(t: ReturnType<typeof useTranslation>['t'], status: string) {
  if (status === 'DRAFT') return t('status.draft');
  if (status === 'CONFIRMED') return t('status.confirmed');
  if (status === 'CANCELLED') return t('status.cancelled');
  return status;
}

export const BondDetails = () => {
  const { t } = useTranslation('bondDetails');
  const { showToast } = useToast();
  const navigate = useNavigate();
  const params = useParams();
  const id = String(params.id ?? '');

  const [bond, setBond] = useState<VoucherRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [telegramBusy, setTelegramBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getVoucher(id);
      setBond(res.data);
    } catch (e) {
      setBond(null);
      setError(e instanceof ApiRequestError ? e.message : t('error.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const doConfirm = async () => {
    if (!bond) return;
    setBusy(true);
    try {
      await confirmVoucher(bond.id);
      showToast({ type: 'success', message: t('toast.confirmSuccess') });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('toast.confirmError') });
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!bond) return;
    if (
      !window.confirm(
        t('confirmDialog.cancelMessage', { voucherNo: bond.voucher_no }),
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await cancelVoucher(bond.id);
      showToast({ type: 'success', message: t('toast.cancelSuccess') });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('toast.cancelError') });
    } finally {
      setBusy(false);
    }
  };

  const handleSendTelegram = async () => {
    if (!bond) return;
    setTelegramBusy(true);
    try {
      await sendTelegramVoucherFromRow(bond);
      showToast({ type: 'success', message: t('toast.telegramSent') });
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof Error ? e.message : t('toast.telegramError'),
      });
    } finally {
      setTelegramBusy(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('page.title')}</h2>
          <p className="text-slate-500 mt-1">{t('page.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/bonds/records')}
          className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition shadow-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t('page.backToRecords')}</span>
        </button>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin mr-2" />
          {t('loading')}
        </div>
      ) : !bond ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-500">{t('notFound')}</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-11 h-11 rounded-full flex items-center justify-center ${
                  bond.voucher_type === 'RECEIPT' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                }`}
              >
                {bond.voucher_type === 'RECEIPT' ? <ArrowDownRight className="w-6 h-6" /> : <ArrowUpRight className="w-6 h-6" />}
              </div>
              <div>
                <div className="text-sm text-slate-500">{t('header.voucherNoLabel')}</div>
                <div className="text-xl font-bold text-slate-900 font-mono">{bond.voucher_no}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 rounded text-xs font-bold bg-slate-100 text-slate-700">{statusLabel(t, bond.status)}</span>
              <button
                type="button"
                onClick={() => setPrintModalOpen(true)}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50"
              >
                <span className="inline-flex items-center gap-2">
                  <Printer className="w-4 h-4" />
                  {t('header.print')}
                </span>
              </button>
              {bond.status === 'CONFIRMED' ? (
                <TelegramSendButton
                  size="toolbar"
                  label={t('header.sendTelegram')}
                  busy={telegramBusy}
                  onClick={handleSendTelegram}
                />
              ) : null}
              {bond.status === 'DRAFT' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void doConfirm()}
                  className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
                >
                  {t('header.confirm')}
                </button>
              )}
              {bond.status === 'CONFIRMED' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void doCancel()}
                  className="px-3 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-60"
                >
                  {t('header.cancel')}
                </button>
              )}
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500 mb-2">{t('basic.title')}</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{t('basic.type')}</span>
                  <span className="font-semibold text-slate-900">{typeLabel(t, bond.voucher_type)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{t('basic.date')}</span>
                  <span className="font-semibold text-slate-900">{bond.voucher_date}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{t('basic.amount')}</span>
                  <span className="font-semibold text-slate-900 font-mono">
                    {Number(bond.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} {bond.currency_code}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{t('basic.exchangeRate')}</span>
                  <span className="font-semibold text-slate-900 font-mono" dir="ltr">
                    {bond.exchange_rate_to_usd ? Number(bond.exchange_rate_to_usd).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '1'}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{t('basic.amountUsd')}</span>
                  <span className="font-semibold text-slate-900 font-mono">
                    {bond.amount_usd ? Number(bond.amount_usd).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'} USD
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{t('basic.paymentMethod')}</span>
                  <span className="font-semibold text-slate-900">{bond.payment_method}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500 mb-2">{t('party.title')}</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{t('party.party')}</span>
                  <span className="font-semibold text-slate-900">{bond.party_name || '—'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{t('party.partyType')}</span>
                  <span className="font-semibold text-slate-900">{partyTypeLabel(t, bond.party_type)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{t('party.purpose')}</span>
                  <span className="font-semibold text-slate-900">{voucherPurposeAr(bond.purpose)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{t('party.cashbox')}</span>
                  <span className="font-semibold text-slate-900">{bond.cashbox_name || '—'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{t('party.cashboxCode')}</span>
                  <span className="font-semibold text-slate-900">{bond.cashbox_code || '—'}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4 md:col-span-2">
              <div className="text-sm text-slate-500 mb-2">{t('notes.title')}</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{t('notes.description')}</span>
                  <span className="font-semibold text-slate-900">{bond.description || '—'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{t('notes.notes')}</span>
                  <span className="font-semibold text-slate-900">{bond.notes || '—'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">{t('notes.reference')}</span>
                  <span className="font-semibold text-slate-900">
                    {bond.reference_document_type || '—'} {bond.reference_document_no ? `— ${bond.reference_document_no}` : ''}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <VoucherPrintModal
        isOpen={printModalOpen}
        voucher={bond}
        onClose={() => setPrintModalOpen(false)}
      />
    </div>
  );
};

