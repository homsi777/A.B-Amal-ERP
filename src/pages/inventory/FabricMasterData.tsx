import React, { useCallback, useEffect, useState } from 'react';
import {
  Check, Loader2, Palette, Pencil, Plus, RefreshCw, Search, Shapes, Shirt, X,
  Barcode,   // ← إضافة أيقونة الباركود
} from 'lucide-react';
import { type ApiCategory, listCategories } from '../../lib/api/fabricCategoriesApi';
import {
  type ApiFabricColor,
  type FabricColorPayload,
  createFabricColor,
  listFabricColors,
  toggleFabricColorStatus,
  updateFabricColor,
} from '../../lib/api/fabricColorsApi';
import {
  type ApiFabricItem,
  type FabricItemPayload,
  createFabricItem,
  listFabricItems,
  toggleFabricItemStatus,
  updateFabricItem,
} from '../../lib/api/fabricItemsApi';
import {
  type ApiFabricVariant,
  type FabricVariantPayload,
  createFabricVariant,
  listFabricVariants,
  toggleFabricVariantStatus,
  updateFabricVariant,
} from '../../lib/api/fabricVariantsApi';
import { type ApiSupplier, listSuppliers } from '../../lib/api/suppliersApi';

type Tab = 'items' | 'colors' | 'variants';

// ─────────────────────────────────────────────────────────────────────────────
// Items Tab
// ─────────────────────────────────────────────────────────────────────────────
function ItemsTab() {
  const [items, setItems] = useState<ApiFabricItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);

   const [isOpen, setIsOpen] = useState(false);
   const [editTarget, setEditTarget] = useState<ApiFabricItem | null>(null);
  const [form, setForm] = useState<FabricItemPayload>({
    name: '', internal_code: '', supplier_code: '', fabric_type: '', unit: 'meter', notes: '',
    category_id: null, supplier_id: null,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [res, cats, sups] = await Promise.all([
        listFabricItems({ search: search || undefined, page, pageSize }),
        listCategories(),
        listSuppliers({ pageSize: 200 }),
      ]);
      setItems(res.data); setTotal(res.total);
      setCategories(cats); setSuppliers(sups.data);
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
    finally { setLoading(false); }
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditTarget(null);
    setForm({ name: '', internal_code: '', supplier_code: '', fabric_type: '', unit: 'meter', notes: '', category_id: null, supplier_id: null });
    setSaveError(null); setIsOpen(true);
  };
  const openEdit = (it: ApiFabricItem) => {
    setEditTarget(it);
    setForm({
      name: it.name, internal_code: it.internal_code, supplier_code: it.supplier_code,
      fabric_type: it.fabric_type, unit: it.unit, notes: it.notes,
      category_id: it.category_id, supplier_id: it.supplier_id,
    });
    setSaveError(null); setIsOpen(true);
  };
  const close = () => { setIsOpen(false); setEditTarget(null); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setSaveError(null);
    try {
      if (editTarget) await updateFabricItem(editTarget.id, form);
      else await createFabricItem(form);
      close(); load();
    } catch (e) { setSaveError(e instanceof Error ? e.message : 'فشل الحفظ'); }
    finally { setSaving(false); }
  };

  const toggle = async (id: string) => {
    try {
      const r = await toggleFabricItemStatus(id);
      setItems(prev => prev.map(x => x.id === id ? { ...x, is_active: r.is_active } : x));
    } catch { /* no-op */ }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 flex-1 max-w-sm">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input type="text" placeholder="بحث بالاسم أو الكود..." value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pr-9 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button onClick={load} className="p-2 text-slate-500 hover:text-indigo-600 rounded-lg"><RefreshCw className="w-4 h-4" /></button>
        </div>
        <button onClick={openAdd} className="bg-indigo-600 text-white px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition text-sm">
          <Plus className="w-4 h-4" /><span>إضافة خامة</span>
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
            <tr>
              <th className="px-4 py-3">الكود الداخلي</th>
              <th className="px-4 py-3">الاسم</th>
              <th className="px-4 py-3">النوع</th>
              <th className="px-4 py-3">الوحدة</th>
              <th className="px-4 py-3">التصنيف</th>
              <th className="px-4 py-3">المورد</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={8} className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-400" /></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="py-8 text-center text-slate-400">لا يوجد خامات.</td></tr>
            ) : items.map(it => (
              <tr key={it.id} className="hover:bg-slate-50/50 bg-white">
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{it.internal_code}</td>
                <td className="px-4 py-3 font-semibold text-slate-900">{it.name}</td>
                <td className="px-4 py-3 text-slate-600">{it.fabric_type || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{it.unit}</td>
                <td className="px-4 py-3 text-slate-500">{it.category_name || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{it.supplier_name || '—'}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggle(it.id)}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold ${it.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {it.is_active ? 'نشط' : 'غير نشط'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => openEdit(it)} className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg"><Pencil className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span>{total} خامة</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 rounded-lg border disabled:opacity-40">السابق</button>
            <span className="px-3 py-1.5">{page}/{totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 rounded-lg border disabled:opacity-40">التالي</button>
          </div>
        </div>
      )}

      {isOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-lg">{editTarget ? 'تعديل خامة' : 'إضافة خامة جديدة'}</h3>
              <button onClick={close}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={save} className="p-6 space-y-4">
              {saveError && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">{saveError}</p>}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الاسم *</label>
                  <input required type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الكود الداخلي *</label>
                  <input required type="text" value={form.internal_code} onChange={e => setForm(f => ({ ...f, internal_code: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">نوع الخامة</label>
                  <input type="text" value={form.fabric_type || ''} onChange={e => setForm(f => ({ ...f, fabric_type: e.target.value }))}
                    placeholder="كتون، بوليستر..." className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الوحدة</label>
                  <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                    <option value="meter">متر</option>
                    <option value="yard">يارد</option>
                    <option value="kg">كيلوغرام</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">التصنيف</label>
                  <select value={form.category_id || ''} onChange={e => setForm(f => ({ ...f, category_id: e.target.value || null }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                    <option value="">بلا تصنيف</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">المورد</label>
                  <select value={form.supplier_id || ''} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value || null }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                    <option value="">بلا مورد</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">كود المورد</label>
                <input type="text" value={form.supplier_code || ''} onChange={e => setForm(f => ({ ...f, supplier_code: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" />
              </div>
              <div className="pt-2 flex justify-end gap-3">
                <button type="button" onClick={close} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm">إلغاء</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm flex items-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editTarget ? 'حفظ' : 'إضافة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Colors Tab
// ─────────────────────────────────────────────────────────────────────────────
function ColorsTab() {
  const [colors, setColors] = useState<ApiFabricColor[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [isOpen, setIsOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiFabricColor | null>(null);
  const [form, setForm] = useState<FabricColorPayload>({ name_ar: '', name_tr: '', color_code: '', supplier_color_code: '', hex_color: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await listFabricColors({ search: search || undefined, page, pageSize });
      setColors(res.data); setTotal(res.total);
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
    finally { setLoading(false); }
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditTarget(null);
    setForm({ name_ar: '', name_tr: '', color_code: '', supplier_color_code: '', hex_color: '', notes: '' });
    setSaveError(null); setIsOpen(true);
  };
  const openEdit = (c: ApiFabricColor) => {
    setEditTarget(c);
    setForm({ name_ar: c.name_ar, name_tr: c.name_tr, color_code: c.color_code, supplier_color_code: c.supplier_color_code, hex_color: c.hex_color || '', notes: c.notes });
    setSaveError(null); setIsOpen(true);
  };
  const close = () => { setIsOpen(false); setEditTarget(null); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setSaveError(null);
    try {
      if (editTarget) await updateFabricColor(editTarget.id, form);
      else await createFabricColor(form);
      close(); load();
    } catch (e) { setSaveError(e instanceof Error ? e.message : 'فشل الحفظ'); }
    finally { setSaving(false); }
  };

  const toggle = async (id: string) => {
    try {
      const r = await toggleFabricColorStatus(id);
      setColors(prev => prev.map(x => x.id === id ? { ...x, is_active: r.is_active } : x));
    } catch { /* no-op */ }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 flex-1 max-w-sm">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input type="text" placeholder="بحث بالاسم أو الكود..." value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pr-9 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button onClick={load} className="p-2 text-slate-500 hover:text-indigo-600 rounded-lg"><RefreshCw className="w-4 h-4" /></button>
        </div>
        <button onClick={openAdd} className="bg-indigo-600 text-white px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition text-sm">
          <Plus className="w-4 h-4" /><span>إضافة لون</span>
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
            <tr>
              <th className="px-4 py-3">اللون</th>
              <th className="px-4 py-3">الاسم العربي</th>
              <th className="px-4 py-3">الاسم التركي</th>
              <th className="px-4 py-3">كود اللون</th>
              <th className="px-4 py-3">كود المورد</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-400" /></td></tr>
            ) : colors.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-slate-400">لا يوجد ألوان.</td></tr>
            ) : colors.map(c => (
              <tr key={c.id} className="hover:bg-slate-50/50 bg-white">
                <td className="px-4 py-3">
                  <div className="w-6 h-6 rounded-full border border-slate-200 shadow-sm"
                    style={{ background: c.hex_color || '#e2e8f0' }} title={c.hex_color || ''} />
                </td>
                <td className="px-4 py-3 font-semibold text-slate-900">{c.name_ar}</td>
                <td className="px-4 py-3 text-slate-600">{c.name_tr || '—'}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.color_code}</td>
                <td className="px-4 py-3 text-slate-500">{c.supplier_color_code || '—'}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggle(c.id)}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold ${c.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {c.is_active ? 'نشط' : 'غير نشط'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => openEdit(c)} className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg"><Pencil className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span>{total} لون</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 rounded-lg border disabled:opacity-40">السابق</button>
            <span className="px-3 py-1.5">{page}/{totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 rounded-lg border disabled:opacity-40">التالي</button>
          </div>
        </div>
      )}

      {isOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-lg">{editTarget ? 'تعديل لون' : 'إضافة لون جديد'}</h3>
              <button onClick={close}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={save} className="p-6 space-y-4">
              {saveError && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">{saveError}</p>}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الاسم العربي *</label>
                  <input required type="text" value={form.name_ar} onChange={e => setForm(f => ({ ...f, name_ar: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الاسم التركي</label>
                  <input type="text" value={form.name_tr || ''} onChange={e => setForm(f => ({ ...f, name_tr: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">كود اللون *</label>
                  <input required type="text" value={form.color_code} onChange={e => setForm(f => ({ ...f, color_code: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">كود المورد</label>
                  <input type="text" value={form.supplier_color_code || ''} onChange={e => setForm(f => ({ ...f, supplier_color_code: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" />
                </div>
              </div>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">كود اللون السداسي</label>
                  <input type="text" value={form.hex_color || ''} onChange={e => setForm(f => ({ ...f, hex_color: e.target.value }))}
                    placeholder="#RRGGBB"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" />
                </div>
                {form.hex_color && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(form.hex_color) && (
                  <div className="w-10 h-10 rounded-lg border border-slate-300 shadow-sm mb-0.5 shrink-0"
                    style={{ background: form.hex_color }} />
                )}
              </div>
              <div className="pt-2 flex justify-end gap-3">
                <button type="button" onClick={close} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm">إلغاء</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm flex items-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editTarget ? 'حفظ' : 'إضافة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Variants Tab
// ─────────────────────────────────────────────────────────────────────────────
interface VariantsTabProps {
  onOpenBulkBarcode: () => void;
}

function VariantsTab({ onOpenBulkBarcode }: VariantsTabProps) {
  const [variants, setVariants] = useState<ApiFabricVariant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [fabricItems, setFabricItems] = useState<ApiFabricItem[]>([]);
  const [fabricColors, setFabricColors] = useState<ApiFabricColor[]>([]);

  const [isOpen, setIsOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiFabricVariant | null>(null);
  const [form, setForm] = useState<FabricVariantPayload>({ item_id: '', color_id: '', variant_code: '', width_cm: null, gsm: null });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [res, items, colors] = await Promise.all([
        listFabricVariants({ search: search || undefined, page, pageSize }),
        listFabricItems({ pageSize: 200 }),
        listFabricColors({ pageSize: 200 }),
      ]);
      setVariants(res.data); setTotal(res.total);
      setFabricItems(items.data); setFabricColors(colors.data);
    } catch (e) { setError(e instanceof Error ? e.message : 'خطأ'); }
    finally { setLoading(false); }
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditTarget(null);
    setForm({ item_id: fabricItems[0]?.id || '', color_id: fabricColors[0]?.id || '', variant_code: '', width_cm: null, gsm: null });
    setSaveError(null); setIsOpen(true);
  };
  const openEdit = (v: ApiFabricVariant) => {
    setEditTarget(v);
    setForm({ item_id: v.item_id, color_id: v.color_id, variant_code: v.variant_code, width_cm: v.width_cm, gsm: v.gsm });
    setSaveError(null); setIsOpen(true);
  };
  const close = () => { setIsOpen(false); setEditTarget(null); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setSaveError(null);
    try {
      if (editTarget) await updateFabricVariant(editTarget.id, form);
      else await createFabricVariant(form);
      close(); load();
    } catch (e) { setSaveError(e instanceof Error ? e.message : 'فشل الحفظ'); }
    finally { setSaving(false); }
  };

  const toggle = async (id: string) => {
    try {
      const r = await toggleFabricVariantStatus(id);
      setVariants(prev => prev.map(x => x.id === id ? { ...x, is_active: r.is_active } : x));
    } catch { /* no-op */ }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 flex-1 max-w-sm">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input type="text" placeholder="بحث بالكود أو الخامة أو اللون..." value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pr-9 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button onClick={load} className="p-2 text-slate-500 hover:text-indigo-600 rounded-lg"><RefreshCw className="w-4 h-4" /></button>
        </div>
        <button onClick={openAdd} className="bg-indigo-600 text-white px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition text-sm">
          <Plus className="w-4 h-4" /><span>إضافة متغير</span>
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
            <tr>
              <th className="px-4 py-3">كود المتغير</th>
              <th className="px-4 py-3">الخامة</th>
              <th className="px-4 py-3">اللون</th>
              <th className="px-4 py-3">العرض (سم)</th>
              <th className="px-4 py-3">GSM</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-400" /></td></tr>
            ) : variants.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-slate-400">لا يوجد متغيرات.</td></tr>
            ) : variants.map(v => (
              <tr key={v.id} className="hover:bg-slate-50/50 bg-white">
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{v.variant_code}</td>
                <td className="px-4 py-3 text-slate-900">{v.item_name || '—'}</td>
                <td className="px-4 py-3">
         <div className="flex items-center gap-2">
           <div className="relative flex-1 max-w-sm">
             <input type="text" placeholder="بحث بالاسم أو الكود..." value={search}
               onChange={e => { setSearch(e.target.value); setPage(1); }}
               className="w-full pr-9 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
           </div>
           <button onClick={load} className="p-2 text-slate-500 hover:text-indigo-600 rounded-lg"><RefreshCw className="w-4 h-4" /></button>
           <button onClick={openAdd} className="bg-indigo-600 text-white px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition text-sm">
             <Plus className="w-4 h-4" /><span>إضافة خامة</span>
           </button>
           <button onClick={onOpenBulkBarcode} className="bg-emerald-600 text-white px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700 transition text-sm">
             <Barcode className="w-4 h-4" /><span>توليد باركود جماعي</span>
           </button>
         </div>
                </td>
                <td className="px-4 py-3 text-slate-600">{v.width_cm ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{v.gsm ?? '—'}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggle(v.id)}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold ${v.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {v.is_active ? 'نشط' : 'غير نشط'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => openEdit(v)} className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg"><Pencil className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span>{total} متغير</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 rounded-lg border disabled:opacity-40">السابق</button>
            <span className="px-3 py-1.5">{page}/{totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 rounded-lg border disabled:opacity-40">التالي</button>
          </div>
        </div>
      )}

      {isOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-lg">{editTarget ? 'تعديل متغير' : 'إضافة متغير جديد'}</h3>
              <button onClick={close}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={save} className="p-6 space-y-4">
              {saveError && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">{saveError}</p>}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">كود المتغير *</label>
                <input required type="text" value={form.variant_code} onChange={e => setForm(f => ({ ...f, variant_code: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الخامة *</label>
                  <select required value={form.item_id} onChange={e => setForm(f => ({ ...f, item_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                    <option value="">اختر خامة</option>
                    {fabricItems.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">اللون *</label>
                  <select required value={form.color_id} onChange={e => setForm(f => ({ ...f, color_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                    <option value="">اختر لوناً</option>
                    {fabricColors.map(c => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">العرض (سم)</label>
                  <input type="number" min="0" step="0.01"
                    value={form.width_cm ?? ''} onChange={e => setForm(f => ({ ...f, width_cm: e.target.value ? parseFloat(e.target.value) : null }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">GSM</label>
                  <input type="number" min="0" step="0.01"
                    value={form.gsm ?? ''} onChange={e => setForm(f => ({ ...f, gsm: e.target.value ? parseFloat(e.target.value) : null }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" />
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-3">
                <button type="button" onClick={close} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm">إلغاء</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm flex items-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editTarget ? 'حفظ' : 'إضافة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'items', label: 'الخامات', icon: <Shirt className="w-4 h-4" /> },
  { id: 'colors', label: 'الألوان', icon: <Palette className="w-4 h-4" /> },
  { id: 'variants', label: 'المتغيرات', icon: <Shapes className="w-4 h-4" /> },
];

 // ─────────────────────────────────────────────────────────────────────────────
 // Bulk Barcode Modal Component
 // ─────────────────────────────────────────────────────────────────────────────

 interface BulkBarcodeModalProps {
   open: boolean;
   onClose: () => void;
   onSuccess: () => void;
 }

 // `ApiFabricItem` لا يصرّح بحقل `barcode` في الواجهة الحالية، لكنه موجود على
 // الـ backend ويُرجعه عند توفره. نستخدم نوعًا موسّعًا محليًا حتى يبقى ضبط
 // TypeScript صارمًا دون تعطيل المنطق.
 type FabricItemWithBarcode = ApiFabricItem & { barcode?: string | null };

 function getErrorMessage(err: unknown, fallback: string): string {
   if (err && typeof err === 'object' && 'message' in err) {
     const msg = (err as { message?: unknown }).message;
     if (typeof msg === 'string' && msg.length > 0) return msg;
   }
   return fallback;
 }

 function BulkBarcodeModal({ open, onClose, onSuccess }: BulkBarcodeModalProps) {
   const [itemsWithoutBarcode, setItemsWithoutBarcode] = useState<FabricItemWithBarcode[]>([]);
   const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
   const [loading, setLoading] = useState(false);
   const [generating, setGenerating] = useState(false);
   const [error, setError] = useState<string | null>(null);

   useEffect(() => {
     if (!open) return;
     const fetchItems = async () => {
       setLoading(true);
       setError(null);
       try {
         const res = await listFabricItems({ pageSize: 10000, status: 'active' });
         const withoutBarcode = (res.data as FabricItemWithBarcode[]).filter((item) => {
           const bc = item.barcode;
           return !bc || bc.trim() === '';
         });
         setItemsWithoutBarcode(withoutBarcode);
       } catch (err: unknown) {
         setError(getErrorMessage(err, 'فشل تحميل الخامات'));
       } finally {
         setLoading(false);
       }
     };
     fetchItems();
   }, [open]);

   const toggleSelect = (id: string) => {
     setSelectedIds(prev => {
       const next = new Set(prev);
       if (next.has(id)) next.delete(id);
       else next.add(id);
       return next;
     });
   };

   const selectAll = () => {
     if (selectedIds.size === itemsWithoutBarcode.length) {
       setSelectedIds(new Set());
     } else {
       setSelectedIds(new Set(itemsWithoutBarcode.map(it => it.id)));
     }
   };

   const generateAndSave = async () => {
     if (selectedIds.size === 0) return;
     setGenerating(true);
     setError(null);
     try {
       for (const item of itemsWithoutBarcode.filter(it => selectedIds.has(it.id))) {
         const newBarcode = `AUTO-${item.id.slice(0, 8)}`;
         // `barcode` ليس مُعلنًا في `FabricItemPayload` لكنه مدعوم على الـ backend.
         await updateFabricItem(
           item.id,
           { barcode: newBarcode } as unknown as Parameters<typeof updateFabricItem>[1],
         );
       }
       onSuccess();
       onClose();
     } catch (err: unknown) {
       setError(getErrorMessage(err, 'فشل حفظ الباركودات'));
     } finally {
       setGenerating(false);
     }
   };

   if (!open) return null;

   return (
     <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
       <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl" dir="rtl">
         <div className="p-5 border-b border-slate-200 flex justify-between items-center">
           <div>
             <h3 className="font-bold text-lg text-slate-900">توليد باركود جماعي للخامات</h3>
             <p className="text-xs text-slate-500 mt-1">الخامات التالية ليس لها باركود: {itemsWithoutBarcode.length}</p>
           </div>
           <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-400" /></button>
         </div>

         <div className="p-5 max-h-[60vh] overflow-y-auto">
           {error && <p className="mb-3 text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">{error}</p>}

           {loading ? (
             <div className="py-8 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
           ) : itemsWithoutBarcode.length === 0 ? (
             <p className="py-8 text-center text-slate-500">جميع الخامات لديها باركود.</p>
           ) : (
             <>
               <div className="mb-3 flex items-center gap-2">
                 <button onClick={selectAll} className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg">
                   {selectedIds.size === itemsWithoutBarcode.length ? 'إلغاء الكل' : 'تحديد الكل'}
                 </button>
                 <span className="text-xs text-slate-500">تم تحديد {selectedIds.size} من {itemsWithoutBarcode.length}</span>
               </div>
               <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                 <thead className="bg-slate-50">
                   <tr>
                     <th className="px-4 py-2 w-12 text-center">✓</th>
                     <th className="px-4 py-2 text-right">الكود الداخلي</th>
                     <th className="px-4 py-2 text-right">اسم الخامة</th>
                     <th className="px-4 py-2 text-right">النوع</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100">
                   {itemsWithoutBarcode.map(item => (
                     <tr key={item.id} className={`hover:bg-slate-50 cursor-pointer ${selectedIds.has(item.id) ? 'bg-indigo-50/50' : ''}`}
                       onClick={() => toggleSelect(item.id)}>
                       <td className="px-4 py-2 text-center">
                         <input
                           type="checkbox"
                           checked={selectedIds.has(item.id)}
                           onChange={() => toggleSelect(item.id)}
                           onClick={e => e.stopPropagation()}
                         />
                       </td>
                       <td className="px-4 py-2 font-mono text-xs text-slate-600">{item.internal_code}</td>
                       <td className="px-4 py-2 font-bold text-slate-900">{item.name}</td>
                       <td className="px-4 py-2 text-slate-600">{item.fabric_type}</td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </>
           )}
         </div>

         <div className="p-5 border-t border-slate-200 flex justify-between">
           <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50">إلغاء</button>
           <button
             onClick={generateAndSave}
             disabled={generating || selectedIds.size === 0}
             className="px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
           >
             {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Barcode className="w-4 h-4" />}
             توليد وحفظ ({selectedIds.size})
           </button>
         </div>
       </div>
     </div>
   );
 }

 export const FabricMasterData = () => {
   const [activeTab, setActiveTab] = useState<Tab>('items');
   const [, setRefreshKey] = useState(0);
   const [showBulkBarcodeModal, setShowBulkBarcodeModal] = useState(false);

   const load = useCallback(() => {
     setRefreshKey(k => k + 1);
   }, []);

   const handleBulkSuccess = () => {
     load(); // Reload items table
   };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">تعريفات الأقمشة</h2>
        <p className="text-slate-500 mt-1">الخامات، الألوان، والمتغيرات — مُتصل بـ PostgreSQL</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 flex">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition border-b-2 -mb-px
                ${activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>
        <div className="p-6">
          {activeTab === 'items' && <ItemsTab />}
          {activeTab === 'colors' && <ColorsTab />}
          {activeTab === 'variants' && (
            <VariantsTab onOpenBulkBarcode={() => setShowBulkBarcodeModal(true)} />
          )}
         </div>
       </div>

       {/* Bulk Barcode Modal */}
       <BulkBarcodeModal
         open={showBulkBarcodeModal}
         onClose={() => setShowBulkBarcodeModal(false)}
         onSuccess={handleBulkSuccess}
       />
     </div>
   );
 };
