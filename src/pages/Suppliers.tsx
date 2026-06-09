import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import {
  type ApiSupplier,
  type SupplierPayload,
  createSupplier,
  listSuppliers,
  toggleSupplierStatus,
  updateSupplier,
} from '../lib/api/suppliersApi';
import { focusNextFormControl } from '../lib/forms/enterNavigation';

const emptyForm = (): SupplierPayload => ({
  name: '', code: '', phone: '', email: '', address: '', country: '', notes: '',
  telegramChatId: '', telegramEnabled: false, telegramLabel: '',
});

export const Suppliers = () => {
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiSupplier | null>(null);
  const [form, setForm] = useState<SupplierPayload>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await listSuppliers({
        search: search || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        page, pageSize,
      });
      setSuppliers(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في تحميل البيانات');
    } finally { setLoading(false); }
  }, [search, statusFilter, page]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditTarget(null); setForm(emptyForm()); setSaveError(null); setIsModalOpen(true); };
  const openEdit = (s: ApiSupplier) => {
    setEditTarget(s);
    setForm({
      name: s.name,
      code: s.code,
      phone: s.phone,
      email: s.email || '',
      address: s.address,
      country: s.country,
      notes: s.notes,
      telegramChatId: s.telegram_chat_id || '',
      telegramEnabled: s.telegram_enabled,
      telegramLabel: s.telegram_label || '',
    });
    setSaveError(null);
    setIsModalOpen(true);
  };
  const closeModal = () => { setIsModalOpen(false); setEditTarget(null); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setSaveError(null);
    try {
      if (editTarget) { await updateSupplier(editTarget.id, form); }
      else { await createSupplier(form); }
      closeModal(); load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'فشل الحفظ');
    } finally { setSaving(false); }
  };

  const handleToggle = async (id: string) => {
    try {
      const res = await toggleSupplierStatus(id);
      setSuppliers(s => s.map(x => x.id === id ? { ...x, is_active: res.is_active } : x));
    } catch { /* no-op */ }
  };

  const handleDeactivate = async (supplier: ApiSupplier) => {
    if (!supplier.is_active) return;
    if (!window.confirm(`تعطيل المورد "${supplier.name}"؟ سيبقى محفوظاً للفواتير والكشوفات السابقة.`)) return;
    await handleToggle(supplier.id);
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">الموردون</h2>
          <p className="text-slate-500 mt-1">إدارة بيانات الموردين — مُتصل بـ PostgreSQL</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition" title="تحديث">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={openAdd} className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition">
            <Plus className="w-4 h-4" /><span>إضافة مورد</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input type="text" placeholder="بحث بالاسم أو الكود أو الهاتف..." value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pr-9 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value as typeof statusFilter); setPage(1); }}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="all">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
          </select>
        </div>

        {error && (
          <div className="m-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">{error}</div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">الكود</th>
                <th className="px-4 py-3">الاسم</th>
                <th className="px-4 py-3">الهاتف</th>
                <th className="px-4 py-3">الدولة</th>
                <th className="px-4 py-3">الحالة</th>
                <th className="px-4 py-3">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </td></tr>
              ) : suppliers.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">لا يوجد موردون.</td></tr>
              ) : suppliers.map(s => (
                <tr key={s.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{s.code}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{s.name}</td>
                  <td className="px-4 py-3 text-slate-600" dir="ltr">{s.phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{s.country || '—'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggle(s.id)}
                      className={`px-2.5 py-1 rounded-full text-xs font-bold transition ${s.is_active ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                      {s.is_active ? 'نشط' : 'غير نشط'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(s)} title="تعديل" className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => void handleDeactivate(s)} disabled={!s.is_active} title="تعطيل المورد" className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition disabled:opacity-30">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between text-sm text-slate-600">
            <span>{total} مورد إجمالاً</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">السابق</button>
              <span className="px-3 py-1.5">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">التالي</button>
            </div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-lg">{editTarget ? 'تعديل مورد' : 'إضافة مورد جديد'}</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              {saveError && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">{saveError}</p>}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الاسم *</label>
                  <input required type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} onKeyDown={focusNextFormControl}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الكود</label>
                  <input type="text" value={form.code || ''} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} onKeyDown={focusNextFormControl}
                    placeholder="تلقائي إذا تُرك فارغاً"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">رقم الهاتف</label>
                  <input type="text" value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} onKeyDown={focusNextFormControl}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الدولة</label>
                  <input type="text" value={form.country || ''} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} onKeyDown={focusNextFormControl}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">البريد الإلكتروني</label>
                <input type="email" value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} onKeyDown={focusNextFormControl}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">العنوان</label>
                <input type="text" value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} onKeyDown={focusNextFormControl}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">ملاحظات</label>
                <textarea rows={2} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none" />
              </div>
              <div className="border border-sky-100 bg-sky-50/40 rounded-xl p-3 space-y-3">
                <label className="flex items-center justify-between gap-3 text-sm font-bold text-slate-700">
                  <span>تفعيل إرسال تيليغرام لهذا المورد</span>
                  <input
                    type="checkbox"
                    checked={Boolean(form.telegramEnabled)}
                    onChange={e => setForm(f => ({ ...f, telegramEnabled: e.target.checked }))}
                    className="w-4 h-4 accent-sky-600"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Telegram Chat ID</label>
                    <input
                      type="text"
                      value={form.telegramChatId || ''}
                      onChange={e => setForm(f => ({ ...f, telegramChatId: e.target.value }))}
                      onKeyDown={focusNextFormControl}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">اسم تيليغرام</label>
                    <input
                      type="text"
                      value={form.telegramLabel || ''}
                      onChange={e => setForm(f => ({ ...f, telegramLabel: e.target.value }))}
                      onKeyDown={focusNextFormControl}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-3">
                <button type="button" onClick={closeModal} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm">إلغاء</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm flex items-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editTarget ? 'حفظ التعديلات' : 'إضافة المورد'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
