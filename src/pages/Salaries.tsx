import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Briefcase,
  BanknoteArrowDown,
  Download,
  FileSpreadsheet,
  Filter,
  History,
  Loader2,
  Plus,
  Printer,
  ReceiptText,
  Search,
  UserCheck,
  Wallet,
} from 'lucide-react';
import {
  createPayrollEmployee,
  createEmployeeAdvance,
  listPayrollEmployees,
  listPayrollRuns,
  markPayrollRunPaid,
  payEmployeeSalary,
  type PayrollEmployeeDto,
  type PayrollRunDto,
} from '../lib/api/payrollApi';
import { listCashboxes, type CashboxDto } from '../lib/api/cashboxesApi';
import { ApiRequestError } from '../lib/api/client';
import type { ExchangeRateDto } from '../lib/api/exchangeRatesApi';
import { listExchangeRates } from '../lib/api/exchangeRatesApi';
import { ExchangeRatePopupButton } from '../components/treasury/ExchangeRatePopupButton';
import { convertToUsd, formatUsd, normalizeExchangeRate, round2 } from '../lib/currency';

type EmployeeForm = {
  employeeCode: string;
  fullName: string;
  address: string;
  phone: string;
  baseSalary: string;
  currencyCode: 'SYP' | 'TRY' | 'USD';
  salaryPeriod: 'weekly' | 'monthly';
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function genEmployeeCode(): string {
  return `EMP-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function money(value: string | number, currency = 'USD'): string {
  return `${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

const emptyForm = (): EmployeeForm => ({
  employeeCode: genEmployeeCode(),
  fullName: '',
  address: '',
  phone: '',
  baseSalary: '',
  currencyCode: 'SYP',
  salaryPeriod: 'monthly',
});

export const Salaries = () => {
  const { t } = useTranslation('salaries');
  const salaryPeriodLabel = (value: PayrollEmployeeDto['salary_period']): string =>
    value === 'weekly' ? t('salaryPeriod.weekly') : t('salaryPeriod.monthly');
  const statusLabel = (isActive: boolean): string => (isActive ? t('status.active') : t('status.suspended'));
  const [employees, setEmployees] = useState<PayrollEmployeeDto[]>([]);
  const [runs, setRuns] = useState<PayrollRunDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<EmployeeForm>(() => emptyForm());
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const [payRun, setPayRun] = useState<PayrollRunDto | null>(null);
  const [payEmployee, setPayEmployee] = useState<PayrollEmployeeDto | null>(null);
  const [advanceEmployee, setAdvanceEmployee] = useState<PayrollEmployeeDto | null>(null);
  const [payCashboxes, setPayCashboxes] = useState<CashboxDto[]>([]);
  const [payCashboxId, setPayCashboxId] = useState('');
  const [payDate, setPayDate] = useState(todayIso());
  const [payAmount, setPayAmount] = useState('');
  const [payModalLoading, setPayModalLoading] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateDto[]>([]);
  const [payExchangeRateToUsd, setPayExchangeRateToUsd] = useState('1');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, r] = await Promise.all([listPayrollEmployees({}), listPayrollRuns()]);
      setEmployees(e.data);
      setRuns(r.data);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void listExchangeRates()
      .then((res) => setExchangeRates(res.data))
      .catch(() => setExchangeRates([]));
  }, []);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((emp) => {
      return (
        emp.employee_code.toLowerCase().includes(q) ||
        emp.full_name.toLowerCase().includes(q) ||
        (emp.phone || '').toLowerCase().includes(q) ||
        (emp.address || '').toLowerCase().includes(q)
      );
    });
  }, [employees, search]);

  const totalsByCurrency = useMemo(() => {
    return employees.reduce<Record<string, number>>((acc, emp) => {
      acc[emp.currency_code] = (acc[emp.currency_code] || 0) + Number(emp.base_salary || 0);
      return acc;
    }, {});
  }, [employees]);

  const patchForm = (patch: Partial<EmployeeForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const resetForm = () => {
    setForm(emptyForm());
    setError(null);
  };

  const openNewEmployee = () => {
    resetForm();
    setModalOpen(true);
  };

  const submitEmployee = async (afterSave: 'close' | 'pay') => {
    if (!form.fullName.trim()) {
      setError(t('errors.nameRequired'));
      return;
    }
    if (!form.phone.trim()) {
      setError(t('errors.phoneRequired'));
      return;
    }
    const salary = Number(form.baseSalary);
    if (!Number.isFinite(salary) || salary <= 0) {
      setError(t('errors.salaryInvalid'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createPayrollEmployee({
        employeeCode: form.employeeCode.trim() || genEmployeeCode(),
        fullName: form.fullName.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim(),
        baseSalary: salary,
        currencyCode: form.currencyCode,
        salaryPeriod: form.salaryPeriod,
      });
      setEmployees((rows) => [created.data, ...rows]);
      setModalOpen(false);
      resetForm();
      if (afterSave === 'pay') {
        await openEmployeePayModal(created.data);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const loadPayModalData = async (paymentCurrency: string) => {
    const [cashRes, rateRes] = await Promise.all([listCashboxes({ active: true }), listExchangeRates()]);
    const boxes = cashRes.data ?? [];
    const rates = rateRes.data ?? [];
    setPayCashboxes(boxes);
    setExchangeRates(rates);
    const preferred =
      boxes.find((b) => b.is_default) ||
      boxes.find((b) => b.code === `EMP-${paymentCurrency}` || b.code.startsWith('EMP-')) ||
      boxes[0];
    setPayCashboxId(preferred?.id ?? '');
    const code = String(paymentCurrency || 'USD').trim().toUpperCase();
    const rateRow = rates.find((r) => r.currency_code === code);
    setPayExchangeRateToUsd(code === 'USD' ? '1' : String(rateRow?.exchange_rate_to_usd ?? '15000'));
  };

  const openEmployeePayModal = async (employee: PayrollEmployeeDto) => {
    setPayRun(null);
    setPayEmployee(employee);
    setAdvanceEmployee(null);
    setPayErr(null);
    setPayDate(todayIso());
    setPayAmount(String(Number(employee.base_salary || 0)));
    setPayModalLoading(true);
    try {
      await loadPayModalData(employee.currency_code);
    } catch (e) {
      setPayCashboxes([]);
      setPayErr(e instanceof ApiRequestError ? e.message : t('errors.cashboxesLoadFailed'));
    } finally {
      setPayModalLoading(false);
    }
  };

  const openRunPayModal = useCallback(async (run: PayrollRunDto) => {
    setAdvanceEmployee(null);
    setPayEmployee(null);
    setPayRun(run);
    setPayErr(null);
    setPayDate(todayIso());
    setPayAmount(String(Number(run.total_net || 0)));
    setPayModalLoading(true);
    try {
      await loadPayModalData(run.currency_code);
    } catch (e) {
      setPayCashboxes([]);
      setPayErr(e instanceof ApiRequestError ? e.message : t('errors.cashboxesLoadFailed'));
    } finally {
      setPayModalLoading(false);
    }
  }, [t]);

  const openAdvanceModal = async (employee: PayrollEmployeeDto) => {
    setPayRun(null);
    setPayEmployee(null);
    setAdvanceEmployee(employee);
    setPayErr(null);
    setPayDate(todayIso());
    setPayAmount('');
    setPayModalLoading(true);
    try {
      await loadPayModalData(employee.currency_code);
    } catch (e) {
      setPayCashboxes([]);
      setPayErr(e instanceof ApiRequestError ? e.message : t('errors.employeeCashboxesLoadFailed'));
    } finally {
      setPayModalLoading(false);
    }
  };

  const closePayModal = () => {
    setPayRun(null);
    setPayEmployee(null);
    setAdvanceEmployee(null);
    setPayErr(null);
    setPayCashboxes([]);
    setPayCashboxId('');
    setPayModalLoading(false);
  };

  const submitCashOut = async () => {
    if (!payRun && !payEmployee && !advanceEmployee) return;
    if (!payCashboxId) {
      setPayErr(t('errors.chooseCashbox'));
      return;
    }
    const payRate =
      payTargetCurrency === 'USD' ? 1 : normalizeExchangeRate(payExchangeRateToUsd);
    if (payTargetCurrency !== 'USD' && !payRate) {
      setPayErr(t('errors.exchangeRateInvalid'));
      return;
    }
    setPayErr(null);
    setPayModalLoading(true);
    try {
      const exchangePayload =
        payTargetCurrency === 'USD' ? undefined : { exchangeRateToUsd: payRate };
      if (advanceEmployee) {
        const amount = Number(payAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
          setPayErr(t('errors.advanceAmountInvalid'));
          return;
        }
        await createEmployeeAdvance(advanceEmployee.id, {
          cashboxId: payCashboxId,
          advanceDate: payDate,
          amount,
          notes: t('notes.advance', { name: advanceEmployee.full_name }),
          ...exchangePayload,
        });
      } else if (payEmployee) {
        await payEmployeeSalary(payEmployee.id, {
          cashboxId: payCashboxId,
          paymentDate: payDate,
          amount: Number(payAmount) || Number(payEmployee.base_salary),
          notes: t('notes.payment', { name: payEmployee.full_name }),
          ...exchangePayload,
        });
      } else if (payRun) {
        await markPayrollRunPaid(payRun.id, {
          cashboxId: payCashboxId,
          paymentDate: payDate,
          ...exchangePayload,
        });
      }
      closePayModal();
      await load();
    } catch (e) {
      setPayErr(e instanceof ApiRequestError ? e.message : t('errors.cashOutFailed'));
    } finally {
      setPayModalLoading(false);
    }
  };

  const exportEmployeesExcel = async () => {
    const XLSX = await import('xlsx');
    const rows = filteredEmployees.map((emp) => ({
      [t('export.employeeCode')]: emp.employee_code,
      [t('export.fullName')]: emp.full_name,
      [t('export.address')]: emp.address || '',
      [t('export.phone')]: emp.phone || '',
      [t('export.salary')]: Number(emp.base_salary || 0),
      [t('export.currency')]: emp.currency_code,
      [t('export.salaryPeriod')]: salaryPeriodLabel(emp.salary_period),
      [t('export.status')]: statusLabel(emp.is_active),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employees');
    XLSX.writeFile(wb, `employees-${todayIso()}.xlsx`);
  };

  const printEmployeesA4 = () => {
    const rows = filteredEmployees
      .map(
        (emp, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${emp.employee_code}</td>
            <td>${emp.full_name}</td>
            <td>${emp.address || '-'}</td>
            <td>${emp.phone || '-'}</td>
            <td>${money(emp.base_salary, emp.currency_code)}</td>
            <td>${salaryPeriodLabel(emp.salary_period)}</td>
            <td>${statusLabel(emp.is_active)}</td>
          </tr>
        `,
      )
      .join('');
    const html = `
      <!doctype html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <title>${t('print.documentTitle')}</title>
        <style>
          @page { size: A4; margin: 12mm; }
          body { font-family: Arial, Tahoma, sans-serif; color: #0f172a; }
          .logo { text-align:center; font-weight:900; font-size:28px; letter-spacing:2px; margin-bottom:4px; }
          .sub { text-align:center; color:#64748b; font-size:11px; letter-spacing:3px; margin-bottom:18px; }
          h1 { text-align:center; font-size:20px; margin:0 0 14px; }
          table { width:100%; border-collapse:collapse; font-size:11px; }
          th, td { border:1px solid #111; padding:6px 5px; text-align:center; }
          th { background:#e2e8f0; font-weight:800; }
          .foot { margin-top:12px; font-size:11px; font-weight:700; }
        </style>
      </head>
      <body>
        <div class="logo">CLOTEX</div>
        <div class="sub">CLOTHES TEXTILE</div>
        <h1>${t('print.heading')}</h1>
        <table>
          <thead>
            <tr>
              <th>${t('print.colIndex')}</th>
              <th>${t('print.colEmployeeCode')}</th>
              <th>${t('print.colFullName')}</th>
              <th>${t('print.colAddress')}</th>
              <th>${t('print.colPhone')}</th>
              <th>${t('print.colSalary')}</th>
              <th>${t('print.colSalaryPeriod')}</th>
              <th>${t('print.colStatus')}</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="8">${t('print.noData')}</td></tr>`}</tbody>
        </table>
        <div class="foot">${t('print.printDate', { date: todayIso() })}</div>
      </body>
      </html>
    `;
    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  const payTargetCurrency = advanceEmployee?.currency_code || payEmployee?.currency_code || payRun?.currency_code || 'USD';
  const payTargetAmount = payEmployee ? Number(payEmployee.base_salary) : Number(payRun?.total_net || 0);
  const payTargetTitle = advanceEmployee ? t('payModal.titleAdvance') : payEmployee ? t('payModal.titleDeliver') : t('payModal.titleRun');
  const payTargetName = advanceEmployee?.full_name || payEmployee?.full_name || payRun?.payroll_no;

  const selectedPayCashbox = payCashboxes.find((b) => b.id === payCashboxId);
  const payAmountNum = Number(payAmount) || payTargetAmount;
  const payRateNum = payTargetCurrency === 'USD' ? 1 : normalizeExchangeRate(payExchangeRateToUsd);
  const payAmountUsd =
    payTargetCurrency === 'USD' ? payAmountNum : payRateNum > 0 ? round2(convertToUsd(payAmountNum, payRateNum)) : 0;
  const cashboxCurrency = selectedPayCashbox?.currency_code || 'USD';
  const cashboxRate =
    cashboxCurrency === 'USD'
      ? 1
      : normalizeExchangeRate(exchangeRates.find((r) => r.currency_code === cashboxCurrency)?.exchange_rate_to_usd);
  const cashboxDeduction =
    !selectedPayCashbox || payAmountNum <= 0
      ? 0
      : cashboxCurrency === payTargetCurrency
        ? payAmountNum
        : cashboxCurrency === 'USD'
          ? payAmountUsd
          : cashboxRate > 0
            ? round2(payAmountUsd * cashboxRate)
            : 0;

  const formSalaryUsd = useMemo(() => {
    const salary = Number(form.baseSalary);
    if (!Number.isFinite(salary) || salary <= 0) return null;
    if (form.currencyCode === 'USD') return salary;
    const rate = normalizeExchangeRate(
      exchangeRates.find((r) => r.currency_code === form.currencyCode)?.exchange_rate_to_usd,
    );
    if (!rate) return null;
    return round2(convertToUsd(salary, rate));
  }, [form.baseSalary, form.currencyCode, exchangeRates]);

  return (
    <div className="max-w-7xl mx-auto space-y-6" dir="rtl">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('pageTitle')}</h2>
          <p className="text-slate-500 mt-1">{t('pageSubtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/salaries/log"
            className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50"
          >
            <History className="w-4 h-4" />
            {t('buttons.payrollLog')}
          </Link>
          <ExchangeRatePopupButton onRatesChange={setExchangeRates} />
          <button type="button" onClick={printEmployeesA4} className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50">
            <Printer className="w-4 h-4" />
            {t('buttons.printA4')}
          </button>
          <button type="button" onClick={() => void exportEmployeesExcel()} className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700">
            <FileSpreadsheet className="w-4 h-4" />
            {t('buttons.exportExcel')}
          </button>
          <button type="button" className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2">
            <Briefcase className="w-4 h-4" />
            {t('buttons.manageEmployees')}
          </button>
          <button type="button" onClick={openNewEmployee} className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition shadow-sm font-medium">
            <Plus className="w-4 h-4" />
            {t('buttons.addEmployee')}
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(Object.entries(totalsByCurrency) as Array<[string, number]>).map(([currency, total]) => (
          <div key={currency} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500 font-bold">{t('totals.totalByCurrency', { currency })}</p>
            <p className="mt-1 text-xl font-black text-slate-900">{money(total, currency)}</p>
          </div>
        ))}
      </div>

      {runs.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
            <ReceiptText className="w-5 h-5 text-indigo-600" />
            {t('runs.title')}
          </h3>
          <ul className="text-sm space-y-2">
            {runs.slice(0, 5).map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-3 last:border-0">
                <div className="space-y-1">
                  <span className="font-mono font-semibold text-slate-800">{run.payroll_no}</span>
                  <div className="text-slate-600 text-xs">
                    {run.period_month}/{run.period_year} - {t('runs.net')} <strong className="text-slate-900">{money(run.total_net, run.currency_code)}</strong>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${run.status === 'PAID' ? 'bg-emerald-100 text-emerald-800' : run.status === 'CONFIRMED' ? 'bg-indigo-100 text-indigo-800' : run.status === 'DRAFT' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>
                    {run.status}
                  </span>
                  {run.status === 'CONFIRMED' && (
                    <button type="button" onClick={() => void openRunPayModal(run)} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">
                      <Wallet className="w-3.5 h-3.5" />
                      {t('runs.payFromCashbox')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between bg-slate-50">
          <div className="relative flex-1 max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search.placeholder')}
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button type="button" className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg opacity-60" disabled>
            <Filter className="w-4 h-4" />
            {t('filter')}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-5 py-4">{t('table.employeeCode')}</th>
                <th className="px-5 py-4">{t('table.fullName')}</th>
                <th className="px-5 py-4">{t('table.address')}</th>
                <th className="px-5 py-4">{t('table.phone')}</th>
                <th className="px-5 py-4">{t('table.salary')}</th>
                <th className="px-5 py-4">{t('table.paidSalaries')}</th>
                <th className="px-5 py-4">{t('table.advances')}</th>
                <th className="px-5 py-4">{t('table.salaryPeriod')}</th>
                <th className="px-5 py-4">{t('table.status')}</th>
                <th className="px-5 py-4">{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin inline ml-2" />
                    {t('table.loading')}
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-slate-500">{t('table.noData')}</td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50 bg-white">
                    <td className="px-5 py-4 font-mono text-slate-500">{emp.employee_code}</td>
                    <td className="px-5 py-4 font-bold text-slate-900">{emp.full_name}</td>
                    <td className="px-5 py-4 text-slate-600">{emp.address || '-'}</td>
                    <td className="px-5 py-4 font-mono">{emp.phone || '-'}</td>
                    <td className="px-5 py-4 font-bold">{money(emp.base_salary, emp.currency_code)}</td>
                    <td className="px-5 py-4">
                      <div className="font-bold text-emerald-700">{money(emp.total_salary_paid || 0, emp.currency_code)}</div>
                      {Number(emp.payment_count || 0) > 0 && (
                        <Link to={`/salaries/log?search=${encodeURIComponent(emp.full_name)}`} className="text-xs text-indigo-600 hover:underline">
                          {t('table.paymentCount', { count: emp.payment_count })}
                        </Link>
                      )}
                    </td>
                    <td className="px-5 py-4 font-bold text-amber-700">{money(emp.total_advances || 0, emp.currency_code)}</td>
                    <td className="px-5 py-4">{salaryPeriodLabel(emp.salary_period)}</td>
                    <td className="px-5 py-4">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${emp.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                        {statusLabel(emp.is_active)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => void openEmployeePayModal(emp)} disabled={!emp.is_active} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
                          <Download className="w-3.5 h-3.5" />
                          {t('table.deliver')}
                        </button>
                        <button type="button" onClick={() => void openAdvanceModal(emp)} disabled={!emp.is_active} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-40">
                          <BanknoteArrowDown className="w-3.5 h-3.5" />
                          {t('table.advance')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && filteredEmployees.length > 0 && (
              <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-200">
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center">{t('table.footerSummary')}</td>
                  <td colSpan={2} className="px-6 py-4 text-slate-700">{t('table.employeeCount', { count: filteredEmployees.length })}</td>
                  <td className="px-6 py-4"><UserCheck className="w-4 h-4 text-slate-300 inline" /></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-l from-indigo-50 to-white">
              <h3 className="font-bold text-xl text-slate-900">{t('modal.addEmployeeTitle')}</h3>
              <p className="text-sm text-slate-500 mt-1">{t('modal.addEmployeeSubtitle')}</p>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={t('modal.fields.employeeCode')}>
                <input value={form.employeeCode} onChange={(e) => patchForm({ employeeCode: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2" />
              </Field>
              <Field label={t('modal.fields.fullName')}>
                <input value={form.fullName} onChange={(e) => patchForm({ fullName: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2" />
              </Field>
              <Field label={t('modal.fields.address')}>
                <input value={form.address} onChange={(e) => patchForm({ address: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2" />
              </Field>
              <Field label={t('modal.fields.phone')}>
                <input value={form.phone} onChange={(e) => patchForm({ phone: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2" dir="ltr" />
              </Field>
              <Field label={t('modal.fields.salary')}>
                <input type="number" min="0" value={form.baseSalary} onChange={(e) => patchForm({ baseSalary: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2" dir="ltr" />
                {formSalaryUsd != null && form.currencyCode !== 'USD' ? (
                  <p className="text-xs text-indigo-700 mt-1 font-semibold">{t('modal.equivalentApprox', { amount: formatUsd(formSalaryUsd) })}</p>
                ) : null}
              </Field>
              <Field label={t('modal.fields.salaryCurrency')}>
                <select value={form.currencyCode} onChange={(e) => patchForm({ currencyCode: e.target.value as EmployeeForm['currencyCode'] })} className="w-full border border-slate-200 rounded-lg px-3 py-2 bg-white">
                  <option value="SYP">{t('modal.currency.syp')}</option>
                  <option value="TRY">{t('modal.currency.try')}</option>
                  <option value="USD">{t('modal.currency.usd')}</option>
                </select>
              </Field>
              <Field label={t('modal.fields.salaryPeriod')}>
                <select value={form.salaryPeriod} onChange={(e) => patchForm({ salaryPeriod: e.target.value as EmployeeForm['salaryPeriod'] })} className="w-full border border-slate-200 rounded-lg px-3 py-2 bg-white">
                  <option value="monthly">{t('modal.period.monthly')}</option>
                  <option value="weekly">{t('modal.period.weekly')}</option>
                </select>
              </Field>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-200 rounded-lg bg-white">{t('modal.cancel')}</button>
              <button type="button" disabled={saving} onClick={() => void submitEmployee('pay')} className="px-4 py-2 bg-emerald-600 text-white rounded-lg disabled:opacity-50">
                {t('modal.saveThenDeliver')}
              </button>
              <button type="button" disabled={saving} onClick={() => void submitEmployee('close')} className="px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50">
                {saving ? t('modal.saving') : t('modal.saveEmployee')}
              </button>
            </div>
          </div>
        </div>
      )}

      {(payRun || payEmployee || advanceEmployee) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-4 bg-slate-50">
              <h3 className="font-bold text-lg text-slate-900">{payTargetTitle}</h3>
              <p className="text-sm text-slate-600 mt-1">{payTargetName}</p>
            </div>
            <div className="p-5 space-y-4">
              {payErr && <div className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{payErr}</div>}
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
                <p className="text-slate-500 text-xs mb-1">{advanceEmployee ? t('payModal.advanceAmountLabel') : t('payModal.deliveryAmountLabel')}</p>
                <input type="number" value={payAmount || String(payTargetAmount)} onChange={(e) => setPayAmount(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono" dir="ltr" />
                <p className="text-xs text-slate-500 mt-1">
                  {t('payModal.amountInCurrency', { currency: payTargetCurrency })}
                  {payTargetCurrency !== 'USD' && payAmountUsd > 0 ? (
                    <span className="text-indigo-700 font-semibold"> {t('payModal.equivalent', { amount: formatUsd(payAmountUsd) })}</span>
                  ) : null}
                </p>
              </div>
              {payTargetCurrency !== 'USD' ? (
                <Field label={t('payModal.exchangeRateLabel', { currency: payTargetCurrency })}>
                  <input
                    type="number"
                    min={0}
                    step="0.000001"
                    value={payExchangeRateToUsd}
                    onChange={(e) => setPayExchangeRateToUsd(e.target.value)}
                    disabled={payModalLoading}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-sm"
                    dir="ltr"
                  />
                </Field>
              ) : null}
              <Field label={t('payModal.cashboxLabel')}>
                <select value={payCashboxId} onChange={(e) => setPayCashboxId(e.target.value)} disabled={payModalLoading} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 bg-white text-sm">
                  <option value="">{t('payModal.chooseCashboxOption')}</option>
                  {payCashboxes.map((b) => (
                    <option key={b.id} value={b.id}>
                      {t('payModal.cashboxOption', { name: b.name, code: b.code, currency: b.currency_code, balance: Number(b.current_balance).toLocaleString() })}
                    </option>
                  ))}
                </select>
                {payCashboxes.length === 0 ? (
                  <p className="text-xs text-amber-700 mt-1">{t('payModal.noActiveCashboxes')}</p>
                ) : null}
                {selectedPayCashbox && cashboxCurrency !== payTargetCurrency && cashboxDeduction > 0 ? (
                  <p className="text-xs text-amber-800 mt-1 font-semibold">
                    {t('payModal.deductionNote', { amount: cashboxDeduction.toLocaleString(undefined, { maximumFractionDigits: 2 }), currency: cashboxCurrency })}
                  </p>
                ) : null}
              </Field>
              <Field label={t('payModal.dateLabel')}>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} disabled={payModalLoading} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm" />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={closePayModal} disabled={payModalLoading} className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50">{t('payModal.cancel')}</button>
                <button type="button" disabled={payModalLoading || !payCashboxId} onClick={() => void submitCashOut()} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {payModalLoading ? t('payModal.registering') : advanceEmployee ? t('payModal.confirmAdvance') : t('payModal.confirmDelivery')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-bold text-slate-700">{label}</span>
      {children}
    </label>
  );
}
