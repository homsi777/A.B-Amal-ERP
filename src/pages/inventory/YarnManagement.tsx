import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Package, Plus, Scale, ShoppingCart } from 'lucide-react';
import { createFabricItem, listFabricItems, type ApiFabricItem } from '../../lib/api/fabricItemsApi';
import { createYarnLot, listYarnLots, type YarnLotDto } from '../../lib/api/yarnLotsApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import { createSalesInvoice } from '../../lib/api/salesInvoicesApi';
import { useToast } from '../../components/NonBlockingToast';

/**
 * إدارة الخيط/الغزل — صنف منفصل تماماً عن توب القماش، يُقاس بالوزن (كج) لا
 * بالطول. شاشة مستقلة عمداً بدل دمجها بـ CreateItem.tsx/Inventory.tsx —
 * تلك الشاشات متشابكة جداً بمنطق خاص بالقماش (عرض/GSM/متغيرات لون)، ودمج
 * منطق الوزن فيها كان سيزيد خطر كسر تدفق القماش الحالي بلا داعٍ.
 */
export function YarnManagement() {
  const { t } = useTranslation('yarnManagement');
  const { showToast } = useToast();
  const [items, setItems] = useState<ApiFabricItem[]>([]);
  const [lots, setLots] = useState<YarnLotDto[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [loading, setLoading] = useState(true);

  const [sellForm, setSellForm] = useState({ lotId: '', customerId: '', weightKg: '', unitPrice: '' });
  const [sellSaving, setSellSaving] = useState(false);

  const [itemForm, setItemForm] = useState({ internalCode: '', name: '', supplierCode: '', notes: '' });
  const [itemSaving, setItemSaving] = useState(false);

  const [lotForm, setLotForm] = useState({
    itemId: '', supplierId: '', warehouseId: '', weightKg: '', unitCost: '', batchNo: '', notes: '',
  });
  const [lotSaving, setLotSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [itemsRes, lotsRes, suppliersRes, warehousesRes, customersRes] = await Promise.all([
        listFabricItems({ unit: 'kg', pageSize: 200 }),
        listYarnLots({ pageSize: 100 }),
        listSuppliers({ pageSize: 200 }),
        listWarehouses(),
        listCustomers({ pageSize: 200 }),
      ]);
      setItems(itemsRes.data);
      setLots(lotsRes.data);
      setSuppliers(suppliersRes.data);
      setWarehouses(warehousesRes);
      setCustomers(customersRes.data);
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : t('toast.loadFailed') });
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
      showToast({ type: 'error', message: t('toast.itemFieldsRequired') });
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
      showToast({ type: 'success', message: t('toast.itemCreated') });
      await load();
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : t('toast.itemCreateFailed') });
    } finally {
      setItemSaving(false);
    }
  };

  const handleCreateLot = async () => {
    const weight = Number(lotForm.weightKg);
    if (!lotForm.itemId || !lotForm.warehouseId || !weight || weight <= 0) {
      showToast({ type: 'error', message: t('toast.lotFieldsRequired') });
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
      showToast({ type: 'success', message: t('toast.lotReceived') });
      await load();
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : t('toast.lotReceiveFailed') });
    } finally {
      setLotSaving(false);
    }
  };

  const handleSellLot = async () => {
    const weight = Number(sellForm.weightKg);
    const price = Number(sellForm.unitPrice);
    if (!sellForm.lotId || !sellForm.customerId || !weight || weight <= 0 || !price || price <= 0) {
      showToast({ type: 'error', message: t('toast.sellFieldsRequired') });
      return;
    }
    const lot = lots.find((l) => l.id === sellForm.lotId);
    if (!lot) return;
    if (weight > Number(lot.weight_kg) + 1e-6) {
      showToast({ type: 'error', message: t('toast.weightExceedsAvailable', { weight: lot.weight_kg }) });
      return;
    }
    setSellSaving(true);
    try {
      const lineTotal = Math.round(weight * price * 100) / 100;
      await createSalesInvoice({
        invoiceNo: 'AUTO',
        invoiceDate: new Date().toISOString().slice(0, 10),
        customerId: sellForm.customerId,
        currencyCode: 'USD',
        exchangeRateToUsd: 1,
        subtotal: lineTotal,
        discountTotal: 0,
        taxTotal: 0,
        totalAmount: lineTotal,
        paidAmount: 0,
        remainingAmount: lineTotal,
        confirm: true,
        lines: [
          {
            yarnLotId: lot.id,
            fabricItemId: lot.item_id,
            description: lot.item_name || 'خيط',
            quantity: weight,
            unit: 'kg',
            unitPrice: price,
            lineTotal,
          },
        ],
      });
      setSellForm({ lotId: '', customerId: '', weightKg: '', unitPrice: '' });
      showToast({ type: 'success', message: t('toast.soldSuccess') });
      await load();
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : t('toast.sellFailed') });
    } finally {
      setSellSaving(false);
    }
  };

  const inputCls = 'w-full p-2.5 bg-white border border-slate-200 rounded-lg text-sm';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Scale className="w-6 h-6 text-indigo-600" /> {t('pageTitle')}
        </h2>
        <p className="text-slate-500 mt-1">{t('pageSubtitle')}</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <Package className="w-5 h-5 text-indigo-600" /> {t('newItemCardTitle')}
          </div>
          <input className={inputCls} placeholder={t('internalCodePlaceholder')} value={itemForm.internalCode}
            onChange={(e) => setItemForm({ ...itemForm, internalCode: e.target.value })} />
          <input className={inputCls} placeholder={t('itemNamePlaceholder')} value={itemForm.name}
            onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} />
          <input className={inputCls} placeholder={t('supplierCodePlaceholder')} value={itemForm.supplierCode}
            onChange={(e) => setItemForm({ ...itemForm, supplierCode: e.target.value })} />
          <textarea className={inputCls} placeholder={t('notesPlaceholder')} value={itemForm.notes}
            onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })} />
          <button type="button" onClick={() => void handleCreateItem()} disabled={itemSaving}
            className="w-full bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {itemSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t('createItem')}
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <Scale className="w-5 h-5 text-indigo-600" /> {t('receiveLotCardTitle')}
          </div>
          <select className={inputCls} value={lotForm.itemId} onChange={(e) => setLotForm({ ...lotForm, itemId: e.target.value })}>
            <option value="">{t('chooseItemOption')}</option>
            {items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.internal_code})</option>)}
          </select>
          <select className={inputCls} value={lotForm.supplierId} onChange={(e) => setLotForm({ ...lotForm, supplierId: e.target.value })}>
            <option value="">{t('supplierOptionalOption')}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className={inputCls} value={lotForm.warehouseId} onChange={(e) => setLotForm({ ...lotForm, warehouseId: e.target.value })}>
            <option value="">{t('chooseWarehouseOption')}</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" step="0.001" className={inputCls} placeholder={t('weightKgPlaceholder')} value={lotForm.weightKg}
              onChange={(e) => setLotForm({ ...lotForm, weightKg: e.target.value })} />
            <input type="number" step="0.0001" className={inputCls} placeholder={t('costPerKgPlaceholder')} value={lotForm.unitCost}
              onChange={(e) => setLotForm({ ...lotForm, unitCost: e.target.value })} />
          </div>
          <input className={inputCls} placeholder={t('batchNoPlaceholder')} value={lotForm.batchNo}
            onChange={(e) => setLotForm({ ...lotForm, batchNo: e.target.value })} />
          <button type="button" onClick={() => void handleCreateLot()} disabled={lotSaving}
            className="w-full bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {lotSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t('receiveLot')}
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <ShoppingCart className="w-5 h-5 text-rose-600" /> {t('sellLotCardTitle')}
          </div>
          <select className={inputCls} value={sellForm.lotId} onChange={(e) => setSellForm({ ...sellForm, lotId: e.target.value })}>
            <option value="">{t('chooseLotOption')}</option>
            {lots.filter((l) => l.status === 'AVAILABLE' && Number(l.weight_kg) > 0).map((l) => (
              <option key={l.id} value={l.id}>{t('lotOptionAvailable', { itemName: l.item_name, barcode: l.barcode, weight: Number(l.weight_kg).toFixed(3) })}</option>
            ))}
          </select>
          <select className={inputCls} value={sellForm.customerId} onChange={(e) => setSellForm({ ...sellForm, customerId: e.target.value })}>
            <option value="">{t('chooseCustomerOption')}</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" step="0.001" className={inputCls} placeholder={t('soldWeightPlaceholder')} value={sellForm.weightKg}
              onChange={(e) => setSellForm({ ...sellForm, weightKg: e.target.value })} />
            <input type="number" step="0.0001" className={inputCls} placeholder={t('sellPricePerKgPlaceholder')} value={sellForm.unitPrice}
              onChange={(e) => setSellForm({ ...sellForm, unitPrice: e.target.value })} />
          </div>
          <button type="button" onClick={() => void handleSellLot()} disabled={sellSaving}
            className="w-full bg-rose-600 text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {sellSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
            {t('sellAndConfirm')}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 font-bold text-slate-800">{t('currentLotsTitle')}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100">
              <tr>
                <th className="px-4 py-3">{t('colBarcode')}</th>
                <th className="px-4 py-3">{t('colItem')}</th>
                <th className="px-4 py-3">{t('colWarehouse')}</th>
                <th className="px-4 py-3">{t('colRemainingWeight')}</th>
                <th className="px-4 py-3">{t('colCostPerKg')}</th>
                <th className="px-4 py-3">{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin inline ml-2" /> {t('loading')}
                </td></tr>
              ) : lots.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{t('noLotsYet')}</td></tr>
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
