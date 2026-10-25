import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import { listPreparationTypes, type PreparationType } from '../../lib/api/externalJobsApi';
import { createIntakeOperation, type IntakeActionType } from '../../lib/api/intakeOperationsApi';
import { ApiRequestError } from '../../lib/api/client';
import { useToast } from '../../components/NonBlockingToast';

const ACTION_TYPES: { value: IntakeActionType; labelKey: string }[] = [
  { value: 'PROCESSING', labelKey: 'actionProcessing' },
  { value: 'STOCK', labelKey: 'actionStock' },
  { value: 'RETURN', labelKey: 'actionReturn' },
  { value: 'PURCHASE', labelKey: 'actionPurchase' },
];

export const IntakeOperationNew: React.FC = () => {
  const { t } = useTranslation('intakeOperations');
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [prepTypes, setPrepTypes] = useState<PreparationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [supplierId, setSupplierId] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [actionType, setActionType] = useState<IntakeActionType>('STOCK');
  const [customerId, setCustomerId] = useState('');
  const [fabricStage, setFabricStage] = useState<'RAW' | 'FINISHED' | ''>('');
  const [preparationTypeId, setPreparationTypeId] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [supRes, whRes, custRes, prepRes] = await Promise.all([
        listSuppliers({ status: 'active', pageSize: 500 }),
        listWarehouses({ status: 'active' }),
        listCustomers({ status: 'active', pageSize: 500 }),
        listPreparationTypes(),
      ]);
      setSuppliers(supRes.data);
      setWarehouses(whRes);
      setCustomers(custRes.data);
      setPrepTypes(prepRes.data);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('loadFailed') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // عام لكل الموردين — الفحص الدقيق (هل هو جهة تجهيز فعلاً عند اختيار
  // مصنعية) يبقى على الخادم عند الحفظ.
  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLocaleLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => s.name.toLocaleLowerCase().includes(q));
  }, [suppliers, supplierSearch]);

  const submit = async () => {
    if (!supplierId || !warehouseId) {
      showToast({ type: 'warning', message: t('requiredFields') });
      return;
    }
    if (actionType === 'RETURN' && !customerId) {
      showToast({ type: 'warning', message: t('customerRequiredForReturn') });
      return;
    }
    if (actionType === 'PROCESSING' && (!fabricStage || !preparationTypeId)) {
      showToast({ type: 'warning', message: t('processingFieldsRequired') });
      return;
    }
    setSaving(true);
    try {
      const op = await createIntakeOperation({
        supplierId,
        warehouseId,
        actionType,
        customerId: actionType === 'RETURN' ? customerId : null,
        fabricStage: actionType === 'PROCESSING' ? (fabricStage as 'RAW' | 'FINISHED') : null,
        preparationTypeId: actionType === 'PROCESSING' ? preparationTypeId : null,
      });
      showToast({ type: 'success', message: t('createdSuccess', { orderNo: op.order_no }) });
      navigate(`/inventory/create?intakeOperationId=${op.id}`);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('createFailed') });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin ml-2" />
        {t('loading')}
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4" dir="rtl">
      <div>
        <h2 className="text-lg font-black text-slate-900">{t('title')}</h2>
        <p className="text-sm text-slate-500">{t('subtitle')}</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <label className="space-y-1 block">
          <span className="text-xs font-bold text-slate-600">{t('supplierLabel')}</span>
          <input
            type="text"
            value={supplierSearch}
            onChange={(e) => setSupplierSearch(e.target.value)}
            placeholder={t('supplierSearchPlaceholder')}
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs bg-slate-50 mb-1"
          />
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">{t('chooseSupplier')}</option>
            {filteredSuppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {suppliers.length === 0 && (
            <p className="text-xs text-amber-700">{t('noSuppliersAtAll')}</p>
          )}
        </label>

        <label className="space-y-1 block">
          <span className="text-xs font-bold text-slate-600">{t('warehouseLabel')}</span>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">{t('chooseWarehouse')}</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1 block">
          <span className="text-xs font-bold text-slate-600">{t('orderNoLabel')}</span>
          <input
            value={t('orderNoAutoHint')}
            disabled
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
          />
        </label>

        <label className="space-y-1 block">
          <span className="text-xs font-bold text-slate-600">{t('actionTypeLabel')}</span>
          <div className="grid grid-cols-2 gap-2">
            {ACTION_TYPES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setActionType(opt.value)}
                className={`rounded-lg border px-3 py-2 text-sm font-bold ${
                  actionType === opt.value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </label>

        {actionType === 'RETURN' && (
          <label className="space-y-1 block">
            <span className="text-xs font-bold text-slate-600">{t('customerLabel')}</span>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">{t('chooseCustomer')}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}

        {actionType === 'PROCESSING' && (
          <>
            <label className="space-y-1 block">
              <span className="text-xs font-bold text-slate-600">{t('fabricStageLabel')}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFabricStage('RAW')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold ${
                    fabricStage === 'RAW' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'
                  }`}
                >
                  {t('stageRaw')}
                </button>
                <button
                  type="button"
                  onClick={() => setFabricStage('FINISHED')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold ${
                    fabricStage === 'FINISHED' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'
                  }`}
                >
                  {t('stageFinished')}
                </button>
              </div>
            </label>
            <label className="space-y-1 block">
              <span className="text-xs font-bold text-slate-600">{t('preparationTypeLabel')}</span>
              <select
                value={preparationTypeId}
                onChange={(e) => setPreparationTypeId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">{t('choosePrepType')}</option>
                {prepTypes.filter((p) => p.is_active).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? t('saving') : t('continueButton')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default IntakeOperationNew;
