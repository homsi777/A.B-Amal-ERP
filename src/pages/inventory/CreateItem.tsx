import React, { useState, useEffect, useMemo } from 'react';
import { Save, FileText, ArrowRight, ScanLine, ImagePlus, Upload, X, Printer } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { autoPrintLabel } from '../../lib/printing/autoPrintLabel';
import { useElectronSettings } from '../../lib/electron/useElectronSettings';
import type { AdHocLabelInput } from '../../components/labels/LabelCard';
import { ApiRequestError, getApiBaseUrl, getStoredToken } from '../../lib/api/client';
import { createFabricItem, listFabricItems, updateFabricItem } from '../../lib/api/fabricItemsApi';
import { createFabricRoll } from '../../lib/api/fabricRollsApi';
import { createFabricColor, listFabricColors, type ApiFabricColor } from '../../lib/api/fabricColorsApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { getCategoryTree, type ApiCategory } from '../../lib/api/fabricCategoriesApi';
import { resolveFabricClassification } from '../../lib/api/fabricClassificationApi';
import { buildRollQrPayload } from '../../lib/labels/buildRollQrPayload';
import { HIDE_FABRIC_COLOR_UI } from '../../lib/inventoryUiConfig';

const INVENTORY_SHOW_ITEM_IMAGE_KEY = 'inventory_show_item_image_upload';
const INVENTORY_LOW_STOCK_THRESHOLD_KEY = 'inventory_low_stock_threshold';
const INVENTORY_AUTO_PRINT_KEY = 'inventory_create_item_auto_print';
const RETAIN_ENTRY_FIELDS_KEY = 'inventory_create_item_retain_fields';

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

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function getCategoryValue(category: ApiCategory | null, fallback = ''): string {
  return (category?.name || category?.code || fallback).trim();
}

function isPlaceholderColorCode(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return !trimmed || trimmed === '#000000' || trimmed === '#000' || trimmed === '000000';
}

function resolveColorFields(params: {
  selectedColor: ApiCategory | null;
  selectedColorCode: ApiCategory | null;
  manualColorName: string;
  manualColorCode: string;
}): { colorName: string; colorCode: string } {
  const colorName = getCategoryValue(params.selectedColor, params.manualColorName.trim());
  let colorCode = '';
  if (params.selectedColorCode) {
    colorCode = getCategoryValue(params.selectedColorCode, '');
  } else if (params.selectedColor) {
    colorCode = getCategoryValue(params.selectedColor, '');
  } else if (!isPlaceholderColorCode(params.manualColorCode)) {
    colorCode = params.manualColorCode.trim();
  } else if (colorName) {
    colorCode = colorName;
  }
  return { colorName, colorCode };
}

function findMatchingFabricColor(
  colors: ApiFabricColor[],
  colorCode: string,
  colorName: string,
): ApiFabricColor | undefined {
  const code = colorCode.trim();
  const name = colorName.trim();
  if (!code && !name) return undefined;

  const exact = colors.find(
    (color) => sameText(color.color_code, code) && sameText(color.name_ar, name),
  );
  if (exact) return exact;

  if (name && code && !isPlaceholderColorCode(code)) return undefined;
  if (name) return colors.find((color) => sameText(color.name_ar, name));
  if (code && !isPlaceholderColorCode(code)) {
    return colors.find((color) => sameText(color.color_code, code));
  }
  return undefined;
}

async function ensureFabricColorId(colorName: string, colorCode: string): Promise<string | null> {
  if (!colorName && !colorCode) return null;
  const resolvedColorCode = colorCode || colorName;
  const resolvedColorName = colorName || colorCode;
  const searchTerm = resolvedColorName || resolvedColorCode;
  const listed = (await listFabricColors({ search: searchTerm, pageSize: 100 })).data;
  let apiColor = findMatchingFabricColor(listed, resolvedColorCode, resolvedColorName);
  if (!apiColor) {
    apiColor = await createFabricColor({
      name_ar: resolvedColorName,
      color_code: resolvedColorCode,
      notes: 'تم إنشاؤه تلقائياً من شاشة إنشاء مادة جديدة.',
    });
  }
  return apiColor.id;
}

function sameText(a: string | null | undefined, b: string): boolean {
  return normalizeText(a ?? '') === normalizeText(b);
}

function normalizeSevenDigitBarcode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 7);
}

export const CreateItem = () => {
  const { addFabric, updateFabric, inventory, warehouses } = useStore();
  const navigate = useNavigate();
  const { id } = useParams();
  const editingItem = id ? inventory.find(item => item.id === id) : null;
  const isEditMode = Boolean(editingItem);

  const { settings } = useElectronSettings();
  const [apiWarehouses, setApiWarehouses] = useState<ApiWarehouse[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [lastSavedPrintInput, setLastSavedPrintInput] = useState<AdHocLabelInput | null>(null);

  const localActiveWarehouses = warehouses.filter(w => w.status === 'active');
  const activeWarehouses = apiWarehouses.length > 0
    ? apiWarehouses.filter(w => w.is_active).map(w => ({
        id: w.id,
        name: w.name,
        location: w.address || w.code,
      }))
    : localActiveWarehouses;

  const [categoryApiTree, setCategoryApiTree] = useState<ApiCategory[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeLoadErr, setTreeLoadErr] = useState('');
  const [catL1Id, setCatL1Id] = useState('');
  const [catL2Id, setCatL2Id] = useState('');
  const [catL3Id, setCatL3Id] = useState('');
  const [catL4Id, setCatL4Id] = useState('');

  const level2Options = useMemo(() => {
    if (!catL1Id) return [];
    const n = findCategoryById(categoryApiTree, catL1Id);
    return n?.children?.filter((c) => c.is_active !== false) ?? [];
  }, [categoryApiTree, catL1Id]);

  const level3Options = useMemo(() => {
    if (!catL2Id) return [];
    const n = findCategoryById(categoryApiTree, catL2Id);
    return n?.children?.filter((c) => c.is_active !== false) ?? [];
  }, [categoryApiTree, catL2Id]);

  const level4Options = useMemo(() => {
    if (!catL3Id) return [];
    const n = findCategoryById(categoryApiTree, catL3Id);
    return n?.children?.filter((c) => c.is_active !== false) ?? [];
  }, [categoryApiTree, catL3Id]);

  const [name, setName] = useState('');
  const [warehouseId, setWarehouseId] = useState(activeWarehouses[0]?.id || '');
  const [barcode, setBarcode] = useState('');
  const [lotNumber, setLotNumber] = useState('');

  const materialNameSuggestions = useMemo(() => {
    const q = normalizeText(name);
    const roots = categoryApiTree.filter((c) => c.is_active !== false);
    if (!q) return roots.slice(0, 8);
    return roots
      .filter((c) => normalizeText(c.name).includes(q) || normalizeText(c.code).includes(q))
      .slice(0, 8);
  }, [categoryApiTree, name]);

  const generateBarcode = () => {
    setBarcode(String(Math.floor(1000000 + Math.random() * 9000000)));
  };

  /** Legacy edit-mode fields (local catalog) */
  const [fabricCode, setFabricCode] = useState('');
  const [colorName, setColorName] = useState('');
  const [colorCode, setColorCode] = useState('#000000');
  
  const [lengthType, setLengthType] = useState<'meter' | 'yard'>('meter');
  const [length, setLength] = useState<number | ''>('');
  const [weight, setWeight] = useState<number | ''>('');
  const [weightMultiplier, setWeightMultiplier] = useState<number | ''>(150);
  
  const [widthUnit, setWidthUnit] = useState<'inch' | 'cm'>('cm');
  const [rollWidth, setRollWidth] = useState<number | ''>(150);
  
  const [costPrice, setCostPrice] = useState<number | ''>('');
  const [sellingPrice, setSellingPrice] = useState<number | ''>('');
  
  const [successMessage, setSuccessMessage] = useState('');
  const [printWarning, setPrintWarning] = useState('');
  const [retainEntryFields, setRetainEntryFields] = useState(
    () => localStorage.getItem(RETAIN_ENTRY_FIELDS_KEY) !== 'false',
  );
  const setRetainFieldsPersist = (v: boolean) => {
    setRetainEntryFields(v);
    localStorage.setItem(RETAIN_ENTRY_FIELDS_KEY, String(v));
  };
  const [autoPrint, setAutoPrintState] = useState<boolean>(
    () => localStorage.getItem(INVENTORY_AUTO_PRINT_KEY) === 'true',
  );
  // Wrapper that persists the toggle so the user's preference survives reloads
  // and is restored next time they open the form.
  const setAutoPrint = (value: boolean) => {
    setAutoPrintState(value);
    localStorage.setItem(INVENTORY_AUTO_PRINT_KEY, String(value));
  };
  const [showImageUpload, setShowImageUpload] = useState(() => localStorage.getItem(INVENTORY_SHOW_ITEM_IMAGE_KEY) === 'true');
  const [imageUrl, setImageUrl] = useState('');
  const lengthInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!getApiBaseUrl() || !getStoredToken()) return;
    let cancelled = false;

    listWarehouses({ status: 'active' })
      .then((rows) => {
        if (cancelled) return;
        setApiWarehouses(rows);
        if (!warehouseId && rows[0]?.id) setWarehouseId(rows[0].id);
      })
      .catch(() => {
        if (!cancelled) setApiWarehouses([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!getApiBaseUrl() || !getStoredToken()) {
      setTreeLoading(false);
      return;
    }
    setTreeLoading(true);
    getCategoryTree()
      .then((t) => {
        setCategoryApiTree(t);
        setTreeLoadErr('');
      })
      .catch(() => setTreeLoadErr('تعذر تحميل شجرة التصنيفات من الخادم.'))
      .finally(() => setTreeLoading(false));
  }, []);

  useEffect(() => {
    if (!catL1Id) return;
    const n = findCategoryById(categoryApiTree, catL1Id);
    if (n?.name) setName(n.name);
  }, [catL1Id, categoryApiTree]);

  const selectMaterialName = (category: ApiCategory) => {
    setName(category.name);
    setCatL1Id(category.id);
    setCatL2Id('');
    setCatL3Id('');
    setCatL4Id('');
  };

  const handleMaterialNameChange = (value: string) => {
    setName(value);
    const exact = categoryApiTree.find((c) => normalizeText(c.name) === normalizeText(value));
    setCatL1Id(exact?.id ?? '');
    setCatL2Id('');
    setCatL3Id('');
    setCatL4Id('');
  };

  useEffect(() => {
    if (!editingItem) return;

    setName(editingItem.name || '');
    setWarehouseId(editingItem.warehouseId || activeWarehouses[0]?.id || '');
    setBarcode(editingItem.barcode || '');
    setLotNumber(editingItem.lotNumber || '');
    setFabricCode(editingItem.fabricCode || '');
    setColorName(editingItem.colorName || '');
    setColorCode(editingItem.colorCode || '#000000');
    setLengthType(editingItem.lengthType || 'meter');
    setLength(editingItem.length || editingItem.meters || '');
    setWeight(editingItem.weight || '');
    setRollWidth(editingItem.rollWidth || '');
    setCostPrice(editingItem.costPrice || '');
    setSellingPrice(editingItem.sellingPrice || '');
    setImageUrl(editingItem.imageUrl || '');
  }, [editingItem]);

  useEffect(() => {
    setShowImageUpload(localStorage.getItem(INVENTORY_SHOW_ITEM_IMAGE_KEY) === 'true');
  }, []);

  const handleToggleImageUpload = (checked: boolean) => {
    setShowImageUpload(checked);
    localStorage.setItem(INVENTORY_SHOW_ITEM_IMAGE_KEY, String(checked));
  };

  useEffect(() => {
    if (length !== '' && weightMultiplier !== '' && rollWidth !== '') {
      const lengthInMeters = lengthType === 'yard' ? Number(length) * 0.9144 : Number(length);
      const widthInMeters = widthUnit === 'inch' ? Number(rollWidth) * 0.0254 : Number(rollWidth) / 100;
      const area = lengthInMeters * widthInMeters;
      const calculatedWeight = (area * Number(weightMultiplier)) / 1000;
      setWeight(parseFloat(calculatedWeight.toFixed(2)));
    } else if (length === '') {
      setWeight('');
    }
  }, [length, weightMultiplier, rollWidth, widthUnit, lengthType]);

  const lengthEquivalentText = useMemo(() => {
    const value = Number(length);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (lengthType === 'meter') return `${(value * 1.09361).toFixed(2)} ياردة`;
    return `${(value * 0.9144).toFixed(2)} متر`;
  }, [length, lengthType]);

  const printLabel = async (input: AdHocLabelInput) => {
    await autoPrintLabel({ settings, input });
  };

  const handleSave = async () => {
    if (saving) return;
    setSaveError('');
    setPrintWarning('');

    if (!name?.trim()) {
      setSaveError('اسم الخامة مطلوب.');
      return;
    }

    if (isEditMode) {
      if (!fabricCode?.trim()) {
        setSaveError('كود الخامة مطلوب في وضع التعديل.');
        return;
      }
    } else {
      if (!catL1Id || !catL2Id) {
        setSaveError(
          HIDE_FABRIC_COLOR_UI
            ? 'يرجى اختيار اسم الخامة وكود الخامة من شجرة التصنيفات.'
            : 'يرجى اختيار اسم الخامة وكود الخامة ولون الخامة وكود اللون من شجرة التصنيفات.',
        );
        return;
      }
      if (!HIDE_FABRIC_COLOR_UI && (!catL3Id || !catL4Id)) {
        setSaveError('يرجى اختيار لون الخامة وكود اللون من شجرة التصنيفات.');
        return;
      }
      if (!warehouseId) {
        setSaveError('المستودع مطلوب.');
        return;
      }
      if (length === '' || Number(length) < 0) {
        setSaveError('الطول مطلوب ويجب أن يكون رقماً صحيحاً.');
        return;
      }
      if (rollWidth === '' || Number(rollWidth) <= 0) {
        setSaveError('عرض التوب مطلوب ويجب أن يكون أكبر من صفر.');
        return;
      }
      if (weightMultiplier === '' || Number(weightMultiplier) <= 0) {
        setSaveError('وزن المتر المربع (GSM) مطلوب ويجب أن يكون أكبر من صفر.');
        return;
      }
    }

    setSaving(true);

    const selectedMaterialName = findCategoryById(categoryApiTree, catL1Id);
    const selectedMaterialCode = findCategoryById(categoryApiTree, catL2Id);
    const selectedColor = findCategoryById(categoryApiTree, catL3Id);
    const selectedColorCode = findCategoryById(categoryApiTree, catL4Id);
    const materialCodeValue = getCategoryValue(selectedMaterialCode, fabricCode.trim() || barcode.trim() || name.trim());
    const { colorName: colorNameValue, colorCode: colorCodeValue } = resolveColorFields({
      selectedColor,
      selectedColorCode,
      manualColorName: colorName,
      manualColorCode: colorCode,
    });
    const lotNumberValue = lotNumber.trim();

    const payload = {
      name,
      fabricCode: materialCodeValue,
      colorName: colorNameValue,
      colorCode: colorCodeValue,
      lotNumber: lotNumberValue || undefined,
      lengthType,
      length: Number(length) || 0,
      rollWidth: Number(rollWidth) || 0,
      weight: Number(weight) || 0,
      warehouseId,
      barcode,
      costPrice: Number(costPrice) || 0,
      sellingPrice: Number(sellingPrice) || 0,
      imageUrl,
      minStockLevel: Number(localStorage.getItem(INVENTORY_LOW_STOCK_THRESHOLD_KEY)) || 0,
      status: Number(length) > 0 ? ('available' as const) : ('out_of_stock' as const),
      type: 'عام',
      yards: lengthType === 'yard' ? Number(length) : Number(length) * 1.09361,
      meters: lengthType === 'meter' ? Number(length) : Number(length) * 0.9144,
      rollNumber: materialCodeValue,
    };

    const selectedWarehouse =
      apiWarehouses.find((w) => w.id === warehouseId)
      ?? apiWarehouses.find((w) => w.is_active)
      ?? apiWarehouses[0];

    try {
      /* ─── Edit mode: تحديث تعريف الخامة في PostgreSQL فقط (بدون ثوب جديد) ─── */
      if (isEditMode && editingItem) {
        if (!getApiBaseUrl() || !getStoredToken()) {
          updateFabric(editingItem.id, payload);
          setSuccessMessage(`تم تعديل المادة "${name}" محلياً.`);
          setSaving(false);
          return;
        }
        let apiItem = (await listFabricItems({ search: fabricCode, pageSize: 100 })).data.find(
          (item) => item.internal_code.trim().toLowerCase() === fabricCode.trim().toLowerCase(),
        );
        if (apiItem) {
          await updateFabricItem(apiItem.id, {
            name,
            internal_code: apiItem.internal_code,
            supplier_code: barcode || apiItem.supplier_code || '',
            fabric_type: apiItem.fabric_type || 'عام',
            unit: apiItem.unit || 'meter',
            notes: imageUrl ? 'تم إرفاق صورة للمادة في واجهة النظام.' : apiItem.notes || '',
            category_id: apiItem.category_id,
            supplier_id: apiItem.supplier_id,
          });
        }
        updateFabric(editingItem.id, payload);
        setSuccessMessage(`تم تعديل المادة "${name}" وحفظها في قاعدة البيانات`);
        setSaving(false);
        setTimeout(() => navigate('/inventory'), 900);
        return;
      }

      /* ─── إنشاء ثوب جديد من مسار التصنيف الثلاثي ─── */
      if (!getApiBaseUrl() || !getStoredToken()) {
        setSaveError('يجب الاتصال بالخادم لحفظ المادة في PostgreSQL.');
        setSaving(false);
        return;
      }
      if (!selectedWarehouse) {
        setSaveError('لا يوجد مستودع نشط.');
        setSaving(false);
        return;
      }

      const lengthM =
        lengthType === 'meter' ? Number(length) || 0 : (Number(length) || 0) * 0.9144;
      const widthCm =
        widthUnit === 'cm' ? Number(rollWidth) || null : (Number(rollWidth) || 0) * 2.54;
      const gsmNum = Number(weightMultiplier) || null;

      const hasFullClassification = Boolean(catL1Id && catL2Id && catL3Id && catL4Id);
      let resolved: {
        itemId: string;
        colorId: string | null;
        variantId: string | null;
        articleCode: string;
        fabricColorName: string;
        colorCode: string;
        designNr: string;
      };

      if (hasFullClassification) {
        try {
          resolved = await resolveFabricClassification({
            level1CategoryId: catL1Id,
            level2CategoryId: catL2Id,
            level3CategoryId: catL3Id,
            level4CategoryId: catL4Id,
            widthCm,
            gsm: gsmNum,
          });
        } catch (error) {
          console.warn('resolveFabricClassification failed, falling back to manual item creation logic', error);
          //Fallback: treat as non-classification path
          const internalCode = materialCodeValue || barcode.trim() || name.trim();
          let apiItem = (await listFabricItems({ search: internalCode, pageSize: 100 })).data.find(
            (item) => sameText(item.internal_code, internalCode),
          );
          if (!apiItem) {
            apiItem = (await listFabricItems({ search: name.trim(), pageSize: 100 })).data.find(
              (item) => sameText(item.name, name.trim()) || sameText(item.internal_code, internalCode),
            );
          }
          if (!apiItem) {
            try {
              apiItem = await createFabricItem({
                name: name.trim(),
                internal_code: internalCode,
                supplier_code: barcode.trim(),
                fabric_type: 'عام',
                unit: 'meter',
                notes: imageUrl ? 'تم إرفاق صورة للمادة في واجهة النظام.' : '',
                category_id: selectedMaterialName?.id ?? null,
              });
            } catch (error2) {
              if (!(error2 instanceof ApiRequestError && error2.statusCode === 409)) throw error2;
              apiItem = (await listFabricItems({ search: internalCode, pageSize: 100 })).data.find(
                (item) => sameText(item.internal_code, internalCode) || sameText(item.name, name.trim()),
              );
              if (!apiItem) throw error2;
            }
          }

          const colorId = await ensureFabricColorId(colorNameValue, colorCodeValue);

          resolved = {
            itemId: apiItem.id,
            colorId,
            variantId: null,
            articleCode: apiItem.internal_code || internalCode,
            fabricColorName: colorNameValue || 'بدون لون',
            colorCode: colorCodeValue || '',
            designNr: apiItem.internal_code || internalCode,
          };
        }
      } else {
        const internalCode = materialCodeValue || barcode.trim() || name.trim();
        let apiItem = (await listFabricItems({ search: internalCode, pageSize: 100 })).data.find(
          (item) => sameText(item.internal_code, internalCode),
        );
        if (!apiItem) {
          apiItem = (await listFabricItems({ search: name.trim(), pageSize: 100 })).data.find(
            (item) => sameText(item.name, name.trim()) || sameText(item.internal_code, internalCode),
          );
        }
        if (!apiItem) {
          try {
            apiItem = await createFabricItem({
              name: name.trim(),
              internal_code: internalCode,
              supplier_code: barcode.trim(),
              fabric_type: 'عام',
              unit: 'meter',
              notes: imageUrl ? 'تم إرفاق صورة للمادة في واجهة النظام.' : '',
              category_id: selectedMaterialName?.id ?? null,
            });
          } catch (error) {
            if (!(error instanceof ApiRequestError && error.statusCode === 409)) throw error;
            apiItem = (await listFabricItems({ search: internalCode, pageSize: 100 })).data.find(
              (item) => sameText(item.internal_code, internalCode) || sameText(item.name, name.trim()),
            );
            if (!apiItem) throw error;
          }
        }

        const colorId = await ensureFabricColorId(colorNameValue, colorCodeValue);

        resolved = {
          itemId: apiItem.id,
          colorId,
          variantId: null,
          articleCode: apiItem.internal_code || internalCode,
          fabricColorName: colorNameValue || 'بدون لون',
          colorCode: colorCodeValue || '',
          designNr: apiItem.internal_code || internalCode,
        };
      }

      const roll = await createFabricRoll({
        barcode: barcode.trim() || undefined,
        rollNo: barcode.trim() || undefined,
        batchNo: lotNumberValue || null,
        itemId: resolved.itemId,
        colorId: resolved.colorId,
        variantId: resolved.variantId ?? undefined,
        warehouseId: selectedWarehouse.id,
        lengthM,
        widthCm,
        gsm: gsmNum,
        actualWeightKg: Number(weight) || null,
        unitCost: Number(costPrice) || null,
        currencyCode: 'USD',
        notes: imageUrl ? 'تم إرفاق صورة للمادة في واجهة النظام.' : null,
      });

      const l1 = findCategoryById(categoryApiTree, catL1Id);
      const whName = activeWarehouses.find((w) => w.id === warehouseId)?.name ?? null;
      const qrPayload = buildRollQrPayload({
        rollId: roll.id,
        barcode: roll.barcode,
        lot: lotNumberValue || '',
        articleCode: resolved.articleCode,
        fabricName: l1?.name ?? name.trim(),
        fabricColor: resolved.fabricColorName,
        colorCode: resolved.colorCode,
        widthCm,
        gsm: gsmNum,
        lengthM,
        weightKg: Number(weight) > 0 ? Number(weight) : null,
        warehouse: whName,
        createdAt: roll.created_at ?? new Date().toISOString(),
      });

      const printInput: AdHocLabelInput = {
        barcode: roll.barcode,
        qrPayload,
        rollNo: barcode.trim() || roll.roll_no || roll.barcode,
        itemName: resolved.articleCode,
        internalCode: resolved.designNr,
        supplierCode: null,
        colorNameAr: resolved.fabricColorName,
        colorNameTr: null,
        colorCode: resolved.colorCode,
        lengthM,
        widthCm,
        gsm: gsmNum,
        actualWeightKg: Number(weight) > 0 ? Number(weight) : null,
        calculatedWeightKg:
          lengthM >= 0 && widthCm != null && widthCm > 0 && gsmNum != null && gsmNum > 0
            ? Number((lengthM * (widthCm / 100) * (gsmNum / 1000)).toFixed(3))
            : null,
        warehouseName: whName,
        batchNo: lotNumberValue || null,
        containerNo: null,
        purchaseInvoiceNo: null,
        supplierRollRef: null,
      };

      addFabric(payload);

      setSuccessMessage('تم حفظ المادة بنجاح');
      setTimeout(() => setSuccessMessage(''), 5000);
      setLastSavedPrintInput(printInput);

      if (autoPrint) {
        if (
          typeof window !== 'undefined'
          && window.fabricApp?.isElectron
          && !settings?.defaultLabelPrinterName
        ) {
          setPrintWarning('لم يتم تحديد طابعة لصاقات افتراضية — سيُفتح حوار الطباعة أو راجع إعدادات المكتب.');
        }
        try {
          await printLabel(printInput);
        } catch {
          setSaveError('تم الحفظ، لكن تعذرت الطباعة التلقائية. استخدم زر طباعة اللصاقة.');
        }
      }

      if (retainEntryFields) {
        setLength('');
        setWeight('');
        setLotNumber('');
        setBarcode('');
        generateBarcode();
      } else {
        setLength('');
        setWeight('');
        setLotNumber('');
        setBarcode('');
        setCatL1Id('');
        setCatL2Id('');
        setCatL3Id('');
        setCatL4Id('');
        setName('');
        generateBarcode();
      }

      if (lengthInputRef.current) lengthInputRef.current.focus();
    } catch (error) {
      if (error instanceof ApiRequestError && error.statusCode === 409) {
        setSaveError('هذا الباركود موجود مسبقاً.');
      } else {
        setSaveError((error as { message?: string }).message ?? 'تعذر حفظ المادة في قاعدة البيانات.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  const enterToNext = (e: React.KeyboardEvent, nextId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById(nextId)?.focus();
    }
  };

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setImageUrl(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsDataURL(file);
  };

  const l3Node = catL3Id ? findCategoryById(categoryApiTree, catL3Id) : null;
  const l4Node = catL4Id ? findCategoryById(categoryApiTree, catL4Id) : null;
  const swatchColor = (() => {
    const l4Code = l4Node?.code?.trim() ?? '';
    if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(l4Code) && !isPlaceholderColorCode(l4Code)) return l4Code;
    const label = l3Node?.name?.trim() || l4Node?.name?.trim() || '';
    if (!label) return '#e5e7eb';
    let hash = 0;
    for (let i = 0; i < label.length; i += 1) {
      hash = label.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
  })();

  return (
    <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
      <div className="flex justify-between items-end">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">إنشاء مادة جديدة</h2>
            <p className="text-slate-500 mt-1">إضافة خامة جديدة إلى قسم المخزون</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            type="button"
            onClick={() => navigate('/inventory')}
            className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition shadow-sm font-medium"
          >
            إلغاء
          </button>
          <button 
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition shadow-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'جاري الحفظ...' : 'حفظ المادة'}</span>
          </button>
        </div>
      </div>

      <ItemImageControl
        enabled={showImageUpload}
        imageUrl={imageUrl}
        onToggle={handleToggleImageUpload}
        onImageChange={handleImageChange}
        onClear={() => setImageUrl('')}
      />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
           <FileText className="w-5 h-5 text-indigo-600" />
           <h3 className="font-bold text-slate-800 text-lg">بيانات الخامة</h3>
        </div>
        
        <div className="p-8">
          <div className="flex flex-col lg:flex-row gap-8">
            
            {/* Right Side Cards (RTL) / Quick inputs */}
            <div className="lg:w-1/3 flex flex-col gap-6 order-1">
              <div className="bg-indigo-50 border-2 border-indigo-200 rounded-2xl p-6 shadow-sm">
                 <label className="block text-lg font-bold text-indigo-900 mb-4">الطول النهائي ({lengthType === 'yard' ? 'ياردة' : 'متر'})</label>
                  <input 
                    id="length"
                    ref={lengthInputRef}
                    type="number" 
                    value={length}
                    onChange={e => setLength(e.target.value === '' ? '' : Number(e.target.value))}
                    onKeyDown={handleKeyDown}
                    onWheel={e => e.currentTarget.blur()}
                    placeholder="0" 
                    className="w-full bg-white border border-indigo-300 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 transition shadow-sm font-mono text-center text-4xl py-6 font-black text-indigo-700" 
                    dir="ltr"
                    autoFocus
                  />
                  {lengthEquivalentText ? (
                    <div className="mt-3 text-center text-xs font-bold text-indigo-500">
                      يعادل تقريباً {lengthEquivalentText}
                    </div>
                  ) : null}
              </div>

              <div className={`border-2 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-4 transition-colors cursor-pointer select-none ${autoPrint ? 'bg-emerald-50 border-emerald-300' : 'bg-slate-50 border-slate-200'}`} onClick={() => setAutoPrint(!autoPrint)}>
                 <div className="flex flex-col">
                   <label className={`text-base font-bold cursor-pointer ${autoPrint ? 'text-emerald-800' : 'text-slate-600'}`}>طباعة اللصاقة تلقائياً</label>
                   <span className={`text-xs mt-1 ${autoPrint ? 'text-emerald-600' : 'text-slate-400'}`}>
                     {autoPrint
                       ? (settings?.silentLabelPrintingEnabled && settings?.defaultLabelPrinterName
                           ? `طباعة صامتة فوراً → ${settings.defaultLabelPrinterName}`
                           : 'سيُفتح حوار الطابعة — اضبطي طابعة افتراضية في الإعدادات')
                       : 'عند الحفظ أو ضغط Enter'}
                   </span>
                 </div>
                 
                 {/* Toggle Switch */}
                 <button 
                   type="button"
                   className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 transition-colors ${autoPrint ? 'bg-emerald-500' : 'bg-slate-300'}`}
                   role="switch"
                   aria-checked={autoPrint}
                   onClick={(e) => { e.stopPropagation(); setAutoPrint(!autoPrint); }}
                 >
                   <span className="sr-only">تفعيل الطباعة التلقائية</span>
                   <span aria-hidden="true" className={`pointer-events-none absolute h-6 w-6 rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ease-in-out ${autoPrint ? '-translate-x-3' : 'translate-x-3'}`} />
                 </button>
              </div>

<div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-6 shadow-sm">
                  <label className="block text-lg font-bold text-emerald-900 mb-4">الوزن النهائي (KG)</label>
                  <input 
                    id="weight"
                    type="number" 
                    value={weight}
                    onChange={e => setWeight(e.target.value === '' ? '' : Number(e.target.value))}
                    onKeyDown={handleKeyDown}
                    onWheel={e => e.currentTarget.blur()}
                    placeholder="0.00" 
                    className="w-full bg-white border border-emerald-300 rounded-xl focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 transition shadow-sm font-mono text-center text-3xl py-4 font-black text-emerald-700" 
                    dir="ltr"
                  />
               </div>

               <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-4">
                  <label className="text-sm font-bold text-slate-700 whitespace-nowrap">وزن المتر/الياردة (غرام):</label>
                  <input 
                    id="weight-multiplier"
                    type="number" 
                    value={weightMultiplier}
                    onChange={e => setWeightMultiplier(e.target.value === '' ? '' : Number(e.target.value))}
                    onKeyDown={handleKeyDown}
                    onWheel={e => e.currentTarget.blur()}
                    placeholder="150" 
                    step="0.01"
                    className="w-32 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 transition shadow-sm font-mono text-center text-xl font-bold py-2 text-slate-700" 
                    dir="ltr"
                  />
               </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm text-slate-600 space-y-3">
                <p>💡 <b>تلميح:</b> يمكنك تعديل الأرقام أعلاه والضغط على <b>Enter</b> للحفظ مباشرة وإضافة القطعة التالية بنفس المواصفات.</p>
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={retainEntryFields}
                    onChange={(e) => setRetainFieldsPersist(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-indigo-600"
                  />
                  الاحتفاظ بالبيانات لإضافة ثوب آخر
                </label>
              </div>
              
              {successMessage && (
                <div className="bg-emerald-100 text-emerald-800 p-4 rounded-xl border border-emerald-200 font-bold text-center animate-in fade-in slide-in-from-top-2 duration-300 shadow-sm space-y-3">
                  <div>{successMessage}</div>
                  {lastSavedPrintInput && (
                    <button
                      type="button"
                      onClick={() => printLabel(lastSavedPrintInput)}
                      className="mx-auto bg-white border border-emerald-300 text-emerald-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-50 transition shadow-sm text-sm"
                    >
                      <Printer className="w-4 h-4" />
                      <span>طباعة اللصاقة الآن</span>
                    </button>
                  )}
                </div>
              )}

              {saveError && (
                <div className="bg-rose-50 text-rose-700 p-4 rounded-xl border border-rose-200 font-bold text-center shadow-sm">
                  {saveError}
                </div>
              )}

              {printWarning && (
                <div className="bg-amber-50 text-amber-900 p-4 rounded-xl border border-amber-200 text-sm font-medium text-center shadow-sm">
                  {printWarning}
                </div>
              )}
            </div>

            {/* Form Fields Side — شبكة عمودين كما التصميم المعتمد */}
            <div className="lg:w-2/3 p-6 sm:p-8 order-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              <div className="space-y-3">
                <label className="block text-sm font-bold text-slate-700">الباركود</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <ScanLine className="w-5 h-5 text-slate-400" />
                    </div>
                    <input 
                      id="barcode"
                      type="text" 
                      value={barcode}
                      onChange={e => setBarcode(normalizeSevenDigitBarcode(e.target.value))}
                      maxLength={7}
                      inputMode="numeric"
                      onKeyDown={e => enterToNext(e, 'lot-number')}
                      placeholder="امسح الباركود أو أدخل الرقم..." 
                      className="w-full pr-10 pl-4 py-3 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition shadow-sm font-mono text-left" 
                      dir="ltr"
                    />
                  </div>
                  <button 
                    onClick={generateBarcode}
                    type="button"
                    className="px-4 py-2 bg-slate-100 text-slate-700 font-bold border border-slate-300 rounded-lg hover:bg-slate-200 transition whitespace-nowrap shadow-sm text-sm"
                    title="توليد رقم باركود عشوائي"
                  >
                    توليد
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-bold text-slate-700">اللوت</label>
                <input
                  id="lot-number"
                  type="text"
                  value={lotNumber}
                  onChange={e => setLotNumber(e.target.value)}
                  onKeyDown={e => enterToNext(e, 'warehouse')}
                  placeholder="اكتب رقم اللوت إن وجد"
                  className="w-full p-3 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition shadow-sm font-mono text-left"
                  dir="ltr"
                />
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-bold text-slate-700">المستودع / مكان التخزين</label>
                <select 
                  id="warehouse"
                  onKeyDown={e => enterToNext(e, "name")}
                  value={warehouseId}
                  onChange={e => setWarehouseId(e.target.value)}
                  className="w-full p-3 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition shadow-sm" 
                >
                  {activeWarehouses.length === 0 && <option value="" disabled>عدم تحديد / لا يوجد مستودعات نشطة</option>}
                  {activeWarehouses.map(wh => (
                    <option key={wh.id} value={wh.id}>{wh.name} ({wh.location})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-3 md:col-span-2">
                <label className="block text-sm font-bold text-slate-700">اسم الخامة</label>
                  <input 
                    id="name"
                    onKeyDown={e => enterToNext(e, "fabric-code")}
                    type="text" 
                    value={name}
                    onChange={e => handleMaterialNameChange(e.target.value)}
                    placeholder={HIDE_FABRIC_COLOR_UI ? 'اكتب اسم الخامة وسيتم اقتراح أكوادها المرتبطة' : 'اكتب اسم الخامة وسيتم اقتراح الأكواد والألوان المرتبطة'} 
                    className="w-full p-3 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition shadow-sm" 
                  />
                  {!isEditMode && name.trim() && !catL1Id && materialNameSuggestions.length > 0 ? (
                    <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-2 space-y-1">
                      {materialNameSuggestions.map((category) => (
                        <button
                          key={category.id}
                          type="button"
                          onClick={() => selectMaterialName(category)}
                          className="w-full text-right px-3 py-2 rounded-md bg-white hover:bg-indigo-50 border border-slate-100 text-sm font-bold text-slate-800"
                        >
                          {category.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {!isEditMode && name.trim() && !catL1Id ? (
                    <p className="text-xs text-amber-700">
                      {HIDE_FABRIC_COLOR_UI
                        ? 'اختر اسم خامة من الاقتراحات حتى يقرأ النظام كود الخامة من شجرة التصنيفات.'
                        : 'اختر اسم خامة من الاقتراحات حتى يقرأ النظام كود الخامة والألوان من شجرة التصنيفات.'}
                    </p>
                  ) : null}
                  {!isEditMode && catL1Id ? (
                    <p className="text-xs text-emerald-700 font-bold">
                      تم ربط اسم الخامة بشجرة التصنيفات.
                    </p>
                  ) : null}
                </div>

              {!isEditMode && (
                <>
                  {treeLoadErr ? (
                    <p className="text-xs text-rose-600 md:col-span-2">{treeLoadErr}</p>
                  ) : null}
                  {!treeLoading && categoryApiTree.length === 0 ? (
                    <p className="text-xs text-amber-800 md:col-span-2">
                      لا توجد تصنيفات بعد.{' '}
                      <Link to="/inventory/categories" className="font-bold text-indigo-700 underline">
                        تصنيفات الأقمشة
                      </Link>
                    </p>
                  ) : null}

                  <div className="space-y-3">
                    <label className="block text-sm font-bold text-slate-700">كود الخامة</label>
                    <select
                      id="fabric-code"
                      onKeyDown={e => enterToNext(e, 'color-name')}
                      value={catL2Id}
                      onChange={(e) => {
                        setCatL2Id(e.target.value);
                        setCatL3Id('');
                        setCatL4Id('');
                      }}
                      disabled={!catL1Id || level2Options.length === 0}
                      className="w-full p-3 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition shadow-sm font-mono"
                    >
                      <option value="">-- اختر كود الخامة --</option>
                      {level2Options.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </div>

                  {!HIDE_FABRIC_COLOR_UI && (
                  <>
                  <div className="space-y-3">
                    <label className="block text-sm font-bold text-slate-700">لون الخامة</label>
                    <select
                      id="color-name"
                      onKeyDown={e => enterToNext(e, 'color-code')}
                      value={catL3Id}
                      onChange={(e) => {
                        setCatL3Id(e.target.value);
                        setCatL4Id('');
                      }}
                      disabled={!catL2Id || level3Options.length === 0}
                      className="w-full p-3 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition shadow-sm disabled:opacity-50"
                    >
                      <option value="">-- اختر لون الخامة --</option>
                      {level3Options.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-3 md:col-span-2">
                    <label className="block text-sm font-bold text-slate-700">كود اللون</label>
                    <div className="flex gap-3 items-stretch">
                      <div
                        className="w-14 h-[50px] shrink-0 rounded-lg border border-slate-300 shadow-sm self-center"
                        style={{ backgroundColor: swatchColor }}
                        title={l4Node?.code ?? ''}
                      />
                      <select
                        id="color-code"
                        onKeyDown={e => enterToNext(e, 'roll-width')}
                        value={catL4Id}
                        onChange={(e) => setCatL4Id(e.target.value)}
                        disabled={!catL3Id || level4Options.length === 0}
                        className="min-h-[50px] flex-1 p-3 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition shadow-sm font-mono text-left disabled:opacity-50"
                        dir="ltr"
                      >
                        <option value="">-- اختر كود اللون --</option>
                        {level4Options.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  </>
                  )}
                </>
              )}

              {isEditMode && (
                <>
                  <div className="space-y-3">
                    <label className="block text-sm font-bold text-slate-700">كود الخامة (مرجعي)</label>
                    <input
                      type="text"
                      value={fabricCode}
                      onChange={(e) => setFabricCode(e.target.value)}
                      className="w-full p-3 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                      dir="ltr"
                    />
                  </div>
                  {!HIDE_FABRIC_COLOR_UI && (
                  <>
                  <div className="space-y-3">
                    <label className="block text-sm font-bold text-slate-700">لون الخامة (مرجعي)</label>
                    <input
                      type="text"
                      value={colorName}
                      onChange={(e) => setColorName(e.target.value)}
                      className="w-full p-3 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="space-y-3 md:col-span-2">
                    <label className="block text-sm font-bold text-slate-700">كود اللون (مرجعي)</label>
                    <input
                      type="text"
                      value={colorCode}
                      onChange={(e) => setColorCode(e.target.value)}
                      className="w-full p-3 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                      dir="ltr"
                    />
                  </div>
                  </>
                  )}
                </>
              )}

              <div className="space-y-3">
              <label className="block text-sm font-bold text-slate-700">نوع الطول</label>
              <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setLengthType('meter')}
                  className={`flex-1 py-2 text-sm font-bold rounded-md transition ${lengthType === 'meter' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  متر
                </button>
                <button
                  type="button"
                  onClick={() => setLengthType('yard')}
                  className={`flex-1 py-2 text-sm font-bold rounded-md transition ${lengthType === 'yard' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  ياردة
                </button>
              </div>
            </div>

                <div className="space-y-3">
                  <label className="block flex justify-between items-center text-sm font-bold text-slate-700">
                    <span>عرض التوب</span>
                    <select 
                      value={widthUnit} 
                      onChange={(e) => setWidthUnit(e.target.value as 'inch' | 'cm')}
                      className="text-xs border border-slate-300 rounded px-2 py-1 bg-slate-50 focus:outline-none"
                    >
                      <option value="cm">سم</option>
                      <option value="inch">إنش</option>
                    </select>
                  </label>
<input 
                     id="roll-width"
                     onKeyDown={e => enterToNext(e, "cost-price")}
                     type="number" 
                     value={rollWidth}
                     onChange={e => setRollWidth(e.target.value === '' ? '' : Number(e.target.value))}
                     onWheel={e => e.currentTarget.blur()}
                     placeholder={`مثال: ${widthUnit === 'inch' ? '58' : '150'}`} 
                     className="w-full p-3 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition shadow-sm font-mono text-left" 
                     dir="ltr"
                   />
                </div>

<div className="space-y-3">
                   <label className="block text-sm font-bold text-slate-700">سعر التكلفة</label>
                   <div className="relative">
                     <input 
                       id="cost-price"
                       onKeyDown={e => enterToNext(e, "selling-price")}
                       type="number" 
                       value={costPrice}
                       onChange={e => setCostPrice(e.target.value === '' ? '' : Number(e.target.value))}
                       onWheel={e => e.currentTarget.blur()}
                       placeholder="0.00" 
                       className="w-full p-3 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition shadow-sm font-mono text-left pr-12" 
                       dir="ltr"
                     />
                     <span className="absolute right-4 top-3 text-slate-400 font-bold">$</span>
                   </div>
                 </div>

                 <div className="space-y-3">
                   <label className="block text-sm font-bold text-slate-700">سعر البيع</label>
                   <div className="relative">
                     <input 
                       id="selling-price"
                       onKeyDown={e => enterToNext(e, "length")}
                       type="number" 
                       value={sellingPrice}
                       onChange={e => setSellingPrice(e.target.value === '' ? '' : Number(e.target.value))}
                       onWheel={e => e.currentTarget.blur()}
                       placeholder="0.00" 
                       className="w-full p-3 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition shadow-sm font-mono text-left pr-12" 
                       dir="ltr"
                     />
                     <span className="absolute right-4 top-3 text-emerald-500 font-bold">$</span>
                  </div>
                </div>
                
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ItemImageControl = ({
  enabled,
  imageUrl,
  onToggle,
  onImageChange,
  onClear,
}: {
  enabled: boolean;
  imageUrl: string;
  onToggle: (checked: boolean) => void;
  onImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}) => {
  if (!enabled) {
    return (
      <aside data-testid="item-image-toggle" className="xl:fixed xl:left-6 xl:top-28 xl:w-56 xl:z-20 bg-white border border-slate-200 rounded-xl shadow-sm p-3">
        <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
          <span className="flex items-center gap-2 min-w-0">
            <span className="w-9 h-9 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
              <ImagePlus className="w-4 h-4 text-slate-500" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-slate-800 truncate">صورة المادة</span>
              <span className="block text-[11px] text-slate-500 truncate">إظهار إضافة صورة</span>
            </span>
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onToggle(event.target.checked)}
            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 shrink-0"
          />
        </label>
      </aside>
    );
  }

  return (
    <aside data-testid="item-image-upload-box" className="xl:fixed xl:left-6 xl:top-28 xl:w-64 xl:z-20 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
    <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <ImagePlus className="w-5 h-5 text-indigo-600" />
        <h3 className="font-bold text-slate-900">صورة المادة</h3>
      </div>
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onToggle(event.target.checked)}
            className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500"
          />
          إظهار
        </label>
      {imageUrl && (
        <button
          type="button"
          onClick={onClear}
          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition"
          title="إزالة الصورة"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      </div>
    </div>
    <label className="block p-4 cursor-pointer">
      <input type="file" accept="image/*" onChange={onImageChange} className="hidden" />
      <div className="aspect-square rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden hover:border-indigo-300 hover:bg-indigo-50/40 transition">
        {imageUrl ? (
          <img src={imageUrl} alt="صورة المادة" className="w-full h-full object-cover" />
        ) : (
          <div className="text-center px-5">
            <Upload className="w-9 h-9 text-slate-400 mx-auto mb-3" />
            <p className="font-bold text-slate-700">إضافة صورة</p>
            <p className="text-xs text-slate-500 mt-1">PNG أو JPG أو WEBP</p>
          </div>
        )}
      </div>
    </label>
    </aside>
  );
};
