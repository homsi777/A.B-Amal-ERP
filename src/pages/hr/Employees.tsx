import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, Loader2, Pencil, Plus, Search, X } from 'lucide-react';
import {
  createPayrollEmployee,
  updatePayrollEmployee,
  listPayrollEmployees,
  listEmployeeWageHistory,
  type PayrollEmployeeDto,
  type PayrollEmployeeUpsertPayload,
  type EmployeeWageHistoryDto,
} from '../../lib/api/payrollApi';
import { ApiRequestError } from '../../lib/api/client';

type EmployeeFormState = {
  employeeCode: string;
  fullName: string;
  fingerprintCode: string;
  factory: string;
  department: string;
  jobTitle: string;
  category: string;
  phone: string;
  address: string;
  paymentMethod: string;
  hireDate: string;
  terminationDate: string;
  status: 'ACTIVE' | 'TERMINATED' | 'SUSPENDED';
  baseSalary: string;
  currencyCode: string;
  salaryPeriod: 'weekly' | 'monthly';
  notes: string;
  wageChangeNotes: string;
};

function genEmployeeCode(): string {
  return `EMP-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function emptyForm(): EmployeeFormState {
  return {
    employeeCode: genEmployeeCode(),
    fullName: '',
    fingerprintCode: '',
    factory: '',
    department: '',
    jobTitle: '',
    category: '',
    phone: '',
    address: '',
    paymentMethod: '',
    hireDate: '',
    terminationDate: '',
    status: 'ACTIVE',
    baseSalary: '',
    currencyCode: 'USD',
    salaryPeriod: 'monthly',
    notes: '',
    wageChangeNotes: '',
  };
}

function formFromEmployee(emp: PayrollEmployeeDto): EmployeeFormState {
  return {
    employeeCode: emp.employee_code,
    fullName: emp.full_name,
    fingerprintCode: emp.fingerprint_code || '',
    factory: emp.factory || '',
    department: emp.department || '',
    jobTitle: emp.job_title || '',
    category: emp.category || '',
    phone: emp.phone || '',
    address: emp.address || '',
    paymentMethod: emp.payment_method || '',
    hireDate: emp.hire_date ? emp.hire_date.slice(0, 10) : '',
    terminationDate: emp.termination_date ? emp.termination_date.slice(0, 10) : '',
    status: emp.status,
    baseSalary: String(emp.base_salary ?? ''),
    currencyCode: emp.currency_code,
    salaryPeriod: emp.salary_period,
    notes: emp.notes || '',
    wageChangeNotes: '',
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-600">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

export function Employees() {
  const { t } = useTranslation('hrEmployees');
  const [employees, setEmployees] = useState<PayrollEmployeeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EmployeeFormState>(() => emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyEmployee, setHistoryEmployee] = useState<PayrollEmployeeDto | null>(null);
  const [history, setHistory] = useState<EmployeeWageHistoryDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await listPayrollEmployees({ search: search || undefined });
      setEmployees(res.data);
    } catch {
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filtered = useMemo(() => employees, [employees]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
    setModalOpen(true);
  }

  function openEdit(emp: PayrollEmployeeDto) {
    setEditingId(emp.id);
    setForm(formFromEmployee(emp));
    setError(null);
    setModalOpen(true);
  }

  async function openHistory(emp: PayrollEmployeeDto) {
    setHistoryEmployee(emp);
    setHistoryLoading(true);
    try {
      const res = await listEmployeeWageHistory(emp.id);
      setHistory(res.data);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleSave() {
    if (!form.fullName.trim()) {
      setError(t('errors.fullNameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    const payload: PayrollEmployeeUpsertPayload = {
      employeeCode: form.employeeCode.trim() || genEmployeeCode(),
      fullName: form.fullName.trim(),
      fingerprintCode: form.fingerprintCode.trim() || null,
      factory: form.factory.trim() || null,
      department: form.department.trim() || null,
      jobTitle: form.jobTitle.trim() || null,
      category: form.category.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      paymentMethod: form.paymentMethod.trim() || null,
      hireDate: form.hireDate || null,
      terminationDate: form.terminationDate || null,
      status: form.status,
      baseSalary: Number(form.baseSalary) || 0,
      currencyCode: form.currencyCode,
      salaryPeriod: form.salaryPeriod,
      notes: form.notes.trim() || null,
      wageChangeNotes: form.wageChangeNotes.trim() || null,
    };
    try {
      if (editingId) {
        await updatePayrollEmployee(editingId, payload);
      } else {
        await createPayrollEmployee(payload);
      }
      setModalOpen(false);
      void load();
    } catch (err) {
      if (err instanceof ApiRequestError && err.statusCode === 409) {
        setError(t('errors.duplicateCode'));
      } else {
        setError(err instanceof Error ? err.message : t('errors.saveFailed'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('page.title')}</h2>
          <p className="mt-1 text-slate-500">{t('page.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          {t('toolbar.addEmployee')}
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('toolbar.search')}
          className="w-full rounded-lg border border-slate-200 py-2 pe-10 ps-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-500">
              <tr>
                <th className="p-3 text-start">{t('table.employeeCode')}</th>
                <th className="p-3 text-start">{t('table.fullName')}</th>
                <th className="p-3 text-start">{t('table.factory')}</th>
                <th className="p-3 text-start">{t('table.department')}</th>
                <th className="p-3 text-start">{t('table.jobTitle')}</th>
                <th className="p-3 text-start">{t('table.category')}</th>
                <th className="p-3 text-start">{t('table.fingerprintCode')}</th>
                <th className="p-3 text-start">{t('table.baseSalary')}</th>
                <th className="p-3 text-start">{t('table.status')}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => (
                <tr key={emp.id} className="border-t border-slate-100">
                  <td className="p-3 font-mono text-xs">{emp.employee_code}</td>
                  <td className="p-3 font-bold text-slate-800">{emp.full_name}</td>
                  <td className="p-3">{emp.factory || '—'}</td>
                  <td className="p-3">{emp.department || '—'}</td>
                  <td className="p-3">{emp.job_title || '—'}</td>
                  <td className="p-3">{emp.category || '—'}</td>
                  <td className="p-3 font-mono text-xs">{emp.fingerprint_code || '—'}</td>
                  <td className="p-3">{Number(emp.base_salary).toLocaleString()} {emp.currency_code}</td>
                  <td className="p-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        emp.status === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-700'
                          : emp.status === 'SUSPENDED'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {t(`status.${emp.status}`)}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => openEdit(emp)} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50" title={t('actions.edit')}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => void openHistory(emp)} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50" title={t('actions.wageHistory')}>
                        <History className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/55 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-black text-slate-900">{editingId ? t('modal.titleEdit') : t('modal.titleCreate')}</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label={t('modal.fields.employeeCode')}>
                  <input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t('modal.fields.fullName')}>
                  <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t('modal.fields.fingerprintCode')}>
                  <input value={form.fingerprintCode} onChange={(e) => setForm({ ...form, fingerprintCode: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t('modal.fields.factory')}>
                  <input value={form.factory} onChange={(e) => setForm({ ...form, factory: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t('modal.fields.department')}>
                  <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t('modal.fields.jobTitle')}>
                  <input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t('modal.fields.category')}>
                  <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t('modal.fields.phone')}>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t('modal.fields.paymentMethod')}>
                  <input value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t('modal.fields.address')}>
                  <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t('modal.fields.hireDate')}>
                  <input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t('modal.fields.terminationDate')}>
                  <input type="date" value={form.terminationDate} onChange={(e) => setForm({ ...form, terminationDate: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t('modal.fields.status')}>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EmployeeFormState['status'] })} className={`${inputCls} bg-white`}>
                    <option value="ACTIVE">{t('status.ACTIVE')}</option>
                    <option value="SUSPENDED">{t('status.SUSPENDED')}</option>
                    <option value="TERMINATED">{t('status.TERMINATED')}</option>
                  </select>
                </Field>
                <Field label={t('modal.fields.baseSalary')}>
                  <input type="number" min="0" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} className={inputCls} dir="ltr" />
                </Field>
                <Field label={t('modal.fields.currencyCode')}>
                  <select value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value })} className={`${inputCls} bg-white`}>
                    <option value="USD">USD</option>
                    <option value="SYP">SYP</option>
                    <option value="TRY">TRY</option>
                    <option value="EGP">EGP</option>
                  </select>
                </Field>
                <Field label={t('modal.fields.salaryPeriod')}>
                  <select value={form.salaryPeriod} onChange={(e) => setForm({ ...form, salaryPeriod: e.target.value as EmployeeFormState['salaryPeriod'] })} className={`${inputCls} bg-white`}>
                    <option value="monthly">{t('modal.salaryPeriod.monthly')}</option>
                    <option value="weekly">{t('modal.salaryPeriod.weekly')}</option>
                  </select>
                </Field>
                <Field label={t('modal.fields.wageChangeNotes')}>
                  <input value={form.wageChangeNotes} onChange={(e) => setForm({ ...form, wageChangeNotes: e.target.value })} className={inputCls} />
                </Field>
                <div className="md:col-span-3">
                  <Field label={t('modal.fields.notes')}>
                    <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} rows={2} />
                  </Field>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 font-bold text-slate-600 hover:bg-slate-50">
                  {t('modal.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? t('modal.saving') : t('modal.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {historyEmployee && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/55 p-4">
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-black text-slate-900">{t('modal.wageHistoryTitle', { name: historyEmployee.full_name })}</h3>
              <button type="button" onClick={() => setHistoryEmployee(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5">
              {historyLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : history.length === 0 ? (
                <div className="text-sm text-slate-500">{t('modal.wageHistoryEmpty')}</div>
              ) : (
                <ul className="space-y-3">
                  {history.map((h) => (
                    <li key={h.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <div className="flex justify-between font-bold text-slate-800">
                        <span>{t('modal.wageHistoryEffectiveFrom')}: {h.effective_from.slice(0, 10)}</span>
                        <span>{Number(h.base_salary).toLocaleString()}</span>
                      </div>
                      {h.notes && <div className="mt-1 text-xs text-slate-500">{h.notes}</div>}
                      {h.created_by && <div className="mt-1 text-xs text-slate-400">{t('modal.wageHistoryBy')}: {h.created_by}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
