import React, { useEffect, useMemo, useState } from 'react';
import { Printer, FileText, Search, CreditCard, Loader2 } from 'lucide-react';
import { createVoucher, confirmVoucher, type VoucherRow } from '../lib/api/vouchersApi';
import { listCashboxes, type CashboxDto } from '../lib/api/cashboxesApi';
import { listCustomers, type ApiCustomer } from '../lib/api/customersApi';
import { listSuppliers, type ApiSupplier } from '../lib/api/suppliersApi';
import { ApiRequestError } from '../lib/api/client';
import { sendTelegramVoucherFromRow } from '../lib/telegramVoucher';
import { focusNextFormControl } from '../lib/forms/enterNavigation';
import { listExchangeRates, type ExchangeRateDto } from '../lib/api/exchangeRatesApi';
import { convertToUsd, normalizeExchangeRate, round2, SUPPORTED_CURRENCIES } from '../lib/currency';
import { useToast } from '../components/NonBlockingToast';
import { VoucherPrintModal } from '../components/VoucherPrintModal';
import {
  RECEIPT_PURPOSE_OPTIONS,
  type VoucherPurpose,
} from '../lib/voucherPurpose';

type PartyKind = 'CUSTOMER' | 'SUPPLIER' | 'OTHER';

export const CollectionBonds = () => {
  const { showToast } = useToast();
  const [cashboxes, setCashboxes] = useState<CashboxDto[]>([]);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voucherNo, setVoucherNo] = useState<string | null>(null);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateDto[]>([]);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [currentVoucher, setCurrentVoucher] = useState<VoucherRow | null>(null);

  const [amount, setAmount] = useState('');
  const [voucherDate, setVoucherDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cashboxId, setCashboxId] = useState('');
  const [partyKind, setPartyKind] = useState<PartyKind>('CUSTOMER');
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [purpose, setPurpose] = useState<VoucherPurpose>('INVOICE_PAYMENT');
  const [description, setDescription] = useState('');
  const [currencyCode, setCurrencyCode] = useState<'USD' | 'SYP' | 'TRY' | 'EGP'>('USD');
  const [exchangeRateToUsd, setExchangeRateToUsd] = useState('1');

  const purposeHint = useMemo(
    () => RECEIPT_PURPOSE_OPTIONS.find((o) => o.value === purpose)?.hint ?? '',
    [purpose],
  );

  useEffect(() => {
    void (async () => {
      setLoadingMeta(true);
      try {
        const [c, cust, sup, r] = await Promise.all([
          listCashboxes({ active: true }),
          listCustomers({ pageSize: 500 }),
          listSuppliers({ pageSize: 500 }),
          listExchangeRates(),
        ]);
        setCashboxes(c.data);
        setCustomers(cust.data);
        setSuppliers(sup.data);
        setExchangeRates(r.data);
        if (c.data.length && !cashboxId) setCashboxId(c.data[0].id);
      } catch {
        showToast({ type: 'error', message: 'تعذر تحميل الصناديق أو الأطراف' });
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
        partyName: cust?.name || partyName.trim() || 'دافع',
      };
    }
    if (partyKind === 'SUPPLIER') {
      const sup = suppliers.find((x) => x.id === partyId);
      return {
        partyType: partyId ? ('SUPPLIER' as const) : ('OTHER' as const),
        partyId: partyId || null,
        partyName: sup?.name || partyName.trim() || 'دافع',
      };
    }
    return {
      partyType: 'OTHER' as const,
      partyId: null,
      partyName: partyName.trim() || 'دافع',
    };
  };

  const saveAndConfirm = async () => {
    if (!cashboxId) {
      showToast({ type: 'warning', message: 'الرجاء اختيار صندوقاً' });
      return;
    }
    setSaving(true);
    try {
      const boxCurrency = cashboxes.find((c) => c.id === (cashboxId || ''))?.currency_code;
      if (boxCurrency && String(boxCurrency).trim().toUpperCase() !== String(currencyCode).trim().toUpperCase()) {
        showToast({ type: 'error', message: 'عملة السند يجب أن تطابق عملة الصندوق المحدد' });
        return;
      }
      const party = resolveParty();
      const rate = currencyCode === 'USD' ? 1 : normalizeExchangeRate(exchangeRateToUsd);
      if (!rate) {
        showToast({ type: 'error', message: 'يرجى إدخال سعر صرف صحيح' });
        return;
      }
      const amountOriginal = Number(amount) || 0;
      const amountUsd = round2(convertToUsd(amountOriginal, rate));
      const created = await createVoucher({
        voucherType: 'RECEIPT',
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
      const voucherSnapshot: VoucherRow = {
        ...created.data,
        voucher_type: created.data.voucher_type || 'RECEIPT',
        voucher_date: created.data.voucher_date || voucherDate,
        party_name: created.data.party_name || party.partyName,
        party_type: created.data.party_type || party.partyType,
        amount: created.data.amount || String(amountOriginal),
        currency_code: created.data.currency_code || currencyCode,
        cashbox_name: created.data.cashbox_name || cashboxes.find((cashbox) => cashbox.id === cashboxId)?.name || null,
        purpose: created.data.purpose || purpose,
        description: created.data.description ?? description ?? null,
      };
      setCurrentVoucher(voucherSnapshot);
      setPrintModalOpen(true);
      showToast({ type: 'success', message: `تم تسجيل السند #${created.data.voucher_no} بنجاح في الصندوق` });

      setAmount('');
      setDescription('');
      setPartyId('');
      setPartyName('');
      setPurpose('INVOICE_PAYMENT');

      try {
        await sendTelegramVoucherFromRow(voucherSnapshot);
      } catch (error) {
        console.warn('Telegram receipt voucher failed', error);
      }
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'فشل التسجيل في الصندوق',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">سند قبض</h2>
          <p className="text-slate-500 mt-1">
            قبض من عميل أو مورد — عربون، دفعة، تعويض… يسجَّل في الصندوق والذمم عند التأكيد
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="bg-white border px-4 py-2 rounded-lg opacity-60 cursor-not-allowed" disabled>
            <Search className="w-4 h-4 inline ml-1" />
            بحث عن سند
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-500" />
            بيانات السند:{' '}
            <span className="text-emerald-600 font-mono">{voucherNo || (loadingMeta ? '...' : 'يُولَّد بعد الحفظ')}</span>
          </h3>
          <div className="text-sm text-slate-500">التاريخ: {new Date().toLocaleDateString('ar-SA')}</div>
        </div>

        <div className="p-6 space-y-6" data-enter-scope>
          {loadingMeta ? (
            <div className="flex text-slate-500 items-center">
              <Loader2 className="w-5 h-5 animate-spin ml-2" />
              جاري التحميل...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2 relative">
                  <label className="block text-sm font-medium text-slate-700">المبلغ</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={focusNextFormControl}
                    className="w-full p-2.5 pr-12 bg-slate-50 border border-slate-200 rounded-lg font-bold text-emerald-600 text-lg"
                  />
                  <span className="absolute right-3 top-9 text-slate-400 text-sm">{currencyCode}</span>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-600">العملة</label>
                      <select
                        value={currencyCode}
                        onChange={(e) => setCurrencyCode(e.target.value as any)}
                        onKeyDown={focusNextFormControl}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                      >
                        {SUPPORTED_CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.nameAr} ({c.code})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-600">سعر الصرف مقابل الدولار</label>
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
                  <label className="block text-sm font-medium text-slate-700">التاريخ</label>
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
                <h4 className="text-sm font-bold text-slate-900 border-b pb-2">الصندوق المستلم</h4>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">الصندوق</label>
                  <div className="relative">
                    <CreditCard className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
                    <select
                      value={cashboxId}
                      onChange={(e) => setCashboxId(e.target.value)}
                      onKeyDown={focusNextFormControl}
                      className="w-full p-2.5 pr-10 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      <option value="">— اختر —</option>
                      {cashboxes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-900 border-b pb-2">الدافع وغرض العملية</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">نوع الطرف</label>
                    <select
                      value={partyKind}
                      onChange={(e) => setPartyKind(e.target.value as PartyKind)}
                      onKeyDown={focusNextFormControl}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      <option value="CUSTOMER">عميل</option>
                      <option value="SUPPLIER">مورد</option>
                      <option value="OTHER">أخرى</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">غرض العملية</label>
                    <select
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value as VoucherPurpose)}
                      onKeyDown={focusNextFormControl}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      {RECEIPT_PURPOSE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {purposeHint ? <p className="text-xs text-slate-500">{purposeHint}</p> : null}
                  </div>
                </div>

                {partyKind === 'CUSTOMER' ? (
                  <select
                    value={partyId}
                    onChange={(e) => setPartyId(e.target.value)}
                    onKeyDown={focusNextFormControl}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <option value="">— عميل مسجّل —</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : null}

                {partyKind === 'SUPPLIER' ? (
                  <select
                    value={partyId}
                    onChange={(e) => setPartyId(e.target.value)}
                    onKeyDown={focusNextFormControl}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <option value="">— مورد مسجّل —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                ) : null}

                <input
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  onKeyDown={focusNextFormControl}
                  placeholder={partyKind === 'OTHER' ? 'اسم الدافع' : 'أو اسم يدوي إن لم يُختر من القائمة'}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                />
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={focusNextFormControl}
                  placeholder="البيان (اختياري — يُدمج مع الغرض تلقائياً)"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                />
                {purpose === 'ADVANCE' ? (
                  <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                    العربون يظهر رصيداً دائناً في كشف الطرف ويمكن رده لاحقاً بسند صرف بغرض «رد عربون».
                  </p>
                ) : null}
              </div>

              <div className="flex justify-end pt-4 border-t">
                <button
                  type="button"
                  disabled={saving || !cashboxes.length}
                  onClick={() => void saveAndConfirm()}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700"
                >
                  <Printer className="w-4 h-4" />
                  حفظ وتسجيل في الصندوق
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
