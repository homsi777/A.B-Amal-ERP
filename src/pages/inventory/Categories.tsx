import React, { useCallback, useEffect, useState } from 'react';
import { Check, ChevronLeft, Loader2, Pencil, Plus, RefreshCw, Search, X } from 'lucide-react';
import {
  type ApiCategory,
  type CategoryPayload,
  createCategory,
  listCategories,
  syncCategoriesFromMaterials,
  toggleCategoryStatus,
  updateCategory,
} from '../../lib/api/fabricCategoriesApi';

/** أربع مستويات فقط: 1 اسم خامة → 2 كود خامة → 3 اللون → 4 كود اللون */
const MAX_COLUMNS = 4;
const COLUMN_LABELS = ['اسم خامة', 'كود الخامة', 'اللون', 'كود اللون'] as const;

const emptyForm = (parentId?: string | null): CategoryPayload => ({
  code: '', name: '', parent_id: parentId ?? null,
});

function buildTree(flat: ApiCategory[]): ApiCategory[] {
  const map = new Map<string, ApiCategory>();
  flat.forEach(c => map.set(c.id, { ...c, children: [] }));
  const roots: ApiCategory[] = [];
  flat.forEach(c => {
    const node = map.get(c.id)!;
    if (c.parent_id && map.has(c.parent_id)) {
      map.get(c.parent_id)!.children!.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

/** عمق العقدة من الجذر (الجذر = 0) — للحد الأقصى ثلاث مستويات */
function depthFromRoot(id: string, byId: Map<string, ApiCategory>): number {
  let depth = 0;
  let cur: string | undefined = id;
  while (cur) {
    const n = byId.get(cur);
    if (!n) return 0;
    if (!n.parent_id) return depth;
    depth++;
    cur = n.parent_id;
  }
  return depth;
}

function buildAncestorPath(nodeId: string, flat: ApiCategory[]): ApiCategory[] {
  const byId = new Map(flat.map(c => [c.id, c]));
  const path: ApiCategory[] = [];
  let cur: ApiCategory | undefined = byId.get(nodeId);
  while (cur) {
    path.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return path;
}

export const Categories = () => {
  const [allCategories, setAllCategories] = useState<ApiCategory[]>([]);
  const [tree, setTree] = useState<ApiCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [selectedPath, setSelectedPath] = useState<ApiCategory[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiCategory | null>(null);
  const [form, setForm] = useState<CategoryPayload>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [quickInputs, setQuickInputs] = useState<Record<string, string>>({});
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [autoSyncTried, setAutoSyncTried] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);

  const syncCategoriesFromImportedItems = useCallback(async () => {
    if (autoSyncing) return;
    setAutoSyncing(true);
    setSyncSummary(null);
    try {
      const result = await syncCategoriesFromMaterials();
      setSyncSummary(
        `تمت مزامنة التصنيفات: أُضيف ${result.totalCreated} (اسم خامة ${result.createdLevel1}، كود خامة ${result.createdLevel2}، لون ${result.createdLevel3}، كود لون ${result.createdLevel4}).`,
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشلت مزامنة التصنيفات من المواد الحالية');
    } finally {
      setAutoSyncing(false);
    }
  }, [autoSyncing]);

  const load = useCallback(async (expandToId?: string | null) => {
    setLoading(true); setError(null);
    try {
      let data = await listCategories({ search: search || undefined });
      if (expandToId && !data.some(c => c.id === expandToId)) {
        data = await listCategories({});
      }
      setAllCategories(data);
      setTree(buildTree(data));
      if (expandToId) {
        const path = buildAncestorPath(expandToId, data);
        setSelectedPath(path.slice(0, MAX_COLUMNS));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في تحميل التصنيفات');
    } finally { setLoading(false); }
  }, [search]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (loading || search.trim() || autoSyncing || autoSyncTried || allCategories.length > 0) return;
    void (async () => {
      setAutoSyncTried(true);
      await syncCategoriesFromImportedItems();
      await load();
    })().catch(() => undefined);
  }, [allCategories.length, autoSyncTried, autoSyncing, load, loading, search, syncCategoriesFromImportedItems]);

  const byIdMap = React.useMemo(
    () => new Map(allCategories.map(c => [c.id, c])),
    [allCategories],
  );

  const selectAt = (level: number, cat: ApiCategory) => {
    setSelectedPath(prev => [...prev.slice(0, level), cat]);
  };

  const openEdit = (cat: ApiCategory) => {
    setEditTarget(cat);
    setForm({ code: cat.code, name: cat.name, parent_id: cat.parent_id });
    setSaveError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => { setIsModalOpen(false); setEditTarget(null); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setSaveError(null);
    try {
      let expandToId: string | null = null;
      if (editTarget) {
        await updateCategory(editTarget.id, form);
      } else {
        const created = await createCategory(form);
        expandToId = created.id;
      }
      closeModal();
      if (expandToId) {
        await load(expandToId);
      } else {
        setSelectedPath([]);
        await load();
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'فشل الحفظ');
    } finally { setSaving(false); }
  };

  const quickKey = (level: number, parentId: string | null) => `${level}:${parentId ?? 'root'}`;

  const buildQuickPayload = (level: number, value: string, parentId: string | null): CategoryPayload => {
    const text = value.trim();
    if (level === 2) {
      return {
        name: text,
        code: '',
        parent_id: parentId,
      };
    }
    return {
      name: text,
      code: text,
      parent_id: parentId,
    };
  };

  const handleQuickSave = async (level: number, parentId: string | null) => {
    const key = quickKey(level, parentId);
    const value = quickInputs[key]?.trim() ?? '';
    if (!value || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const created = await createCategory(buildQuickPayload(level, value, parentId));
      setQuickInputs((prev) => ({ ...prev, [key]: '' }));
      await load(created.id);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (cat: ApiCategory) => {
    try {
      await toggleCategoryStatus(cat.id);
      load();
    } catch { /* no-op */ }
  };

  // عمود واحد لكل مستوى كحد أقصى — لا يُفتح عمود رابع
  const columns: { level: number; title: string; parentId: string | null; nodes: ApiCategory[] }[] = [
    { level: 0, title: COLUMN_LABELS[0], parentId: null, nodes: tree },
  ];
  if (selectedPath[0]) {
    columns.push({
      level: 1,
      title: `${COLUMN_LABELS[1]} — ${selectedPath[0].name}`,
      parentId: selectedPath[0].id,
      nodes: selectedPath[0].children || [],
    });
  }
  if (selectedPath[1]) {
    columns.push({
      level: 2,
      title: `${COLUMN_LABELS[2]} — ${selectedPath[1].name}`,
      parentId: selectedPath[1].id,
      nodes: selectedPath[1].children || [],
    });
  }
  if (selectedPath[2]) {
    columns.push({
      level: 3,
      title: `${COLUMN_LABELS[3]} — ${selectedPath[2].name}`,
      parentId: selectedPath[2].id,
      nodes: selectedPath[2].children || [],
    });
  }

  /** يمكن جعل أصلاً لمن عمقه ≤ 2 فقط حتى لا يضاف شيء تحت كود اللون */
  const parentOptions = [
    { id: '', name: 'بلا أصل — مستوى اسم الخامة' },
    ...allCategories
      .filter(c => !editTarget || c.id !== editTarget.id)
      .filter(c => depthFromRoot(c.id, byIdMap) <= 2)
      .map(c => ({
        id: c.id,
        name: `${c.name} (${depthFromRoot(c.id, byIdMap) === 0 ? COLUMN_LABELS[0] : depthFromRoot(c.id, byIdMap) === 1 ? COLUMN_LABELS[1] : depthFromRoot(c.id, byIdMap) === 2 ? COLUMN_LABELS[2] : COLUMN_LABELS[3]})`,
      })),
  ];

  return (
    <div className="space-y-6 h-[calc(100vh-100px)] flex flex-col">
      <div className="flex justify-between items-start shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">تصنيفات الأقمشة</h2>
<p className="text-slate-500 mt-1">
             أربع مستويات فقط: <strong>اسم خامة</strong> ثم <strong>كود الخامة</strong> ثم <strong>اللون</strong> ثم <strong>كود اللون</strong>. عند الإضافة تظهر خانة إدخال واحدة تلقائياً؛ عند التعديل تظهر كلتا الخانتين.
           </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void (async () => {
                await syncCategoriesFromImportedItems();
                await load();
              })();
            }}
            disabled={autoSyncing}
            className="px-3 py-2 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition"
            title="إنشاء التصنيفات من المواد الموجودة حاليًا"
          >
            {autoSyncing ? 'جاري المزامنة...' : 'مزامنة من المواد الحالية'}
          </button>
          <button type="button" onClick={() => load()} className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
            <RefreshCw className="w-4 h-4" />
          </button>
          <div className="relative max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input type="text" placeholder="بحث في التصنيفات..." value={search}
              onChange={e => { setSearch(e.target.value); setSelectedPath([]); }}
              className="pr-9 pl-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
      </div>

      {error && <div className="shrink-0 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">{error}</div>}
      {syncSummary && <div className="shrink-0 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">{syncSummary}</div>}

      <div className="flex-1 rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          </div>
        ) : (
          <div className="flex-1 flex gap-4 overflow-x-auto p-6 bg-slate-50 items-start" dir="rtl">
            {columns.map((col) => (
              <div key={col.level}
                className="min-w-[280px] w-[280px] bg-white border border-slate-200 rounded-xl flex flex-col shrink-0 max-h-[560px] shadow-sm overflow-hidden">
                <div className="p-4 bg-slate-100 border-b border-slate-200 shrink-0 flex items-center justify-between gap-2">
                  <h3 className="font-bold text-slate-800 text-sm leading-snug">{col.title}</h3>
                  <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-bold shrink-0">{col.nodes.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/50">
                  {col.nodes.map(node => {
                    const isSelected = selectedPath[col.level]?.id === node.id;
                    return (
                      <div key={node.id}
                        onClick={() => selectAt(col.level, node)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex justify-between items-center group
                          ${isSelected
                            ? 'bg-indigo-600 text-white border-indigo-700 shadow-md'
                            : `bg-white border-slate-200 hover:border-indigo-400 hover:shadow-sm ${!node.is_active ? 'opacity-50' : ''}`}`}>
                        <div>
                          <p className="font-bold text-sm">{node.name}</p>
                          {node.code && node.code !== node.name ? (
                            <p className={`text-xs mt-0.5 font-mono ${isSelected ? 'text-indigo-200' : 'text-slate-400'}`}>{node.code}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1">
                          {!isSelected && (
                            <div className="flex opacity-0 group-hover:opacity-100 transition-all">
                              <button type="button" onClick={e => { e.stopPropagation(); openEdit(node); }}
                                className="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition" title="تعديل">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={e => { e.stopPropagation(); handleToggle(node); }}
                                className={`p-1.5 rounded-lg transition ${node.is_active ? 'text-slate-400 hover:text-rose-500 hover:bg-rose-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                                title={node.is_active ? 'تعطيل' : 'تفعيل'}>
                                {node.is_active ? <X className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          )}
                          {isSelected && col.level < MAX_COLUMNS - 1 && (
                            <div className="bg-indigo-500/50 rounded p-1">
                              <ChevronLeft className="w-4 h-4 text-white" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleQuickSave(col.level, col.parentId);
                    }}
                    className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-2 focus-within:border-indigo-400"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={quickInputs[quickKey(col.level, col.parentId)] ?? ''}
                        onChange={(e) => setQuickInputs((prev) => ({
                          ...prev,
                          [quickKey(col.level, col.parentId)]: e.target.value,
                        }))}
                        placeholder={`إضافة ${COLUMN_LABELS[col.level]}`}
                        className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm font-bold outline-none"
                      />
                      <button
                        type="submit"
                        disabled={saving || !(quickInputs[quickKey(col.level, col.parentId)] ?? '').trim()}
                        className="p-2 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
                        title="حفظ"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-lg">{editTarget ? 'تعديل تصنيف' : 'إضافة تصنيف جديد'}</h3>
              <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              {saveError && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">{saveError}</p>}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الاسم</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" placeholder="أدخل الاسم..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الكود</label>
                  <input type="text" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" dir="ltr" placeholder="أدخل الكود..." />
                </div>
              </div>
              <p className="text-xs text-slate-500">يجب إدخال الاسم أو الكود على الأقل واحداً.</p>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">المستوى / الأصل</label>
                <select value={form.parent_id || ''} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value || null }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                  {parentOptions.map(o => <option key={o.id || 'root'} value={o.id}>{o.name}</option>)}
                </select>
                <p className="text-xs text-slate-500 mt-1">لا يمكن الإضافة تحت «كود اللون» — الحد أربع مستويات.</p>
              </div>
              <div className="pt-2 flex justify-end gap-3">
                <button type="button" onClick={closeModal} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm">إلغاء</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm flex items-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editTarget ? 'حفظ التعديلات' : 'إضافة التصنيف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
