import React, { useEffect, useState } from 'react';
import { Building2, Loader2, Pencil, Plus, RefreshCw, Save, X } from 'lucide-react';
import { createCompany, listCompanies, updateCompany, type ApiCompany } from '../../lib/api/companiesApi';
import { ApiRequestError } from '../../lib/api/client';

type CompanyManagementPanelProps = {
  /** يُستدعى بعد أي تحميل/إنشاء ناجح حتى تبقى قوائم الحسابات بالشاشات الأخرى (مثل فورم إنشاء مستخدم) محدّثة. */
  onCompaniesChanged?: (companies: ApiCompany[]) => void;
};

const emptyForm = {
  code: '',
  name: '',
  defaultLanguage: 'ar' as 'ar' | 'tr',
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
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingCompany, setEditingCompany] = useState<ApiCompany | null>(null);
  const [editForm, setEditForm] = useState({ name: '', code: '', isActive: true, defaultLanguage: 'ar' as 'ar' | 'tr' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

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
        defaultLanguage: form.defaultLanguage,
        adminUsername: form.adminUsername.trim(),
        adminPassword: form.adminPassword,
        adminFullName: form.adminFullName.trim() || undefined,
      });
      setForm(emptyForm);
      setMessage('تم إنشاء الحساب بنجاح.');
      setShowCreateForm(false);
      await load();
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.message : 'تعذر إنشاء الحساب.');
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (company: ApiCompany) => {
    setEditingCompany(company);
    setEditForm({ name: company.name, code: company.code, isActive: company.is_active, defaultLanguage: company.default_language });
    setEditError('');
  };

  const closeEdit = () => {
    setEditingCompany(null);
    setEditError('');
  };

  const handleSaveEdit = async () => {
    if (!editingCompany || !editForm.name.trim() || !editForm.code.trim()) return;
    setEditSaving(true);
    setEditError('');
    try {
      await updateCompany(editingCompany.id, {
        name: editForm.name.trim(),
        code: editForm.code.trim(),
        isActive: editForm.isActive,
        defaultLanguage: editForm.defaultLanguage,
      });
      closeEdit();
      await load();
    } catch (error) {
      setEditError(error instanceof ApiRequestError ? error.message : 'تعذر حفظ التعديل.');
    } finally {
      setEditSaving(false);
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="bg-[var(--ui-accent)] text-white px-3 py-2 rounded-lg flex items-center gap-2 hover:opacity-95 transition text-sm font-bold"
          >
            <Plus className="w-4 h-4" />
            {showCreateForm ? 'إلغاء' : 'إضافة فرع جديد'}
          </button>
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
      </div>

      {message && (
        <div className="border border-[var(--border-default)] bg-[var(--surface-muted-nav)] rounded-lg px-3 py-2 text-sm font-bold text-[var(--text-heading)]">
          {message}
        </div>
      )}

      {showCreateForm && (
        <div className="border border-[var(--border-default)] rounded-xl p-4 space-y-3 max-w-md">
          <div className="flex items-center gap-2 font-bold text-[var(--text-heading)]">
            <Plus className="w-5 h-5 text-[var(--ui-accent)]" /> فرع جديد (مثال: تركيا)
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
          <div className="space-y-1">
            <label className="text-xs font-bold text-[var(--text-muted)]">لغة الواجهة الافتراضية لهذا الفرع</label>
            <select
              className="w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg"
              value={form.defaultLanguage}
              onChange={(e) => setForm({ ...form, defaultLanguage: e.target.value === 'tr' ? 'tr' : 'ar' })}
            >
              <option value="ar">العربية</option>
              <option value="tr">Türkçe</option>
            </select>
          </div>
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
      )}

      <div className="border border-[var(--border-default)] rounded-xl overflow-hidden">
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
                <th className="p-3 text-right w-24">إجراء</th>
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
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      className="inline-flex items-center gap-1.5 text-[var(--ui-accent)] hover:opacity-80 text-xs font-bold"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      تعديل
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && companies.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-[var(--text-muted)]">لا توجد حسابات.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={5} className="p-6 text-center text-[var(--text-muted)]">جاري التحميل...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] p-5">
              <h3 className="text-lg font-bold text-[var(--text-heading)]">تعديل الفرع</h3>
              <button type="button" onClick={closeEdit} className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-muted-nav)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <div className="space-y-1">
                <label className="text-xs font-bold text-[var(--text-muted)]">اسم الفرع</label>
                <input
                  className="w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-[var(--text-muted)]">الكود</label>
                <input
                  className="w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg font-mono"
                  dir="ltr"
                  value={editForm.code}
                  onChange={(e) => setEditForm({ ...editForm, code: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-[var(--text-muted)]">لغة الواجهة الافتراضية</label>
                <select
                  className="w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg"
                  value={editForm.defaultLanguage}
                  onChange={(e) => setEditForm({ ...editForm, defaultLanguage: e.target.value === 'tr' ? 'tr' : 'ar' })}
                >
                  <option value="ar">العربية</option>
                  <option value="tr">Türkçe</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm font-bold text-[var(--text-heading)]">
                <input
                  type="checkbox"
                  checked={editForm.isActive}
                  onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                  className="accent-[var(--ui-accent)]"
                />
                الحساب فعال
              </label>
              {editError && <p className="text-sm font-bold text-rose-600">{editError}</p>}
            </div>
            <div className="flex justify-end gap-3 border-t border-[var(--border-default)] p-5">
              <button
                type="button"
                onClick={closeEdit}
                disabled={editSaving}
                className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm font-bold text-[var(--text-heading)] hover:bg-[var(--surface-muted-nav)] disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={editSaving || !editForm.name.trim() || !editForm.code.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--ui-accent)] px-4 py-2 text-sm font-bold text-white hover:opacity-95 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {editSaving ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
