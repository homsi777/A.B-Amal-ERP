import React, { useEffect, useState } from 'react';
import { Printer, FileText, Search, CreditCard, Loader2 } from 'lucide-react';
import { createVoucher, confirmVoucher, type VoucherRow } from '../lib/api/vouchersApi';
import { listCashboxes, type CashboxDto } from '../lib/api/cashboxesApi';
import { listCustomers } from '../lib/api/customersApi';
import { ApiRequestError } from '../lib/api/client';
import type { ApiCustomer } from '../lib/api/customersApi';
import { sendTelegramVoucher } from '../lib/telegramVoucher';
import { focusNextFormControl } from '../lib/forms/enterNavigation';
import { listExchangeRates, type ExchangeRateDto } from '../lib/api/exchangeRatesApi';
import { convertToUsd, normalizeExchangeRate, round2, SUPPORTED_CURRENCIES } from '../lib/currency';
import { useToast } from '../components/NonBlockingToast';
import { VoucherPrintModal } from '../components/VoucherPrintModal';

export const CollectionBonds = () => {
  const { showToast } = useToast();
  const [cashboxes, setCashboxes] = useState<CashboxDto[]>([]);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
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
  const [customerId, setCustomerId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [description, setDescription] = useState('');
  const [currencyCode, setCurrencyCode] = useState<'USD' | 'SYP' | 'TRY' | 'EGP'>('USD');
  const [exchangeRateToUsd, setExchangeRateToUsd] = useState('1');

  useEffect(() => {
    void (async () => {
      setLoadingMeta(true);
      try {
        const [c, cust, r] = await Promise.all([listCashboxes({ active: true }), listCustomers({ pageSize: 500 }), listExchangeRates()]);
        setCashboxes(c.data);
        setCustomers(cust.data);
        setExchangeRates(r.data);
        if (c.data.length && !cashboxId) setCashboxId(c.data[0].id);
      } catch {
        showToast({ type: 'error', message: 'تعذر تحميل الصناديق أو العملاء' });
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, []);

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

  const saveAndConfirm = async () => {
    if (!cashboxId) {
      showToast({ type: 'warning', message: 'الرجاء اختيار صندوقاً' });
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const boxCurrency = cashboxes.find((c) => c.id === (cashboxId || ''))?.currency_code;
      if (boxCurrency && String(boxCurrency).trim().toUpperCase() !== String(currencyCode).trim().toUpperCase()) {
        showToast({ type: 'error', message: 'عملة السند يجب أن تطابق عملة الصندوق المحدد' });
        return;
      }
      const cust = customers.find((x) => x.id === customerId);
      const name = cust?.name || partyName.trim() || 'دافع';
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
        partyType: customerId ? 'CUSTOMER' : 'OTHER',
        partyId: customerId || null,
        partyName: name,
        amount: amountOriginal,
        currencyCode,
        exchangeRateToUsd: rate,
        amountUsd,
        description: description || null,
      });
      setVoucherNo(created.data.voucher_no);
      await confirmVoucher(created.data.id);
      setCurrentVoucher({
        ...created.data,
        voucher_type: created.data.voucher_type || 'RECEIPT',
        voucher_date: created.data.voucher_date || voucherDate,
        party_name: created.data.party_name || name,
        amount: created.data.amount || String(amountOriginal),
        currency_code: created.data.currency_code || currencyCode,
        cashbox_name: created.data.cashbox_name || cashboxes.find((cashbox) => cashbox.id === cashboxId)?.name || null,
        description: created.data.description ?? description ?? null,
      });
      setPrintModalOpen(true);
      showToast({ type: 'success', message: `تم تسجيل السند #${created.data.voucher_no} بنجاح في الصندوق` });
      
      // Reset form
      setAmount('');
      setDescription('');
      setCustomerId('');
      setPartyName('');

      try {
        await sendTelegramVoucher({
          voucherType: 'RECEIPT',
          voucherNo: created.data.voucher_no,
          voucherDate,
          partyType: customerId ? 'customer' : 'other',
          partyId: customerId || null,
          partyName: name,
          amount: amountOriginal,
          currency: currencyCode,
          cashboxName: cashboxes.find((cashbox) => cashbox.id === cashboxId)?.name,
          description: description || null,
        });
      } catch (error) {
        console.warn('Telegram receipt voucher failed', error);
      }
    } catch (e) {
      const errorMsg = e instanceof ApiRequestError ? e.message : 'فشل التسجيل في الصندوق';
      showToast({ type: 'error', message: errorMsg });
      setErr(null); // Don't show old error div
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">سند قبض</h2>
          <p className="text-slate-500 mt-1">إصدار سند قبض — تسجيل فعلي في الصندوق عند التأكيد</p>
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
                <h4 className="text-sm font-bold text-slate-900 border-b pb-2">الدافع</h4>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
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
                <input
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  onKeyDown={focusNextFormControl}
                  placeholder="أو اسم دافع يدوي"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                />
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={focusNextFormControl}
                  placeholder="البيان"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                />
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

      {/* Print Modal */}
      <VoucherPrintModal
        isOpen={printModalOpen}
        voucher={currentVoucher}
        onClose={() => setPrintModalOpen(false)}
      />
    </div>
  );
};
