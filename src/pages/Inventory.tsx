import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, QrCode, Search, RefreshCw, Filter, ChevronDown,
  Eye, Pencil, MoveRight, ToggleLeft, Printer,
  Package, Ruler, Weight, FileSpreadsheet, Trash2,
  ArrowUp, ArrowDown, Barcode, X, Loader2,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  listFabricRolls,
  updateFabricRoll,
  updateFabricRollStatus,
  type FabricRollDto,
  type FabricRollListFilters,
  type RollStatus,
} from '../lib/api/fabricRollsApi';
import { listWarehouses, type ApiWarehouse } from '../lib/api/warehousesApi';
import { listFabricItems, updateFabricItem, type ApiFabricItem } from '../lib/api/fabricItemsApi';
import { getCategoryTree, type ApiCategory } from '../lib/api/fabricCategoriesApi';
import { resolveFabricClassification } from '../lib/api/fabricClassificationApi';
import { StockExcelImportModal } from './inventory/StockExcelImportModal';
import { restoreAccidentalInteractionLocks } from '../components/NonBlockingToast';
import {
  displayImportedColorCode,
  displayImportedColorName,
  displayImportedItemCode,
} from '../lib/importDisplay';
import { rollColorSwatch } from '../lib/colorDisplay';

// ─── Status helpers ──────────────────────────────────────────────────────────

const STATUS_LABELS: Record<RollStatus, string> = {
  AVAILABLE: 'متاح',
  RESERVED: 'محجوز',
  SOLD: 'مباع',
  DAMAGED: 'تالف',
  TRANSFERRED: 'منقول',
  INACTIVE: 'غير نشط',
};

const ALL_STATUSES: RollStatus[] = [
  'AVAILABLE', 'RESERVED', 'SOLD', 'DAMAGED', 'TRANSFERRED', 'INACTIVE',
];

/** عرض المخزون: افتراضيًا «متاح للبيع» فقط؛ «الكل» يُظهر الأرشيف والمباع. */
type InventoryScope = 'available' | 'sold' | 'inactive' | 'all';
type InventorySortableField = 'created_at' | 'item_name' | 'internal_code' | 'barcode' | 'color_name_ar';
type InventoryMaterialSort = { field: 'item_name' | 'internal_code'; dir: 'asc' | 'desc' };

const SCOPE_LABELS: Record<InventoryScope, string> = {
  available: 'المتاح للبيع',
  sold: 'المباع',
  inactive: 'غير النشط',
  all: 'الكل / الأرشيف',
};

// ─── Status change modal ─────────────────────────────────────────────────────

interface StatusModalProps {
  roll: FabricRollDto;
  onClose: () => void;
  onSave: (rollId: string, status: RollStatus, notes: string) => Promise<void>;
}

const StatusModal = ({ roll, onClose, onSave }: StatusModalProps) => {
  const [status, setStatus] = useState<RollStatus>(roll.status);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = async () => {
    if (status === roll.status) { onClose(); return; }
    setSaving(true); setErr('');
    try {
      await onSave(roll.id, status, notes);
      onClose();
    } catch (e: unknown) {
      setErr((e as { message?: string }).message ?? 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" dir="rtl">
        <div className="p-5 border-b border-slate-200">
          <h3 className="font-bold text-slate-900 text-lg">تغيير حالة الثوب</h3>
          <p className="text-sm text-slate-500 mt-1">الباركود: <span className="font-mono">{roll.barcode}</span></p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">الحالة الجديدة</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as RollStatus)}
              className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            >
              {ALL_STATUSES.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">ملاحظات</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
              placeholder="سبب تغيير الحالة..."
            />
          </div>
          {err && <p className="text-rose-600 text-sm font-bold">{err}</p>}
        </div>
        <div className="p-5 border-t border-slate-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition">إلغاء</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-bold disabled:opacity-50"
          >
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
};

interface DeactivateRollModalProps {
  roll: FabricRollDto;
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}

const DeactivateRollModal = ({ roll, saving, error, onClose, onConfirm }: DeactivateRollModalProps) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
    <div className="bg-white rounded-xl shadow-xl w-full max-w-md" dir="rtl">
      <div className="p-5 border-b border-slate-200">
        <h3 className="font-bold text-slate-900 text-lg">تأكيد تعطيل الثوب</h3>
        <p className="text-sm text-slate-500 mt-1">
          الباركود: <span className="font-mono">{roll.barcode}</span>
        </p>
      </div>
      <div className="p-5 space-y-3">
        <p className="text-sm font-medium text-slate-700">
          سيتم تعطيل الثوب وإخفاؤه من المتاح للبيع، وسيبقى محفوظاً في السجلات والحركات السابقة.
        </p>
        {error && <p className="text-rose-600 text-sm font-bold">{error}</p>}
      </div>
      <div className="p-5 border-t border-slate-200 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
        >
          إلغاء
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={saving}
          className="px-5 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition font-bold disabled:opacity-50"
        >
          {saving ? 'جاري التعطيل...' : 'تأكيد التعطيل'}
        </button>
      </div>
    </div>
  </div>
);

// ─── Stat card ───────────────────────────────────────────────────────────────

interface BulkDeactivateRollsModalProps {
  count: number;
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}

const BulkDeactivateRollsModal = ({ count, saving, error, onClose, onConfirm }: BulkDeactivateRollsModalProps) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
    <div className="bg-white rounded-xl shadow-xl w-full max-w-md" dir="rtl">
      <div className="p-5 border-b border-slate-200">
        <h3 className="font-bold text-slate-900 text-lg">تأكيد الحذف الجماعي</h3>
        <p className="text-sm text-slate-500 mt-1">
          عدد الأتواب المحددة: <span className="font-bold text-slate-900">{count.toLocaleString('en-US')}</span>
        </p>
      </div>
      <div className="p-5 space-y-3">
        <p className="text-sm font-medium text-slate-700">
          سيتم تعطيل الأتواب المحددة وإخفاؤها من المتاح للبيع، مع بقاء السجلات والحركات السابقة محفوظة.
        </p>
        {error && <p className="text-rose-600 text-sm font-bold">{error}</p>}
      </div>
      <div className="p-5 border-t border-slate-200 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
        >
          إلغاء
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={saving || count === 0}
          className="px-5 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition font-bold disabled:opacity-50 inline-flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? 'جاري الحذف...' : 'تأكيد الحذف'}
        </button>
      </div>
    </div>
  </div>
);

function findCategoryById(tree: ApiCategory[], id: string): ApiCategory | null {
  for (const node of tree) {
    if (node.id === id) return node;
    const inner = node.children?.length ? findCategoryById(node.children, id) : null;
    if (inner) return inner;
  }
  return null;
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }
  return unique;
}

function uniqueCategoryTree(rows: ApiCategory[]): ApiCategory[] {
  return uniqueById<ApiCategory>(rows).map((row) => ({
    ...row,
    children: row.children?.length ? uniqueCategoryTree(row.children) : [],
  }));
}

function activeCategoryChildren(parent: ApiCategory | null): ApiCategory[] {
  return uniqueById<ApiCategory>((parent?.children ?? []).filter((c) => c.is_active !== false));
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function findMatchingChild(parent: ApiCategory | null, value: string | null | undefined): ApiCategory | null {
  const q = normalizeText(value);
  if (!parent || !q) return null;
  return parent.children?.find((child) => (
    child.is_active !== false
    && (normalizeText(child.name) === q || normalizeText(child.code) === q)
  )) ?? null;
}

const inventoryCollator = new Intl.Collator(['ar', 'en'], {
  numeric: true,
  sensitivity: 'base',
});

function rollColorName(roll: FabricRollDto): string {
  return roll.color_name_ar ?? roll.color_name_tr ?? '';
}

function rollSortValue(roll: FabricRollDto, key: InventorySortableField): unknown {
  if (key === 'color_name_ar') return rollColorName(roll);
  return roll[key];
}

function compareRollValues(a: unknown, b: unknown, dir: 'asc' | 'desc'): number {
  const direction = dir === 'asc' ? 1 : -1;
  const aText = String(a ?? '').trim();
  const bText = String(b ?? '').trim();
  if (!aText && !bText) return 0;
  if (!aText) return 1;
  if (!bText) return -1;

  const aDate = Date.parse(aText);
  const bDate = Date.parse(bText);
  const maybeDates = /\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}/.test(aText + bText);
  if (maybeDates && Number.isFinite(aDate) && Number.isFinite(bDate)) {
    return (aDate - bDate) * direction;
  }

  return inventoryCollator.compare(aText, bText) * direction;
}

function sortInventoryRolls(
  rows: FabricRollDto[],
  sortBy: InventorySortableField,
  sortDir: 'asc' | 'desc',
  materialSort: InventoryMaterialSort,
): FabricRollDto[] {
  return [...rows].sort((a, b) => {
    if (sortBy === 'color_name_ar') {
      const material = compareRollValues(
        rollSortValue(a, materialSort.field),
        rollSortValue(b, materialSort.field),
        materialSort.dir,
      );
      if (material !== 0) return material;
      const secondaryMaterial = materialSort.field === 'item_name' ? 'internal_code' : 'item_name';
      const secondary = compareRollValues(rollSortValue(a, secondaryMaterial), rollSortValue(b, secondaryMaterial), 'asc');
      if (secondary !== 0) return secondary;
      const color = compareRollValues(rollColorName(a), rollColorName(b), sortDir);
      if (color !== 0) return color;
      const colorCode = compareRollValues(a.color_code, b.color_code, 'asc');
      if (colorCode !== 0) return colorCode;
      return compareRollValues(a.barcode, b.barcode, 'asc');
    }

    const primary = compareRollValues(rollSortValue(a, sortBy), rollSortValue(b, sortBy), sortDir);
    if (primary !== 0) return primary;
    if (sortBy === 'item_name' || sortBy === 'internal_code') {
      const secondaryKey = sortBy === 'item_name' ? 'internal_code' : 'item_name';
      const secondary = compareRollValues(rollSortValue(a, secondaryKey), rollSortValue(b, secondaryKey), 'asc');
      if (secondary !== 0) return secondary;
      const color = compareRollValues(rollColorName(a), rollColorName(b), 'asc');
      if (color !== 0) return color;
    }
    return compareRollValues(a.barcode, b.barcode, 'asc');
  });
}

interface EditRollModalProps {
  roll: FabricRollDto;
  onClose: () => void;
  onSaved: () => void;
}

const EditRollModal = ({ roll, onClose, onSaved }: EditRollModalProps) => {
  const [categoryTree, setCategoryTree] = useState<ApiCategory[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [catL1Id, setCatL1Id] = useState('');
  const [catL2Id, setCatL2Id] = useState('');
  const [catL3Id, setCatL3Id] = useState('');
  const [catL4Id, setCatL4Id] = useState('');
  const [lengthM, setLengthM] = useState(roll.length_m);
  const [widthCm, setWidthCm] = useState(roll.width_cm ?? '');
  const [gsm, setGsm] = useState(roll.gsm ?? '');
  const [actualWeightKg, setActualWeightKg] = useState(roll.actual_weight_kg ?? '');
  const [unitCost, setUnitCost] = useState(roll.unit_cost ?? '');
  const [batchNo, setBatchNo] = useState(roll.batch_no ?? '');
  const [containerNo, setContainerNo] = useState(roll.container_no ?? '');
  const [supplierRollRef, setSupplierRollRef] = useState(roll.supplier_roll_ref ?? '');
  const [notes, setNotes] = useState(roll.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setTreeLoading(true);
    getCategoryTree()
      .then((tree) => {
        if (cancelled) return;
        setCategoryTree(uniqueCategoryTree(tree));
        const level1 = tree.find((node) => (
          node.is_active !== false
          && (normalizeText(node.name) === normalizeText(roll.item_name)
            || normalizeText(node.code) === normalizeText(roll.item_name))
        )) ?? null;
        const level2 = findMatchingChild(level1, roll.internal_code ?? roll.supplier_code_item);
        const level3 = findMatchingChild(level2, roll.color_name_ar ?? roll.color_name_tr);
        const level4 = findMatchingChild(level3, roll.color_code);
        setCatL1Id(level1?.id ?? '');
        setCatL2Id(level2?.id ?? '');
        setCatL3Id(level3?.id ?? '');
        setCatL4Id(level4?.id ?? '');
      })
      .catch(() => {
        if (!cancelled) setErr('تعذر تحميل تصنيفات الخامات.');
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false);
      });
    return () => { cancelled = true; };
  }, [roll]);

  const level1Options = uniqueById<ApiCategory>(categoryTree.filter((c) => c.is_active !== false));
  const level2Options = activeCategoryChildren(catL1Id ? findCategoryById(categoryTree, catL1Id) : null);
  const level3Options = activeCategoryChildren(catL2Id ? findCategoryById(categoryTree, catL2Id) : null);
  const level4Options = activeCategoryChildren(catL3Id ? findCategoryById(categoryTree, catL3Id) : null);

  const handleSave = async () => {
    setSaving(true);
    setErr('');
    try {
      if (!catL1Id || !catL2Id) {
        setErr('اختاري اسم الخامة وكود الخامة قبل الحفظ. اللون وكود اللون اختياريان.');
        setSaving(false);
        return;
      }

      let itemId = roll.item_id;
      let colorId: string | null = roll.color_id;
      let variantId: string | null = roll.variant_id;

      if (catL1Id && catL2Id && catL3Id && catL4Id) {
        const resolved = await resolveFabricClassification({
          level1CategoryId: catL1Id,
          level2CategoryId: catL2Id,
          level3CategoryId: catL3Id,
          level4CategoryId: catL4Id,
          widthCm: widthCm ? Number(widthCm) : null,
          gsm: gsm ? Number(gsm) : null,
        });
        itemId = resolved.itemId;
        colorId = resolved.colorId;
        variantId = resolved.variantId;
      } else {
        colorId = null;
        variantId = null;
      }

      await updateFabricRoll(roll.id, {
        itemId,
        colorId,
        variantId,
        lengthM: Number(lengthM) || 0,
        widthCm: widthCm ? Number(widthCm) : null,
        gsm: gsm ? Number(gsm) : null,
        actualWeightKg: actualWeightKg ? Number(actualWeightKg) : null,
        unitCost: unitCost ? Number(unitCost) : null,
        batchNo: batchNo || null,
        containerNo: containerNo || null,
        supplierRollRef: supplierRollRef || null,
        notes: notes || null,
      });
      onSaved();
    } catch (e: unknown) {
      setErr((e as { message?: string }).message ?? 'تعذر حفظ تعديل التوب.');
    } finally {
      setSaving(false);
    }
  };

  const fieldCls = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" dir="rtl">
      <div className="my-6 w-full max-w-5xl overflow-hidden rounded-2xl bg-slate-50 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white p-6">
          <div>
            <h3 className="text-2xl font-black text-slate-900">تعديل خامة التوب مباشرة</h3>
            <p className="mt-1 text-sm text-slate-500">الباركود: <span className="font-mono">{roll.barcode}</span></p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[72vh] space-y-5 overflow-y-auto p-6">
          <section className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
            <h4 className="mb-4 text-base font-black text-slate-900">التصنيف المرتبط بالخامة</h4>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-sm font-bold text-slate-700">اسم الخامة</label>
                <select value={catL1Id} disabled={treeLoading} onChange={(e) => { setCatL1Id(e.target.value); setCatL2Id(''); setCatL3Id(''); setCatL4Id(''); }} className={fieldCls}>
                  <option value="">اختيار الخامة</option>
                  {level1Options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-bold text-slate-700">كود الخامة</label>
                <select value={catL2Id} disabled={!catL1Id} onChange={(e) => { setCatL2Id(e.target.value); setCatL3Id(''); setCatL4Id(''); }} className={fieldCls}>
                  <option value="">اختيار كود الخامة</option>
                  {level2Options.map((c) => <option key={c.id} value={c.id}>{c.code || c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-bold text-slate-700">اللون <span className="text-slate-400 font-normal">(اختياري)</span></label>
                <select value={catL3Id} disabled={!catL2Id} onChange={(e) => { setCatL3Id(e.target.value); setCatL4Id(''); }} className={fieldCls}>
                  <option value="">بدون لون</option>
                  {level3Options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-bold text-slate-700">كود اللون <span className="text-slate-400 font-normal">(اختياري)</span></label>
                <select value={catL4Id} disabled={!catL2Id} onChange={(e) => setCatL4Id(e.target.value)} className={fieldCls}>
                  <option value="">بدون كود لون</option>
                  {level4Options.map((c) => <option key={c.id} value={c.id}>{c.code || c.name}</option>)}
                </select>
              </div>
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h4 className="mb-4 text-base font-black text-slate-900">بيانات التوب السريعة</h4>
            <div className="grid gap-4 md:grid-cols-4">
              <div><label className="mb-1 block text-sm font-bold text-slate-700">الطول (م)</label><input type="number" value={lengthM} onChange={(e) => setLengthM(e.target.value)} step="0.001" className={fieldCls} dir="ltr" autoFocus /></div>
              <div><label className="mb-1 block text-sm font-bold text-slate-700">العرض (سم)</label><input type="number" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} step="0.1" className={fieldCls} dir="ltr" /></div>
              <div><label className="mb-1 block text-sm font-bold text-slate-700">GSM</label><input type="number" value={gsm} onChange={(e) => setGsm(e.target.value)} className={fieldCls} dir="ltr" /></div>
              <div><label className="mb-1 block text-sm font-bold text-slate-700">الوزن KG</label><input type="number" value={actualWeightKg} onChange={(e) => setActualWeightKg(e.target.value)} step="0.001" className={fieldCls} dir="ltr" /></div>
              <div><label className="mb-1 block text-sm font-bold text-slate-700">سعر التكلفة</label><input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} step="0.0001" className={fieldCls} dir="ltr" /></div>
              <div><label className="mb-1 block text-sm font-bold text-slate-700">رقم الدفعة</label><input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} className={fieldCls} /></div>
              <div><label className="mb-1 block text-sm font-bold text-slate-700">رقم الحاوية</label><input value={containerNo} onChange={(e) => setContainerNo(e.target.value)} className={fieldCls} /></div>
              <div><label className="mb-1 block text-sm font-bold text-slate-700">مرجع المورد</label><input value={supplierRollRef} onChange={(e) => setSupplierRollRef(e.target.value)} className={fieldCls} dir="ltr" /></div>
              <div className="md:col-span-4"><label className="mb-1 block text-sm font-bold text-slate-700">ملاحظات</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${fieldCls} resize-none`} /></div>
            </div>
          </section>
          {err && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{err}</div>}
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white p-5 sm:flex-row sm:justify-end">
          <button onClick={onClose} disabled={saving} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">إلغاء</button>
          <button onClick={handleSave} disabled={saving || treeLoading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-black text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'جاري الحفظ...' : 'حفظ التعديل'}
          </button>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
    <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
      {icon}
    </div>
    <div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-xl font-bold text-slate-900 mt-0.5">{value}</p>
    </div>
  </div>
);

// ─── Main Inventory page ─────────────────────────────────────────────────────

export const Inventory = () => {
  const navigate = useNavigate();

  const [rolls, setRolls] = useState<FabricRollDto[]>([]);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 500;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

   const [search, setSearch] = useState('');
   const [inventoryScope, setInventoryScope] = useState<InventoryScope>('available');
   const [filterWarehouseId, setFilterWarehouseId] = useState('');
   const [sortBy, setSortBy] = useState<InventorySortableField>('created_at');
   const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
   const [materialSort, setMaterialSort] = useState<InventoryMaterialSort>({ field: 'item_name', dir: 'asc' });
   const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [statusModal, setStatusModal] = useState<FabricRollDto | null>(null);
   const [editModal, setEditModal] = useState<FabricRollDto | null>(null);
   const [deactivateModal, setDeactivateModal] = useState<FabricRollDto | null>(null);
   const [deactivateSaving, setDeactivateSaving] = useState(false);
   const [deactivateError, setDeactivateError] = useState('');
   const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
   const [selectedRollIds, setSelectedRollIds] = useState<Set<string>>(new Set());
   const [bulkDeactivateOpen, setBulkDeactivateOpen] = useState(false);
   const [bulkDeactivateSaving, setBulkDeactivateSaving] = useState(false);
   const [bulkDeactivateError, setBulkDeactivateError] = useState('');
   const [excelImportOpen, setExcelImportOpen] = useState(false);
   const [importFollowUp, setImportFollowUp] = useState<{
     batchTag: string;
     createdRolls: number;
     createdItems: number;
     createdColors: number;
     supplierId: string | null;
     warehouseId: string;
   } | null>(null);
   const [showBulkBarcodeModal, setShowBulkBarcodeModal] = useState(false);

  // إحصائيات الصفحة الحالية فقط (مع توضيح نطاق العرض في التسميات)
  const stats = {
    count: total,
    meters: rolls.reduce((s, r) => s + parseFloat(r.length_m || '0'), 0),
    kg: rolls.reduce((s, r) => s + parseFloat(r.actual_weight_kg ?? r.calculated_weight_kg ?? '0'), 0),
  };
  const deletableRolls = rolls.filter((roll) => roll.status !== 'INACTIVE');
  const selectedRolls = rolls.filter((roll) => selectedRollIds.has(roll.id) && roll.status !== 'INACTIVE');
  const allVisibleSelected = deletableRolls.length > 0 && deletableRolls.every((roll) => selectedRollIds.has(roll.id));

  const fetchWarehouses = useCallback(async () => {
    try {
      const whs = await listWarehouses();
      setWarehouses(whs);
    } catch {
      // non-critical
    }
   }, []);

   const fetchRolls = useCallback(async () => {
      setLoading(true);
      setError('');
      try {
        const allRows: FabricRollDto[] = [];
        let currentPage = 1;
        let expectedTotal = 0;
        for (;;) {
          const filters: FabricRollListFilters = {
            search: search || undefined,
            warehouseId: filterWarehouseId || undefined,
            page: currentPage,
            pageSize: PAGE_SIZE,
          };
          if (inventoryScope === 'available') {
            filters.onlyAvailable = true;
          } else if (inventoryScope === 'sold') {
            filters.status = 'SOLD';
          } else if (inventoryScope === 'inactive') {
            filters.status = 'INACTIVE';
          }
          const res = await listFabricRolls(filters);
          expectedTotal = res.total;
          allRows.push(...res.data);
          if (res.data.length < PAGE_SIZE || allRows.length >= expectedTotal) break;
          currentPage += 1;
        }

        const sortedRows = sortInventoryRolls(allRows, sortBy, sortDir, materialSort);

       const uniqueRows = uniqueById(sortedRows);
       setRolls(uniqueRows);
       setTotal(Math.min(expectedTotal || uniqueRows.length, uniqueRows.length));
     } catch (e: unknown) {
       setError((e as { message?: string }).message ?? 'تعذر تحميل بيانات المخزون');
     } finally {
       setLoading(false);
     }
   }, [search, inventoryScope, filterWarehouseId, sortBy, sortDir, materialSort]);

  useEffect(() => {
    fetchWarehouses();
  }, [fetchWarehouses]);

  useEffect(() => {
    fetchRolls();
  }, [search, inventoryScope, filterWarehouseId, sortBy, sortDir, fetchRolls]);

  useEffect(() => {
    setSelectedRollIds((prev) => {
      if (prev.size === 0) return prev;
      const visibleIds = new Set(rolls.map((roll) => roll.id));
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rolls]);

  const handleSort = (field: InventorySortableField) => {
    if (sortBy === field) {
      setSortDir(prev => {
        const next = prev === 'asc' ? 'desc' : 'asc';
        if (field === 'item_name' || field === 'internal_code') {
          setMaterialSort({ field, dir: next });
        }
        return next;
      });
    } else {
      setSortBy(field);
      setSortDir('asc');
      if (field === 'item_name' || field === 'internal_code') {
        setMaterialSort({ field, dir: 'asc' });
      }
    }
  };

  const handleStatusSave = async (rollId: string, status: RollStatus, notes: string) => {
    await updateFabricRollStatus(rollId, status, notes);
    fetchRolls();
  };

  const handleDeactivateRoll = async (roll: FabricRollDto) => {
    if (roll.status === 'INACTIVE') return;
    setDeactivateError('');
    setDeactivateModal(roll);
  };

  const closeDeactivateModal = () => {
    if (deactivateSaving) return;
    setDeactivateModal(null);
    setDeactivateError('');
    window.setTimeout(restoreAccidentalInteractionLocks, 0);
  };

  const confirmDeactivateRoll = async () => {
    if (!deactivateModal) return;
    setDeactivateSaving(true);
    setDeactivateError('');
    try {
      await updateFabricRollStatus(deactivateModal.id, 'INACTIVE', 'تعطيل من شاشة المخزون');
      setDeactivateModal(null);
      await fetchRolls();
    } catch (e: unknown) {
      setDeactivateError((e as { message?: string }).message ?? 'تعذر تعطيل الثوب');
    } finally {
      setDeactivateSaving(false);
      window.setTimeout(restoreAccidentalInteractionLocks, 0);
    }
  };

  const startBulkDeleteMode = () => {
    setBulkDeleteMode(true);
    setSelectedRollIds(new Set());
    setBulkDeactivateError('');
  };

  const cancelBulkDeleteMode = () => {
    if (bulkDeactivateSaving) return;
    setBulkDeleteMode(false);
    setSelectedRollIds(new Set());
    setBulkDeactivateOpen(false);
    setBulkDeactivateError('');
    window.setTimeout(restoreAccidentalInteractionLocks, 0);
  };

  const toggleRollSelection = (rollId: string) => {
    setSelectedRollIds((prev) => {
      const next = new Set(prev);
      if (next.has(rollId)) next.delete(rollId);
      else next.add(rollId);
      return next;
    });
  };

  const toggleAllVisibleRolls = () => {
    setSelectedRollIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        deletableRolls.forEach((roll) => next.delete(roll.id));
      } else {
        deletableRolls.forEach((roll) => next.add(roll.id));
      }
      return next;
    });
  };

  const confirmBulkDeactivateRolls = async () => {
    if (selectedRolls.length === 0) return;
    setBulkDeactivateSaving(true);
    setBulkDeactivateError('');
    const failures: string[] = [];
    try {
      for (const roll of selectedRolls) {
        try {
          await updateFabricRollStatus(roll.id, 'INACTIVE', 'حذف جماعي من شاشة المخزون');
        } catch (e: unknown) {
          failures.push(roll.barcode || roll.roll_no || roll.id);
        }
      }
      if (failures.length > 0) {
        setBulkDeactivateError(`تعذر حذف ${failures.length.toLocaleString('en-US')} توب. أول باركود: ${failures[0]}`);
      } else {
        setBulkDeactivateOpen(false);
        setBulkDeleteMode(false);
        setSelectedRollIds(new Set());
      }
      await fetchRolls();
    } finally {
      setBulkDeactivateSaving(false);
      window.setTimeout(restoreAccidentalInteractionLocks, 0);
    }
  };

return (
    <div className="w-full space-y-4" dir="rtl">
      {importFollowUp && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-emerald-950">
            <p className="font-black">تم تنفيذ الاستيراد الأولي وظهرت المواد في المخزون بنجاح.</p>
            <p className="mt-1 font-medium">
              الأتواب المضافة: {importFollowUp.createdRolls.toLocaleString('en-US')} | الخامات الجديدة: {importFollowUp.createdItems.toLocaleString('en-US')} | الألوان الجديدة: {importFollowUp.createdColors.toLocaleString('en-US')}
            </p>
            <p className="mt-1 text-emerald-800">
              يمكنك الآن مراجعة المواد داخل المخزون، ثم استكمال الخطوات اللاحقة مثل التسعير الجماعي عند الحاجة.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                const q = new URLSearchParams();
                q.set('mode', 'import');
                q.set('batchTag', importFollowUp.batchTag);
                if (importFollowUp.supplierId) q.set('supplierId', importFollowUp.supplierId);
                if (importFollowUp.warehouseId) q.set('warehouseId', importFollowUp.warehouseId);
                navigate(`/inventory/bulk-pricing?${q.toString()}`);
              }}
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition font-medium"
            >
              استكمال الخطوات
            </button>
            <button
              type="button"
              onClick={() => setImportFollowUp(null)}
              className="bg-white border border-emerald-200 text-emerald-800 px-4 py-2 rounded-lg hover:bg-emerald-100 transition font-medium"
            >
              إخفاء
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">أتواب الأقمشة</h2>
          <p className="text-slate-500 mt-1">
            العرض الافتراضي: <span className="font-bold text-slate-700">المتاح للبيع فقط</span> (حالة متاح + طول أكبر من صفر). استخدم «الكل / الأرشيف» لمراجعة المباع والصفرية.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/inventory/labels"
            className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition font-medium text-sm"
          >
            <QrCode className="w-4 h-4" />
            طباعة اللصاقات
          </Link>
          <button
            type="button"
            onClick={bulkDeleteMode ? cancelBulkDeleteMode : startBulkDeleteMode}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition font-bold text-sm shadow-sm ${
              bulkDeleteMode
                ? 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                : 'bg-rose-600 text-white hover:bg-rose-700'
            }`}
          >
            {bulkDeleteMode ? <X className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
            {bulkDeleteMode ? 'إلغاء الحذف' : 'حذف جماعي'}
          </button>
          {/*
            "إضافة ثوب جديد" مُخفي حسب طلب المالك (مكرر مع تدفق الاستيراد).
            المسار /inventory/rolls/new + صفحة CreateRoll مُحتفظ بهما كما هما.
          */}
          {false && (
            <Link
              to="/inventory/rolls/new"
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition font-bold text-sm"
            >
              <Plus className="w-4 h-4" />
              إضافة ثوب جديد
                </Link>
              )}
              <button
                type="button"
                onClick={() => setShowBulkBarcodeModal(true)}
                className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700 transition font-bold text-sm shadow-sm"
              >
                <Barcode className="w-4 h-4" />
                توليد باركود جماعي
              </button>
              <button
                type="button"
                onClick={() => setExcelImportOpen(true)}
                className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700 transition font-bold text-sm shadow-sm"
              >
                <FileSpreadsheet className="w-4 h-4" />
                استيراد من ملف Excel
              </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={<Package className="w-5 h-5" />}
          label={`عدد الأدواب (حسب الفلتر: ${SCOPE_LABELS[inventoryScope]})`}
          value={total.toLocaleString()}
        />
        <StatCard
          icon={<Ruler className="w-5 h-5" />}
          label={`مجموع الأمتار — الصفحة الحالية (${SCOPE_LABELS[inventoryScope]})`}
          value={stats.meters.toFixed(2)}
        />
        <StatCard
          icon={<Weight className="w-5 h-5" />}
          label={`مجموع الكيلوغرامات — الصفحة الحالية (${SCOPE_LABELS[inventoryScope]})`}
          value={stats.kg.toFixed(2)}
        />
      </div>

      {/* Search + filters - مضمن في الشريط العلوي */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="بحث بالباركود، اسم الخامة، كود المورد، اسم اللون..."
                className="w-full pr-9 pl-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">ترتيب:</span>
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg p-1">
              <button
                onClick={() => { setSortBy('created_at'); setSortDir('desc'); }}
                className={`px-2.5 py-1 rounded text-xs font-bold transition ${
                  sortBy === 'created_at' && sortDir === 'desc'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                الأحدث
              </button>
              <button
                onClick={() => { setSortBy('created_at'); setSortDir('asc'); }}
                className={`px-2.5 py-1 rounded text-xs font-bold transition ${
                  sortBy === 'created_at' && sortDir === 'asc'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                الأقدم
              </button>
              <div className="w-px h-4 bg-slate-300 mx-1" />
              <button
                onClick={() => { setSortBy('item_name'); setSortDir('asc'); setMaterialSort({ field: 'item_name', dir: 'asc' }); }}
                className={`px-2.5 py-1 rounded text-xs font-bold transition ${
                  sortBy === 'item_name' && sortDir === 'asc'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                اسم (أ←ي)
              </button>
              <button
                onClick={() => { setSortBy('item_name'); setSortDir('desc'); setMaterialSort({ field: 'item_name', dir: 'desc' }); }}
                className={`px-2.5 py-1 rounded text-xs font-bold transition ${
                  sortBy === 'item_name' && sortDir === 'desc'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                اسم (ي←أ)
              </button>
              <div className="w-px h-4 bg-slate-300 mx-1" />
              <button
                onClick={() => { setSortBy('internal_code'); setSortDir('asc'); setMaterialSort({ field: 'internal_code', dir: 'asc' }); }}
                className={`px-2.5 py-1 rounded text-xs font-bold transition ${
                  sortBy === 'internal_code' && sortDir === 'asc'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                كود تصاعدي
              </button>
              <button
                onClick={() => { setSortBy('barcode'); setSortDir('asc'); }}
                className={`px-2.5 py-1 rounded text-xs font-bold transition ${
                  sortBy === 'barcode' && sortDir === 'asc'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                باركود تصاعدي
              </button>
            </div>
          </div>
          <button
            onClick={() => setShowFilters(f => !f)}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-100 transition text-sm font-medium"
          >
            <Filter className="w-3 h-3" />
            فلاتر
            <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={() => fetchRolls()}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-100 transition text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>

        {showFilters && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 mt-2">
            <label className="text-xs font-bold text-slate-600 whitespace-nowrap">نطاق العرض</label>
            <select
              value={inventoryScope}
              onChange={e => setInventoryScope(e.target.value as InventoryScope)}
              className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 text-sm min-w-[180px]"
            >
              <option value="available">{SCOPE_LABELS.available}</option>
              <option value="sold">{SCOPE_LABELS.sold}</option>
              <option value="inactive">{SCOPE_LABELS.inactive}</option>
              <option value="all">{SCOPE_LABELS.all}</option>
            </select>
            <select
              value={filterWarehouseId}
              onChange={e => setFilterWarehouseId(e.target.value)}
              className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 text-sm"
            >
              <option value="">كل المستودعات</option>
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        )}
</div>

      {/* Error */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 font-bold text-sm">
          {error}
        </div>
      )}

      {bulkDeleteMode && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-rose-950">
            <p className="font-black">وضع الحذف الجماعي مفعل</p>
            <p className="mt-0.5 text-rose-700">
              حدد الأتواب المطلوبة من الجدول ثم اضغط تأكيد الحذف. المحدد حاليا: {selectedRolls.length.toLocaleString('en-US')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={toggleAllVisibleRolls}
              disabled={deletableRolls.length === 0}
              className="px-4 py-2 bg-white border border-rose-200 text-rose-800 rounded-lg hover:bg-rose-100 transition text-sm font-bold disabled:opacity-50"
            >
              {allVisibleSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل الظاهر'}
            </button>
            <button
              type="button"
              onClick={() => setBulkDeactivateOpen(true)}
              disabled={selectedRolls.length === 0}
              className="px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition text-sm font-bold disabled:opacity-50"
            >
              تأكيد الحذف ({selectedRolls.length.toLocaleString('en-US')})
            </button>
            <button
              type="button"
              onClick={cancelBulkDeleteMode}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition text-sm font-bold"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {bulkDeleteMode && (
                  <th className="text-center py-3 px-3 font-bold text-slate-600 whitespace-nowrap w-12">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisibleRolls}
                      disabled={deletableRolls.length === 0}
                      className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                      aria-label="تحديد كل الأتواب الظاهرة"
                    />
                  </th>
                )}
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">
                  <button
                    onClick={() => handleSort('barcode')}
                    className="flex items-center gap-1 hover:text-indigo-600 transition-colors cursor-pointer"
                  >
                    الباركود
                    {sortBy === 'barcode' && (
                      sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    )}
                  </button>
                </th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap min-w-[220px]">
                  <button
                    onClick={() => handleSort('item_name')}
                    className="flex items-center gap-1 hover:text-indigo-600 transition-colors cursor-pointer"
                  >
                    اسم خامة
                    {sortBy === 'item_name' && (
                      sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    )}
                  </button>
                </th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">
                  <button
                    onClick={() => handleSort('internal_code')}
                    className="flex items-center gap-1 hover:text-indigo-600 transition-colors cursor-pointer"
                  >
                    كود خامة
                    {sortBy === 'internal_code' && (
                      sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    )}
                  </button>
                </th>
                <th className="text-right py-3 px-4 font-bold text-slate-600">
                  <button
                    onClick={() => handleSort('color_name_ar')}
                    className="flex items-center gap-1 hover:text-indigo-600 transition-colors cursor-pointer"
                  >
                    اللون
                    {sortBy === 'color_name_ar' && (
                      sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    )}
                  </button>
                </th>
                <th className="text-right py-3 px-4 font-bold text-slate-600">كود اللون</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">الطول</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">وزن KG</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600">المستودع</th>
                <th className="text-right py-3 px-4 font-bold text-slate-600">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={bulkDeleteMode ? 10 : 9} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                    جاري التحميل...
                  </td>
                </tr>
              )}
               {!loading && rolls.length === 0 && (
                 <tr>
                   <td colSpan={bulkDeleteMode ? 10 : 9} className="py-16 text-center">
                     <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                     <p className="text-slate-400 font-bold">لا توجد أتواب في المخزون</p>
                     <p className="text-slate-400 text-xs mt-1">
                       {search || filterWarehouseId || inventoryScope !== 'available'
                         ? 'جرب تعديل معايير البحث أو نطاق العرض'
                         : 'استورد أول ملف Excel للبدء'}
                     </p>
                      {!search && !filterWarehouseId && inventoryScope === 'available' && (
                        <button
                          type="button"
                          onClick={() => setExcelImportOpen(true)}
                          className="mt-4 inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition text-sm font-bold"
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                          استيراد من ملف Excel
                        </button>
                      )}
                  </td>
                </tr>
              )}
              {!loading && rolls.length > 0 && rolls.map(roll => {
                const weight = roll.actual_weight_kg ?? roll.calculated_weight_kg ?? '0';
                const isSelected = selectedRollIds.has(roll.id);
                const canSelect = roll.status !== 'INACTIVE';
                const colorName = displayImportedColorName(roll.color_name_ar || roll.color_name_tr);
                const colorSwatch = rollColorSwatch(roll);
                const colorCodeDisplay = displayImportedColorCode(roll.color_code);
                const itemCodeDisplay = displayImportedItemCode(roll);
                return (
                  <tr
                    key={roll.id}
                    className={`border-b border-slate-100 hover:bg-slate-50/60 transition ${
                      isSelected ? 'bg-rose-50/60' :
                      roll.status === 'SOLD' || parseFloat(roll.length_m || '0') <= 0
                        ? 'bg-slate-50/80'
                        : ''
                    }`}
                  >
                    {bulkDeleteMode && (
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!canSelect}
                          onChange={() => toggleRollSelection(roll.id)}
                          className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 disabled:opacity-40"
                          aria-label={`تحديد الثوب ${roll.barcode}`}
                        />
                      </td>
                    )}
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-800">{roll.barcode}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                            roll.status === 'AVAILABLE' ? 'bg-emerald-50 text-emerald-700' :
                            roll.status === 'RESERVED' ? 'bg-amber-50 text-amber-700' :
                            roll.status === 'SOLD' ? 'bg-indigo-50 text-indigo-700' :
                            roll.status === 'DAMAGED' ? 'bg-rose-50 text-rose-700' :
                            roll.status === 'TRANSFERRED' ? 'bg-sky-50 text-sky-700' :
                            'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {STATUS_LABELS[roll.status]}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-slate-900 font-medium">{roll.item_name ?? '—'}</td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                      {itemCodeDisplay || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">
                      <div className="flex items-center gap-2">
                        {colorSwatch && (
                          <span
                            className="inline-block w-3 h-3 rounded-full border border-slate-200 shrink-0"
                            style={{ backgroundColor: colorSwatch }}
                          />
                        )}
                        <span>{colorName}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-600">
                      {colorCodeDisplay}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                      {parseFloat(roll.length_m || '0').toFixed(2)} م
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                      {parseFloat(weight).toFixed(2)} كغ
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">{roll.warehouse_name ?? '—'}</td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title="عرض التفاصيل"
                          onClick={() => navigate(`/inventory/rolls/${roll.id}`)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title="تعديل"
                          onClick={() => setEditModal(roll)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title="نقل"
                          onClick={() => navigate(`/inventory/rolls/${roll.id}/move`)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition"
                        >
                          <MoveRight className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title="تغيير الحالة"
                          onClick={() => setStatusModal(roll)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 transition"
                        >
                          <ToggleLeft className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title="طباعة لصاقة"
                          onClick={() => navigate(`/inventory/labels?rollId=${roll.id}`)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        {roll.status !== 'INACTIVE' && (
                          <button
                            type="button"
                            title="تعطيل"
                            onClick={() => handleDeactivateRoll(roll)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editModal && (
        <EditRollModal
          roll={editModal}
          onClose={() => {
            setEditModal(null);
            window.setTimeout(restoreAccidentalInteractionLocks, 0);
          }}
          onSaved={() => {
            setEditModal(null);
            fetchRolls();
            window.setTimeout(restoreAccidentalInteractionLocks, 0);
          }}
        />
      )}

      {/* Status change modal */}
      {statusModal && (
        <StatusModal
          roll={statusModal}
          onClose={() => {
            setStatusModal(null);
            window.setTimeout(restoreAccidentalInteractionLocks, 0);
          }}
          onSave={handleStatusSave}
        />
      )}

      {deactivateModal && (
        <DeactivateRollModal
          roll={deactivateModal}
          saving={deactivateSaving}
          error={deactivateError}
          onClose={closeDeactivateModal}
          onConfirm={confirmDeactivateRoll}
        />
      )}

      {bulkDeactivateOpen && (
        <BulkDeactivateRollsModal
          count={selectedRolls.length}
          saving={bulkDeactivateSaving}
          error={bulkDeactivateError}
          onClose={() => {
            if (bulkDeactivateSaving) return;
            setBulkDeactivateOpen(false);
            setBulkDeactivateError('');
            window.setTimeout(restoreAccidentalInteractionLocks, 0);
          }}
          onConfirm={confirmBulkDeactivateRolls}
        />
      )}

      {/* Excel import modal */}
      <StockExcelImportModal
        open={excelImportOpen}
        onClose={() => setExcelImportOpen(false)}
        onImported={(result) => {
          setExcelImportOpen(false);
          setImportFollowUp({
            batchTag: result.batchTag,
            createdRolls: result.createdRolls,
            createdItems: result.createdItems,
            createdColors: result.createdColors,
            supplierId: result.supplierId,
            warehouseId: result.warehouseId,
          });
          fetchRolls();
        }}
      />

      {/* Bulk barcode modal */}
      <BulkBarcodeModal
        open={showBulkBarcodeModal}
        onClose={() => setShowBulkBarcodeModal(false)}
        onSuccess={() => fetchRolls()}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Barcode Modal
// ─────────────────────────────────────────────────────────────────────────────

interface BulkBarcodeModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// `ApiFabricItem` لا يُصرّح بحقل `barcode` في الواجهة الحالية، لكنه موجود في
// قاعدة البيانات وتُرجعه الـ API عند توفره. نستخدم نوعًا موسّعًا محليًا حتى
// يبقى ضبط TypeScript صارمًا دون تعطيل المنطق.
type FabricItemWithBarcode = ApiFabricItem & { barcode?: string | null };

function handleApiError(err: unknown, fallback: string): string {
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
        setError(handleApiError(err, 'فشل تحميل الخامات'));
      } finally {
        setLoading(false);
      }
    };
    fetchItems();
  }, [open]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
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
      setSelectedIds(new Set(itemsWithoutBarcode.map((it) => it.id)));
    }
  };

  const generateAndSave = async () => {
    if (selectedIds.size === 0) return;
    setGenerating(true);
    setError(null);
    try {
      for (const item of itemsWithoutBarcode.filter((it) => selectedIds.has(it.id))) {
        const newBarcode = `AUTO-${item.id.slice(0, 8)}`;
        // `barcode` ليس مُعلنًا في `FabricItemPayload` حاليًا لكنه مدعوم على الـ backend،
        // لذلك نمرّره عبر cast واحد محدود لتفادي تعطيل الـ TypeScript.
        await updateFabricItem(
          item.id,
          { barcode: newBarcode } as unknown as Parameters<typeof updateFabricItem>[1],
        );
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(handleApiError(err, 'فشل حفظ الباركودات'));
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
            <p className="text-xs text-slate-500 mt-1">
              الخامات التالية ليس لها باركود: {itemsWithoutBarcode.length}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {error && (
            <p className="mb-3 text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">{error}</p>
          )}

          {loading ? (
            <div className="py-8 text-center text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
            </div>
          ) : itemsWithoutBarcode.length === 0 ? (
            <p className="py-8 text-center text-slate-500">جميع الخامات لديها باركود.</p>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <button
                  onClick={selectAll}
                  className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  {selectedIds.size === itemsWithoutBarcode.length ? 'إلغاء الكل' : 'تحديد الكل'}
                </button>
                <span className="text-xs text-slate-500">
                  تم تحديد {selectedIds.size} من {itemsWithoutBarcode.length}
                </span>
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
                  {itemsWithoutBarcode.map((item) => (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-50 cursor-pointer ${
                        selectedIds.has(item.id) ? 'bg-indigo-50/50' : ''
                      }`}
                      onClick={() => toggleSelect(item.id)}
                    >
                      <td className="px-4 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-600">
                        {item.internal_code}
                      </td>
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
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
          >
            إلغاء
          </button>
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
