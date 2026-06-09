import React, { useEffect, useState } from 'react';
import { Printer, FileText, Search, CreditCard, Loader2 } from 'lucide-react';
import { createVoucher, confirmVoucher, type VoucherRow } from '../lib/api/vouchersApi';
import { listCashboxes, type CashboxDto } from '../lib/api/cashboxesApi';
import { listSuppliers } from '../lib/api/suppliersApi';
import { ApiRequestError } from '../lib/api/client';
import type { ApiSupplier } from '../lib/api/suppliersApi';
import { sendTelegramVoucher } from '../lib/telegramVoucher';
import { focusNextFormControl } from '../lib/forms/enterNavigation';
import { listExchangeRates, type ExchangeRateDto } from '../lib/api/exchangeRatesApi';
import { convertToUsd, normalizeExchangeRate, round2, SUPPORTED_CURRENCIES } from '../lib/currency';
import { useToast } from '../components/NonBlockingToast';
import { VoucherPrintModal } from '../components/VoucherPrintModal';

export const PaymentBonds = () => {
  const { showToast } = useToast();
  const [cashboxes, setCashboxes] = useState<CashboxDto[]>([]);
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
  const [supplierId, setSupplierId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [description, setDescription] = useState('');
  const [currencyCode, setCurrencyCode] = useState<'USD' | 'SYP' | 'TRY' | 'EGP'>('USD');
  const [exchangeRateToUsd, setExchangeRateToUsd] = useState('1');

  useEffect(() => {
    void (async () => {
      setLoadingMeta(true);
      try {
        const [c, s, r] = await Promise.all([listCashboxes({ active: true }), listSuppliers({ pageSize: 500 }), listExchangeRates()]);
        setCashboxes(c.data);
        setSuppliers(s.data);
        setExchangeRates(r.data);
        if (c.data.length && !cashboxId) setCashboxId(c.data[0].id);
      } catch {
        showToast({ type: 'error', message: 'تعذر تحميل الصناديق أو الموردين' });
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

  const saveDraft = async () => {
    setSaving(true);
    setErr(null);
    try {
      const boxCurrency = cashboxes.find((c) => c.id === (cashboxId || ''))?.currency_code;
      if (boxCurrency && String(boxCurrency).trim().toUpperCase() !== String(currencyCode).trim().toUpperCase()) {
        setErr('عملة السند يجب أن تطابق عملة الصندوق المحدد');
        return;
      }
      const sup = suppliers.find((x) => x.id === supplierId);
      const name = sup?.name || partyName.trim() || 'مستفيد';
      const rate = currencyCode === 'USD' ? 1 : normalizeExchangeRate(exchangeRateToUsd);
      if (!rate) {
        setErr('يرجى إدخال سعر صرف صحيح');
        return;
      }
      const amountOriginal = Number(amount) || 0;
      const amountUsd = round2(convertToUsd(amountOriginal, rate));
      const res = await createVoucher({
        voucherType: 'PAYMENT',
        voucherDate,
        cashboxId: cashboxId || null,
        partyType: supplierId ? 'SUPPLIER' : 'OTHER',
        partyId: supplierId || null,
        partyName: name,
        amount: amountOriginal,
        currencyCode,
        exchangeRateToUsd: rate,
        amountUsd,
        description: description || null,
      });
      setVoucherNo(res.data.voucher_no);
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const saveAndConfirm = async () => {
    if (!cashboxId) {
      showToast({ type: 'warning', message: 'الرجاء اختيار صندوقاً للتأكيد' });
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
      const sup = suppliers.find((x) => x.id === supplierId);
      const name = sup?.name || partyName.trim() || 'مستفيد';
      const rate = currencyCode === 'USD' ? 1 : normalizeExchangeRate(exchangeRateToUsd);
      if (!rate) {
        showToast({ type: 'error', message: 'يرجى إدخال سعر صرف صحيح' });
        return;
      }
      const amountOriginal = Number(amount) || 0;
      const amountUsd = round2(convertToUsd(amountOriginal, rate));
      const created = await createVoucher({
        voucherType: 'PAYMENT',
        voucherDate,
        cashboxId,
        partyType: supplierId ? 'SUPPLIER' : 'OTHER',
        partyId: supplierId || null,
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
        voucher_type: created.data.voucher_type || 'PAYMENT',
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
      setSupplierId('');
      setPartyName('');

      try {
        await sendTelegramVoucher({
          voucherType: 'PAYMENT',
          voucherNo: created.data.voucher_no,
          voucherDate,
          partyType: supplierId ? 'supplier' : 'other',
          partyId: supplierId || null,
          partyName: name,
          amount: amountOriginal,
          currency: currencyCode,
          cashboxName: cashboxes.find((cashbox) => cashbox.id === cashboxId)?.name,
          description: description || null,
        });
      } catch (error) {
        console.warn('Telegram payment voucher failed', error);
      }
    } catch (e) {
      const errorMsg = e instanceof ApiRequestError ? e.message : 'فشل التسجيل في الصندوق';
      showToast({ type: 'error', message: errorMsg });
      setErr(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">سند صرف</h2>
          <p className="text-slate-500 mt-1">إصدار سند صرف — تسجيل فعلي في الصندوق عند التأكيد</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 opacity-60 cursor-not-allowed"
            disabled
          >
            <Search className="w-4 h-4" />
            <span>بحث عن سند</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-rose-500" />
            بيانات السند:{' '}
            <span className="text-rose-600 font-mono">
              {voucherNo || (loadingMeta ? '...' : 'يُولَّد بعد الحفظ')}
            </span>
          </h3>
          <div className="text-sm text-slate-500">التاريخ: {new Date().toLocaleDateString('ar-SA')}</div>
        </div>

        <div className="p-6 space-y-6" data-enter-scope>
          {loadingMeta ? (
            <div className="flex text-slate-500 items-center">
              <Loader2 className="w-5 h-5 animate-spin ml-2" />
              جاري تحميل الصناديق...
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
                    className="w-full p-2.5 pr-12 bg-slate-50 border border-slate-200 rounded-lg font-bold text-rose-600 text-lg"
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
                <h4 className="text-sm font-bold text-slate-900 border-b pb-2">طريقة الدفع والصندوق</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                        <option value="">— اختر الصندوق —</option>
                        {cashboxes.length === 0 && <option value="" disabled>لا توجد صناديق</option>}
                        {cashboxes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-900 border-b pb-2">تفاصيل المستفيد</h4>
                <div className="grid grid-cols-1 gap-6">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">مورد مسجّل أو اسم يدوي</label>
                    <select
                      value={supplierId}
                      onChange={(e) => setSupplierId(e.target.value)}
                      onKeyDown={focusNextFormControl}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      <option value="">— بدون اختيار —</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">اسم المستفيد (إذا لم يُختر مورد)</label>
                    <input
                      value={partyName}
                      onChange={(e) => setPartyName(e.target.value)}
                      onKeyDown={focusNextFormControl}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">البيان</label>
                    <input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      onKeyDown={focusNextFormControl}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                      placeholder="شرح السند"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 justify-end pt-4 border-t border-slate-100">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveDraft()}
                  className="bg-white border border-slate-200 px-4 py-2 rounded-lg"
                >
                  حفظ مسودة
                </button>
                <button
                  type="button"
                  disabled={saving || !cashboxes.length}
                  onClick={() => void saveAndConfirm()}
                  className="bg-rose-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-rose-700"
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
