import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Droplet, Layers, Loader2, Pencil, Plus, Scissors, Search, Settings, X } from 'lucide-react';
import {
  createProcessingExternalJob,
  listPreparationTypes,
  createPreparationType,
  updatePreparationType,
  type PreparationType,
  type FabricStage,
} from '../../lib/api/externalJobsApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { listFabricRolls, type FabricRollDto } from '../../lib/api/fabricRollsApi';
import { useToast } from '../../components/NonBlockingToast';
import { ApiRequestError } from '../../lib/api/client';

type SelectedRoll = FabricRollDto;

export const ExternalJobProcessingNew = () => {
  const { t } = useTranslation('externalJobs');
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [fabricStage, setFabricStage] = useState<FabricStage | null>(null);

  const [prepTypes, setPrepTypes] = useState<PreparationType[]>([]);
  const [preparationTypeId, setPreparationTypeId] = useState('');
  const [prepManageOpen, setPrepManageOpen] = useState(false);

  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');

  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');

  const [processDescription, setProcessDescription] = useState('');
  const [notes, setNotes] = useState('');

  const [rollQuery, setRollQuery] = useState('');
  const [rollResults, setRollResults] = useState<FabricRollDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedRolls, setSelectedRolls] = useState<SelectedRoll[]>([]);
  const [saving, setSaving] = useState(false);

  const loadPrepTypes = async () => {
    try {
      const res = await listPreparationTypes();
      setPrepTypes(res.data);
    } catch {
      setPrepTypes([]);
    }
  };

  useEffect(() => {
    void loadPrepTypes();
    // عام لكل الموردين — ليس محصوراً بمن عُلِّم "جهة تجهيز" فقط؛ الفحص الدقيق
    // (هل هذا المورد جهة تجهيز فعلاً) يبقى عند الحفظ على الخادم كما هو.
    listSuppliers({ status: 'active', pageSize: 500 }).then((r) => setSuppliers(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    listWarehouses({ status: 'active' }).then((rows) => setWarehouses(rows)).catch(() => setWarehouses([]));
  }, []);

  // عام لكل المستودعات — لم يعد مقصوراً على المستودعات المصنَّفة بنفس مرحلة
  // الخامة المختارة؛ المطابقة الدقيقة تبقى تُفحَص عند الحفظ على الخادم.
  const matchingWarehouses = warehouses;

  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLocaleLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => s.name.toLocaleLowerCase().includes(q));
  }, [suppliers, supplierSearch]);

  useEffect(() => {
    const q = rollQuery.trim();
    if (!q || !sourceWarehouseId) {
      setRollResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      listFabricRolls({ search: q, warehouseId: sourceWarehouseId, status: 'AVAILABLE', pageSize: 25 })
        .then((res) => { if (!cancelled) setRollResults(res.data); })
        .catch(() => { if (!cancelled) setRollResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [rollQuery, sourceWarehouseId]);

  const addRoll = (roll: FabricRollDto) => {
    if (selectedRolls.some((r) => r.id === roll.id)) {
      showToast({ type: 'error', message: t('processingNew.rollAlreadyAdded', { barcode: roll.barcode }) });
      return;
    }
    if (roll.warehouse_id !== sourceWarehouseId) {
      showToast({ type: 'error', message: t('processingNew.rollWrongWarehouse', { barcode: roll.barcode }) });
      return;
    }
    if (roll.status !== 'AVAILABLE') {
      showToast({ type: 'error', message: t('processingNew.rollNotAvailable', { barcode: roll.barcode, status: roll.status }) });
      return;
    }
    if (Number.parseFloat(roll.length_m || '0') <= 0) {
      showToast({ type: 'error', message: t('processingNew.rollZeroLength', { barcode: roll.barcode }) });
      return;
    }
    setSelectedRolls((prev) => [...prev, roll]);
    setRollQuery('');
    setRollResults([]);
  };

  const removeRoll = (rollId: string) => {
    setSelectedRolls((prev) => prev.filter((r) => r.id !== rollId));
  };

  const handleScanKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const value = rollQuery.trim();
    if (!value || !sourceWarehouseId) return;
    const exact = rollResults.find((r) => r.barcode.trim().toLowerCase() === value.toLowerCase());
    if (exact) {
      addRoll(exact);
      return;
    }
    try {
      const res = await listFabricRolls({ barcode: value, warehouseId: sourceWarehouseId, pageSize: 1 });
      if (res.data[0]) addRoll(res.data[0]);
      else showToast({ type: 'error', message: t('processingNew.rollNotFound', { barcode: value }) });
    } catch (err) {
      showToast({ type: 'error', message: err instanceof ApiRequestError ? err.message : t('processingNew.rollNotFound', { barcode: value }) });
    }
  };

  const totals = useMemo(() => {
    const totalM = selectedRolls.reduce((sum, r) => sum + (Number.parseFloat(r.length_m || '0') || 0), 0);
    const totalKg = selectedRolls.reduce(
      (sum, r) => sum + (Number.parseFloat(r.actual_weight_kg ?? r.calculated_weight_kg ?? '0') || 0),
      0,
    );
    return { totalM, totalKg };
  }, [selectedRolls]);

  const canSave = Boolean(fabricStage && preparationTypeId && supplierId && sourceWarehouseId && selectedRolls.length > 0);

  const handleSave = async () => {
    if (!canSave || !fabricStage) return;
    setSaving(true);
    try {
      const res = await createProcessingExternalJob({
        supplierId,
        fabricStage,
        preparationTypeId,
        sourceWarehouseId,
        processDescription: processDescription.trim() || null,
        notes: notes.trim() || null,
        rollIds: selectedRolls.map((r) => r.id),
      });
      showToast({ type: 'success', message: t('processingNew.createdSuccess', { jobNo: res.data.jobNo }) });
      navigate(`/purchases/external-jobs/${res.data.id}`);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('processingNew.createFailed') });
    } finally {
      setSaving(false);
    }
  };

  const selectedPrepType = prepTypes.find((p) => p.id === preparationTypeId);
  const selectedSupplier = suppliers.find((s) => s.id === supplierId);
  const selectedWarehouse = warehouses.find((w) => w.id === sourceWarehouseId);

  return (
    <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/purchases/external-jobs')} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Scissors className="w-6 h-6 text-emerald-600" /> {t('processingNew.title')}
          </h2>
          <p className="text-slate-500 mt-1 text-sm">{t('processingNew.subtitle')}</p>
        </div>
      </div>

      {/* Step 1: stage */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="font-bold text-slate-800 mb-3">{t('processingNew.stageStepTitle')}</h3>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setFabricStage('RAW')}
            className={`flex flex-col items-center gap-2 p-6 rounded-xl border-2 transition ${
              fabricStage === 'RAW' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:border-amber-300'
            }`}
          >
            <Layers className={`w-8 h-8 ${fabricStage === 'RAW' ? 'text-amber-600' : 'text-slate-400'}`} />
            <span className="font-bold text-slate-800">{t('processingNew.stageRaw')}</span>
          </button>
          <button
            type="button"
            onClick={() => setFabricStage('FINISHED')}
            className={`flex flex-col items-center gap-2 p-6 rounded-xl border-2 transition ${
              fabricStage === 'FINISHED' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-emerald-300'
            }`}
          >
            <Droplet className={`w-8 h-8 ${fabricStage === 'FINISHED' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className="font-bold text-slate-800">{t('processingNew.stageFinished')}</span>
          </button>
        </div>
      </div>

      {fabricStage && (
        <>
          {/* Step 2: selectors */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
            <h3 className="font-bold text-slate-800">{t('processingNew.detailsStepTitle')}</h3>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-slate-700">{t('processingNew.preparationTypeLabel')}</label>
                  <button type="button" onClick={() => setPrepManageOpen(true)} className="text-slate-400 hover:text-emerald-600" title={t('processingNew.managePrepTypes')}>
                    <Settings className="w-4 h-4" />
                  </button>
                </div>
                <select
                  value={preparationTypeId}
                  onChange={(e) => setPreparationTypeId(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">{t('processingNew.choosePrepType')}</option>
                  {prepTypes.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700">{t('processingNew.partyLabel')}</label>
                <input
                  type="text"
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  placeholder={t('processingNew.partySearchPlaceholder')}
                  className="w-full p-2 mb-1 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">{t('processingNew.chooseParty')}</option>
                  {filteredSuppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {suppliers.length === 0 && (
                  <p className="text-xs text-amber-700">{t('processingNew.noSuppliersAtAll')}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700">{t('processingNew.sourceWarehouseLabel')}</label>
                <select
                  value={sourceWarehouseId}
                  onChange={(e) => setSourceWarehouseId(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">{t('processingNew.chooseWarehouse')}</option>
                  {matchingWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                {matchingWarehouses.length === 0 && (
                  <p className="text-xs text-amber-700">{t('processingNew.noWarehousesAtAll')}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">{t('processingNew.processDescriptionLabel')}</label>
              <textarea
                value={processDescription}
                onChange={(e) => setProcessDescription(e.target.value)}
                rows={2}
                placeholder={t('processingNew.processDescriptionPlaceholder')}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">{t('processingNew.notesLabel')}</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {(selectedPrepType || selectedSupplier || selectedWarehouse) && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 grid sm:grid-cols-2 gap-1.5 text-sm">
                {selectedSupplier && <div><span className="text-slate-500">{t('processingNew.summaryParty')}: </span><strong>{selectedSupplier.name}</strong></div>}
                {selectedPrepType && <div><span className="text-slate-500">{t('processingNew.summaryPrepType')}: </span><strong>{selectedPrepType.name}</strong></div>}
                <div><span className="text-slate-500">{t('processingNew.summaryOrderNo')}: </span><strong>{t('processingNew.assignedOnSave')}</strong></div>
                <div><span className="text-slate-500">{t('processingNew.summaryDispatchNo')}: </span><strong>{t('processingNew.assignedOnSave')}</strong></div>
              </div>
            )}
          </div>

          {/* Roll selection */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
            <h3 className="font-bold text-slate-800">{t('processingNew.rollsLabel')}</h3>
            <div className="relative">
              <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={rollQuery}
                onChange={(e) => setRollQuery(e.target.value)}
                onKeyDown={(e) => void handleScanKeyDown(e)}
                disabled={!sourceWarehouseId}
                placeholder={sourceWarehouseId ? t('processingNew.rollScanPlaceholder') : t('processingNew.chooseWarehouseFirst')}
                className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                dir="ltr"
              />
            </div>
            {searching && <p className="text-xs text-slate-400">{t('processingNew.searching')}</p>}
            {rollResults.length > 0 && (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-40 overflow-y-auto">
                {rollResults.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => addRoll(r)}
                    className="w-full text-right px-3 py-2 text-sm hover:bg-emerald-50 flex items-center justify-between gap-2"
                  >
                    <span className="font-mono text-xs text-slate-500" dir="ltr">{r.barcode}</span>
                    <span className="font-medium text-slate-800">{r.item_name}</span>
                    <span className="text-xs text-slate-500">{r.color_name_ar}</span>
                    <span className="text-xs text-slate-500">{r.length_m} {t('meterAbbr')}</span>
                  </button>
                ))}
              </div>
            )}

            {selectedRolls.length > 0 ? (
              <div className="overflow-x-auto border border-emerald-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-emerald-50 text-emerald-700">
                    <tr>
                      <th className="px-3 py-2 text-right">{t('processingNew.colBarcode')}</th>
                      <th className="px-3 py-2 text-right">{t('processingNew.colItem')}</th>
                      <th className="px-3 py-2 text-right">{t('processingNew.colColor')}</th>
                      <th className="px-3 py-2 text-right">{t('processingNew.colLength')}</th>
                      <th className="px-3 py-2 text-right">{t('processingNew.colWeight')}</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedRolls.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600" dir="ltr">{r.barcode}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{r.item_name}</td>
                        <td className="px-3 py-2 text-slate-600">{r.color_name_ar} {r.color_code ? `(${r.color_code})` : ''}</td>
                        <td className="px-3 py-2 font-mono text-slate-600">{r.length_m}</td>
                        <td className="px-3 py-2 font-mono text-slate-600">{r.actual_weight_kg ?? r.calculated_weight_kg ?? '—'}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => removeRoll(r.id)} className="text-rose-500 hover:text-rose-700">
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold">
                    <tr>
                      <td colSpan={3} className="px-3 py-2">{t('processingNew.totalsLabel', { count: selectedRolls.length })}</td>
                      <td className="px-3 py-2 font-mono">{totals.totalM.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono">{totals.totalKg.toFixed(2)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-400">{t('processingNew.noRollsSelected')}</p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => void handleSave()}
              disabled={!canSave || saving}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {t('processingNew.save')}
            </button>
          </div>
        </>
      )}

      {prepManageOpen && (
        <PreparationTypesModal
          types={prepTypes}
          onClose={() => setPrepManageOpen(false)}
          onChanged={() => void loadPrepTypes()}
        />
      )}
    </div>
  );
};

const PreparationTypesModal = ({
  types,
  onClose,
  onChanged,
}: {
  types: PreparationType[];
  onClose: () => void;
  onChanged: () => void;
}) => {
  const { t } = useTranslation('externalJobs');
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [wastePct, setWastePct] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!name.trim()) {
      showToast({ type: 'error', message: t('processingNew.prepTypeNameRequired') });
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updatePreparationType(editingId, {
          name: name.trim(),
          defaultWastePct: wastePct.trim() ? Number(wastePct) : null,
        });
      } else {
        await createPreparationType({
          name: name.trim(),
          defaultWastePct: wastePct.trim() ? Number(wastePct) : null,
        });
      }
      setName('');
      setWastePct('');
      setEditingId(null);
      onChanged();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('processingNew.prepTypeSaveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (p: PreparationType) => {
    setEditingId(p.id);
    setName(p.name);
    setWastePct(p.default_waste_pct != null ? String(p.default_waste_pct) : '');
  };

  const toggleActive = async (p: PreparationType) => {
    try {
      await updatePreparationType(p.id, { isActive: !p.is_active });
      onChanged();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('processingNew.prepTypeSaveFailed') });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-lg font-bold text-slate-900">{t('processingNew.managePrepTypesTitle')}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('processingNew.prepTypeNamePlaceholder')}
              className="flex-1 p-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={wastePct}
              onChange={(e) => setWastePct(e.target.value)}
              placeholder={t('processingNew.prepTypeWastePlaceholder')}
              className="w-28 p-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              dir="ltr"
            />
            <button
              onClick={() => void handleAdd()}
              disabled={saving}
              className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1"
            >
              {editingId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            </button>
          </div>
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-60 overflow-y-auto">
            {types.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-400 text-center">{t('processingNew.noPrepTypesYet')}</p>
            ) : types.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className={p.is_active ? 'font-medium text-slate-800' : 'text-slate-400 line-through'}>{p.name}</span>
                  {p.default_waste_pct != null && (
                    <span className="text-xs text-slate-400">({p.default_waste_pct}%)</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => startEdit(p)} className="text-slate-400 hover:text-emerald-600"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => void toggleActive(p)} className="text-xs font-bold text-slate-500 hover:text-rose-600">
                    {p.is_active ? t('processingNew.deactivate') : t('processingNew.activate')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
