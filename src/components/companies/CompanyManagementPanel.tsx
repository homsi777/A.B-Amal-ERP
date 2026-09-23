import React, { useEffect, useState } from 'react';
import { Building2, Loader2, Plus, RefreshCw } from 'lucide-react';
import { createCompany, listCompanies, type ApiCompany } from '../../lib/api/companiesApi';
import { ApiRequestError } from '../../lib/api/client';

type CompanyManagementPanelProps = {
  /** يُستدعى بعد أي تحميل/إنشاء ناجح حتى تبقى قوائم الحسابات بالشاشات الأخرى (مثل فورم إنشاء مستخدم) محدّثة. */
  onCompaniesChanged?: (companies: ApiCompany[]) => void;
};

const emptyForm = {
  code: '',
  name: '',
  adminUsername: '',
  adminPassword: '',
  adminFullName: '',
};

export function CompanyManagementPanel({ onCompaniesChanged }: CompanyManagementPanelProps) {
  const [companies, setCompanies] = useState<ApiCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    setLoading(true);
    setMessage('');
    try {
      const rows = await listCompanies();
      setCompanies(rows);
      onCompaniesChanged?.(rows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تحميل الحسابات.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    if (!form.code.trim() || !form.name.trim() || !form.adminUsername.trim() || form.adminPassword.length < 6) {
      setMessage('عبّي كود الحساب، الاسم، اسم مستخدم المدير، وكلمة سر لا تقل عن 6 محارف.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await createCompany({
        code: form.code.trim(),
        name: form.name.trim(),
        adminUsername: form.adminUsername.trim(),
        adminPassword: form.adminPassword,
        adminFullName: form.adminFullName.trim() || undefined,
      });
      setForm(emptyForm);
      setMessage('تم إنشاء الحساب بنجاح.');
      await load();
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.message : 'تعذر إنشاء الحساب.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 transition-colors space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-xl font-bold text-[var(--text-heading)] flex items-center gap-2">
            <Building2 className="w-5 h-5 text-[var(--ui-accent)]" />
            الحسابات
          </h3>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            كل حساب معزول تماماً عن الحسابات الأخرى (مستودعات، فواتير، عملاء، خزينة...). هذا القسم يظهر فقط لمدير المنصة.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="bg-[var(--surface-header)] border border-[var(--border-default)] text-[var(--text-heading)] px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-[var(--surface-muted-nav)] transition text-sm font-bold disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </button>
      </div>

      {message && (
        <div className="border border-[var(--border-default)] bg-[var(--surface-muted-nav)] rounded-lg px-3 py-2 text-sm font-bold text-[var(--text-heading)]">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 border border-[var(--border-default)] rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 font-bold text-[var(--text-heading)]">
            <Plus className="w-5 h-5 text-[var(--ui-accent)]" /> حساب جديد
          </div>
          <input
            className="w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg"
            placeholder="كود الحساب (مثال: TURKEY)"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
          <input
            className="w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg"
            placeholder="اسم الحساب (مثال: مستودع تركيا)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div className="pt-2 border-t border-[var(--border-subtle)] text-xs font-bold text-[var(--text-muted)]">
            أول مدير لهذا الحساب
          </div>
          <input
            className="w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg"
            placeholder="اسم المستخدم"
            value={form.adminUsername}
            onChange={(e) => setForm({ ...form, adminUsername: e.target.value })}
          />
          <input
            className="w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg"
            placeholder="الاسم الكامل (اختياري)"
            value={form.adminFullName}
            onChange={(e) => setForm({ ...form, adminFullName: e.target.value })}
          />
          <input
            type="password"
            className="w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg"
            placeholder="كلمة المرور (6 محارف على الأقل)"
            value={form.adminPassword}
            onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy}
            className="w-full bg-[var(--ui-accent)] text-white px-4 py-2 rounded-lg font-bold hover:opacity-95 transition disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'إنشاء الحساب'}
          </button>
        </div>

        <div className="lg:col-span-2 border border-[var(--border-default)] rounded-xl overflow-hidden">
          <div className="p-4 bg-[var(--surface-muted-nav)] border-b border-[var(--border-default)] font-bold text-[var(--text-heading)]">
            الحسابات الحالية
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-muted-nav)] text-[var(--text-muted)]">
                <tr>
                  <th className="p-3 text-right">الاسم</th>
                  <th className="p-3 text-right">الكود</th>
                  <th className="p-3 text-right">العملة الأساسية</th>
                  <th className="p-3 text-right">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-t border-[var(--border-subtle)]">
                    <td className="p-3 font-bold text-[var(--text-heading)]">{c.name}</td>
                    <td className="p-3 font-mono text-[var(--text-muted)]">{c.code}</td>
                    <td className="p-3 text-[var(--text-muted)]">{c.base_currency_code}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${c.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {c.is_active ? 'فعال' : 'موقوف'}
                      </span>
                    </td>
                  </tr>
                ))}
                {!loading && companies.length === 0 && (
                  <tr><td colSpan={4} className="p-6 text-center text-[var(--text-muted)]">لا توجد حسابات.</td></tr>
                )}
                {loading && (
                  <tr><td colSpan={4} className="p-6 text-center text-[var(--text-muted)]">جاري التحميل...</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
