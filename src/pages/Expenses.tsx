import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Loader2, CreditCard, Ban } from 'lucide-react';
import { format } from 'date-fns';
import { ar, tr } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import {
  cancelOperatingExpense,
  createOperatingExpense,
  listExpenseCategories,
  listOperatingExpenses,
  type ExpenseCategoryDto,
  type OperatingExpenseDto,
} from '../lib/api/expensesApi';
import { listCashboxes, type CashboxDto } from '../lib/api/cashboxesApi';
import { listExchangeRates, type ExchangeRateDto } from '../lib/api/exchangeRatesApi';
import { ApiRequestError } from '../lib/api/client';
import { convertToUsd, getCurrencyName, normalizeExchangeRate, round2, SUPPORTED_CURRENCIES } from '../lib/currency';
import { useToast } from '../components/NonBlockingToast';

export const Expenses = () => {
  const { t, i18n } = useTranslation('expenses');
  const dateLocale = i18n.language === 'ar' ? ar : tr;
  const { showToast } = useToast();
  const [expenses, setExpenses] = useState<OperatingExpenseDto[]>([]);
  const [categories, setCategories] = useState<ExpenseCategoryDto[]>([]);
  const [cashboxes, setCashboxes] = useState<CashboxDto[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [err, setErr] = useState('');

  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState('');
  const [cashboxId, setCashboxId] = useState('');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [currencyCode, setCurrencyCode] = useState<'USD' | 'SYP' | 'TRY' | 'EGP'>('USD');
  const [exchangeRateToUsd, setExchangeRateToUsd] = useState('1');

  const loadExpenses = useCallback(async (search?: string) => {
    const res = await listOperatingExpenses({ search: search?.trim() || undefined, pageSize: 100 });
    setExpenses(res.data);
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [catRes, boxRes, rateRes] = await Promise.all([
          listExpenseCategories(),
          listCashboxes({ active: true }),
          listExchangeRates(),
        ]);
        setCategories(catRes.data);
        setCashboxes(boxRes.data);
        setExchangeRates(rateRes.data);
        if (catRes.data.length) setCategoryId(catRes.data[0].id);
        if (boxRes.data.length) setCashboxId(boxRes.data[0].id);
        await loadExpenses();
      } catch {
        showToast({ type: 'error', message: t('loadError') });
      } finally {
        setLoading(false);
      }
    })();
  }, [loadExpenses, showToast]);

  useEffect(() => {
    const box = cashboxes.find((c) => c.id === cashboxId);
    if (!box) return;
    const code = String(box.currency_code || 'USD').trim().toUpperCase() as typeof currencyCode;
    if (code === 'USD' || code === 'SYP' || code === 'TRY' || code === 'EGP') {
      setCurrencyCode(code);
      const rateRow = exchangeRates.find((r) => r.currency_code === code);
      setExchangeRateToUsd(code === 'USD' ? '1' : String(rateRow?.exchange_rate_to_usd ?? '1'));
    }
  }, [cashboxId, cashboxes, exchangeRates]);

  const handleSearch = () => {
    void loadExpenses(searchTerm).catch(() => {
      showToast({ type: 'error', message: t('searchError') });
    });
  };

  const resetForm = () => {
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setBeneficiaryName('');
    setAmount('');
    setDescription('');
    setNotes('');
    setErr('');
    if (categories.length) setCategoryId(categories[0].id);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryId || !cashboxId) {
      setErr(t('chooseCategoryAndCashbox'));
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const rate = currencyCode === 'USD' ? 1 : normalizeExchangeRate(exchangeRateToUsd);
      if (!rate) {
        setErr(t('invalidExchangeRate'));
        return;
      }
      const amountOriginal = Number(amount) || 0;
      if (amountOriginal <= 0) {
        setErr(t('amountMustBePositive'));
        return;
      }
      const res = await createOperatingExpense({
        expenseDate,
        categoryId,
        cashboxId,
        beneficiaryName: beneficiaryName.trim() || null,
        amount: amountOriginal,
        currencyCode,
        exchangeRateToUsd: rate,
        description: description.trim(),
        notes: notes.trim() || null,
      });
      showToast({
        type: 'success',
        message: res.message ?? t('createSuccess', { expenseNo: res.data.expense_no }),
      });
      setIsModalOpen(false);
      resetForm();
      await loadExpenses(searchTerm);
    } catch (error) {
      setErr(error instanceof ApiRequestError ? error.message : t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (row: OperatingExpenseDto) => {
    const reason = window.prompt(t('cancelPrompt', { expenseNo: row.expense_no }));
    if (!reason?.trim()) return;
    try {
      const res = await cancelOperatingExpense(row.id, reason.trim());
      showToast({ type: 'success', message: res.message ?? t('cancelSuccess') });
      await loadExpenses(searchTerm);
    } catch (error) {
      showToast({
        type: 'error',
        message: error instanceof ApiRequestError ? error.message : t('cancelError'),
      });
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('pageTitle')}</h2>
          <p className="text-slate-500 mt-1">
            {t('pageSubtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { resetForm(); setIsModalOpen(true); }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition"
        >
          <Plus className="w-4 h-4" />
          <span>{t('addExpense')}</span>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              placeholder={t('searchPlaceholder')}
              className="w-full pr-10 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            />
          </div>
          <button
            type="button"
            onClick={handleSearch}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
          >
            {t('search')}
          </button>
        </div>

        {loading ? (
          <div className="p-10 flex items-center justify-center text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin ml-2" />
            {t('loading')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4">{t('colNumber')}</th>
                  <th className="px-6 py-4">{t('colDate')}</th>
                  <th className="px-6 py-4">{t('colCategory')}</th>
                  <th className="px-6 py-4">{t('colCashbox')}</th>
                  <th className="px-6 py-4">{t('colDescription')}</th>
                  <th className="px-6 py-4">{t('colAmount')}</th>
                  <th className="px-6 py-4">{t('colStatus')}</th>
                  <th className="px-6 py-4">{t('colAction')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.map((expense) => (
                  <tr key={expense.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs font-medium text-slate-900">{expense.expense_no}</td>
                    <td className="px-6 py-4 text-slate-500">
                      {format(new Date(expense.expense_date), 'PP', { locale: dateLocale })}
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-slate-100 rounded text-slate-700 text-xs">
                        {expense.category_name ?? '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-700">{expense.cashbox_name ?? '—'}</td>
                    <td className="px-6 py-4 text-slate-700">
                      <div>{expense.description}</div>
                      {expense.beneficiary_name && (
                        <div className="text-xs text-slate-400 mt-0.5">{t('beneficiaryPrefix', { name: expense.beneficiary_name })}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 font-bold text-rose-600 whitespace-nowrap">
                      {Number(expense.amount).toFixed(2)} {expense.currency_code}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-bold px-2 py-1 rounded ${
                        expense.status === 'CONFIRMED'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                      >
                        {expense.status === 'CONFIRMED' ? t('statusConfirmed') : t('statusCancelled')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {expense.status === 'CONFIRMED' && (
                        <button
                          type="button"
                          title={t('cancelExpenseTitle')}
                          onClick={() => void handleCancel(expense)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                        >
                          <Ban className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {expenses.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                      {t('noExpensesYet')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-900">{t('modalTitle')}</h3>
              <button type="button" onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            <form onSubmit={(e) => void handleAdd(e)} className="p-6 space-y-4">
              {err && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{err}</p>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{t('dateLabel')}</label>
                  <input
                    required
                    type="date"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{t('categoryLabel')}</label>
                  <select
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    <option value="">{t('chooseCategoryOption')}</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('cashboxLabel')}</label>
                <div className="relative">
                  <CreditCard className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
                  <select
                    required
                    className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg"
                    value={cashboxId}
                    onChange={(e) => setCashboxId(e.target.value)}
                  >
                    <option value="">{t('chooseCashboxOption')}</option>
                    {cashboxes.map((box) => (
                      <option key={box.id} value={box.id}>
                        {box.name} ({box.currency_code}) — {Number(box.current_balance).toFixed(2)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{t('amountLabel')}</label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-rose-600"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{t('currencyLabel')}</label>
                  <select
                    value={currencyCode}
                    disabled
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-600"
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>{getCurrencyName(c.code)} ({c.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              {currencyCode !== 'USD' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{t('exchangeRateLabel')}</label>
                  <input
                    type="number"
                    step="0.000001"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                    value={exchangeRateToUsd}
                    onChange={(e) => setExchangeRateToUsd(e.target.value)}
                  />
                  {amount && (
                    <p className="text-xs text-slate-500 mt-1">
                      {t('approxUsd', { value: round2(convertToUsd(Number(amount) || 0, normalizeExchangeRate(exchangeRateToUsd) || 1)).toFixed(2) })}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('beneficiaryLabel')}</label>
                <input
                  type="text"
                  placeholder={t('beneficiaryPlaceholder')}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  value={beneficiaryName}
                  onChange={(e) => setBeneficiaryName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('descriptionLabel')}</label>
                <input
                  required
                  type="text"
                  placeholder={t('descriptionPlaceholder')}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('notesLabel')}</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                {t('saveNotice')}
              </p>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('saveAndDeduct')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
