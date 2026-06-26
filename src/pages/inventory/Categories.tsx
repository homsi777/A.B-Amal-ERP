import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, Loader2, Pencil, Plus, RefreshCw, Search, X } from 'lucide-react';
import {
  type ApiCategory,
  type CategoryPayload,
  createCategory,
  getCategoryPath,
  listCategories,
  syncCategoriesFromMaterials,
  toggleCategoryStatus,
  updateCategory,
} from '../../lib/api/fabricCategoriesApi';

/** أربع مستويات فقط: 1 اسم خامة → 2 كود خامة → 3 اللون → 4 كود اللون */
const MAX_COLUMNS = 4;
const COLUMN_LABELS = ['اسم خامة', 'كود الخامة', 'اللون', 'كود اللون'] as const;
const ROOT_KEY = 'root';

const emptyForm = (parentId?: string | null): CategoryPayload => ({
  code: '', name: '', parent_id: parentId ?? null,
});

function cacheKey(parentId: string | null): string {
  return parentId ?? ROOT_KEY;
}

function depthFromRoot(id: string, flat: Map<string, ApiCategory>): number {
  let depth = 0;
  let cur: string | undefined = id;
  while (cur) {
    const n = flat.get(cur);
    if (!n) return 0;
    if (!n.parent_id) return depth;
    depth++;
    cur = n.parent_id;
  }
  return depth;
}

function filterNodes(nodes: ApiCategory[], filter: string): ApiCategory[] {
  const q = filter.trim().toLowerCase();
  if (!q) return nodes;
  return nodes.filter(
    (n) => n.name.toLowerCase().includes(q) || (n.code && n.code.toLowerCase().includes(q)),
  );
}

function sortCategories(list: ApiCategory[]): ApiCategory[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

export const Categories = () => {
  const [childrenCache, setChildrenCache] = useState<Record<string, ApiCategory[]>>({});
  const [allCategoriesFlat, setAllCategoriesFlat] = useState<ApiCategory[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingParents, setLoadingParents] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [searchResults, setSearchResults] = useState<ApiCategory[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [selectedPath, setSelectedPath] = useState<ApiCategory[]>([]);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiCategory | null>(null);
  const [form, setForm] = useState<CategoryPayload>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [quickInputs, setQuickInputs] = useState<Record<string, string>>({});
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [autoSyncTried, setAutoSyncTried] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);

  const quickInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const childrenCacheRef = useRef(childrenCache);
  childrenCacheRef.current = childrenCache;
  const pendingScrollId = useRef<string | null>(null);

  const patchCache = useCallback((parentId: string | null, patch: (list: ApiCategory[]) => ApiCategory[]) => {
    const key = cacheKey(parentId);
    setChildrenCache((prev) => {
      const nextList = sortCategories(patch(prev[key] ?? []));
      return { ...prev, [key]: nextList };
    });
  }, []);

  const mergeFlat = useCallback((cat: ApiCategory) => {
    setAllCategoriesFlat((prev) => {
      if (prev.some((c) => c.id === cat.id)) {
        return prev.map((c) => (c.id === cat.id ? { ...c, ...cat } : c));
      }
      return [...prev, cat];
    });
  }, []);

  const ensureChildren = useCallback(
    async (parentId: string | null, force = false): Promise<ApiCategory[]> => {
      const key = cacheKey(parentId);
      if (!force && childrenCacheRef.current[key]) return childrenCacheRef.current[key]!;

      setLoadingParents((prev) => new Set(prev).add(key));
      try {
        const data = await listCategories({ parentId });
        setChildrenCache((prev) => ({ ...prev, [key]: data }));
        data.forEach(mergeFlat);
        return data;
      } finally {
        setLoadingParents((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [mergeFlat],
  );

  const loadRoots = useCallback(async (force = false) => {
    setError(null);
    if (!force) setInitialLoading(true);
    try {
      const roots = await listCategories({ parentId: null });
      setChildrenCache((prev) => ({ ...prev, [ROOT_KEY]: roots }));
      roots.forEach(mergeFlat);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في تحميل التصنيفات');
    } finally {
      setInitialLoading(false);
    }
  }, [mergeFlat]);

  const expandToCategory = useCallback(
    async (categoryId: string) => {
      try {
        const path = await getCategoryPath(categoryId);
        setSelectedPath(path);
        await ensureChildren(null);
        for (const node of path) {
          await ensureChildren(node.id);
        }
        pendingScrollId.current = categoryId;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'تعذر فتح مسار التصنيف');
      }
    },
    [ensureChildren],
  );

  const refreshKeepingPath = useCallback(async () => {
    const pathIds = selectedPath.map((p) => p.id);
    setChildrenCache({});
    await loadRoots(true);
    await ensureChildren(null, true);
    for (const id of pathIds) {
      await ensureChildren(id, true);
    }
  }, [ensureChildren, loadRoots, selectedPath]);

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
      setChildrenCache({});
      await loadRoots(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشلت مزامنة التصنيفات من المواد الحالية');
    } finally {
      setAutoSyncing(false);
    }
  }, [autoSyncing, loadRoots]);

  useEffect(() => {
    void loadRoots();
  }, [loadRoots]);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (searchDebounced.length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    void listCategories({ search: searchDebounced })
      .then((data) => {
        if (!cancelled) setSearchResults(data);
      })
      .catch(() => {
        if (!cancelled) setSearchResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchDebounced]);

  useEffect(() => {
    if (initialLoading || searchDebounced || autoSyncing || autoSyncTried) return;
    const roots = childrenCache[ROOT_KEY] ?? [];
    if (roots.length > 0) return;
    void (async () => {
      setAutoSyncTried(true);
      await syncCategoriesFromImportedItems();
    })().catch(() => undefined);
  }, [
    autoSyncTried,
    autoSyncing,
    childrenCache,
    initialLoading,
    searchDebounced,
    syncCategoriesFromImportedItems,
  ]);

  useEffect(() => {
    const id = pendingScrollId.current;
    if (!id) return;
    pendingScrollId.current = null;
    window.requestAnimationFrame(() => {
      document.getElementById(`cat-node-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, [childrenCache, selectedPath]);

  const byIdMap = useMemo(
    () => new Map(allCategoriesFlat.map((c) => [c.id, c])),
    [allCategoriesFlat],
  );

  const quickKey = (level: number, parentId: string | null) => `${level}:${parentId ?? 'root'}`;

  const selectAt = (level: number, cat: ApiCategory) => {
    setSelectedPath((prev) => [...prev.slice(0, level), cat]);
    if (level < MAX_COLUMNS - 1) {
      void ensureChildren(cat.id);
    }
  };

  const openEdit = (cat: ApiCategory) => {
    setEditTarget(cat);
    setForm({ code: cat.code, name: cat.name, parent_id: cat.parent_id });
    setSaveError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditTarget(null);
  };

  const buildQuickPayload = (level: number, value: string, parentId: string | null): CategoryPayload => {
    const text = value.trim();
    if (level === 2) {
      return { name: text, code: '', parent_id: parentId };
    }
    return { name: text, code: text, parent_id: parentId };
  };

  const afterCreate = useCallback(
    (created: ApiCategory, level: number, parentId: string | null, inputKey: string) => {
      patchCache(parentId, (list) => [...list, created]);
      mergeFlat(created);
      setSelectedPath((prev) => [...prev.slice(0, level), created]);
      setQuickInputs((prev) => ({ ...prev, [inputKey]: '' }));
      if (level < MAX_COLUMNS - 1) {
        void ensureChildren(created.id);
      }
      pendingScrollId.current = created.id;
      window.requestAnimationFrame(() => quickInputRefs.current[inputKey]?.focus());
    },
    [ensureChildren, mergeFlat, patchCache],
  );

  const handleQuickSave = async (level: number, parentId: string | null) => {
    const key = quickKey(level, parentId);
    const value = quickInputs[key]?.trim() ?? '';
    if (!value || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const created = await createCategory(buildQuickPayload(level, value, parentId));
      afterCreate(created, level, parentId, key);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      if (editTarget) {
        const updated = await updateCategory(editTarget.id, form);
        const parentId = editTarget.parent_id;
        patchCache(parentId, (list) => list.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
        mergeFlat(updated);
        setSelectedPath((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
      } else {
        const created = await createCategory(form);
        const parentId = form.parent_id ?? null;
        const level = parentId ? depthFromRoot(parentId, byIdMap) + 1 : 0;
        afterCreate(created, level, parentId, quickKey(level, parentId));
      }
      closeModal();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (cat: ApiCategory) => {
    try {
      const res = await toggleCategoryStatus(cat.id);
      patchCache(cat.parent_id, (list) =>
        list.map((c) => (c.id === cat.id ? { ...c, is_active: res.is_active } : c)),
      );
      mergeFlat({ ...cat, is_active: res.is_active });
    } catch {
      /* no-op */
    }
  };

  const columns: { level: number; title: string; parentId: string | null; nodes: ApiCategory[] }[] = [
    {
      level: 0,
      title: COLUMN_LABELS[0],
      parentId: null,
      nodes: childrenCache[ROOT_KEY] ?? [],
    },
  ];
  if (selectedPath[0]) {
    columns.push({
      level: 1,
      title: `${COLUMN_LABELS[1]} — ${selectedPath[0].name}`,
      parentId: selectedPath[0].id,
      nodes: childrenCache[cacheKey(selectedPath[0].id)] ?? [],
    });
  }
  if (selectedPath[1]) {
    columns.push({
      level: 2,
      title: `${COLUMN_LABELS[2]} — ${selectedPath[1].name}`,
      parentId: selectedPath[1].id,
      nodes: childrenCache[cacheKey(selectedPath[1].id)] ?? [],
    });
  }
  if (selectedPath[2]) {
    columns.push({
      level: 3,
      title: `${COLUMN_LABELS[3]} — ${selectedPath[2].name}`,
      parentId: selectedPath[2].id,
      nodes: childrenCache[cacheKey(selectedPath[2].id)] ?? [],
    });
  }

  const parentOptions = [
    { id: '', name: 'بلا أصل — مستوى اسم الخامة' },
    ...allCategoriesFlat
      .filter((c) => !editTarget || c.id !== editTarget.id)
      .filter((c) => depthFromRoot(c.id, byIdMap) <= 2)
      .map((c) => ({
        id: c.id,
        name: `${c.name} (${depthFromRoot(c.id, byIdMap) === 0 ? COLUMN_LABELS[0] : depthFromRoot(c.id, byIdMap) === 1 ? COLUMN_LABELS[1] : depthFromRoot(c.id, byIdMap) === 2 ? COLUMN_LABELS[2] : COLUMN_LABELS[3]})`,
      })),
  ];

  const breadcrumb = selectedPath.map((c) => c.name).join(' › ');

  return (
    <div className="space-y-6 h-[calc(100vh-100px)] flex flex-col">
      <div className="flex justify-between items-start shrink-0 gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">تصنيفات الأقمشة</h2>
          <p className="text-slate-500 mt-1">
            أربع مستويات: <strong>اسم خامة</strong> → <strong>كود الخامة</strong> → <strong>اللون</strong> →{' '}
            <strong>كود اللون</strong>. الإضافة السريعة لا تُخفِي القائمة ولا تُعيدك لبداية البحث.
          </p>
          {breadcrumb ? (
            <p className="text-xs text-indigo-700 mt-2 bg-indigo-50 inline-block px-2 py-1 rounded-lg">
              المسار الحالي: {breadcrumb}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              void syncCategoriesFromImportedItems();
            }}
            disabled={autoSyncing}
            className="px-3 py-2 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition"
            title="إنشاء التصنيفات من المواد الموجودة حاليًا"
          >
            {autoSyncing ? 'جاري المزامنة...' : 'مزامنة من المواد الحالية'}
          </button>
          <button
            type="button"
            onClick={() => {
              void refreshKeepingPath();
            }}
            className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
            title="تحديث"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <div className="relative max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              placeholder="بحث سريع للانتقال..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9 pl-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-56"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="shrink-0 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">{error}</div>
      )}
      {saveError && !isModalOpen && (
        <div className="shrink-0 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">{saveError}</div>
      )}
      {syncSummary && (
        <div className="shrink-0 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">
          {syncSummary}
        </div>
      )}

      {searchDebounced.length >= 2 ? (
        <div className="shrink-0 rounded-xl border border-indigo-200 bg-indigo-50/50 overflow-hidden">
          <div className="px-4 py-2 border-b border-indigo-100 flex justify-between items-center text-sm">
            <span className="font-medium text-indigo-900">نتائج البحث للانتقال — الأعمدة تبقى ظاهرة</span>
            <span className="text-indigo-600 text-xs">
              {searchLoading ? 'جاري البحث...' : `${searchResults.length.toLocaleString()} نتيجة`}
            </span>
          </div>
          <div className="max-h-36 overflow-y-auto divide-y divide-indigo-100">
            {searchLoading ? (
              <div className="p-4 text-center text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin inline text-indigo-500" />
              </div>
            ) : searchResults.length === 0 ? (
              <p className="p-4 text-sm text-slate-500 text-center">لا توجد نتائج</p>
            ) : (
              searchResults.slice(0, 40).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    void expandToCategory(r.id);
                    setSearch('');
                    setSearchDebounced('');
                    setSearchResults([]);
                  }}
                  className="w-full text-right px-4 py-2 hover:bg-white text-sm flex justify-between gap-2"
                >
                  <span className="font-medium text-slate-800">{r.name}</span>
                  {r.code && r.code !== r.name ? (
                    <span className="text-xs font-mono text-slate-400 shrink-0">{r.code}</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      <div className="flex-1 rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0">
        {initialLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          </div>
        ) : (
          <div className="flex-1 flex gap-4 overflow-x-auto p-6 bg-slate-50 items-start min-h-0" dir="rtl">
            {columns.map((col) => {
              const colKey = cacheKey(col.parentId);
              const colFilter = columnFilters[colKey] ?? '';
              const visibleNodes = filterNodes(col.nodes, colFilter);
              const colLoading = loadingParents.has(colKey);

              return (
                <div
                  key={col.level}
                  className="min-w-[280px] w-[280px] bg-white border border-slate-200 rounded-xl flex flex-col shrink-0 max-h-full shadow-sm overflow-hidden"
                >
                  <div className="p-3 bg-slate-100 border-b border-slate-200 shrink-0 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-slate-800 text-sm leading-snug">{col.title}</h3>
                      <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-bold shrink-0">
                        {col.nodes.length}
                      </span>
                    </div>
                    {col.nodes.length > 8 ? (
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2" />
                        <input
                          type="text"
                          value={colFilter}
                          onChange={(e) =>
                            setColumnFilters((prev) => ({ ...prev, [colKey]: e.target.value }))
                          }
                          placeholder={`تصفية ${COLUMN_LABELS[col.level]}...`}
                          className="w-full pr-7 pl-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/50 min-h-[200px] max-h-[520px]">
                    {colLoading && col.nodes.length === 0 ? (
                      <div className="py-8 text-center">
                        <Loader2 className="w-5 h-5 animate-spin inline text-indigo-500" />
                      </div>
                    ) : null}
                    {visibleNodes.map((node) => {
                      const isSelected = selectedPath[col.level]?.id === node.id;
                      return (
                        <div
                          key={node.id}
                          id={`cat-node-${node.id}`}
                          onClick={() => selectAt(col.level, node)}
                          className={`p-3 rounded-xl border transition-all cursor-pointer flex justify-between items-center group
                          ${
                            isSelected
                              ? 'bg-indigo-600 text-white border-indigo-700 shadow-md'
                              : `bg-white border-slate-200 hover:border-indigo-400 hover:shadow-sm ${!node.is_active ? 'opacity-50' : ''}`
                          }`}
                        >
                          <div>
                            <p className="font-bold text-sm">{node.name}</p>
                            {node.code && node.code !== node.name ? (
                              <p
                                className={`text-xs mt-0.5 font-mono ${isSelected ? 'text-indigo-200' : 'text-slate-400'}`}
                              >
                                {node.code}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-1">
                            {!isSelected && (
                              <div className="flex opacity-0 group-hover:opacity-100 transition-all">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEdit(node);
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition"
                                  title="تعديل"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleToggle(node);
                                  }}
                                  className={`p-1.5 rounded-lg transition ${node.is_active ? 'text-slate-400 hover:text-rose-500 hover:bg-rose-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                                  title={node.is_active ? 'تعطيل' : 'تفعيل'}
                                >
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
                    {colFilter && visibleNodes.length === 0 && col.nodes.length > 0 ? (
                      <p className="text-xs text-slate-400 text-center py-4">لا يطابق التصفية — غيّر النص أو امسحه</p>
                    ) : null}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleQuickSave(col.level, col.parentId);
                      }}
                      className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-2 focus-within:border-indigo-400 sticky bottom-0"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          ref={(el) => {
                            quickInputRefs.current[quickKey(col.level, col.parentId)] = el;
                          }}
                          type="text"
                          value={quickInputs[quickKey(col.level, col.parentId)] ?? ''}
                          onChange={(e) =>
                            setQuickInputs((prev) => ({
                              ...prev,
                              [quickKey(col.level, col.parentId)]: e.target.value,
                            }))
                          }
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
              );
            })}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-lg">{editTarget ? 'تعديل تصنيف' : 'إضافة تصنيف جديد'}</h3>
              <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              {saveError && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">{saveError}</p>}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الاسم</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    placeholder="أدخل الاسم..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">الكود</label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    dir="ltr"
                    placeholder="أدخل الكود..."
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">يجب إدخال الاسم أو الكود على الأقل واحداً.</p>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">المستوى / الأصل</label>
                <select
                  value={form.parent_id || ''}
                  onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value || null }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  {parentOptions.map((o) => (
                    <option key={o.id || 'root'} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">لا يمكن الإضافة تحت «كود اللون» — الحد أربع مستويات.</p>
              </div>
              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm flex items-center gap-2 disabled:opacity-60"
                >
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
