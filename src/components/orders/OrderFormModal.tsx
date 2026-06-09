import React, { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileText,
  ImagePlus,
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

export interface OrderFormSubmitPayload {
  orderNumber?: string;
  date: string;
  customerId: string;
  currency: string;
  warehouse?: string;
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
  /** الكمية بالمتر (رقم واحد يظهر في عمود متر / يارد) */
  length: string;
  price: string;
  materialName: string;
  dsamNumber: string;
  rollNo: string;
  widthCm: string;
  gsm: string;
  weight: string;
  note: string;
  imageUrl?: string;
}

const DEFAULT_WIDTH_CM = '150';
const DEFAULT_GSM = '150';

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
  id: `L-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
  scanBarcode: '',
  fabricCode: '',
  colorCode: '',
  colorName: '',
  length: '',
  price: '',
  materialName: '',
  dsamNumber: '',
  rollNo: '',
  widthCm: DEFAULT_WIDTH_CM,
  gsm: DEFAULT_GSM,
  weight: String(calculateFabricWeightKg(0, Number(DEFAULT_WIDTH_CM), Number(DEFAULT_GSM))),
  note: '',
  imageUrl: undefined,
});

const toFormLine = (row: CustomerOrderLine): FormLine => {
  let len = row.length;
  if (row.unitType === 'yard') {
    len = Math.round(row.length * YARDS_TO_METERS * 100) / 100;
  }
  return {
    id: row.id,
    scanBarcode: row.referenceBarcode ?? '',
    fabricCode: row.dsamNumber || '',
    colorCode: row.colorCode,
    colorName: row.colorName,
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
  };
};

const numberValue = (value: string) => Number(value) || 0;
const money = (value: number, currency: string) =>
  `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || 'SAR'}`;

type OrderFormModalProps = {
  open: boolean;
  onClose: () => void;
  customers: Customer[];
  inventory: FabricItem[];
  templates: OrderTemplate[];
  editingOrder: CustomerOrder | null;
  onSubmit: (payload: OrderFormSubmitPayload, mode: 'create' | 'update') => void | Promise<void>;
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
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [orderNumber, setOrderNumber] = useState('');
  const [partyId, setPartyId] = useState('');
  const [warehouse, setWarehouse] = useState('main');
  const [currency, setCurrency] = useState('SAR');
  const [notes, setNotes] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [advancePayment, setAdvancePayment] = useState('');
  const [status, setStatus] = useState<CustomerOrder['status']>('draft');
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<FormLine[]>([emptyLine()]);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const barcodeInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const fabricCodesSorted = useMemo(() => {
    const codes = [...new Set(inventory.map((i) => i.fabricCode).filter(Boolean))];
    return codes.sort((a, b) => a.localeCompare(b, 'ar'));
  }, [inventory]);

  const colorCodesForFabric = useCallback(
    (fc: string) =>
      [...new Set(inventory.filter((i) => i.fabricCode === fc).map((i) => i.colorCode))].sort(),
    [inventory],
  );

  const colorNamesForFabricColor = useCallback(
    (fc: string, cc: string) =>
      [
        ...new Set(
          inventory.filter((i) => i.fabricCode === fc && i.colorCode === cc).map((i) => i.colorName),
        ),
      ].sort(),
    [inventory],
  );

  const recalcWeight = useCallback((line: FormLine): string => {
    const m = numberValue(line.length);
    return String(calculateFabricWeightKg(m, numberValue(line.widthCm), numberValue(line.gsm)));
  }, []);

  const patchLine = useCallback(
    (id: string, patch: Partial<FormLine>) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          const next = { ...item, ...patch };
          next.weight = recalcWeight(next);
          return next;
        }),
      );
    },
    [recalcWeight],
  );

  useEffect(() => {
    if (!open) return;
    if (editingOrder) {
      setDate(editingOrder.date);
      setOrderNumber(editingOrder.orderNumber);
      setPartyId(editingOrder.customerId);
      setWarehouse(editingOrder.warehouse || 'main');
      setCurrency(editingOrder.currency);
      setNotes(editingOrder.notes || '');
      setExpectedDate(editingOrder.expectedDate || '');
      setAdvancePayment(editingOrder.advancePayment != null ? String(editingOrder.advancePayment) : '');
      setStatus(editingOrder.status);
      setTemplateId(editingOrder.templateId);
      setItems(editingOrder.items.length ? editingOrder.items.map(toFormLine) : [emptyLine()]);
    } else {
      setDate(format(new Date(), 'yyyy-MM-dd'));
      setOrderNumber('');
      setPartyId('');
      setWarehouse('main');
      setCurrency('SAR');
      setNotes('');
      setExpectedDate('');
      setAdvancePayment('');
      setStatus('draft');
      setTemplateId(undefined);
      setItems([emptyLine()]);
    }
  }, [open, editingOrder]);

  const summary = useMemo(
    () =>
      calculateFabricInvoiceSummary(
        items.map((item) => ({
          materialName: item.materialName || item.fabricCode,
          designCode: item.fabricCode || item.dsamNumber,
          colorCode: item.colorCode,
          colorName: item.colorName,
          rollNo: item.rollNo,
          lengthMeters: numberValue(item.length),
          weightKg: item.weight,
          pricePerMeter: item.price,
        })),
      ),
    [items],
  );

  const totalAmount = summary.totals.totalAmount;

  const handleFabricSelect = (lineId: string, fc: string) => {
    const variants = inventory.filter((i) => i.fabricCode === fc);
    const first = variants[0];
    patchLine(lineId, {
      fabricCode: fc,
      dsamNumber: fc,
      materialName: first?.name ?? '',
      colorCode: first?.colorCode ?? '',
      colorName: first?.colorName ?? '',
      price: first ? String(first.sellingPrice) : '',
      rollNo: first?.rollNumber ?? '',
      imageUrl: first?.imageUrl,
    });
  };

  const handleColorCodeSelect = (lineId: string, fc: string, cc: string) => {
    const names = colorNamesForFabricColor(fc, cc);
    patchLine(lineId, {
      colorCode: cc,
      colorName: names[0] ?? '',
    });
  };

  const handleColorNameSelect = (lineId: string, fc: string, cn: string) => {
    const hit = inventory.find((i) => i.fabricCode === fc && i.colorName === cn);
    const patch: Partial<FormLine> = {
      colorName: cn,
      colorCode: hit?.colorCode ?? '',
    };
    if (hit) patch.price = String(hit.sellingPrice);
    patchLine(lineId, patch);
  };

  const handleBarcodeCommit = (lineId: string) => {
    const row = items.find((i) => i.id === lineId);
    if (!row) return;
    const hit = matchFabric(inventory, row.scanBarcode);
    if (!hit) return;

    const merged: Partial<FormLine> = {
      fabricCode: hit.fabricCode,
      dsamNumber: hit.fabricCode,
      materialName: hit.name,
      colorCode: hit.colorCode,
      colorName: hit.colorName,
      price: String(hit.sellingPrice),
      rollNo: hit.rollNumber ?? '',
      imageUrl: hit.imageUrl ?? undefined,
    };

    const nl = emptyLine();
    setItems((prev) => {
      const next = prev.map((it) => {
        if (it.id !== lineId) return it;
        const u = { ...it, ...merged };
        u.weight = recalcWeight(u);
        return u;
      });
      return [...next, nl];
    });

    setTimeout(() => barcodeInputRefs.current[nl.id]?.focus(), 50);
  };

  const handleAddItem = () => setItems([...items, emptyLine()]);
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
          widthCm: String(line.widthCm),
          gsm: String(line.gsm),
          weight: String(calculateFabricWeightKg(line.length, line.widthCm, line.gsm)),
          price: String(line.price),
          note: line.note || '',
        };
      }),
    );
    setSummaryOpen(true);
  };

  const handleImagePick = (lineId: string, file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result as string;
      patchLine(lineId, { imageUrl: data });
    };
    reader.readAsDataURL(file);
  };

  const groupText = (value: string) => value.trim() || 'غير محدد';

  const updateGroupPrice = (materialName: string, designCode: string, price: string) => {
    setItems(
      items.map((item) =>
        groupText(item.materialName || item.fabricCode) === materialName &&
        groupText(item.fabricCode || item.dsamNumber) === designCode
          ? { ...item, price, weight: recalcWeight({ ...item, price }) }
          : item,
      ),
    );
  };

  const getItemError = (item: FormLine, field: 'length' | 'price') => {
    const value = numberValue(item[field]);
    if (field === 'length' && value <= 0) return 'الكمية يجب أن تكون أكبر من صفر';
    if (field === 'price' && value < 0) return 'السعر لا يمكن أن يكون سالبا';
    return '';
  };

  const hasValidationErrors = items.some(
    (item) => getItemError(item, 'length') || getItemError(item, 'price'),
  );

  const buildPayload = (): OrderFormSubmitPayload | null => {
    if (hasValidationErrors || !partyId) return null;
    const lines: CustomerOrderLine[] = items.map((item) => ({
      id: item.id,
      materialName: item.materialName || item.fabricCode || '—',
      dsamNumber: item.fabricCode || item.dsamNumber,
      rollNo: item.rollNo,
      colorCode: item.colorCode,
      colorName: item.colorName,
      length: numberValue(item.length),
      widthCm: numberValue(item.widthCm),
      gsm: numberValue(item.gsm),
      weight: numberValue(item.weight),
      price: numberValue(item.price),
      note: item.note.trim() || undefined,
      imageUrl: item.imageUrl,
      referenceBarcode: item.scanBarcode.trim() || undefined,
      unitType: 'meter',
    }));
    return {
      orderNumber: orderNumber.trim() || undefined,
      date,
      customerId: partyId,
      currency,
      warehouse,
      notes: notes.trim() || undefined,
      items: lines,
      status,
      expectedDate: expectedDate || undefined,
      templateId,
      advancePayment: advancePayment.trim() ? Number(advancePayment) || undefined : undefined,
    };
  };

  const handleSave = async (kind: 'draft' | 'final') => {
    const payload = buildPayload();
    if (!payload || !partyId) return;
    const st =
      kind === 'draft'
        ? ('draft' as const)
        : payload.status === 'draft'
          ? ('pending_supply' as const)
          : payload.status;
    await onSubmit({ ...payload, status: st }, editingOrder ? 'update' : 'create');
    onClose();
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
                امسح الباركود في «الخامة / مرجع» لتعبئة السطر من المخزون وفتح سطر جديد؛ أو اختر كود خامة والألوان من القوائم.
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
              disabled={hasValidationErrors || !partyId}
              onClick={() => handleSave('draft')}
              className="bg-amber-50 text-amber-800 border border-amber-200 px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-medium disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              حفظ مسودة
            </button>
            <button
              type="button"
              disabled={hasValidationErrors || !partyId}
              onClick={() => handleSave('final')}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {editingOrder ? 'حفظ التعديلات' : 'تأكيد الطلبية'}
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto flex-1 px-4 sm:px-6 py-5 space-y-6">
          <div className="rounded-xl border border-cyan-200 bg-cyan-50/80 px-4 py-3 text-sm text-cyan-900 flex flex-wrap gap-2 items-center">
            <strong>تنبيه:</strong>
            <span>
              خانة «الخامة / مرجع» للباركود — عند التطابق مع المخزون تُعبَّأ الحقول وتُضاف صف جديد. بدون مطابقة يمكن الاختيار يدوياً من
              القوائم المنسدلة المرتبطة بنفس الصف.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            <div className="space-y-1.5 xl:col-span-2">
              <label className="text-xs font-bold text-slate-700">رقم الطلبية</label>
              <input
                type="text"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                placeholder="يُولَّد تلقائياً إن تُرك فارغاً"
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
              <table className="w-full text-right text-xs sm:text-sm border-collapse min-w-[920px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <th className="p-2 font-bold w-10 text-center">#</th>
                    <th className="p-2 font-bold w-16 text-center">صورة</th>
                    <th className="p-2 font-bold min-w-[140px]">الخامة / مرجع</th>
                    <th className="p-2 font-bold min-w-[120px]">كود خامة</th>
                    <th className="p-2 font-bold min-w-[100px]">كود لون</th>
                    <th className="p-2 font-bold min-w-[110px]">لون</th>
                    <th className="p-2 font-bold min-w-[130px]">متر / يارد</th>
                    <th className="p-2 font-bold w-24">السعر</th>
                    <th className="p-2 font-bold w-24">إجمالي</th>
                    <th className="p-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => {
                    const lengthError = getItemError(item, 'length');
                    const ccOptions = item.fabricCode ? colorCodesForFabric(item.fabricCode) : [];
                    const nameOptions =
                      item.fabricCode && item.colorCode
                        ? colorNamesForFabricColor(item.fabricCode, item.colorCode)
                        : item.fabricCode
                          ? [
                              ...new Set(
                                inventory.filter((i) => i.fabricCode === item.fabricCode).map((i) => i.colorName),
                              ),
                            ].sort()
                          : [];
                    const lineTotal = numberValue(item.length) * numberValue(item.price);

                    return (
                      <tr key={item.id} className="border-b border-slate-100">
                        <td className="p-1.5 text-center font-bold text-slate-400">{index + 1}</td>
                        <td className="p-1.5 align-middle">
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            ref={(el) => {
                              fileInputRefs.current[item.id] = el;
                            }}
                            onChange={(e) => handleImagePick(item.id, e.target.files?.[0] ?? null)}
                          />
                          <button
                            type="button"
                            onClick={() => fileInputRefs.current[item.id]?.click()}
                            className="w-12 h-12 rounded-lg border border-dashed border-slate-300 flex items-center justify-center overflow-hidden bg-slate-50 hover:border-indigo-400 transition"
                          >
                            {item.imageUrl ? (
                              <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <ImagePlus className="w-5 h-5 text-slate-400" />
                            )}
                          </button>
                        </td>
                        <td className="p-1.5">
                          <div className="relative">
                            <QrCode className="w-3.5 h-3.5 absolute right-2 top-2 text-slate-400 pointer-events-none" />
                            <input
                              ref={(el) => {
                                barcodeInputRefs.current[item.id] = el;
                              }}
                              type="text"
                              placeholder="باركود أو مرجع"
                              value={item.scanBarcode}
                              onChange={(e) => patchLine(item.id, { scanBarcode: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleBarcodeCommit(item.id);
                                }
                              }}
                              className="w-full bg-white border border-slate-200 rounded pr-7 pl-1.5 py-1.5 text-xs font-mono"
                              dir="ltr"
                            />
                          </div>
                        </td>
                        <td className="p-1.5">
                          <select
                            value={item.fabricCode}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (!v) {
                                patchLine(item.id, {
                                  fabricCode: '',
                                  dsamNumber: '',
                                  materialName: '',
                                  colorCode: '',
                                  colorName: '',
                                  price: '',
                                  rollNo: '',
                                });
                                return;
                              }
                              handleFabricSelect(item.id, v);
                            }}
                            className={selectClass}
                          >
                            <option value="">— كود خامة —</option>
                            {fabricCodesSorted.map((fc) => (
                              <option key={fc} value={fc}>
                                {fc}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-1.5">
                          <select
                            value={item.colorCode}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (!item.fabricCode) return;
                              if (!v) patchLine(item.id, { colorCode: '', colorName: '' });
                              else handleColorCodeSelect(item.id, item.fabricCode, v);
                            }}
                            disabled={!item.fabricCode}
                            className={`${selectClass} disabled:opacity-50`}
                          >
                            <option value="">— كود لون —</option>
                            {ccOptions.map((cc) => (
                              <option key={cc} value={cc}>
                                {cc}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-1.5">
                          <select
                            value={item.colorName}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (!item.fabricCode) return;
                              if (!v) patchLine(item.id, { colorName: '', colorCode: '' });
                              else handleColorNameSelect(item.id, item.fabricCode, v);
                            }}
                            disabled={!item.fabricCode}
                            className={`${selectClass} disabled:opacity-50`}
                          >
                            <option value="">— لون —</option>
                            {nameOptions.map((nm) => (
                              <option key={nm} value={nm}>
                                {nm}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-1.5">
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={item.length}
                            onChange={(e) => patchLine(item.id, { length: e.target.value })}
                            onKeyDown={handleKeyDownTable}
                            title={lengthError}
                            placeholder="0"
                            className={`${inputClass(Boolean(lengthError))} min-w-[5rem]`}
                            dir="ltr"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.price}
                            onChange={(e) => patchLine(item.id, { price: e.target.value })}
                            onKeyDown={handleKeyDownTable}
                            className={inputClass()}
                            dir="ltr"
                          />
                        </td>
                        <td className="p-1.5 font-bold text-slate-700 bg-slate-50/80 text-center font-mono text-[11px]">
                          {lineTotal.toFixed(2)}
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
                    <td colSpan={6} className="p-2 text-left">
                      المجموع
                    </td>
                    <td className="p-2 font-mono">{summary.totals.totalMeters.toFixed(2)}</td>
                    <td className="p-2" />
                    <td className="p-2 font-mono text-indigo-700">{money(totalAmount, currency)}</td>
                    <td className="p-2" />
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
                <p className="text-xs text-slate-500">إجمالي الأمتار محسوب من الكمية المدخلة في كل سطر</p>
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
                        <th className="p-2">وزن KG</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.groups.map((group) => (
                        <tr key={`${group.materialName}-${group.designCode}-${group.pricePerMeter}`} className="border-t border-slate-100">
                          <td className="p-2 font-bold">{group.materialName}</td>
                          <td className="p-2 font-mono text-[11px]">{group.designCode}</td>
                          <td className="p-2">{group.colorCount}</td>
                          <td className="p-2">{group.rollCount}</td>
                          <td className="p-2 font-mono">{group.totalMeters.toFixed(2)}</td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              value={group.pricePerMeter}
                              onChange={(event) =>
                                updateGroupPrice(group.materialName, group.designCode, event.target.value)
                              }
                              className="w-24 bg-white border border-slate-200 rounded px-1.5 py-1 font-mono text-left"
                              dir="ltr"
                            />
                          </td>
                          <td className="p-2 font-mono font-bold text-indigo-700">{money(group.totalAmount, currency)}</td>
                          <td className="p-2 font-mono">{group.totalKg.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <SummaryStat label="رولات" value={String(summary.totals.rollCount)} />
                  <SummaryStat label="أمتار" value={summary.totals.totalMeters.toFixed(2)} />
                  <SummaryStat label="وزن KG" value={summary.totals.totalKg.toFixed(2)} />
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
