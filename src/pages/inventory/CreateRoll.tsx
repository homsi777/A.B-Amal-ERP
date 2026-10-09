import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, ArrowRight, ScanLine, Calculator, Printer, VolumeX, Link2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { createFabricRoll } from '../../lib/api/fabricRollsApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listWarehouses, listLocations, type ApiWarehouse, type ApiWarehouseLocation } from '../../lib/api/warehousesApi';
import { getCategoryTree, type ApiCategory } from '../../lib/api/fabricCategoriesApi';
import { resolveFabricClassification } from '../../lib/api/fabricClassificationApi';
import { autoPrintLabel } from '../../lib/printing/autoPrintLabel';
import { useElectronSettings } from '../../lib/electron/useElectronSettings';
import { buildRollQrPayload } from '../../lib/labels/buildRollQrPayload';
import { ApiRequestError } from '../../lib/api/client';
import type { AdHocLabelInput } from '../../components/labels/LabelCard';

const ROLL_AUTO_PRINT_KEY = 'inventory_create_roll_auto_print';
const RETAIN_ROLL_ENTRY_KEY = 'inventory_create_roll_retain_fields';

function findCategoryById(tree: ApiCategory[], id: string): ApiCategory | null {
  for (const n of tree) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const inner = findCategoryById(n.children, id);
      if (inner) return inner;
    }
  }
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcWeight(lengthM: number, widthCm: number, gsm: number): number | null {
  if (lengthM >= 0 && widthCm > 0 && gsm > 0) {
    return parseFloat((lengthM * (widthCm / 100) * (gsm / 1000)).toFixed(3));
  }
  return null;
}

function normalizeSevenDigitBarcode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 7);
}

// ─── Form field ──────────────────────────────────────────────────────────────

const Field = ({
  label, required, children,
}: { label: string; required?: boolean; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <label className="block text-sm font-bold text-slate-700">
      {label}
      {required && <span className="text-rose-500 mr-1">*</span>}
    </label>
    {children}
  </div>
);

const inputCls = 'w-full p-2.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition text-sm';

// ─── Page ─────────────────────────────────────────────────────────────────────

export const CreateRoll = () => {
  const { t } = useTranslation('createRoll');
  const navigate = useNavigate();

  const [categoryTree, setCategoryTree] = useState<ApiCategory[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeErr, setTreeErr] = useState('');
  const [catL1Id, setCatL1Id] = useState('');
  const [catL2Id, setCatL2Id] = useState('');
  const [catL3Id, setCatL3Id] = useState('');

  const level2Options = useMemo(() => {
    if (!catL1Id) return [];
    const n = findCategoryById(categoryTree, catL1Id);
    return n?.children?.filter((c) => c.is_active !== false) ?? [];
  }, [categoryTree, catL1Id]);

  const level3Options = useMemo(() => {
    if (!catL2Id) return [];
    const n = findCategoryById(categoryTree, catL2Id);
    return n?.children?.filter((c) => c.is_active !== false) ?? [];
  }, [categoryTree, catL2Id]);

  const l3Node = catL3Id ? findCategoryById(categoryTree, catL3Id) : null;
  const swatchColor =
    l3Node && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(l3Node.code.trim())
      ? l3Node.code.trim()
      : '#e5e7eb';

  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [locations, setLocations] = useState<ApiWarehouseLocation[]>([]);
  const [masterLoading, setMasterLoading] = useState(true);

  const [barcode, setBarcode] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [lengthM, setLengthM] = useState<number | ''>('');
  const [widthCm, setWidthCm] = useState<number | ''>('');
  const [gsm, setGsm] = useState<number | ''>('');
  const [actualWeightKg, setActualWeightKg] = useState<number | ''>('');
  const [unitCost, setUnitCost] = useState<number | ''>('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [containerNo, setContainerNo] = useState('');
  const [purchaseInvoiceNo, setPurchaseInvoiceNo] = useState('');
  const [supplierRollRef, setSupplierRollRef] = useState('');
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [printWarn, setPrintWarn] = useState('');
  const [retainFields, setRetainFields] = useState(
    () => localStorage.getItem(RETAIN_ROLL_ENTRY_KEY) !== 'false',
  );
  const setRetainPersist = (v: boolean) => {
    setRetainFields(v);
    localStorage.setItem(RETAIN_ROLL_ENTRY_KEY, String(v));
  };

  const { settings } = useElectronSettings();
  const [autoPrint, setAutoPrintState] = useState<boolean>(
    () => localStorage.getItem(ROLL_AUTO_PRINT_KEY) === 'true',
  );
  const setAutoPrint = (v: boolean) => {
    setAutoPrintState(v);
    localStorage.setItem(ROLL_AUTO_PRINT_KEY, String(v));
  };

  const calculatedWeight =
    typeof lengthM === 'number' && typeof widthCm === 'number' && typeof gsm === 'number'
      ? calcWeight(lengthM, widthCm, gsm)
      : null;

  const loadMasterData = useCallback(async () => {
    setMasterLoading(true);
    try {
      const [tree, sRes, whs] = await Promise.all([
        getCategoryTree().catch(() => {
          setTreeErr(t('treeLoadError'));
          return [] as ApiCategory[];
        }),
        listSuppliers({ pageSize: 500 }),
        listWarehouses(),
      ]);
      setCategoryTree(tree);
      if (tree.length > 0) setTreeErr('');
      setSuppliers(sRes.data);
      setWarehouses(whs);
      if (whs.length > 0) setWarehouseId(whs[0].id);
    } catch {
      setError(t('masterLoadError'));
    } finally {
      setTreeLoading(false);
      setMasterLoading(false);
    }
  }, []);

  useEffect(() => { void loadMasterData(); }, [loadMasterData]);

  useEffect(() => {
    if (!warehouseId) { setLocations([]); setLocationId(''); return; }
    listLocations(warehouseId).then(res => setLocations(res)).catch(() => setLocations([]));
    setLocationId('');
  }, [warehouseId]);

  const handleSave = async () => {
    setError('');
    setSuccess('');
    setPrintWarn('');
    if (!catL1Id || !catL2Id || !catL3Id) {
      setError(t('chooseCategoryChain'));
      return;
    }
    if (!warehouseId) { setError(t('warehouseRequired')); return; }
    if (lengthM === '' || lengthM < 0) { setError(t('lengthMustBePositive')); return; }
    if (widthCm === '' || Number(widthCm) <= 0) { setError(t('widthRequired')); return; }
    if (gsm === '' || Number(gsm) <= 0) { setError(t('gsmRequired')); return; }

    setSaving(true);
    try {
      const w = typeof widthCm === 'number' ? widthCm : null;
      const g = typeof gsm === 'number' ? gsm : null;

      const resolved = await resolveFabricClassification({
        level1CategoryId: catL1Id,
        level2CategoryId: catL2Id,
        level3CategoryId: catL3Id,
        level4CategoryId: catL3Id, // temporary, assuming same
        widthCm: w,
        gsm: g,
      });

      const roll = await createFabricRoll({
        barcode: barcode.trim() || undefined,
        rollNo: rollNo.trim() || undefined,
        itemId: resolved.itemId,
        colorId: resolved.colorId,
        variantId: resolved.variantId ?? undefined,
        supplierId: supplierId || undefined,
        warehouseId,
        locationId: locationId || undefined,
        lengthM: Number(lengthM),
        widthCm: w ?? undefined,
        gsm: g ?? undefined,
        actualWeightKg: typeof actualWeightKg === 'number' ? actualWeightKg : undefined,
        unitCost: typeof unitCost === 'number' ? unitCost : undefined,
        currencyCode: currencyCode || undefined,
        batchNo: batchNo || undefined,
        containerNo: containerNo || undefined,
        purchaseInvoiceNo: purchaseInvoiceNo || undefined,
        supplierRollRef: supplierRollRef || undefined,
        notes: notes || undefined,
      });

      const l1 = findCategoryById(categoryTree, catL1Id);
      const wh = warehouses.find((x) => x.id === warehouseId);
      const qrPayload = buildRollQrPayload({
        rollId: roll.id,
        barcode: roll.barcode,
        lot: rollNo.trim() || roll.roll_no || '',
        articleCode: resolved.articleCode,
        fabricName: l1?.name ?? resolved.articleCode,
        fabricColor: resolved.fabricColorName,
        colorCode: resolved.colorCode,
        widthCm: w,
        gsm: g,
        lengthM: Number(lengthM),
        weightKg: typeof actualWeightKg === 'number' ? actualWeightKg : calculatedWeight,
        warehouse: wh?.code ?? wh?.name ?? null,
        createdAt: roll.created_at ?? new Date().toISOString(),
      });

      const printInput: AdHocLabelInput = {
        barcode: roll.barcode,
        qrPayload,
        rollNo: rollNo.trim() || roll.roll_no || roll.barcode,
        itemName: (l1?.name ?? resolved.articleCode) || resolved.articleCode,
        internalCode: resolved.designNr ?? resolved.articleCode,
        supplierCode: null,
        colorNameAr: resolved.fabricColorName,
        colorNameTr: null,
        colorCode: resolved.colorCode,
        lengthM: Number(lengthM),
        widthCm: w,
        gsm: g,
        actualWeightKg: typeof actualWeightKg === 'number' ? actualWeightKg : null,
        calculatedWeightKg: calculatedWeight,
        warehouseName: wh?.name ?? null,
        batchNo: batchNo || null,
        containerNo: containerNo || null,
        purchaseInvoiceNo: purchaseInvoiceNo || null,
        supplierRollRef: supplierRollRef || null,
      };

      if (autoPrint) {
        if (
          typeof window !== 'undefined'
          && window.fabricApp?.isElectron
          && !settings?.defaultLabelPrinterName
        ) {
          setPrintWarn(t('noDefaultPrinterWarning'));
        }
        try {
          await autoPrintLabel({ settings, input: printInput });
        } catch {
          setPrintWarn((pw) => pw || t('autoPrintFailedWarning'));
        }
      }

      setSuccess(t('saveSuccess'));

      if (retainFields) {
        setLengthM('');
        setActualWeightKg('');
      } else {
        setBarcode('');
        setRollNo('');
        setCatL1Id('');
        setCatL2Id('');
        setCatL3Id('');
        setLengthM('');
        setWidthCm('');
        setGsm('');
        setActualWeightKg('');
        setNotes('');
      }
    } catch (e: unknown) {
      if (e instanceof ApiRequestError && e.statusCode === 409) {
        setError(t('barcodeExists'));
      } else {
        setError(e instanceof ApiRequestError ? e.message : t('unexpectedError'));
      }
    } finally {
      setSaving(false);
    }
  };

  if (masterLoading && treeLoading) {
    return (
      <div className="flex items-center justify-center h-64" dir="rtl">
        <div className="text-center text-slate-400">
          <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" />
          <p>{t('loadingMasterData')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{t('pageTitle')}</h2>
            <p className="text-slate-500 mt-1">{t('pageSubtitle')}</p>
          </div>
        </div>
        <div className="flex gap-3 items-center flex-wrap">
          <button
            type="button"
            onClick={() => setAutoPrint(!autoPrint)}
            title={autoPrint
              ? (settings?.silentLabelPrintingEnabled && settings?.defaultLabelPrinterName
                  ? t('silentPrintTo', { printer: settings.defaultLabelPrinterName })
                  : t('printDialogWillOpen'))
              : t('enableAutoPrintAfterSave')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition text-sm font-bold ${
              autoPrint
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {autoPrint && settings?.silentLabelPrintingEnabled && settings?.defaultLabelPrinterName
              ? <VolumeX className="w-4 h-4" />
              : <Printer className="w-4 h-4" />}
            <span className="flex flex-col items-start leading-tight">
              <span>{autoPrint ? t('autoPrintEnabled') : t('autoPrintDisabled')}</span>
              {autoPrint && settings?.defaultLabelPrinterName && (
                <span className="text-[10px] font-normal text-emerald-600 truncate max-w-[160px]" dir="ltr">
                  {settings.defaultLabelPrinterName}
                </span>
              )}
            </span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/inventory')}
            className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition text-sm"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="bg-indigo-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition font-bold text-sm disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? t('saving') : t('saveRoll')}
          </button>
        </div>
      </div>

      {treeErr && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 text-sm">{treeErr}</div>
      )}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 font-bold text-sm">{error}</div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-4 font-bold text-sm">{success}</div>
      )}
      {printWarn && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 text-sm font-medium">{printWarn}</div>
      )}

      {calculatedWeight !== null && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center gap-3 text-indigo-800">
          <Calculator className="w-5 h-5 shrink-0" />
          <span className="font-bold">
            {t('calculatedWeightLine', { length: lengthM, width: Number(widthCm) / 100, gsm })}
            = <span className="text-indigo-600 text-lg">{calculatedWeight} kg</span>
          </span>
        </div>
      )}

      <label className="flex items-center gap-3 cursor-pointer select-none rounded-xl border border-slate-200 bg-white p-4">
        <input
          type="checkbox"
          checked={retainFields}
          onChange={(e) => setRetainPersist(e.target.checked)}
          className="w-4 h-4 rounded text-indigo-600"
        />
        <span className="text-sm font-bold text-slate-800">{t('retainFieldsLabel')}</span>
      </label>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 bg-slate-50 border-b border-slate-200">
          <h3 className="font-bold text-slate-800">{t('rollDataTitle')}</h3>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

          {!treeLoading && categoryTree.length === 0 && (
            <div className="col-span-full rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              {t('noCategoriesYet')}{' '}
              <Link to="/inventory/categories" className="inline-flex items-center gap-1 font-bold text-indigo-700 underline">
                <Link2 className="w-4 h-4" />
                {t('openCategoriesLink')}
              </Link>
            </div>
          )}

          <Field label={t('materialCodeLabel')} required>
            <select
              value={catL1Id}
              onChange={(e) => {
                setCatL1Id(e.target.value);
                setCatL2Id('');
                setCatL3Id('');
              }}
              disabled={treeLoading}
              className={inputCls}
            >
              <option value="">{t('chooseMaterialCode')}</option>
              {categoryTree.filter((c) => c.is_active !== false).map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          </Field>

          <Field label={t('materialColorLabel')} required>
            <select
              value={catL2Id}
              onChange={(e) => {
                setCatL2Id(e.target.value);
                setCatL3Id('');
              }}
              disabled={!catL1Id || level2Options.length === 0}
              className={inputCls}
            >
              <option value="">{t('chooseMaterialColor')}</option>
              {level2Options.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          </Field>

          <Field label={t('colorCodeLabel')} required>
            <div className="flex gap-2">
              <div
                className="w-12 shrink-0 rounded-lg border border-slate-300"
                style={{ backgroundColor: swatchColor }}
              />
              <select
                value={catL3Id}
                onChange={(e) => setCatL3Id(e.target.value)}
                disabled={!catL2Id || level3Options.length === 0}
                className={`${inputCls} flex-1`}
                dir="ltr"
              >
                <option value="">{t('chooseColorCode')}</option>
                {level3Options.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </select>
            </div>
          </Field>

          <Field label={t('barcodeLabel')}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={barcode}
                  onChange={e => setBarcode(normalizeSevenDigitBarcode(e.target.value))}
                  maxLength={7}
                  inputMode="numeric"
                  placeholder={t('barcodePlaceholder')}
                  className={`${inputCls} pr-9`}
                  dir="ltr"
                />
              </div>
            </div>
          </Field>

          <Field label={t('rollNoLabel')}>
            <input
              type="text"
              value={rollNo}
              onChange={e => setRollNo(e.target.value)}
              placeholder={t('rollNoPlaceholder')}
              className={inputCls}
            />
          </Field>

          <Field label={t('supplierLabel')}>
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className={inputCls}>
              <option value="">{t('noSupplierOption')}</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>

          <Field label={t('warehouseLabel')} required>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={inputCls}>
              <option value="">{t('chooseWarehouseOption')}</option>
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </Field>

          <Field label={t('locationLabel')}>
            <select value={locationId} onChange={e => setLocationId(e.target.value)} className={inputCls}>
              <option value="">{t('noLocationOption')}</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </Field>

          <Field label={t('lengthLabel')} required>
            <input
              type="number"
              value={lengthM}
              min={0}
              step="0.001"
              onChange={e => setLengthM(e.target.value === '' ? '' : parseFloat(e.target.value))}
              placeholder={t('lengthPlaceholder')}
              className={inputCls}
              dir="ltr"
            />
          </Field>

          <Field label={t('widthLabel')} required>
            <input
              type="number"
              value={widthCm}
              min={0}
              step="0.1"
              onChange={e => setWidthCm(e.target.value === '' ? '' : parseFloat(e.target.value))}
              placeholder={t('widthPlaceholder')}
              className={inputCls}
              dir="ltr"
            />
          </Field>

          <Field label={t('gsmLabel')} required>
            <input
              type="number"
              value={gsm}
              min={0}
              step="1"
              onChange={e => setGsm(e.target.value === '' ? '' : parseFloat(e.target.value))}
              placeholder={t('gsmPlaceholder')}
              className={inputCls}
              dir="ltr"
            />
          </Field>

          <Field label={t('actualWeightLabel')}>
            <input
              type="number"
              value={actualWeightKg}
              min={0}
              step="0.001"
              onChange={e => setActualWeightKg(e.target.value === '' ? '' : parseFloat(e.target.value))}
              placeholder={calculatedWeight !== null ? t('calculatedPlaceholder', { weight: calculatedWeight }) : t('actualWeightPlaceholder')}
              className={inputCls}
              dir="ltr"
            />
          </Field>

          <Field label={t('unitCostLabel')}>
            <input
              type="number"
              value={unitCost}
              min={0}
              step="0.0001"
              onChange={e => setUnitCost(e.target.value === '' ? '' : parseFloat(e.target.value))}
              placeholder="0.0000"
              className={inputCls}
              dir="ltr"
            />
          </Field>

          <Field label={t('currencyLabel')}>
            <input
              type="text"
              value={currencyCode}
              onChange={e => setCurrencyCode(e.target.value.toUpperCase())}
              placeholder="USD / EUR / SAR"
              className={inputCls}
              dir="ltr"
              maxLength={3}
            />
          </Field>

          <Field label={t('batchNoLabel')}>
            <input
              type="text"
              value={batchNo}
              onChange={e => setBatchNo(e.target.value)}
              placeholder={t('optional')}
              className={inputCls}
            />
          </Field>

          <Field label={t('containerNoLabel')}>
            <input
              type="text"
              value={containerNo}
              onChange={e => setContainerNo(e.target.value)}
              placeholder={t('optional')}
              className={inputCls}
            />
          </Field>

          <Field label={t('purchaseInvoiceNoLabel')}>
            <input
              type="text"
              value={purchaseInvoiceNo}
              onChange={e => setPurchaseInvoiceNo(e.target.value)}
              placeholder={t('optional')}
              className={inputCls}
            />
          </Field>

          <Field label={t('supplierRollRefLabel')}>
            <input
              type="text"
              value={supplierRollRef}
              onChange={e => setSupplierRollRef(e.target.value)}
              placeholder={t('supplierRollRefPlaceholder')}
              className={inputCls}
              dir="ltr"
            />
          </Field>

          <div className="col-span-full">
            <Field label={t('notesLabel')}>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder={t('notesPlaceholder')}
                className={`${inputCls} resize-none`}
              />
            </Field>
          </div>

        </div>
      </div>
    </div>
  );
};
