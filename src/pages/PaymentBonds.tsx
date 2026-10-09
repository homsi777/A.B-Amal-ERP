import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, FileText, Search, CreditCard, Loader2 } from 'lucide-react';
import { createVoucher, confirmVoucher, getVoucher, type VoucherRow } from '../lib/api/vouchersApi';
import { listCashboxes, type CashboxDto } from '../lib/api/cashboxesApi';
import { listCustomers, type ApiCustomer } from '../lib/api/customersApi';
import { listSuppliers, type ApiSupplier } from '../lib/api/suppliersApi';
import { ApiRequestError } from '../lib/api/client';
import { sendTelegramVoucherFromRow } from '../lib/telegramVoucher';
import { focusNextFormControl } from '../lib/forms/enterNavigation';
import { listExchangeRates, type ExchangeRateDto } from '../lib/api/exchangeRatesApi';
import { convertToUsd, getCurrencyLabel, normalizeExchangeRate, round2 } from '../lib/currency';
import { useToast } from '../components/NonBlockingToast';
import { VoucherPrintModal } from '../components/VoucherPrintModal';
import {
  getPaymentPurposeOptions,
  type VoucherPurpose,
} from '../lib/voucherPurpose';

type PartyKind = 'CUSTOMER' | 'SUPPLIER' | 'OTHER';

export const PaymentBonds = () => {
  const { t, i18n } = useTranslation('paymentBonds');
  const dateLocale = i18n.language === 'ar' ? 'ar-SA' : 'tr-TR';
  const { showToast } = useToast();
  const [cashboxes, setCashboxes] = useState<CashboxDto[]>([]);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [voucherNo, setVoucherNo] = useState<string | null>(null);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateDto[]>([]);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [currentVoucher, setCurrentVoucher] = useState<VoucherRow | null>(null);

  const [amount, setAmount] = useState('');
  const [voucherDate, setVoucherDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cashboxId, setCashboxId] = useState('');
  const [partyKind, setPartyKind] = useState<PartyKind>('SUPPLIER');
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [purpose, setPurpose] = useState<VoucherPurpose>('INVOICE_PAYMENT');
  const [description, setDescription] = useState('');
  const [currencyCode, setCurrencyCode] = useState<'USD' | 'SYP' | 'TRY' | 'EGP'>('USD');
  const [exchangeRateToUsd, setExchangeRateToUsd] = useState('1');

  const selectedCashbox = useMemo(
    () => cashboxes.find((c) => c.id === cashboxId) ?? null,
    [cashboxes, cashboxId],
  );

  const purposeHint = useMemo(
    () => getPaymentPurposeOptions().find((o) => o.value === purpose)?.hint ?? '',
    [purpose, i18n.language],
  );

  useEffect(() => {
    void (async () => {
      setLoadingMeta(true);
      try {
        const [c, s, cust, r] = await Promise.all([
          listCashboxes({ active: true }),
          listSuppliers({ pageSize: 500 }),
          listCustomers({ pageSize: 500 }),
          listExchangeRates(),
        ]);
        setCashboxes(c.data);
        setSuppliers(s.data);
        setCustomers(cust.data);
        setExchangeRates(r.data);
        if (c.data.length && !cashboxId) setCashboxId(c.data[0].id);
      } catch {
        showToast({ type: 'error', message: t('errors.loadFailed') });
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, []);

  useEffect(() => {
    setPartyId('');
    setPartyName('');
  }, [partyKind]);

  useEffect(() => {
    const box = cashboxes.find((c) => c.id === cashboxId);
    if (!box) return;
    const code = String(box.currency_code || 'USD').trim().toUpperCase() as any;
    if (code === 'USD' || code === 'SYP' || code === 'TRY' || code === 'EGP') {
      setCurrencyCode(code);
      const rateRow = exchangeRates.find((r) => r.currency_code === code);
      setExchangeRateToUsd(code === 'USD' ? '1' : String(rateRow?.exchange_rate_to_usd ?? '1'));
    }
  }, [cashboxId, cashboxes, exchangeRates]);

  useEffect(() => {
    if (currencyCode === 'USD') {
      setExchangeRateToUsd('1');
      return;
    }
    const rateRow = exchangeRates.find((r) => r.currency_code === currencyCode);
    setExchangeRateToUsd(String(rateRow?.exchange_rate_to_usd ?? exchangeRateToUsd));
  }, [currencyCode, exchangeRates]);

  const resolveParty = () => {
    if (partyKind === 'CUSTOMER') {
      const cust = customers.find((x) => x.id === partyId);
      return {
        partyType: partyId ? ('CUSTOMER' as const) : ('OTHER' as const),
        partyId: partyId || null,
        partyName: cust?.name || partyName.trim() || t('defaults.beneficiary'),
      };
    }
    if (partyKind === 'SUPPLIER') {
      const sup = suppliers.find((x) => x.id === partyId);
      return {
        partyType: partyId ? ('SUPPLIER' as const) : ('OTHER' as const),
        partyId: partyId || null,
        partyName: sup?.name || partyName.trim() || t('defaults.beneficiary'),
      };
    }
    return {
      partyType: 'OTHER' as const,
      partyId: null,
      partyName: partyName.trim() || t('defaults.beneficiary'),
    };
  };

  const buildPayload = () => {
    const party = resolveParty();
    const rate = currencyCode === 'USD' ? 1 : normalizeExchangeRate(exchangeRateToUsd);
    const amountOriginal = Number(amount) || 0;
    const amountUsd = round2(convertToUsd(amountOriginal, rate || 1));
    return { party, rate, amountOriginal, amountUsd };
  };

  const saveDraft = async () => {
    setSaving(true);
    setErr(null);
    try {
      const boxCurrency = cashboxes.find((c) => c.id === (cashboxId || ''))?.currency_code;
      if (boxCurrency && String(boxCurrency).trim().toUpperCase() !== String(currencyCode).trim().toUpperCase()) {
        setErr(t('errors.currencyMismatch'));
        return;
      }
      const { party, rate, amountOriginal, amountUsd } = buildPayload();
      if (!rate) {
        setErr(t('errors.invalidRate'));
        return;
      }
      const res = await createVoucher({
        voucherType: 'PAYMENT',
        voucherDate,
        cashboxId: cashboxId || null,
        partyType: party.partyType,
        partyId: party.partyId,
        partyName: party.partyName,
        amount: amountOriginal,
        currencyCode,
        exchangeRateToUsd: rate,
        amountUsd,
        purpose,
        description: description || null,
      });
      setVoucherNo(res.data.voucher_no);
      showToast({ type: 'success', message: t('toasts.draftSaved', { no: res.data.voucher_no }) });
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : t('errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const saveAndConfirm = async () => {
    if (!cashboxId) {
      showToast({ type: 'warning', message: t('errors.selectCashboxToConfirm') });
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const boxCurrency = cashboxes.find((c) => c.id === (cashboxId || ''))?.currency_code;
      if (boxCurrency && String(boxCurrency).trim().toUpperCase() !== String(currencyCode).trim().toUpperCase()) {
        showToast({ type: 'error', message: t('errors.currencyMismatch') });
        return;
      }
      const { party, rate, amountOriginal, amountUsd } = buildPayload();
      if (!rate) {
        showToast({ type: 'error', message: t('errors.invalidRate') });
        return;
      }
      const created = await createVoucher({
        voucherType: 'PAYMENT',
        voucherDate,
        cashboxId,
        partyType: party.partyType,
        partyId: party.partyId,
        partyName: party.partyName,
        amount: amountOriginal,
        currencyCode,
        exchangeRateToUsd: rate,
        amountUsd,
        purpose,
        description: description || null,
      });
      setVoucherNo(created.data.voucher_no);
      await confirmVoucher(created.data.id);
      const saved = await getVoucher(created.data.id);
      const voucherSnapshot: VoucherRow = {
        ...saved.data,
        cashbox_name:
          saved.data.cashbox_name || selectedCashbox?.name || cashboxes.find((cashbox) => cashbox.id === cashboxId)?.name || null,
      };
      setCurrentVoucher(voucherSnapshot);
      setPrintModalOpen(true);
      showToast({ type: 'success', message: t('toasts.registered', { no: created.data.voucher_no }) });

      setAmount('');
      setDescription('');
      setPartyId('');
      setPartyName('');
      setPurpose('INVOICE_PAYMENT');

      try {
        await sendTelegramVoucherFromRow(voucherSnapshot);
      } catch (error) {
        console.warn('Telegram payment voucher failed', error);
      }
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : t('errors.registerFailed'),
      });
      setErr(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('page.title')}</h2>
          <p className="text-slate-500 mt-1">
            {t('page.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 opacity-60 cursor-not-allowed"
            disabled
          >
            <Search className="w-4 h-4" />
            <span>{t('page.searchVoucher')}</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-rose-500" />
            {t('page.voucherDataLabel')}{' '}
            <span className="text-rose-600 font-mono">
              {voucherNo || (loadingMeta ? '...' : t('page.generatedAfterSave'))}
            </span>
          </h3>
          <div className="text-sm text-slate-500">{t('page.dateLabel')} {new Date().toLocaleDateString(dateLocale)}</div>
        </div>

        <div className="p-6 space-y-6" data-enter-scope>
          {err ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-sm">{err}</div>
          ) : null}
          {loadingMeta ? (
            <div className="flex text-slate-500 items-center">
              <Loader2 className="w-5 h-5 animate-spin ml-2" />
              {t('page.loadingCashboxes')}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2 relative">
                  <label className="block text-sm font-medium text-slate-700">{t('fields.amount')}</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={focusNextFormControl}
                    className="w-full p-2.5 pr-12 bg-slate-50 border border-slate-200 rounded-lg font-bold text-rose-600 text-lg"
                  />
                  <span className="absolute right-3 top-9 text-slate-400 text-sm">{currencyCode}</span>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-600">{t('fields.currency')}</label>
                      <input
                        type="text"
                        readOnly
                        value={getCurrencyLabel(currencyCode)}
                        className="w-full p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-slate-700"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-600">{t('fields.exchangeRate')}</label>
                      <input
                        type="number"
                        step="0.000001"
                        value={currencyCode === 'USD' ? '1' : exchangeRateToUsd}
                        disabled={currencyCode === 'USD'}
                        onChange={(e) => setExchangeRateToUsd(e.target.value)}
                        onKeyDown={focusNextFormControl}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-left"
                        dir="ltr"
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">{t('fields.date')}</label>
                  <input
                    type="date"
                    value={voucherDate}
                    onChange={(e) => setVoucherDate(e.target.value)}
                    onKeyDown={focusNextFormControl}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-900 border-b pb-2">{t('sections.paymentMethod')}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">{t('fields.cashbox')}</label>
                    <div className="relative">
                      <CreditCard className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
                      <select
                        value={cashboxId}
                        onChange={(e) => setCashboxId(e.target.value)}
                        onKeyDown={focusNextFormControl}
                        className="w-full p-2.5 pr-10 bg-slate-50 border border-slate-200 rounded-lg"
                      >
                        <option value="">{t('fields.selectCashboxPlaceholder')}</option>
                        {cashboxes.length === 0 && <option value="" disabled>{t('fields.noCashboxes')}</option>}
                        {cashboxes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({String(c.currency_code || 'USD').toUpperCase()})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-900 border-b pb-2">{t('sections.beneficiaryAndPurpose')}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">{t('fields.partyKind')}</label>
                    <select
                      value={partyKind}
                      onChange={(e) => setPartyKind(e.target.value as PartyKind)}
                      onKeyDown={focusNextFormControl}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      <option value="SUPPLIER">{t('partyKindOptions.supplier')}</option>
                      <option value="CUSTOMER">{t('partyKindOptions.customer')}</option>
                      <option value="OTHER">{t('partyKindOptions.other')}</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">{t('fields.purpose')}</label>
                    <select
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value as VoucherPurpose)}
                      onKeyDown={focusNextFormControl}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      {getPaymentPurposeOptions().map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {purposeHint ? <p className="text-xs text-slate-500">{purposeHint}</p> : null}
                  </div>
                </div>

                {partyKind === 'SUPPLIER' ? (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">{t('fields.registeredSupplier')}</label>
                    <select
                      value={partyId}
                      onChange={(e) => setPartyId(e.target.value)}
                      onKeyDown={focusNextFormControl}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      <option value="">{t('fields.noSelectionPlaceholder')}</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {partyKind === 'CUSTOMER' ? (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">{t('fields.registeredCustomer')}</label>
                    <select
                      value={partyId}
                      onChange={(e) => setPartyId(e.target.value)}
                      onKeyDown={focusNextFormControl}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      <option value="">{t('fields.noSelectionPlaceholder')}</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">
                    {partyKind === 'OTHER' ? t('fields.beneficiaryName') : t('fields.beneficiaryNameWithFallback')}
                  </label>
                  <input
                    value={partyName}
                    onChange={(e) => setPartyName(e.target.value)}
                    onKeyDown={focusNextFormControl}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">{t('fields.description')}</label>
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onKeyDown={focusNextFormControl}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                    placeholder={t('fields.descriptionPlaceholder')}
                  />
                </div>
                {purpose === 'ADVANCE_REFUND' ? (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    {t('hints.advanceRefund')}
                  </p>
                ) : null}
                {partyKind === 'CUSTOMER' && purpose === 'COMPENSATION' ? (
                  <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    {t('hints.compensationCustomer')}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2 justify-end pt-4 border-t border-slate-100">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveDraft()}
                  className="bg-white border border-slate-200 px-4 py-2 rounded-lg"
                >
                  {t('actions.saveDraft')}
                </button>
                <button
                  type="button"
                  disabled={saving || !cashboxes.length}
                  onClick={() => void saveAndConfirm()}
                  className="bg-rose-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-rose-700"
                >
                  <Printer className="w-4 h-4" />
                  {t('actions.saveAndRegister')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <VoucherPrintModal
        isOpen={printModalOpen}
        voucher={currentVoucher}
        onClose={() => setPrintModalOpen(false)}
      />
    </div>
  );
};
