import React, { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileText,
  ImagePlus,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
  QrCode,
} from 'lucide-react';
import { format } from 'date-fns';
import { calculateFabricInvoiceSummary, calculateFabricWeightKg } from '../../lib/fabricInvoiceSummary';
import type {
  Customer,
  CustomerOrder,
  CustomerOrderLine,
  FabricItem,
  OrderTemplate,
} from '../../types';
import { ORDER_STATUS_LABELS, ORDER_STATUS_FLOW } from '../../pages/orders/orderStatusUi';
import { displayCustomerOrderNumber } from '../../lib/orderDisplay';
import { compressOrderLineImage, compressOrderLineImageErrorMessage } from '../../lib/compressOrderLineImage';
import { isValidPriceInput, normalizePriceInput } from '../../lib/orderPriceInput';
import { lookupCartelaByScan } from '../../lib/api/cartelaApi';
import { ApiRequestError } from '../../lib/api/client';
import { useToast } from '../NonBlockingToast';

export interface OrderFormSubmitPayload {
  orderNumber?: string;
  date: string;
  customerId: string;
  currency: string;
  warehouse?: string;
  shippingMethod?: string;
  notes?: string;
  items: CustomerOrderLine[];
  status: CustomerOrder['status'];
  expectedDate?: string;
  templateId?: string;
  advancePayment?: number;
}

/** للملخص والوزن: الكمية تُعتبر بالمتر في السطر */

interface FormLine {
  id: string;
  /** خانة الخامة / مرجع — باركود أو مرجع يدوي */
  scanBarcode: string;
  /** كود خامة من القائمة أو من المخزون */
  fabricCode: string;
  colorCode: string;
  colorName: string;
  /** متر لكل رول */
  metersPerRoll: string;
  /** عدد الرول */
  rollCount: string;
  /** إجمالي الأمتار (محسوب) */
  length: string;
  price: string;
  materialName: string;
  dsamNumber: string;
  rollNo: string;
  /** من الكارتيلا فقط — لا يُعرض في الطلبية */
  widthCm: string;
  gsm: string;
  weight: string;
  note: string;
  imageUrl?: string;
  /** باركود غير موجود في الكارتيلا — تُنشأ مسودة عند الحفظ */
  needsCartelaDraft?: boolean;
}

const YARDS_TO_METERS = 0.9144;

function matchFabric(inv: FabricItem[], scan: string): FabricItem | undefined {
  const q = scan.trim().toLowerCase();
  if (!q) return undefined;
  return inv.find((f) => {
    const bc = f.barcode?.trim().toLowerCase();
    const qr = f.qrCode?.trim().toLowerCase() ?? '';
    return (
      (bc && bc === q) ||
      qr === q ||
      f.fabricCode.trim().toLowerCase() === q ||
      f.id.trim().toLowerCase() === q ||
      f.name.trim().toLowerCase() === q
    );
  });
}

const emptyLine = (): FormLine => ({
  id: crypto.randomUUID(),
  scanBarcode: '',
  fabricCode: '',
  colorCode: '',
  colorName: '',
  metersPerRoll: '',
  rollCount: '1',
  length: '0',
  price: '',
  materialName: '',
  dsamNumber: '',
  rollNo: '',
  widthCm: '0',
  gsm: '0',
  weight: '0',
  note: '',
  imageUrl: undefined,
});

function recalcCartelaWeight(line: FormLine): string {
  const widthCm = numberValue(line.widthCm);
  const gsm = numberValue(line.gsm);
  if (widthCm <= 0 || gsm <= 0) return '0';
  return String(calculateFabricWeightKg(numberValue(line.length), widthCm, gsm));
}

/** السطر التالي: يرث الباركود والكميات والسعر وكل بيانات الخامة — فقط اللون يُترك فارغاً */
function inheritNextLineFrom(source: FormLine): FormLine {
  const inherited = syncLineQuantities({
    ...emptyLine(),
    scanBarcode: source.scanBarcode,
    fabricCode: source.fabricCode,
    dsamNumber: source.dsamNumber,
    materialName: source.materialName,
    rollNo: source.rollNo,
    price: source.price,
    metersPerRoll: source.metersPerRoll,
    rollCount: source.rollCount,
    widthCm: source.widthCm,
    gsm: source.gsm,
    imageUrl: source.imageUrl,
    needsCartelaDraft: source.needsCartelaDraft,
    colorCode: '',
    colorName: '',
  });
  inherited.weight = recalcCartelaWeight(inherited);
  return inherited;
}

function syncLineQuantities(line: FormLine): FormLine {
  const metersPerRoll = numberValue(line.metersPerRoll);
  const rollCount = Math.max(1, Math.round(numberValue(line.rollCount)) || 1);
  const totalM = Math.round(metersPerRoll * rollCount * 100) / 100;
  return {
    ...line,
    rollCount: String(rollCount),
    length: String(totalM),
  };
};

const toFormLine = (row: CustomerOrderLine): FormLine => {
  let len = row.length;
  if (row.unitType === 'yard') {
    len = Math.round(row.length * YARDS_TO_METERS * 100) / 100;
  }
  const rollCount = row.rollCount && row.rollCount > 0 ? row.rollCount : 1;
  const metersPerRoll =
    row.metersPerRoll != null && row.metersPerRoll > 0 ? row.metersPerRoll : len / rollCount;
  const synced = syncLineQuantities({
    id: row.id,
    scanBarcode: row.referenceBarcode ?? '',
    fabricCode: row.rollNo || row.dsamNumber || '',
    colorCode: row.colorCode,
    colorName: row.colorName,
    metersPerRoll: String(metersPerRoll),
    rollCount: String(rollCount),
    length: String(len),
    price: String(row.price),
    materialName: row.materialName,
    dsamNumber: row.dsamNumber,
    rollNo: row.rollNo,
    widthCm: String(row.widthCm),
    gsm: String(row.gsm),
    weight: String(row.weight),
    note: row.note ?? '',
    imageUrl: row.imageUrl,
  });
  return {
    ...synced,
    weight: String(
      row.weight ||
        recalcCartelaWeight({ ...synced, widthCm: String(row.widthCm), gsm: String(row.gsm) }),
    ),
  };
};

const numberValue = (value: string) => Number(value) || 0;

function numericFromCartelaField(value: string | undefined): number {
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isBlankOrderLine(line: FormLine): boolean {
  return (
    !line.scanBarcode.trim() &&
    !line.materialName.trim() &&
    !line.fabricCode.trim() &&
    !line.colorCode.trim() &&
    !line.colorName.trim() &&
    numberValue(line.metersPerRoll) <= 0
  );
}

/** سطر جاهز للحفظ — يجب أن يكون فيه خامة وكمية ولون */
function isSavableOrderLine(line: FormLine): boolean {
  if (isBlankOrderLine(line)) return false;
  const hasFabric = !!(line.materialName.trim() || line.fabricCode.trim() || line.scanBarcode.trim());
  const hasQty = numberValue(line.metersPerRoll) > 0;
  const hasColor = !!(line.colorCode.trim() || line.colorName.trim());
  return hasFabric && hasQty && hasColor;
}

/** سطر يظهر في الملخص — خامة + كمية (اللون ليس شرطاً للعرض) */
function isSummaryLine(line: FormLine): boolean {
  if (isBlankOrderLine(line)) return false;
  const hasFabric = !!(line.materialName.trim() || line.fabricCode.trim() || line.scanBarcode.trim());
  const hasQty = numberValue(line.metersPerRoll) > 0;
  return hasFabric && hasQty;
}

function applyCartelaToLinePatch(cartela: {
  title: string;
  art_code: string;
  design_no: string;
  serial_no: string;
  width_value: string;
  weight_value: string;
}, scanFallback: string, inventory: FabricItem[]): Partial<FormLine> {
  const art = cartela.art_code.trim();
  const title = cartela.title.trim();
  const design = cartela.design_no.trim();
  const widthCm = numericFromCartelaField(cartela.width_value);
  const gsm = numericFromCartelaField(cartela.weight_value);
  const invHit = art ? inventory.find((i) => i.fabricCode.trim().toLowerCase() === art.toLowerCase()) : undefined;
  const materialName = title || art;
  // كود الخامة في الجدول = DESIGN NO (مثل 7025)
  const fabricCode = design || art;
  return {
    scanBarcode: cartela.serial_no.trim() || scanFallback,
    fabricCode,
    dsamNumber: art || design,
    materialName,
    rollNo: design,
    colorCode: '',
    colorName: '',
    ...(widthCm > 0 ? { widthCm: String(widthCm) } : {}),
    ...(gsm > 0 ? { gsm: String(gsm) } : {}),
    ...(invHit ? { price: String(invHit.sellingPrice) } : {}),
  };
}
const money = (value: number, currency: string) =>
  `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || 'SAR'}`;

type OrderFormModalProps = {
  open: boolean;
  onClose: () => void;
  customers: Customer[];
  inventory: FabricItem[];
  templates: OrderTemplate[];
  editingOrder: CustomerOrder | null;
  onSubmit: (
    payload: OrderFormSubmitPayload,
    mode: 'create' | 'update',
  ) => Promise<{ cartelaDraftsCreated?: number }>;
};

export function OrderFormModal({
  open,
  onClose,
  customers,
  inventory,
  templates,
  editingOrder,
  onSubmit,
}: OrderFormModalProps) {
  const { showToast } = useToast();
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [orderNumber, setOrderNumber] = useState('');
  const [partyId, setPartyId] = useState('');
  const [warehouse, setWarehouse] = useState('main');
  const [shippingMethod, setShippingMethod] = useState('');
  const [currency, setCurrency] = useState('SAR');
  const [notes, setNotes] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [advancePayment, setAdvancePayment] = useState('');
  const [status, setStatus] = useState<CustomerOrder['status']>('draft');
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<FormLine[]>([emptyLine()]);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [compressingLineId, setCompressingLineId] = useState<string | null>(null);
  const barcodeCommittingRef = useRef<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const barcodeInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const colorCodeInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const patchLine = useCallback((id: string, patch: Partial<FormLine>) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next = syncLineQuantities({ ...item, ...patch });
        next.weight = recalcCartelaWeight(next);
        return next;
      }),
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    if (editingOrder) {
      setDate(editingOrder.date);
      setOrderNumber(displayCustomerOrderNumber(editingOrder.orderNumber));
      setPartyId(editingOrder.customerId);
      setWarehouse(editingOrder.warehouse || 'main');
      setShippingMethod(editingOrder.shippingMethod || '');
      setCurrency(editingOrder.currency);
      setNotes(editingOrder.notes || '');
      setExpectedDate(editingOrder.expectedDate || '');
      setAdvancePayment(editingOrder.advancePayment != null ? String(editingOrder.advancePayment) : '');
      setStatus(editingOrder.status);
      setTemplateId(editingOrder.templateId ?? undefined);
      setItems(editingOrder.items.length ? editingOrder.items.map(toFormLine) : [emptyLine()]);
    } else {
      setDate(format(new Date(), 'yyyy-MM-dd'));
      setOrderNumber('');
      setPartyId('');
      setWarehouse('main');
      setShippingMethod('');
      setCurrency('SAR');
      setNotes('');
      setExpectedDate('');
      setAdvancePayment('');
      setStatus('draft');
      setTemplateId(undefined);
      setItems([emptyLine()]);
    }
  }, [open, editingOrder]);

  const summaryItems = useMemo(() => items.filter(isSummaryLine), [items]);
  const savableItems = useMemo(() => items.filter(isSavableOrderLine), [items]);
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === partyId),
    [customers, partyId],
  );

  const summary = useMemo(
    () =>
      calculateFabricInvoiceSummary(
        summaryItems.map((item) => ({
          materialName: item.materialName || item.fabricCode,
          designCode: item.fabricCode || item.dsamNumber,
          colorCode: item.colorCode,
          colorName: item.colorName,
          rollNo: item.rollNo,
          lengthMeters: numberValue(item.length),
          pricePerMeter: item.price,
        })),
      ),
    [summaryItems],
  );

  const totalAmount = summary.totals.totalAmount;

  const handleBarcodeCommit = async (lineId: string) => {
    const row = items.find((i) => i.id === lineId);
    if (!row) return;
    const scan = row.scanBarcode.trim();
    if (!scan) return;
    if (barcodeCommittingRef.current === lineId) return;
    barcodeCommittingRef.current = lineId;

    const commitLine = (merged: Partial<FormLine>) => {
      let focusRowId = '';
      setItems((prev) => {
        const source = prev.find((it) => it.id === lineId);
        const filled = source
          ? (() => {
              const u = syncLineQuantities({ ...source, ...merged });
              u.weight = recalcCartelaWeight(u);
              return u;
            })()
          : null;
        const next = prev.map((it) => {
          if (it.id !== lineId) return it;
          return filled ?? syncLineQuantities({ ...it, ...merged });
        });
        const inherited = filled ? inheritNextLineFrom(filled) : emptyLine();
        focusRowId = inherited.id;
        return [...next, inherited];
      });
      setTimeout(() => colorCodeInputRefs.current[focusRowId]?.focus(), 50);
    };

    try {
      try {
        const cartela = await lookupCartelaByScan(scan);
        commitLine({ ...applyCartelaToLinePatch(cartela, scan, inventory), needsCartelaDraft: false });
        showToast({
          type: 'success',
          message: `كارتيلا: ${cartela.title || cartela.art_code} · ${cartela.art_code}${cartela.design_no ? ` · ${cartela.design_no}` : ''} — أكمل اللون والكمية`,
        });
        return;
      } catch (e) {
        if (!(e instanceof ApiRequestError) || e.statusCode !== 404) {
          showToast({
            type: 'error',
            message: e instanceof ApiRequestError ? e.message : 'تعذر البحث في الكارتيلا',
          });
          return;
        }
      }

      const hit = matchFabric(inventory, scan);
      if (!hit) {
        commitLine({ scanBarcode: scan, needsCartelaDraft: true });
        showToast({
          type: 'warning',
          message:
            'كارتيلا غير موجودة — أكمل الخامة واللون يدوياً. تُسجَّل مسودة كارتيلا تلقائياً عند حفظ الطلبية.',
        });
        return;
      }

      commitLine({
        fabricCode: hit.rollNumber?.trim() || hit.fabricCode,
        dsamNumber: hit.fabricCode,
        materialName: hit.name,
        colorCode: '',
        colorName: '',
        price: String(hit.sellingPrice),
        rollNo: hit.rollNumber?.trim() || hit.fabricCode,
        imageUrl: hit.imageUrl ?? undefined,
        needsCartelaDraft: true,
      });
      showToast({
        type: 'warning',
        message:
          'كارتيلا غير موجودة — تم تعبئة بيانات من المخزون. تُسجَّل مسودة كارتيلا تلقائياً عند حفظ الطلبية.',
      });
    } finally {
      barcodeCommittingRef.current = null;
    }
  };

  const handleAddItem = () => {
    const last = items[items.length - 1];
    if (!last) {
      setItems([emptyLine()]);
      return;
    }
    const inherited = inheritNextLineFrom(last);
    setItems([...items, inherited]);
    setTimeout(() => colorCodeInputRefs.current[inherited.id]?.focus(), 50);
  };
  const handleRemoveItem = (id: string) => setItems(items.filter((item) => item.id !== id));

  const applyTemplate = (tid: string) => {
    const t = templates.find((x) => x.id === tid);
    if (!t || !t.lines.length) return;
    setTemplateId(tid);
    setItems(
      t.lines.map((line) => {
        const row = emptyLine();
        return {
          ...row,
          fabricCode: line.dsamNumber,
          dsamNumber: line.dsamNumber,
          materialName: line.materialName,
          colorCode: line.colorCode,
          colorName: line.colorName,
          length: String(line.length),
          widthCm: String(line.widthCm || 0),
          gsm: String(line.gsm || 0),
          weight: '0',
          price: String(line.price),
          note: line.note || '',
        };
      }),
    );
    setSummaryOpen(true);
  };

  const handleImagePick = async (lineId: string, file: File | null) => {
    if (!file) return;
    const looksLikeImage =
      file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name);
    if (!looksLikeImage) {
      showToast({ type: 'error', message: 'الملف المختار ليس صورة' });
      return;
    }

    setCompressingLineId(lineId);
    try {
      const { dataUrl } = await compressOrderLineImage(file);
      patchLine(lineId, { imageUrl: dataUrl });
      showToast({ type: 'success', message: 'تم ضغط الصورة وجاهزة للحفظ' });
    } catch (err) {
      showToast({ type: 'error', message: compressOrderLineImageErrorMessage(err) });
    } finally {
      setCompressingLineId(null);
      const input = fileInputRefs.current[lineId];
      if (input) input.value = '';
    }
  };

  const groupText = (value: string) => value.trim() || 'غير محدد';

  const groupKey = (materialName: string, designCode: string) => `${materialName}|||${designCode}`;

  const getGroupPriceValue = (materialName: string, designCode: string): string => {
    const hit = items.find(
      (item) =>
        groupText(item.materialName || item.fabricCode) === materialName &&
        groupText(item.fabricCode || item.dsamNumber) === designCode,
    );
    return hit?.price ?? '';
  };

  const updateGroupPrice = (materialName: string, designCode: string, price: string) => {
    if (!isValidPriceInput(price)) return;
    const normalized = normalizePriceInput(price);
    setItems((prev) =>
      prev.map((item) =>
        groupText(item.materialName || item.fabricCode) === materialName &&
        groupText(item.fabricCode || item.dsamNumber) === designCode
          ? { ...item, price: normalized }
          : item,
      ),
    );
  };

  const getItemError = (item: FormLine, field: 'metersPerRoll' | 'rollCount') => {
    if (isBlankOrderLine(item)) return '';
    if (field === 'metersPerRoll') {
      const value = numberValue(item.metersPerRoll);
      if (value <= 0) return 'متر/رول يجب أن يكون أكبر من صفر';
    }
    if (field === 'rollCount') {
      const value = Math.round(numberValue(item.rollCount));
      if (value <= 0) return 'عدد الرول يجب أن يكون أكبر من صفر';
    }
    return '';
  };

  const hasValidationErrors =
    savableItems.length === 0 ||
    savableItems.some(
      (item) => getItemError(item, 'metersPerRoll') || getItemError(item, 'rollCount'),
    );

  const buildPayload = (): OrderFormSubmitPayload | null => {
    if (hasValidationErrors || !partyId) return null;
    const lines: CustomerOrderLine[] = savableItems.map((item) => {
      const synced = syncLineQuantities(item);
      const rollCount = Math.max(1, Math.round(numberValue(synced.rollCount)) || 1);
      const metersPerRoll = numberValue(synced.metersPerRoll);
      const designNo = item.fabricCode.trim() || item.rollNo.trim();
      return {
        materialName: item.materialName.trim() || designNo || '—',
        dsamNumber: item.dsamNumber.trim(),
        rollNo: designNo,
        colorCode: item.colorCode.trim(),
        colorName: item.colorName.trim(),
        length: numberValue(synced.length),
        metersPerRoll,
        rollCount,
        widthCm: numberValue(item.widthCm),
        gsm: numberValue(item.gsm),
        weight: numberValue(item.weight),
        price: numberValue(item.price),
        note: item.note.trim() || undefined,
        imageUrl: item.imageUrl?.trim() || undefined,
        referenceBarcode: item.scanBarcode.trim() || undefined,
        unitType: 'meter' as const,
      };
    });
    return {
      orderNumber: orderNumber.trim() || undefined,
      date,
      customerId: partyId,
      currency,
      warehouse: warehouse.trim() || undefined,
      shippingMethod: shippingMethod.trim() || undefined,
      notes: notes.trim() || undefined,
      items: lines,
      status,
      expectedDate: expectedDate.trim() || undefined,
      templateId: templateId || undefined,
      advancePayment: advancePayment.trim() ? Number(advancePayment) || undefined : undefined,
    };
  };

  const handleSave = async (kind: 'draft' | 'final') => {
    const payload = buildPayload();
    if (!payload || !partyId) {
      showToast({
        type: 'error',
        message: !partyId
          ? 'اختر العميل قبل الحفظ'
          : savableItems.length === 0
            ? summaryItems.length > 0
              ? 'أكمل اللون في كل سطر قبل الحفظ'
              : 'أضف سطراً واحداً على الأقل (خامة + كمية + لون)'
            : 'تحقق من الكميات في بنود الطلبية',
      });
      return;
    }
    const st =
      kind === 'draft'
        ? ('draft' as const)
        : payload.status === 'draft'
          ? ('pending_supply' as const)
          : payload.status;
    setSaving(true);
    try {
      const result = await onSubmit({ ...payload, status: st }, editingOrder ? 'update' : 'create');
      const draftsCreated = result?.cartelaDraftsCreated ?? 0;
      if (draftsCreated > 0) {
        showToast({
          type: 'success',
          message: `تمت إضافة ${draftsCreated} كارتيلا مسودة — يمكن إكمال التفاصيل من سجل الكارتيلات`,
        });
      }
      onClose();
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر حفظ الطلبية',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDownTable = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const currentInput = e.currentTarget;
    const currentRow = currentInput.closest('tr');
    if (!currentRow) return;
    const inputsInRow = Array.from(currentRow.querySelectorAll('input[type="number"],input:not([type])')) as HTMLInputElement[];
    const currentIndex = inputsInRow.indexOf(currentInput);
    if (currentIndex > -1 && currentIndex < inputsInRow.length - 1) {
      inputsInRow[currentIndex + 1].focus();
      return;
    }
    const table = currentRow.closest('tbody');
    const rows = table ? (Array.from(table.querySelectorAll('tr')) as HTMLTableRowElement[]) : [];
    const currentRowIndex = rows.indexOf(currentRow);
    const nextRow = rows[currentRowIndex + 1];
    const nextRowInput = nextRow?.querySelector('input[type="number"],input:not([type])');
    if (nextRowInput) {
      (nextRowInput as HTMLInputElement).focus();
      return;
    }
    handleAddItem();
  };

  const inputClass = (hasError = false) =>
    `w-full bg-white border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500 shadow-sm ${
      hasError ? 'border-rose-300 bg-rose-50' : 'border-slate-200'
    }`;

  const selectClass =
    'w-full bg-white border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500 shadow-sm';

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-stretch justify-center p-2 sm:p-3 md:p-4 bg-slate-900/55 backdrop-blur-[2px]"
      dir="rtl"
    >
      <div className="relative flex min-h-0 w-full max-w-[1600px] flex-1 flex-col h-[calc(100dvh-1rem)] sm:h-[calc(100dvh-1.5rem)] md:h-[calc(100dvh-2rem)] bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-gradient-to-l from-indigo-50/80 to-white shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition shrink-0"
              aria-label="إغلاق"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-indigo-700 font-bold text-lg">
                <ClipboardList className="w-5 h-5 shrink-0" />
                {editingOrder ? 'تعديل طلبية حجز' : 'طلبية حجز جديدة'}
              </div>
              <p className="text-sm text-slate-500 mt-0.5">
                الباركود → اسم الخامة → كود الخامة — اللون يدوياً. السطر التالي يرث الباركود والكميات.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg flex items-center gap-1.5 hover:bg-slate-50 text-sm font-medium"
            >
              <X className="w-4 h-4" />
              إلغاء
            </button>
            <button
              type="button"
              disabled={hasValidationErrors || !partyId || saving}
              onClick={() => void handleSave('draft')}
              className="bg-amber-50 text-amber-800 border border-amber-200 px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-medium disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              {saving ? 'جاري الحفظ…' : 'حفظ مسودة'}
            </button>
            <button
              type="button"
              disabled={hasValidationErrors || !partyId || saving}
              onClick={() => void handleSave('final')}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'جاري الحفظ…' : editingOrder ? 'حفظ التعديلات' : 'تأكيد الطلبية'}
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto flex-1 px-4 sm:px-6 py-5 space-y-6">
          <div className="rounded-xl border border-cyan-200 bg-cyan-50/80 px-4 py-3 text-sm text-cyan-900 flex flex-wrap gap-2 items-center">
            <strong>تنبيه:</strong>
            <span>
              امسح <strong>باركود/QR الكارتيلا</strong> لتعبئة الخامة والباركود — ثم أكمل{' '}
              <strong>كود اللون</strong> و<strong>اللون</strong> يدوياً. السطر التالي يرث نفس الباركود والكميات والسعر.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            <div className="space-y-1.5 xl:col-span-2">
              <label className="text-xs font-bold text-slate-700">رقم الطلبية</label>
              <input
                type="text"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                placeholder="يُولَّد تلقائياً (رقم فقط)"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">التاريخ</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">توريد متوقع</label>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">دفعة مقدمة من العميل</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={advancePayment}
                onChange={(e) => setAdvancePayment(e.target.value)}
                placeholder="0.00"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">العميل *</label>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              >
                <option value="">— اختر العميل —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {selectedCustomer && (
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  <span className="font-bold text-slate-600">من قيد العميل:</span>{' '}
                  {selectedCustomer.phone?.trim() || '—'}
                  {selectedCustomer.address?.trim() ? ` · ${selectedCustomer.address.trim()}` : ''}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">حالة الطلبية</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as CustomerOrder['status'])}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              >
                {ORDER_STATUS_FLOW.map((s) => (
                  <option key={s} value={s}>
                    {ORDER_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">طريقة الشحن</label>
              <input
                type="text"
                value={shippingMethod}
                onChange={(e) => setShippingMethod(e.target.value)}
                list="shipping-method-options"
                placeholder="مثال: شحن داخلي، استلام، توصيل..."
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
              <datalist id="shipping-method-options">
                <option value="شحن داخلي" />
                <option value="استلام من المستودع" />
                <option value="توصيل للعميل" />
                <option value="شحن خارجي" />
              </datalist>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">مستودع (مرجعي)</label>
              <select
                value={warehouse}
                onChange={(e) => setWarehouse(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="main">المستودع الرئيسي</option>
                <option value="sub">مستودع الجملة</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">العملة</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="SAR">ريال (SAR)</option>
                <option value="USD">دولار (USD)</option>
                <option value="TRY">ليرة (TRY)</option>
              </select>
            </div>
            <div className="space-y-1.5 xl:col-span-2">
              <label className="text-xs font-bold text-slate-700">تحميل من نموذج</label>
              <select
                value={templateId || ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setTemplateId(v || undefined);
                  if (v) applyTemplate(v);
                }}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">— بدون نموذج —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-bold text-slate-900">بنود الطلبية</h3>
              <button
                type="button"
                onClick={handleAddItem}
                className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> إضافة سطر
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-right text-xs sm:text-sm border-collapse min-w-[880px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <th className="p-2 font-bold w-10 text-center">#</th>
                    <th className="p-2 font-bold min-w-[120px]">الباركود</th>
                    <th className="p-2 font-bold min-w-[130px]">اسم الخامة</th>
                    <th className="p-2 font-bold min-w-[90px]">DESIGN NO</th>
                    <th className="p-2 font-bold min-w-[100px]">كود لون</th>
                    <th className="p-2 font-bold min-w-[110px]">لون</th>
                    <th className="p-2 font-bold min-w-[90px]">متر/رول</th>
                    <th className="p-2 font-bold min-w-[70px]">عدد رول</th>
                    <th className="p-2 font-bold min-w-[80px]">إجمالي م</th>
                    <th className="p-2 font-bold w-14 text-center">صورة</th>
                    <th className="p-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => {
                    const lengthError = getItemError(item, 'metersPerRoll');
                    const rollCountError = getItemError(item, 'rollCount');

                    return (
                      <tr key={item.id} className="border-b border-slate-100">
                        <td className="p-1.5 text-center font-bold text-slate-400">{index + 1}</td>
                        <td className="p-1.5">
                          <div className="relative">
                            <QrCode className="w-3.5 h-3.5 absolute right-2 top-2 text-slate-400 pointer-events-none" />
                            <input
                              ref={(el) => {
                                barcodeInputRefs.current[item.id] = el;
                              }}
                              type="text"
                              placeholder="امسح الباركود"
                              value={item.scanBarcode}
                              onChange={(e) => patchLine(item.id, { scanBarcode: e.target.value })}
                              onBlur={() => void handleBarcodeCommit(item.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  void handleBarcodeCommit(item.id);
                                }
                              }}
                              className="w-full bg-white border border-slate-200 rounded pr-7 pl-1.5 py-1.5 text-xs font-mono"
                              dir="ltr"
                            />
                          </div>
                        </td>
                        <td className="p-1.5">
                          <input
                            type="text"
                            placeholder="اسم الخامة"
                            value={item.materialName}
                            onChange={(e) => patchLine(item.id, { materialName: e.target.value })}
                            onKeyDown={handleKeyDownTable}
                            className={inputClass()}
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="text"
                            placeholder="7025"
                            value={item.fabricCode}
                            onChange={(e) =>
                              patchLine(item.id, { fabricCode: e.target.value, rollNo: e.target.value })
                            }
                            onKeyDown={handleKeyDownTable}
                            className={`${inputClass()} font-mono text-xs`}
                            dir="ltr"
                            title="DESIGN NO من الكارتيلا"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            ref={(el) => {
                              colorCodeInputRefs.current[item.id] = el;
                            }}
                            type="text"
                            placeholder="كود لون"
                            value={item.colorCode}
                            onChange={(e) => patchLine(item.id, { colorCode: e.target.value })}
                            onKeyDown={handleKeyDownTable}
                            className={inputClass()}
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="text"
                            placeholder="لون"
                            value={item.colorName}
                            onChange={(e) => patchLine(item.id, { colorName: e.target.value })}
                            onKeyDown={handleKeyDownTable}
                            className={inputClass()}
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={item.metersPerRoll}
                            onChange={(e) => patchLine(item.id, { metersPerRoll: e.target.value })}
                            onKeyDown={handleKeyDownTable}
                            title={lengthError}
                            placeholder="0"
                            className={`${inputClass(Boolean(lengthError))} min-w-[4.5rem]`}
                            dir="ltr"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={item.rollCount}
                            onChange={(e) => patchLine(item.id, { rollCount: e.target.value })}
                            onKeyDown={handleKeyDownTable}
                            title={rollCountError}
                            placeholder="1"
                            className={`${inputClass(Boolean(rollCountError))} min-w-[3.5rem]`}
                            dir="ltr"
                          />
                        </td>
                        <td className="p-1.5 font-bold text-slate-700 bg-slate-50/80 text-center font-mono text-[11px]">
                          {numberValue(item.length).toFixed(2)}
                        </td>
                        <td className="p-1.5 align-middle">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/*"
                            capture="environment"
                            className="hidden"
                            ref={(el) => {
                              fileInputRefs.current[item.id] = el;
                            }}
                            onChange={(e) => void handleImagePick(item.id, e.target.files?.[0] ?? null)}
                          />
                          <button
                            type="button"
                            disabled={compressingLineId === item.id}
                            onClick={() => fileInputRefs.current[item.id]?.click()}
                            className="w-10 h-10 mx-auto rounded-lg border border-dashed border-slate-300 flex items-center justify-center overflow-hidden bg-slate-50 hover:border-indigo-400 transition disabled:opacity-60"
                            title="إرفاق صورة (كاميرا أو معرض)"
                          >
                            {compressingLineId === item.id ? (
                              <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                            ) : item.imageUrl ? (
                              <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <ImagePlus className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                        </td>
                        <td className="p-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            disabled={items.length === 1}
                            className="text-slate-400 hover:text-rose-500 disabled:opacity-30 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 font-bold border-t border-slate-200 text-slate-700 text-xs">
                  <tr>
                    <td colSpan={8} className="p-2 text-left">
                      المجموع
                    </td>
                    <td className="p-2 font-mono">{summary.totals.totalMeters.toFixed(2)}</td>
                    <td className="p-2" colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <section className="rounded-xl border border-slate-200 bg-slate-50">
            <button
              type="button"
              onClick={() => setSummaryOpen(!summaryOpen)}
              className="w-full flex items-center justify-between px-4 py-3 text-right"
            >
              <div>
                <h3 className="text-base font-bold text-slate-900">ملخص حسب الخامة والتصميم</h3>
                <p className="text-xs text-slate-500">التسعير هنا — سعر المتر لكل خامة/تصميم</p>
              </div>
              {summaryOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
            {summaryOpen && (
              <div className="px-4 pb-4 space-y-3">
                <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
                  <table className="w-full text-xs sm:text-sm text-right">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="p-2">الخامة</th>
                        <th className="p-2">التصميم</th>
                        <th className="p-2">ألوان</th>
                        <th className="p-2">رولات</th>
                        <th className="p-2">أمتار</th>
                        <th className="p-2">سعر المتر</th>
                        <th className="p-2">إجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.groups.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-4 text-center text-slate-400 text-sm">
                            {items.some(isSummaryLine)
                              ? 'أدخل سعر المتر لكل خامة/تصميم'
                              : 'امسح الباركود وأدخل الكمية — يظهر الملخص تلقائياً'}
                          </td>
                        </tr>
                      ) : (
                        summary.groups.map((group) => (
                        <tr
                          key={groupKey(group.materialName, group.designCode)}
                          className="border-t border-slate-100"
                        >
                          <td className="p-2 font-bold">{group.materialName}</td>
                          <td className="p-2 font-mono text-[11px]">{group.designCode}</td>
                          <td className="p-2">{group.colorCount}</td>
                          <td className="p-2">{group.rollCount}</td>
                          <td className="p-2 font-mono">{group.totalMeters.toFixed(2)}</td>
                          <td className="p-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={getGroupPriceValue(group.materialName, group.designCode)}
                              onChange={(event) =>
                                updateGroupPrice(group.materialName, group.designCode, event.target.value)
                              }
                              className="w-24 bg-white border border-slate-200 rounded px-1.5 py-1 font-mono text-left"
                              dir="ltr"
                              aria-label={`سعر المتر — ${group.materialName}`}
                            />
                          </td>
                          <td className="p-2 font-mono font-bold text-indigo-700">{money(group.totalAmount, currency)}</td>
                        </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <SummaryStat label="رولات" value={String(summary.totals.rollCount)} />
                  <SummaryStat label="أمتار" value={summary.totals.totalMeters.toFixed(2)} />
                  <SummaryStat label={`إجمالي ${currency}`} value={money(summary.totals.totalAmount, currency)} />
                  <SummaryStat label="مجموعات" value={String(summary.totals.groupCount)} />
                </div>
              </div>
            )}
          </section>

          <div>
            <label className="text-xs font-bold text-slate-700">ملاحظات عامة للطلبية</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="شروط التسليم، مرجع شحنة المورد، ..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-2.5">
      <div className="text-[10px] font-bold text-slate-500">{label}</div>
      <div className="mt-0.5 font-black text-slate-900 font-mono text-sm">{value}</div>
    </div>
  );
}
