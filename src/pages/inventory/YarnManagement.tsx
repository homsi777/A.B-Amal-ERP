import React, { useEffect, useState } from 'react';
import { Loader2, Package, Plus, Scale } from 'lucide-react';
import { createFabricItem, listFabricItems, type ApiFabricItem } from '../../lib/api/fabricItemsApi';
import { createYarnLot, listYarnLots, type YarnLotDto } from '../../lib/api/yarnLotsApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { useToast } from '../../components/NonBlockingToast';

/**
 * إدارة الخيط/الغزل — صنف منفصل تماماً عن توب القماش، يُقاس بالوزن (كج) لا
 * بالطول. شاشة مستقلة عمداً بدل دمجها بـ CreateItem.tsx/Inventory.tsx —
 * تلك الشاشات متشابكة جداً بمنطق خاص بالقماش (عرض/GSM/متغيرات لون)، ودمج
 * منطق الوزن فيها كان سيزيد خطر كسر تدفق القماش الحالي بلا داعٍ.
 */
export function YarnManagement() {
  const { showToast } = useToast();
  const [items, setItems] = useState<ApiFabricItem[]>([]);
  const [lots, setLots] = useState<YarnLotDto[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [loading, setLoading] = useState(true);

  const [itemForm, setItemForm] = useState({ internalCode: '', name: '', supplierCode: '', notes: '' });
  const [itemSaving, setItemSaving] = useState(false);

  const [lotForm, setLotForm] = useState({
    itemId: '', supplierId: '', warehouseId: '', weightKg: '', unitCost: '', batchNo: '', notes: '',
  });
  const [lotSaving, setLotSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [itemsRes, lotsRes, suppliersRes, warehousesRes] = await Promise.all([
        listFabricItems({ unit: 'kg', pageSize: 200 }),
        listYarnLots({ pageSize: 100 }),
        listSuppliers({ pageSize: 200 }),
        listWarehouses(),
      ]);
      setItems(itemsRes.data);
      setLots(lotsRes.data);
      setSuppliers(suppliersRes.data);
      setWarehouses(warehousesRes);
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : 'تعذر تحميل البيانات' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateItem = async () => {
    if (!itemForm.internalCode.trim() || !itemForm.name.trim()) {
      showToast({ type: 'error', message: 'أدخل الكود الداخلي والاسم على الأقل' });
      return;
    }
    setItemSaving(true);
    try {
      await createFabricItem({
        internal_code: itemForm.internalCode.trim(),
        name: itemForm.name.trim(),
        supplier_code: itemForm.supplierCode.trim() || undefined,
        notes: itemForm.notes.trim() || undefined,
        unit: 'kg',
        fabric_type: 'خيط',
      });
      setItemForm({ internalCode: '', name: '', supplierCode: '', notes: '' });
      showToast({ type: 'success', message: 'تم إنشاء صنف الخيط' });
      await load();
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : 'تعذر إنشاء الصنف' });
    } finally {
      setItemSaving(false);
    }
  };

  const handleCreateLot = async () => {
    const weight = Number(lotForm.weightKg);
    if (!lotForm.itemId || !lotForm.warehouseId || !weight || weight <= 0) {
      showToast({ type: 'error', message: 'اختر الصنف والمستودع وأدخل وزناً صحيحاً' });
      return;
    }
    setLotSaving(true);
    try {
      await createYarnLot({
        itemId: lotForm.itemId,
        supplierId: lotForm.supplierId || null,
        warehouseId: lotForm.warehouseId,
        weightKg: weight,
        unitCost: lotForm.unitCost ? Number(lotForm.unitCost) : null,
        batchNo: lotForm.batchNo.trim() || null,
        notes: lotForm.notes.trim() || null,
      });
      setLotForm({ itemId: '', supplierId: '', warehouseId: '', weightKg: '', unitCost: '', batchNo: '', notes: '' });
      showToast({ type: 'success', message: 'تم استلام دفعة الخيط' });
      await load();
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : 'تعذر استلام الدفعة' });
    } finally {
      setLotSaving(false);
    }
  };

  const inputCls = 'w-full p-2.5 bg-white border border-slate-200 rounded-lg text-sm';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Scale className="w-6 h-6 text-indigo-600" /> إدارة الخيط (بالوزن)
        </h2>
        <p className="text-slate-500 mt-1">أصناف وخيط يُشترى ويُباع بالكيلوغرام — منفصل تماماً عن أتواب القماش بالمتر.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <Package className="w-5 h-5 text-indigo-600" /> صنف خيط جديد
          </div>
          <input className={inputCls} placeholder="الكود الداخلي" value={itemForm.internalCode}
            onChange={(e) => setItemForm({ ...itemForm, internalCode: e.target.value })} />
          <input className={inputCls} placeholder="اسم الصنف" value={itemForm.name}
            onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} />
          <input className={inputCls} placeholder="كود المورد (اختياري)" value={itemForm.supplierCode}
            onChange={(e) => setItemForm({ ...itemForm, supplierCode: e.target.value })} />
          <textarea className={inputCls} placeholder="ملاحظات" value={itemForm.notes}
            onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })} />
          <button type="button" onClick={() => void handleCreateItem()} disabled={itemSaving}
            className="w-full bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {itemSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            إنشاء الصنف
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <Scale className="w-5 h-5 text-indigo-600" /> استلام دفعة خيط
          </div>
          <select className={inputCls} value={lotForm.itemId} onChange={(e) => setLotForm({ ...lotForm, itemId: e.target.value })}>
            <option value="">— اختر صنف الخيط —</option>
            {items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.internal_code})</option>)}
          </select>
          <select className={inputCls} value={lotForm.supplierId} onChange={(e) => setLotForm({ ...lotForm, supplierId: e.target.value })}>
            <option value="">— المورد (اختياري) —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className={inputCls} value={lotForm.warehouseId} onChange={(e) => setLotForm({ ...lotForm, warehouseId: e.target.value })}>
            <option value="">— اختر المستودع —</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" step="0.001" className={inputCls} placeholder="الوزن (كج)" value={lotForm.weightKg}
              onChange={(e) => setLotForm({ ...lotForm, weightKg: e.target.value })} />
            <input type="number" step="0.0001" className={inputCls} placeholder="التكلفة لكل كج" value={lotForm.unitCost}
              onChange={(e) => setLotForm({ ...lotForm, unitCost: e.target.value })} />
          </div>
          <input className={inputCls} placeholder="رقم الدفعة (اختياري)" value={lotForm.batchNo}
            onChange={(e) => setLotForm({ ...lotForm, batchNo: e.target.value })} />
          <button type="button" onClick={() => void handleCreateLot()} disabled={lotSaving}
            className="w-full bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {lotSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            استلام الدفعة
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 font-bold text-slate-800">دفعات الخيط الحالية</div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100">
              <tr>
                <th className="px-4 py-3">الباركود</th>
                <th className="px-4 py-3">الصنف</th>
                <th className="px-4 py-3">المستودع</th>
                <th className="px-4 py-3">الوزن المتبقي (كج)</th>
                <th className="px-4 py-3">التكلفة/كج</th>
                <th className="px-4 py-3">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin inline ml-2" /> جاري التحميل...
                </td></tr>
              ) : lots.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">لا توجد دفعات خيط بعد</td></tr>
              ) : lots.map((lot) => (
                <tr key={lot.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-indigo-600">{lot.barcode}</td>
                  <td className="px-4 py-3">{lot.item_name || '—'}</td>
                  <td className="px-4 py-3">{lot.warehouse_name || '—'}</td>
                  <td className="px-4 py-3 font-bold">{Number(lot.weight_kg).toFixed(3)}</td>
                  <td className="px-4 py-3">{lot.unit_cost ?? '—'} {lot.currency_code}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 rounded text-xs font-bold bg-slate-100 text-slate-800">{lot.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
