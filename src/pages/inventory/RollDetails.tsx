import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowRight, RefreshCw, Pencil, MoveRight, ToggleLeft, Printer,
  Save, X, Package,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getFabricRoll,
  updateFabricRoll,
  updateFabricRollStatus,
  moveFabricRoll,
  type FabricRollDto,
  type InventoryMovementDto,
  type RollStatus,
} from '../../lib/api/fabricRollsApi';
import { listWarehouses, listLocations, type ApiWarehouse, type ApiWarehouseLocation } from '../../lib/api/warehousesApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { displayImportedColorCode, displayImportedColorName } from '../../lib/importDisplay';

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<RollStatus, string> = {
  AVAILABLE:   'متاح',
  RESERVED:    'محجوز',
  SOLD:        'مباع',
  DAMAGED:     'تالف',
  TRANSFERRED: 'منقول',
  INACTIVE:    'غير نشط',
};
const STATUS_COLORS: Record<RollStatus, string> = {
  AVAILABLE:   'bg-emerald-100 text-emerald-800 border-emerald-200',
  RESERVED:    'bg-amber-100 text-amber-800 border-amber-200',
  SOLD:        'bg-slate-100 text-slate-600 border-slate-200',
  DAMAGED:     'bg-rose-100 text-rose-700 border-rose-200',
  TRANSFERRED: 'bg-blue-100 text-blue-700 border-blue-200',
  INACTIVE:    'bg-slate-100 text-slate-400 border-slate-200',
};
const StatusBadge = ({ status }: { status: RollStatus }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${STATUS_COLORS[status] ?? ''}`}>
    {STATUS_LABELS[status] ?? status}
  </span>
);

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  OPENING:              'رصيد افتتاحي',
  PURCHASE_RECEIPT:     'استلام مشتريات',
  MANUAL_CREATE:        'إضافة يدوية',
  TRANSFER_OUT:         'مناقلة (خارج)',
  TRANSFER_IN:          'مناقلة (داخل)',
  RESERVE:              'حجز',
  RELEASE_RESERVATION:  'رفع الحجز',
  SALE:                 'بيع',
  RETURN:               'إرجاع',
  ADJUSTMENT:           'تسوية',
  DAMAGE:               'تالف',
  STATUS_CHANGE:        'تغيير حالة',
};

// ─── Data row ─────────────────────────────────────────────────────────────────

const DataRow = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <div className="flex flex-col sm:flex-row sm:items-start gap-1 py-2.5 border-b border-slate-100 last:border-0">
    <span className="text-sm text-slate-500 sm:w-44 shrink-0 font-medium">{label}</span>
    <span className="text-sm text-slate-900 font-medium">{value ?? <span className="text-slate-300">—</span>}</span>
  </div>
);

// ─── Edit modal ────────────────────────────────────────────────────────────────

interface EditModalProps {
  roll: FabricRollDto;
  suppliers: ApiSupplier[];
  warehouses: ApiWarehouse[];
  onClose: () => void;
  onSaved: () => void;
}
const EditModal = ({ roll, suppliers, warehouses, onClose, onSaved }: EditModalProps) => {
  const [locations, setLocations] = useState<ApiWarehouseLocation[]>([]);
  const [supplierId, setSupplierId] = useState(roll.supplier_id ?? '');
  const [locationId, setLocationId] = useState(roll.location_id ?? '');
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
    if (roll.warehouse_id) {
      listLocations(roll.warehouse_id).then(setLocations).catch(() => setLocations([]));
    }
  }, [roll.warehouse_id]);

  const handleSave = async () => {
    setSaving(true); setErr('');
    try {
      await updateFabricRoll(roll.id, {
        supplierId: supplierId || null,
        locationId: locationId || null,
        lengthM: parseFloat(lengthM) || undefined,
        widthCm: widthCm ? parseFloat(String(widthCm)) : null,
        gsm: gsm ? parseFloat(String(gsm)) : null,
        actualWeightKg: actualWeightKg ? parseFloat(String(actualWeightKg)) : null,
        unitCost: unitCost ? parseFloat(String(unitCost)) : null,
        batchNo: batchNo || null,
        containerNo: containerNo || null,
        supplierRollRef: supplierRollRef || null,
        notes: notes || null,
      });
      onSaved();
    } catch (e: unknown) {
      setErr((e as { message?: string }).message ?? 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10';
  const primaryInputCls = 'w-full rounded-xl border bg-white px-3 py-4 text-center font-mono text-3xl font-black shadow-sm focus:outline-none focus:ring-4';
  const displayValue = (value?: React.ReactNode) => value || <span className="text-slate-400">—</span>;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto" dir="rtl">
      <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-5xl my-6 overflow-hidden">
        <div className="p-6 border-b border-slate-200 bg-white flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-1 rounded-2xl bg-indigo-50 p-3 text-indigo-600">
              <Package className="w-6 h-6" />
            </div>
            <div>
          <h3 className="font-bold text-slate-900">تعديل بيانات الثوب</h3>
              <p className="mt-1 text-sm text-slate-500">شاشة مبسطة بنفس روح إنشاء مادة جديدة للتعديل السريع.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-5 max-h-[72vh] overflow-y-auto">
          <div className="grid gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-xs font-bold text-indigo-500">الباركود</div>
              <div className="mt-1 font-mono text-sm font-black text-slate-900" dir="ltr">{roll.barcode}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-indigo-500">الخامة</div>
              <div className="mt-1 text-sm font-black text-slate-900">{displayValue(roll.item_name)}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-indigo-500">كود الخامة</div>
              <div className="mt-1 font-mono text-sm font-black text-slate-900" dir="ltr">{displayValue(roll.internal_code ?? roll.supplier_code_item)}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-indigo-500">اللون</div>
              <div className="mt-1 text-sm font-black text-slate-900">{displayValue(roll.color_name_ar ?? roll.color_code)}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h4 className="mb-4 text-base font-black text-slate-900">القياسات الأساسية</h4>
            <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">المورد</label>
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className={inputCls}>
              <option value="">— بدون —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">الموقع</label>
            <select value={locationId} onChange={e => setLocationId(e.target.value)} className={inputCls}>
              <option value="">— بدون —</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">الطول (م)</label>
            <input type="number" value={lengthM} onChange={e => setLengthM(e.target.value)} step="0.001" className={`${primaryInputCls} border-indigo-300 text-indigo-700 focus:border-indigo-500 focus:ring-indigo-500/10`} dir="ltr" autoFocus />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">العرض (سم)</label>
            <input type="number" value={widthCm} onChange={e => setWidthCm(e.target.value)} step="0.1" className={inputCls} dir="ltr" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">GSM</label>
            <input type="number" value={gsm} onChange={e => setGsm(e.target.value)} className={inputCls} dir="ltr" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">الوزن الفعلي (كجم)</label>
            <input type="number" value={actualWeightKg} onChange={e => setActualWeightKg(e.target.value)} step="0.001" className={`${primaryInputCls} border-emerald-300 text-emerald-700 focus:border-emerald-500 focus:ring-emerald-500/10`} dir="ltr" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">سعر التكلفة</label>
            <input type="number" value={unitCost} onChange={e => setUnitCost(e.target.value)} step="0.0001" className={inputCls} dir="ltr" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">رقم الدُفعة</label>
            <input type="text" value={batchNo} onChange={e => setBatchNo(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">رقم الحاوية</label>
            <input type="text" value={containerNo} onChange={e => setContainerNo(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">مرجع ثوب المورد</label>
            <input type="text" value={supplierRollRef} onChange={e => setSupplierRollRef(e.target.value)} className={inputCls} dir="ltr" />
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-sm font-bold text-slate-700">ملاحظات</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
          </div>
            </div>
          </div>
          {err && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-700 text-sm font-bold">{err}</p>}
        </div>
        <div className="p-5 border-t border-slate-200 bg-white flex flex-col-reverse sm:flex-row justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 text-sm">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-black text-sm disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm">
            <Save className="w-4 h-4" />
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Move modal ───────────────────────────────────────────────────────────────

interface MoveModalProps {
  roll: FabricRollDto;
  warehouses: ApiWarehouse[];
  onClose: () => void;
  onSaved: () => void;
}
const MoveModal = ({ roll, warehouses, onClose, onSaved }: MoveModalProps) => {
  const [toWarehouseId, setToWarehouseId] = useState(roll.warehouse_id);
  const [toLocationId, setToLocationId] = useState('');
  const [locations, setLocations] = useState<ApiWarehouseLocation[]>([]);
  const [moveNotes, setMoveNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (toWarehouseId) listLocations(toWarehouseId).then(setLocations).catch(() => setLocations([]));
    setToLocationId('');
  }, [toWarehouseId]);

  const handleMove = async () => {
    setSaving(true); setErr('');
    try {
      await moveFabricRoll(roll.id, { toWarehouseId, toLocationId: toLocationId || null, notes: moveNotes || undefined });
      onSaved();
    } catch (e: unknown) {
      setErr((e as { message?: string }).message ?? 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-slate-900">نقل الثوب</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-600">
            من: <strong>{roll.warehouse_name}</strong> {roll.location_name ? `← ${roll.location_name}` : ''}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">المستودع الهدف</label>
            <select value={toWarehouseId} onChange={e => setToWarehouseId(e.target.value)} className={inputCls}>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">الموقع الهدف</label>
            <select value={toLocationId} onChange={e => setToLocationId(e.target.value)} className={inputCls}>
              <option value="">— بدون موقع محدد —</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">ملاحظات</label>
            <textarea value={moveNotes} onChange={e => setMoveNotes(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
          </div>
          {err && <p className="text-rose-600 text-sm font-bold">{err}</p>}
        </div>
        <div className="p-5 border-t border-slate-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 text-sm">إلغاء</button>
          <button onClick={handleMove} disabled={saving} className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold text-sm disabled:opacity-50 flex items-center gap-2">
            <MoveRight className="w-4 h-4" />
            {saving ? 'جاري النقل...' : 'نقل الثوب'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Status modal ─────────────────────────────────────────────────────────────

interface StatusModalProps {
  roll: FabricRollDto;
  onClose: () => void;
  onSaved: () => void;
}
const StatusModal = ({ roll, onClose, onSaved }: StatusModalProps) => {
  const [status, setStatus] = useState<RollStatus>(roll.status);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const ALL_STATUSES: RollStatus[] = ['AVAILABLE','RESERVED','SOLD','DAMAGED','TRANSFERRED','INACTIVE'];

  const handleSave = async () => {
    setSaving(true); setErr('');
    try {
      await updateFabricRollStatus(roll.id, status, notes);
      onSaved();
    } catch (e: unknown) {
      setErr((e as { message?: string }).message ?? 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="p-5 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">تغيير حالة الثوب</h3>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">الحالة الجديدة</label>
            <select value={status} onChange={e => setStatus(e.target.value as RollStatus)} className={inputCls}>
              {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-700">ملاحظات</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
          </div>
          {err && <p className="text-rose-600 text-sm font-bold">{err}</p>}
        </div>
        <div className="p-5 border-t border-slate-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 text-sm">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold text-sm disabled:opacity-50">
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main RollDetails page ────────────────────────────────────────────────────

export const RollDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [roll, setRoll] = useState<(FabricRollDto & { movements: InventoryMovementDto[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [showStatus, setShowStatus] = useState(false);

  const loadRoll = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError('');
    try {
      const data = await getFabricRoll(id);
      setRoll(data);
    } catch {
      setError('تعذر تحميل بيانات الثوب');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadRoll();
    Promise.all([
      listWarehouses(),
      listSuppliers({ pageSize: 200 }),
    ]).then(([whs, sRes]) => {
      setWarehouses(whs);
      setSuppliers(sRes.data);
    }).catch(() => {});
  }, [loadRoll]);

  const handleSaved = () => {
    setShowEdit(false); setShowMove(false); setShowStatus(false);
    loadRoll();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" dir="rtl">
        <div className="text-center text-slate-400">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
          <p>جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (error || !roll) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center" dir="rtl">
        <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600 font-bold mb-4">{error || 'الثوب غير موجود'}</p>
        <button onClick={() => navigate('/inventory')} className="text-indigo-600 hover:underline text-sm">
          العودة إلى المخزون
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/inventory')} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">تفاصيل الثوب</h2>
            <p className="font-mono text-slate-500 mt-0.5">{roll.barcode}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowEdit(true)} className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition text-sm font-medium">
            <Pencil className="w-4 h-4" /> تعديل
          </button>
          <button onClick={() => setShowMove(true)} className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 hover:bg-blue-100 transition text-sm font-medium">
            <MoveRight className="w-4 h-4" /> نقل
          </button>
          <button onClick={() => setShowStatus(true)} className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 hover:bg-amber-100 transition text-sm font-medium">
            <ToggleLeft className="w-4 h-4" /> تغيير الحالة
          </button>
          <button
            onClick={() => navigate(`/inventory/labels?rollId=${roll.id}`)}
            className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 transition text-sm font-medium"
          >
            <Printer className="w-4 h-4" /> طباعة لصاقة
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Roll Info */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="font-bold text-slate-800 mb-3 pb-2 border-b border-slate-100">معلومات الثوب</h3>
          <DataRow label="الباركود" value={<span className="font-mono bg-slate-100 px-2 py-0.5 rounded">{roll.barcode}</span>} />
          <DataRow label="رقم الثوب" value={roll.roll_no} />
          <DataRow label="الحالة" value={<StatusBadge status={roll.status} />} />
          <DataRow label="الخامة" value={roll.item_name} />
          <DataRow label="الكود الداخلي" value={<span className="font-mono">{roll.internal_code}</span>} />
          <DataRow label="اللون" value={
            <div className="flex items-center gap-2">
              {roll.hex_color && roll.color_name_ar && (
                <span className="w-4 h-4 rounded-full border border-slate-200" style={{ backgroundColor: roll.hex_color }} />
              )}
              <span>{displayImportedColorName(roll.color_name_ar ?? roll.color_name_tr)}</span>
              {roll.color_code && roll.color_code.trim() !== '0' && (
                <span className="font-mono text-slate-500">({displayImportedColorCode(roll.color_code)})</span>
              )}
            </div>
          } />
          <DataRow label="كود اللون" value={
            <span className="font-mono">{displayImportedColorCode(roll.color_code)}</span>
          } />
          <DataRow label="المتغير" value={roll.variant_code} />
          <DataRow label="المورد" value={roll.supplier_name} />
        </div>

        {/* Dimensions & Location */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="font-bold text-slate-800 mb-3 pb-2 border-b border-slate-100">الأبعاد والموقع</h3>
          <DataRow label="الطول" value={`${parseFloat(roll.length_m).toFixed(3)} م`} />
          <DataRow label="العرض" value={roll.width_cm ? `${parseFloat(roll.width_cm).toFixed(1)} سم` : undefined} />
          <DataRow label="وزن المتر المربع (GSM)" value={roll.gsm ? parseFloat(roll.gsm).toFixed(0) : undefined} />
          <DataRow label="الوزن المحسوب" value={roll.calculated_weight_kg ? `${parseFloat(roll.calculated_weight_kg).toFixed(3)} كجم` : undefined} />
          <DataRow label="الوزن الفعلي" value={roll.actual_weight_kg ? `${parseFloat(roll.actual_weight_kg).toFixed(3)} كجم` : undefined} />
          <DataRow label="المستودع" value={roll.warehouse_name} />
          <DataRow label="الموقع" value={roll.location_name} />
          <DataRow label="سعر التكلفة" value={roll.unit_cost ? `${parseFloat(roll.unit_cost).toFixed(4)} ${roll.currency_code ?? ''}` : undefined} />
        </div>

        {/* References */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="font-bold text-slate-800 mb-3 pb-2 border-b border-slate-100">مراجع الشراء</h3>
          <DataRow label="رقم الدُفعة" value={roll.batch_no} />
          <DataRow label="رقم الحاوية" value={roll.container_no} />
          <DataRow label="فاتورة الشراء" value={roll.purchase_invoice_no} />
          <DataRow label="مرجع ثوب المورد" value={<span className="font-mono">{roll.supplier_roll_ref}</span>} />
          <DataRow label="ملاحظات" value={roll.notes} />
          <DataRow label="تاريخ الإضافة" value={new Date(roll.created_at).toLocaleDateString('ar-SA')} />
          <DataRow label="آخر تحديث" value={new Date(roll.updated_at).toLocaleDateString('ar-SA')} />
        </div>
      </div>

      {/* Movement history */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h3 className="font-bold text-slate-800">سجل الحركات</h3>
          <p className="text-sm text-slate-500 mt-0.5">{roll.movements.length} حركة مسجلة</p>
        </div>
        {roll.movements.length === 0 ? (
          <p className="text-center text-slate-400 py-8 text-sm">لا توجد حركات مسجلة بعد</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-right py-3 px-4 font-bold text-slate-600 whitespace-nowrap">التاريخ</th>
                  <th className="text-right py-3 px-4 font-bold text-slate-600">نوع الحركة</th>
                  <th className="text-right py-3 px-4 font-bold text-slate-600">من</th>
                  <th className="text-right py-3 px-4 font-bold text-slate-600">إلى</th>
                  <th className="text-right py-3 px-4 font-bold text-slate-600">الحالة السابقة</th>
                  <th className="text-right py-3 px-4 font-bold text-slate-600">الحالة الجديدة</th>
                  <th className="text-right py-3 px-4 font-bold text-slate-600">مرجع</th>
                  <th className="text-right py-3 px-4 font-bold text-slate-600">ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {roll.movements.map(m => (
                  <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition">
                    <td className="py-3 px-4 whitespace-nowrap text-xs text-slate-500">
                      {new Date(m.created_at).toLocaleDateString('ar-SA')}
                    </td>
                    <td className="py-3 px-4">
                      <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-medium">
                        {MOVEMENT_TYPE_LABELS[m.movement_type] ?? m.movement_type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600 text-xs">
                      {m.from_warehouse_name ? `${m.from_warehouse_name}${m.from_location_name ? ` / ${m.from_location_name}` : ''}` : '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-600 text-xs">
                      {m.to_warehouse_name ? `${m.to_warehouse_name}${m.to_location_name ? ` / ${m.to_location_name}` : ''}` : '—'}
                    </td>
                    <td className="py-3 px-4">
                      {m.old_status ? <StatusBadge status={m.old_status as RollStatus} /> : '—'}
                    </td>
                    <td className="py-3 px-4">
                      {m.new_status ? <StatusBadge status={m.new_status as RollStatus} /> : '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 font-mono">{m.reference_no ?? '—'}</td>
                    <td className="py-3 px-4 text-xs text-slate-500">{m.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showEdit && <EditModal roll={roll} suppliers={suppliers} warehouses={warehouses} onClose={() => setShowEdit(false)} onSaved={handleSaved} />}
      {showMove && <MoveModal roll={roll} warehouses={warehouses} onClose={() => setShowMove(false)} onSaved={handleSaved} />}
      {showStatus && <StatusModal roll={roll} onClose={() => setShowStatus(false)} onSaved={handleSaved} />}
    </div>
  );
};
