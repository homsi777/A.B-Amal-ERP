import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Check, Loader2, MapPin, Pencil, Plus, RefreshCw, Search, X } from 'lucide-react';
import {
  type ApiWarehouse,
  type WarehousePayload,
  createWarehouse,
  listWarehouses,
  toggleWarehouseStatus,
  updateWarehouse,
} from '../../lib/api/warehousesApi';

const WAREHOUSE_TYPES = [
  { value: 'MAIN', label: 'رئيسي' },
  { value: 'BRANCH', label: 'فرعي' },
  { value: 'SHOWROOM', label: 'صالة عرض' },
  { value: 'TRANSIT', label: 'عبور' },
];

const emptyForm = (): WarehousePayload => ({ code: '', name: '', type: 'MAIN', address: '' });

export const Warehouses = () => {
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiWarehouse | null>(null);
  const [form, setForm] = useState<WarehousePayload>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await listWarehouses({
        search: search || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      setWarehouses(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في تحميل البيانات');
    } finally { setLoading(false); }
  }, [search, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditTarget(null); setForm(emptyForm()); setSaveError(null); setIsModalOpen(true); };
  const openEdit = (wh: ApiWarehouse) => {
    setEditTarget(wh);
    setForm({ code: wh.code, name: wh.name, type: wh.type, address: wh.address });
    setSaveError(null);
    setIsModalOpen(true);
  };
  const closeModal = () => { setIsModalOpen(false); setEditTarget(null); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setSaveError(null);
    try {
      if (editTarget) { await updateWarehouse(editTarget.id, form); }
      else { await createWarehouse(form); }
      closeModal(); load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'فشل الحفظ');
    } finally { setSaving(false); }
  };

  const handleToggle = async (id: string) => {
    try {
      const res = await toggleWarehouseStatus(id);
      setWarehouses(w => w.map(x => x.id === id ? { ...x, is_active: res.is_active } : x));
    } catch { /* no-op */ }
  };

  const activeCount = warehouses.filter(w => w.is_active).length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">المستودعات</h2>
          <p className="text-slate-500 mt-1">إدارة المستودعات — مُتصل بـ PostgreSQL</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={openAdd} className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition shadow-sm">
            <Plus className="w-5 h-5" /><span className="font-bold">إضافة مستودع</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-11 h-11 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
          <div><p className="text-sm font-bold text-slate-500">إجمالي المستودعات</p>
            <p className="text-2xl font-black text-slate-900">{loading ? '—' : warehouses.length}</p></div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-11 h-11 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
          <div><p className="text-sm font-bold text-slate-500">مستودعات نشطة</p>
            <p className="text-2xl font-black text-slate-900">{loading ? '—' : activeCount}</p></div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو الكود..."
              className="w-full pr-9 pl-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none">
            <option value="all">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
          </select>
        </div>

        {error && <div className="m-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">{error}</div>}

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-5 py-4 font-bold">الكود</th>
                <th className="px-5 py-4 font-bold">الاسم والنوع</th>
                <th className="px-5 py-4 font-bold">العنوان</th>
                <th className="px-5 py-4 font-bold">الحالة</th>
                <th className="px-5 py-4 font-bold">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-400" />
                </td></tr>
              ) : warehouses.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">لا يوجد مستودعات.</td></tr>
              ) : warehouses.map(wh => (
                <tr key={wh.id} className="hover:bg-slate-50 bg-white">
                  <td className="px-5 py-4 font-mono font-bold text-slate-500">{wh.code}</td>
                  <td className="px-5 py-4">
                    <p className="font-bold text-indigo-700">{wh.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {WAREHOUSE_TYPES.find(t => t.value === wh.type)?.label || wh.type}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    <span className="flex items-center gap-1.5 text-slate-700">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate max-w-[140px]">{wh.address || '—'}</span>
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <button onClick={() => handleToggle(wh.id)}
                      className={`px-2.5 py-1 rounded-full text-xs font-bold transition ${wh.is_active ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                      {wh.is_active ? 'نشط' : 'غير نشط'}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <button onClick={() => openEdit(wh)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
                      <Pencil className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800">{editTarget ? 'تعديل مستودع' : 'إضافة مستودع جديد'}</h3>
              <button onClick={closeModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              {saveError && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">{saveError}</p>}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">الكود *</label>
                  <input required type="text" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                    disabled={!!editTarget}
                    placeholder="WH-001"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-50" dir="ltr" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">الاسم *</label>
                  <input required type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">النوع</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                  {WAREHOUSE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">العنوان / الموقع</label>
                <input type="text" value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={closeModal} className="px-5 py-2.5 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition text-sm">إلغاء</button>
                <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition shadow-sm text-sm flex items-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editTarget ? 'حفظ التعديلات' : 'حفظ المستودع'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
