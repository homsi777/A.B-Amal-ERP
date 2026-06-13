import React, { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useNavigate, useLocation, useParams, Link } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { ArrowRight, Save, X, FileText, Plus, Trash2, QrCode, ChevronDown, ChevronUp, FileUp } from 'lucide-react';
import { format } from 'date-fns';
import { calculateFabricInvoiceSummary, calculateFabricWeightKg } from '../../lib/fabricInvoiceSummary';
import { sendTelegramInvoiceNotification } from '../../lib/telegramInvoice';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import {
  listFabricRolls,
  getFabricRoll,
  completeMissingRollFields,
  type FabricRollDto,
} from '../../lib/api/fabricRollsApi';
import { getRollLengthMeters, isFabricRollStockRow, isRollAvailableForSale } from '../../lib/inventory/rollAvailability';
import { listFabricItems, type ApiFabricItem } from '../../lib/api/fabricItemsApi';
import { ApiRequestError } from '../../lib/api/client';
import { listCashboxes } from '../../lib/api/cashboxesApi';
import { createSalesInvoice as postSalesInvoice, getSalesInvoice, updateSalesInvoice, confirmSalesInvoice } from '../../lib/api/salesInvoicesApi';
import type { SalesInvoiceCreatePayload } from '../../lib/api/salesInvoicesApi';
import {
  createPurchaseInvoice as postPurchaseInvoice,
  getPurchaseInvoice,
  updatePurchaseInvoice,
  confirmPurchaseInvoice,
} from '../../lib/api/purchaseInvoicesApi';
import type { PurchaseInvoiceCreatePayload } from '../../lib/api/purchaseInvoicesApi';
import { getCustomerStatement } from '../../lib/api/partyStatementsApi';
import { focusNextFormControl } from '../../lib/forms/enterNavigation';
import { useToast } from '../../components/NonBlockingToast';
import { InvoiceSaveActionsModal } from '../../components/invoices/InvoiceSaveActionsModal';
import { SmartPartySearch } from '../../components/SmartPartySearch';
import { listExchangeRates, type ExchangeRateDto } from '../../lib/api/exchangeRatesApi';
import { convertToUsd, normalizeExchangeRate, round2, SUPPORTED_CURRENCIES } from '../../lib/currency';
import {
  ParsedSupplierLabel,
  isLikelyBarcodePayload,
  parseSupplierLabelQr,
} from '../../lib/supplierLabelParser';
import { buildInvoiceFormLineDraftsFromDbLines, INVOICE_NUMBER_PENDING_LABEL, INVOICE_NUMBER_MISSING_LABEL, normalizeStoredInvoiceNo } from '../../lib/invoiceDbMappers';
import {
  buildInvoiceSaveDuplicateKey,
  incomingStockConflictsWithLine,
  INVOICE_LINE_UUID_RE,
} from '../../lib/invoiceLineDuplicateIdentity';
import type { Invoice } from '../../types';
import { WHOLESALE_SALES_MODE } from '../../lib/inventoryUiConfig';

/** Optional keys some APIs return for scanner / label matching (not all on FabricRollDto). */
type FabricRollScanIdentity = FabricRollDto & {
  supplierBarcode?: string | null;
  supplier_barcode?: string | null;
  rollNumber?: string | null;
  roll_number?: string | null;
  internalRollId?: string | null;
  qrCode?: string | null;
  qr_code?: string | null;
};

function collectRollIdentityCandidates(r: FabricRollDto): string[] {
  const x: FabricRollScanIdentity = r;
  return [
    x.barcode,
    x.supplierBarcode,
    x.supplier_barcode,
    x.supplier_roll_ref,
    x.roll_no,
    x.rollNumber,
    x.roll_number,
    x.internalRollId,
    x.id,
    x.qrCode,
    x.qr_code,
  ]
    .filter((v): v is string => v != null && String(v).trim() !== '')
    .map((v) => String(v).trim().toLowerCase());
}

interface InvoiceFormItem {
  id: number;
  materialName: string;
  dsamNumber: string;
  rollNo: string;
  colorCode: string;
  colorName: string;
  length: string;
  rollQty: string;
  lengthUnit: 'meter' | 'yard';
  widthCm: string;
  gsm: string;
  weight: string;
  price: string;
  note: string;
  supplierBarcode: string;
  printBarcode: string;
  qualityGrade: string;
  internalRollId: string;
  fabricItemId: string;
  rawQrPayload: string;
  rawBarcodePayload: string;
}

interface StagedRollItemPayload {
  name: string;
  fabricCode: string;
  designNumber: string;
  colorName: string;
  colorCode: string;
  lotNumber: string;
  lengthType: 'meter' | 'yard';
  length: number;
  rollWidth: number;
  weight: number;
  warehouseId: string;
  barcode: string;
  supplierBarcode: string;
  qualityGrade: string;
  internalRollId: string;
  costPrice: number;
  sellingPrice: number;
  minStockLevel: number;
  status: 'available' | 'low_stock' | 'out_of_stock';
  type: string;
  yards: number;
  meters: number;
  rollNumber: string;
}

const emptyItem = (): InvoiceFormItem => ({
  id: Date.now() + Math.floor(Math.random() * 1000),
  materialName: '',
  dsamNumber: '',
  rollNo: '',
  colorCode: '',
  colorName: '',
  length: '',
  rollQty: '',
  lengthUnit: 'meter',
  widthCm: '',
  gsm: '',
  weight: '',
  price: '',
  note: '',
  supplierBarcode: '',
  printBarcode: '',
  qualityGrade: '',
  internalRollId: '',
  fabricItemId: '',
  rawQrPayload: '',
  rawBarcodePayload: '',
});

const EDIT_INVOICE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** قيمة `invoiceNo` في جسم POST عند الإنشاء — الخادم لا يستخدمها لتخزين الرقم (يُولَّد تسلسلياً). */
const CREATE_INVOICE_API_NO_STUB = '-';

function warehouseKeyFromLabel(label: unknown): 'main' | 'sub' {
  const s = String(label ?? '').trim();
  if (s.includes('الجملة')) return 'sub';
  return 'main';
}

const numberValue = (value: string) => Number(value) || 0;
const ROLL_PHYSICAL_EPS = 1e-6;

function printableShortBarcode(value: unknown): string {
  const raw = String(value ?? '').trim();
  const exact = raw.match(/^\d{6,7}$/);
  if (exact) return exact[0];
  return raw.match(/(?<!\d)\d{6,7}(?!\d)/)?.[0] || '';
}

function meaningfulBarcode(value: unknown, context: Array<unknown>): string {
  const candidate = String(value ?? '').trim();
  if (!candidate || candidate === '-' || candidate === '—') return '';
  const invalid = new Set(
    context
      .map((part) => String(part ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  if (invalid.has(candidate.toLowerCase())) return '';
  return candidate;
}

function stockBarcodeValue(stock: any, fallbackContext: Array<unknown> = []): string {
  const context = [
    stock?.item_name,
    stock?.itemName,
    stock?.name,
    stock?.materialName,
    stock?.fabricName,
    stock?.internal_code,
    stock?.internalCode,
    stock?.fabricCode,
    stock?.designNumber,
    stock?.color_name_ar,
    stock?.colorNameAr,
    stock?.colorName,
    stock?.color_code,
    stock?.colorCode,
    ...fallbackContext,
  ];
   return (
     meaningfulBarcode(stock?.supplierBarcode, context) ||
     meaningfulBarcode(stock?.barcode, context) ||
     meaningfulBarcode(stock?.roll_no, context) ||
     meaningfulBarcode(stock?.rollNumber, context) ||
     meaningfulBarcode(stock?.supplier_roll_ref, context) ||
     meaningfulBarcode(stock?.internalRollId, context) ||
     meaningfulBarcode(stock?.label_barcode, context) ||
     meaningfulBarcode(stock?.raw_barcode_payload, context) ||
     ''
   );
}

function stockPrintBarcodeValue(stock: any, fallbackContext: Array<unknown> = []): string {
  const candidates = [
    stock?.barcode,
    stock?.supplierBarcode,
    stock?.printBarcode,
    stock?.supplier_barcode,
    stock?.roll_barcode,
    stock?.labelBarcode,
    stock?.label_barcode,
    stock?.rawBarcodePayload,
    stock?.raw_barcode_payload,
    stock?.qrCode,
    stock?.qr_code,
    ...fallbackContext,
  ];
  for (const candidate of candidates) {
    const barcode = printableShortBarcode(candidate);
    if (barcode) return barcode;
  }
  return '';
}

function sanitizeInvoiceFormItemBarcode(item: InvoiceFormItem): InvoiceFormItem {
  const supplierBarcode = meaningfulBarcode(item.supplierBarcode, [
    item.materialName,
    item.dsamNumber,
    item.colorName,
    item.colorCode,
  ]);
  const printBarcode = item.printBarcode || printableShortBarcode(item.supplierBarcode) || printableShortBarcode(item.rawBarcodePayload);
  if (supplierBarcode === item.supplierBarcode && printBarcode === item.printBarcode) return item;
  return { ...item, supplierBarcode, printBarcode };
}

function normalizeInvoiceScanToken(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeInvoiceScanNumber(value: unknown): string {
  const n = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return '0';
  return String(Math.round(n * 1000) / 1000);
}

function buildInvoiceLineScanDuplicateKey(line: InvoiceFormItem): string {
  const uuid = normalizeInvoiceScanToken(line.internalRollId);
  if (uuid && INVOICE_LINE_UUID_RE.test(uuid)) return `uuid:${uuid}`;

  const barcode = normalizeInvoiceScanToken(line.supplierBarcode) || normalizeInvoiceScanToken(line.rawBarcodePayload);
  if (barcode) return `barcode:${barcode}`;

  const material = normalizeInvoiceScanToken(line.materialName);
  const code = normalizeInvoiceScanToken(line.dsamNumber);
  const color = normalizeInvoiceScanToken(line.colorName);
  const colorCode = normalizeInvoiceScanToken(line.colorCode);
  const length = normalizeInvoiceScanNumber(line.length);
  if (!material && !code && !color && !colorCode) return `line:${line.id}`;

  return ['fabric-length', material, code, color, colorCode, length].join('|');
}

function invoiceRollLengthMissingInInventory(lengthM: string | null | undefined): boolean {
  const n = lengthM != null && lengthM !== '' ? Number(lengthM) : 0;
  return !Number.isFinite(n) || n <= ROLL_PHYSICAL_EPS;
}

function invoiceRollActualWeightMissingInInventory(actual: string | null | undefined): boolean {
  if (actual == null || String(actual).trim() === '') return true;
  const n = Number(actual);
  return !Number.isFinite(n) || n <= ROLL_PHYSICAL_EPS;
}
const money = (value: number, currency: string) => `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || 'USD'}`;
const isEmptyInvoiceItem = (item: InvoiceFormItem) =>
  !item.materialName.trim() &&
  !item.dsamNumber.trim() &&
  !item.rollNo.trim() &&
  !item.supplierBarcode.trim() &&
  !item.colorCode.trim() &&
  !item.colorName.trim() &&
  !item.length.trim() &&
  !item.rollQty.trim() &&
  !item.weight.trim() &&
  !item.price.trim();

function computeInvoiceLineTotal(item: InvoiceFormItem, salesMode: boolean, wholesalePendingTafnid = false): number {
  const price = numberValue(item.price);
  if (salesMode && wholesalePendingTafnid) return 0;
  if (salesMode) {
    return numberValue(item.rollQty) * price;
  }
  const len = numberValue(item.length);
  return len * price;
}

const WHOLESALE_PENDING_TOTAL_LABEL = 'بعد التفنيد';

const isCompleteSupplierQrPayload = (value: string) => {
  if (!value.includes('|')) return false;
  return value.split('|').length >= 6;
};

function isLikelyIdentityBarcodePayload(value: string): boolean {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (raw.includes('|')) return true;
  if (raw.startsWith('{') && raw.endsWith('}')) return true;
  if (/\s/.test(raw)) return false;
  if (!/[0-9._:/#-]/.test(raw)) return false;
  return /^[A-Za-z0-9._:/#-]{4,}$/.test(raw);
}

function parseRollIdentityQrPayload(value: string): {
  rollId: string;
  barcode: string;
  lot?: string;
  articleCode?: string;
  fabricName?: string;
  fabricColor?: string;
  colorCode?: string;
  lengthM?: number;
  weightKg?: number;
  widthCm?: number | null;
  gsm?: number | null;
} | null {
  const raw = String(value || '')
    .replace(/[｜¦]/g, '|')
    .replace(/\r?\n/g, '|')
    .replace(/\t/g, '|')
    .trim();
  if (!raw) return null;
  const cleanScannedColor = (value: string | undefined, fallback: string | undefined) => {
    const rawColor = String(value || '').trim();
    if (!rawColor) return fallback;
    if (/[«»�ØÙÃÂ]/.test(rawColor)) return fallback || rawColor.replace(/[«»�]/g, '').trim();
    return rawColor;
  };

  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      if (String(payload.type || '').toUpperCase() !== 'CLOTEX_ROLL') return null;
      const rollId = String(payload.rollId || '').trim();
      const barcode = String(payload.barcode || '').trim();
      const toNumberOrUndefined = (v: unknown) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };
      const toNumberOrNull = (v: unknown) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const articleCode = String(payload.articleCode || '').trim() || undefined;
      const fabricName = String(payload.fabricName || payload.itemName || '').trim() || undefined;
      const colorCode = String(payload.colorCode || '').trim() || undefined;
      const fabricColor = cleanScannedColor(
        String(payload.fabricColor || payload.colorName || '').trim() || undefined,
        colorCode,
      );
      const lot = String(payload.lot || payload.rollNo || '').trim() || undefined;
      const lengthM = toNumberOrUndefined(payload.lengthM);
      const weightKg = toNumberOrUndefined(payload.weightKg);
      const widthCm = toNumberOrNull(payload.widthCm);
      const gsm = toNumberOrNull(payload.gsm);

      // Accept compact v2 payload that only carries fabric identity fields.
      if (!rollId && !barcode && !articleCode && !fabricName && !fabricColor && !colorCode && lengthM == null && weightKg == null) {
        return null;
      }

      return {
        rollId,
        barcode,
        lot,
        articleCode,
        fabricName,
        fabricColor,
        colorCode,
        lengthM,
        weightKg,
        widthCm,
        gsm,
      };
    } catch {
      return null;
    }
  }

  if (!raw.includes('|')) return null;
  const parts = raw.split('|').map((p) => String(p || '').trim());
  const toNumberOrUndefined = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  // Current compact CLOTEX invoice QR format:
  // barcode|materialName|materialCode|colorName|colorCode|length|weight
  if (parts.length >= 4 && String(parts[0] || '').toUpperCase() !== 'ROLL') {
    const looksLikeInvoiceFormat = parts.length >= 7
      && toNumberOrUndefined(parts[5]) !== undefined
      && toNumberOrUndefined(parts[6]) !== undefined;
    const zeroIfMissing = (value: string | undefined) => String(value || '').trim() || '0';
    const barcode = looksLikeInvoiceFormat ? zeroIfMissing(parts[0]) : '0';
    const fabricName = zeroIfMissing(parts[looksLikeInvoiceFormat ? 1 : 0]);
    const articleCode = zeroIfMissing(parts[looksLikeInvoiceFormat ? 2 : 1]);
    const colorCode = zeroIfMissing(parts[looksLikeInvoiceFormat ? 4 : 3]);
    const fabricColor = cleanScannedColor(
      zeroIfMissing(parts[looksLikeInvoiceFormat ? 3 : 2]),
      colorCode,
    );
    const lengthRaw = parts[looksLikeInvoiceFormat ? 5 : 4] ?? '';
    const weightRaw = parts[looksLikeInvoiceFormat ? 6 : 5] ?? '';
    const lengthM = lengthRaw ? toNumberOrUndefined(lengthRaw) : 0;
    const weightKg = weightRaw ? toNumberOrUndefined(weightRaw) : 0;
    if (!barcode && !fabricName && !articleCode && !fabricColor && !colorCode) return null;
    return {
      rollId: '',
      barcode,
      lot: undefined,
      fabricName,
      articleCode,
      fabricColor,
      colorCode,
      lengthM: lengthM ?? 0,
      weightKg: weightKg ?? 0,
    };
  }

  // Legacy format:
  // ROLL|rollId|barcode|fabricName|articleCode|fabricColor|colorCode|length|weight
  if (String(parts[0] || '').toUpperCase() !== 'ROLL') return null;
  const rollId = String(parts[1] || '').trim();
  const barcode = String(parts[2] || '').trim();
  const fabricName = String(parts[3] || '').trim() || undefined;
  const articleCode = String(parts[4] || '').trim() || undefined;
  const colorCode = String(parts[6] || '').trim() || undefined;
  const fabricColor = cleanScannedColor(String(parts[5] || '').trim() || undefined, colorCode);
  const lot = undefined;
  const lengthM = parts[7] ? toNumberOrUndefined(parts[7]) : undefined;
  const weightKg = parts[8] ? toNumberOrUndefined(parts[8]) : undefined;

  if (!rollId && !barcode && !fabricName && !articleCode) return null;
  
  return { rollId, barcode, lot, fabricName, articleCode, fabricColor, colorCode, lengthM, weightKg };
}

/** حقول سطر الفاتورة: ترتيب صريح للتنقل بـ Enter (يتجاهل الأعمدة المخفية). */
function collectInvoiceLineNavInputs(row: HTMLElement): HTMLInputElement[] {
  return Array.from(row.querySelectorAll<HTMLInputElement>('input[data-invoice-field-index]'))
    .filter((el) => {
      if (el.disabled) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const td = el.closest('td');
      if (td) {
        const tdStyle = window.getComputedStyle(td);
        if (tdStyle.display === 'none' || tdStyle.visibility === 'hidden') return false;
      }
      return true;
    })
    .sort((a, b) => Number(a.dataset.invoiceFieldIndex || '0') - Number(b.dataset.invoiceFieldIndex || '0'));
}

function focusAndSelect(el: HTMLElement | null) {
  if (!el) return;
  el.focus();
  if (el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'search' || el.type === 'number')) {
    try {
      el.select();
    } catch {
      /* ignore */
    }
  }
}

function playWarningBeep() {
  try {
    if (typeof window === 'undefined') return;
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    window.setTimeout(() => {
      try {
        osc.stop();
        osc.disconnect();
        gain.disconnect();
      } catch {
        void 0;
      }
      try {
        void ctx.close();
      } catch {
        void 0;
      }
    }, 120);
  } catch {
    void 0;
  }
}

export const InvoiceForm = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeInvoiceId } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const isSales = location.pathname.includes('sales');
  const wholesaleSalesUi = isSales && WHOLESALE_SALES_MODE;
  const editInvoiceId =
    routeInvoiceId && EDIT_INVOICE_ID_RE.test(routeInvoiceId) && location.pathname.includes('/edit')
      ? routeInvoiceId
      : undefined;
  /** فاتورة بيع جديدة: إخفاء ملخص التفنيد حسب الخامة */
  const hideMaterialSummarySection = isSales && !editInvoiceId;

  const { customers, suppliers, inventory } = useStore();

  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [invoiceNumber, setInvoiceNumber] = useState(INVOICE_NUMBER_PENDING_LABEL);
  const [partyId, setPartyId] = useState('');
  const [warehouse, setWarehouse] = useState('main');
  const [currency, setCurrency] = useState('USD');
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateDto[]>([]);
  const [exchangeRateToUsd, setExchangeRateToUsd] = useState('1');
  const [items, setItems] = useState<InvoiceFormItem[]>([emptyItem()]);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [scanInput, setScanInput] = useState('');
  const [scanMessage, setScanMessage] = useState('');
  const [latestScannedLineId, setLatestScannedLineId] = useState<number | null>(null);
  const [stagedRoll, setStagedRoll] = useState<{ item: StagedRollItemPayload; action: 'found' | 'created' | 'staged' } | null>(null);
  const [apiCustomers, setApiCustomers] = useState<ApiCustomer[]>([]);
  const [apiSuppliers, setApiSuppliers] = useState<ApiSupplier[]>([]);
  const [apiRolls, setApiRolls] = useState<FabricRollDto[]>([]);
  const [rollsLoading, setRollsLoading] = useState(true);
  const scanParseTimersRef = useRef<Record<number, ReturnType<typeof setTimeout> | null>>({});
  const rollPatchInFlightRef = useRef<Set<string>>(new Set());
  const internalRollSequenceRef = useRef(0);
  /** Cache of barcode/identity lookups already resolved against the server to avoid spamming the API. */
  const barcodeLookupCacheRef = useRef<Map<string, FabricRollDto | null>>(new Map());
  /** Tracks in-flight server lookups so a single scan never fires two parallel HTTP calls. */
  const barcodeLookupInFlightRef = useRef<Map<string, Promise<FabricRollDto | null>>>(new Map());

  const [saleType, setSaleType] = useState('cash');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [cashboxId, setCashboxId] = useState('');
  const [cashboxOptions, setCashboxOptions] = useState<{ id: string; name: string; code: string }[]>([]);
  const [discount, setDiscount] = useState('');
  const [headerNotes, setHeaderNotes] = useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [editBlocked, setEditBlocked] = useState(false);
  const [savedSaleInvoice, setSavedSaleInvoice] = useState<{ invoice: Invoice; partyName: string } | null>(null);
  const [partyStatementBalance, setPartyStatementBalance] = useState<number | null>(null);
  const [partyStatementBalanceLoading, setPartyStatementBalanceLoading] = useState(false);

  useEffect(() => {
    if (editInvoiceId) return;
    setInvoiceNumber(INVOICE_NUMBER_PENDING_LABEL);
    setPartyId('');
    setItems([emptyItem()]);
    setScanInput('');
    setScanMessage('');
    setLatestScannedLineId(null);
    setStagedRoll(null);
    setHeaderNotes('');
    setSupplierInvoiceNo('');
    setEditBlocked(false);
    scanParseTimersRef.current = {};
  }, [isSales, editInvoiceId]);

  useEffect(() => {
    if (!editInvoiceId) {
      setDraftLoading(false);
      setEditBlocked(false);
      return;
    }
    let cancelled = false;
    setDraftLoading(true);
    setEditBlocked(false);
    void (async () => {
      try {
        const res = isSales ? await getSalesInvoice(editInvoiceId) : await getPurchaseInvoice(editInvoiceId);
        if (cancelled) return;
        const doc = String(res.data.header.document_status ?? '').toUpperCase();
        if (doc !== 'DRAFT') {
          setEditBlocked(true);
          return;
        }
        const h = res.data.header;
        setDate(String(h.invoice_date ?? '').slice(0, 10) || format(new Date(), 'yyyy-MM-dd'));
        setInvoiceNumber(normalizeStoredInvoiceNo(h.invoice_no) || INVOICE_NUMBER_MISSING_LABEL);
        setPartyId(isSales ? String(h.customer_id ?? '') : String(h.supplier_id ?? ''));
        setWarehouse(warehouseKeyFromLabel(h.warehouse_label));
        setCurrency(String(h.currency_code ?? 'USD'));
        const ccy = String(h.currency_code ?? 'USD').trim().toUpperCase();
        const rateNum = Number(h.exchange_rate_to_usd);
        setExchangeRateToUsd(ccy === 'USD' || !Number.isFinite(rateNum) || rateNum <= 0 ? '1' : String(rateNum));
        setDiscount(String(Number(h.discount_total ?? 0) || ''));
        setHeaderNotes(h.notes != null ? String(h.notes) : '');
        setSupplierInvoiceNo(!isSales && h.supplier_invoice_no != null ? String(h.supplier_invoice_no) : '');
        const paid = Number(h.paid_amount ?? 0) || 0;
        const total = Number(h.total_amount ?? 0) || 0;
        if (total > 0 && paid >= total - 1e-4) {
          setSaleType('cash');
          setPaymentAmount('');
        } else if (paid <= 1e-4) {
          setSaleType('credit');
          setPaymentAmount('');
        } else {
          setSaleType('credit');
          setPaymentAmount(String(paid));
        }
        const drafts = buildInvoiceFormLineDraftsFromDbLines(res.data.lines);
        setItems(
          drafts.length > 0
            ? drafts.map((d, i) => ({ ...emptyItem(), ...d, id: Date.now() + i }))
            : [emptyItem()],
        );
        if (isSales) {
          const rollIds = [
            ...new Set(
              res.data.lines
                .map((ln) => ln.fabric_roll_id)
                .filter((x): x is string => x != null && EDIT_INVOICE_ID_RE.test(String(x)))
                .map((x) => String(x)),
            ),
          ];
          if (rollIds.length) {
            const fetched: FabricRollDto[] = [];
            for (const rid of rollIds) {
              try {
                fetched.push(await getFabricRoll(rid));
              } catch {
                /* roll missing */
              }
            }
            if (fetched.length && !cancelled) {
              setApiRolls((prev) => {
                const byId = new Map(prev.map((x) => [x.id, x]));
                for (const r of fetched) byId.set(r.id, r);
                return Array.from(byId.values());
              });
            }
          }
        }
      } catch (e) {
        if (!cancelled) {
          showToast({
            type: 'error',
            message: e instanceof ApiRequestError ? e.message : 'تعذر تحميل الفاتورة',
          });
          navigate(isSales ? '/invoices/sales' : '/invoices/purchases');
        }
      } finally {
        if (!cancelled) setDraftLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editInvoiceId, isSales, navigate, showToast]);

  useEffect(() => {
    let cancelled = false;
    setRollsLoading(true);
    void (async () => {
      try {
       const [cust, sup, stock, boxes, rates] = await Promise.all([
         listCustomers({ status: 'active', pageSize: 1000 }),
         listSuppliers({ status: 'active', pageSize: 1000 }),
         listFabricRolls({ onlyAvailable: true, pageSize: 10000 }), // متاح للبيع فقط (AVAILABLE + length_m > 0)
         listCashboxes({ active: true }),
         listExchangeRates(),
       ]);
        if (cancelled) return;
        setApiCustomers(cust.data);
        setApiSuppliers(sup.data);
        setApiRolls(stock.data.filter((r) => isRollAvailableForSale(r)));
        setExchangeRates(rates.data);
        setCashboxOptions(
          (boxes.data ?? []).map((b) => ({ id: b.id, name: b.name, code: b.code })),
        );
      } catch {
        if (cancelled) return;
        setApiCustomers([]);
        setApiSuppliers([]);
        setApiRolls([]);
        setExchangeRates([]);
        setCashboxOptions([]);
      } finally {
        if (!cancelled) setRollsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isSales || !partyId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(partyId)) {
      setPartyStatementBalance(null);
      setPartyStatementBalanceLoading(false);
      return;
    }
    let cancelled = false;
    setPartyStatementBalanceLoading(true);
    void (async () => {
      try {
        const res = await getCustomerStatement(partyId, { toDate: date });
        if (!cancelled) setPartyStatementBalance(Number(res.data.totals.closingBalance || 0));
      } catch {
        if (!cancelled) setPartyStatementBalance(null);
      } finally {
        if (!cancelled) setPartyStatementBalanceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSales, partyId, date]);

  useEffect(() => {
    const code = String(currency || 'USD').trim().toUpperCase();
    if (code === 'USD') {
      setExchangeRateToUsd('1');
      return;
    }
    const row = exchangeRates.find((r) => r.currency_code === code);
    if (row) setExchangeRateToUsd(String(row.exchange_rate_to_usd ?? '1'));
  }, [currency, exchangeRates]);

  const customerSource = apiCustomers.length ? apiCustomers : customers;
  const supplierSource = apiSuppliers.length ? apiSuppliers : suppliers;
  const inventorySource = apiRolls.length ? apiRolls : inventory;

   const [materialSuggest, setMaterialSuggest] = useState<{
     lineId: number;
     query: string;
     rect: DOMRect;
   } | null>(null);
   const [materialSuggestIndex, setMaterialSuggestIndex] = useState(0);
   const materialSuggestInputRef = useRef<HTMLInputElement | null>(null);
   const materialSuggestDropdownRef = useRef<HTMLDivElement | null>(null);
   const [allFabricItems, setAllFabricItems] = useState<ApiFabricItem[]>([]);
   const [itemsLoading, setItemsLoading] = useState(false);

   useEffect(() => {
     const fetchAllItems = async () => {
       setItemsLoading(true);
       try {
          const res = await listFabricItems({ pageSize: 10000, status: 'active' });
         setAllFabricItems(res.data);
       } catch (error) {
         console.error('Failed to fetch all fabric items:', error);
       } finally {
         setItemsLoading(false);
       }
     };
     fetchAllItems();
   }, []);

  type MaterialSuggestOption = {
    key: string;
    title: string;
    subtitle: string;
    stock: any;
  };

   const materialSuggestOptions = useMemo<MaterialSuggestOption[]>(() => {
     if (!materialSuggest) return [];
     const qRaw = String(materialSuggest.query || '').trim();
     if (qRaw.includes('|') || isLikelyBarcodePayload(qRaw) || isLikelyIdentityBarcodePayload(qRaw)) return [];
     const q = qRaw.toLowerCase();

     const rollRowsForSuggest = isSales
       ? (inventorySource as Record<string, unknown>[]).filter(
           (s) => !isFabricRollStockRow(s) || isRollAvailableForSale(s),
         )
       : (inventorySource as Record<string, unknown>[]);

      const buildOptionFromStock = (stock: any): MaterialSuggestOption => {
        const name = stock.item_name || stock.name || '';
        const design = stock.internal_code || stock.fabricCode || stock.designNumber || '';
        const colorName = stock.color_name_ar || stock.colorName || '';
        const colorCode = stock.color_code || stock.colorCode || '';
        // Order of preference for identity display: barcode → supplierBarcode → roll_no → rollNumber → internalRollId
        const identity =
          stock.barcode ||
          stock.supplierBarcode ||
          stock.roll_no ||
          stock.rollNumber ||
          stock.internalRollId ||
          '';
        const key = String(
          stock.id ||
          stock.internalRollId ||
          stock.barcode ||
          stock.roll_no ||
          stock.rollNumber ||
          name ||
          Math.random()
        );

        return {
          key,
          title: [name, design].filter(Boolean).join(' - '),
          subtitle: [colorName || colorCode, String(identity || '').trim()].filter(Boolean).join(' | '),
          stock,
        };
      };

     const buildOptionFromItem = (item: ApiFabricItem): MaterialSuggestOption => {
       const name = item.name || '';
       const design = item.internal_code || '';
       return {
         key: `item-${item.id}`,
         title: name,
         subtitle: design,
         stock: {
           item_id: item.id,
           id: item.id,
           item_name: name,
           internal_code: design,
           color_name_ar: undefined,
           color_code: undefined,
           barcode: undefined,
           length_m: undefined,
         } as any,
       };
     };

     // If query empty: show ALL fabric items + ALL inventory rolls
     if (!q) {
       const fromItems = allFabricItems.map(buildOptionFromItem);
       const fromInventory = rollRowsForSuggest.map(buildOptionFromStock);
       return [...fromItems, ...fromInventory];
     }

     // Otherwise: search in both
     const out: MaterialSuggestOption[] = [];

     // Search in allFabricItems
     for (const item of allFabricItems) {
       if (
         (item.name && item.name.toLowerCase().includes(q)) ||
         (item.internal_code && item.internal_code.toLowerCase().includes(q))
       ) {
         out.push(buildOptionFromItem(item));
       }
     }

     // Search in inventorySource (rolls)
     for (const stock of rollRowsForSuggest as any[]) {
       const fields = [
         stock.item_name,
         stock.name,
         stock.internal_code,
         stock.fabricCode,
         stock.designNumber,
         stock.color_name_ar,
         stock.colorName,
         stock.color_code,
         stock.colorCode,
         stock.barcode,
         stock.supplierBarcode,
         stock.roll_no,
         stock.rollNumber,
         stock.internalRollId,
         stock.qrCode,
         stock.id,
       ]
         .filter(Boolean)
         .map((v: any) => String(v).toLowerCase());
       if (fields.some((v: string) => v.includes(q))) {
         out.push(buildOptionFromStock(stock));
       }
     }

     return out.slice(0, 60);
   }, [materialSuggest?.lineId, materialSuggest?.query, inventorySource, allFabricItems, isSales]);

  useEffect(() => {
    setMaterialSuggestIndex(0);
  }, [materialSuggest?.lineId, materialSuggest?.query]);

  useEffect(() => {
    if (!materialSuggest) return;

    const syncRect = () => {
      const el = materialSuggestInputRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setMaterialSuggest((prev) => {
        if (!prev) return prev;
        if (prev.lineId !== materialSuggest.lineId) return prev;
        return { ...prev, rect };
      });
    };

    const onDocMouseDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (materialSuggestInputRef.current?.contains(target)) return;
      if (materialSuggestDropdownRef.current?.contains(target)) return;
      setMaterialSuggest(null);
    };

    window.addEventListener('resize', syncRect);
    window.addEventListener('scroll', syncRect, true);
    document.addEventListener('mousedown', onDocMouseDown);
    return () => {
      window.removeEventListener('resize', syncRect);
      window.removeEventListener('scroll', syncRect, true);
      document.removeEventListener('mousedown', onDocMouseDown);
    };
  }, [materialSuggest?.lineId]);

  const selectedParty = isSales
    ? customerSource.find((customer) => customer.id === partyId)
    : supplierSource.find((supplier) => supplier.id === partyId);

  const partyOptions = useMemo(() => (isSales ? customerSource : supplierSource), [customerSource, supplierSource, isSales]);

  const partyBalance = isSales && partyStatementBalance != null
    ? partyStatementBalance
    : selectedParty && 'balance' in selectedParty
      ? Number(selectedParty.balance)
      : 0;
  const balanceText = partyBalance > 0 ? 'مدين' : partyBalance < 0 ? 'دائن' : 'رصيد صفري';
  const balanceColor = partyBalance > 0 ? 'text-rose-500' : partyBalance < 0 ? 'text-emerald-500' : 'text-slate-500';

  const summary = useMemo(
    () =>
      calculateFabricInvoiceSummary(
        items.map((item) => ({
          materialName: item.materialName,
          designCode: item.dsamNumber,
          colorCode: item.colorCode,
          colorName: item.colorName,
          rollNo: item.rollNo,
          lengthMeters: isSales && wholesaleSalesUi ? 0 : isSales ? 0 : numberValue(item.length),
          quantity: isSales ? numberValue(item.rollQty) : numberValue(item.length),
          rollsCount: isSales ? numberValue(item.rollQty) : 1,
          weightKg: item.weight,
          pricePerMeter: item.price,
          lineTotal: computeInvoiceLineTotal(item, isSales, wholesaleSalesUi),
        })),
        { pendingAmountUntilTafnid: wholesaleSalesUi && isSales },
      ),
    [items, isSales, wholesaleSalesUi],
  );

  const handleAddItem = () => {
    setItems((prev) => [...prev.map(sanitizeInvoiceFormItemBarcode), emptyItem()]);
  };

  const handleRemoveItem = (id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id).map(sanitizeInvoiceFormItemBarcode));
  };

  const updateItemLengthUnit = (id: number, lengthUnit: 'meter' | 'yard') => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, lengthUnit } : item)));
  };

  const updateItem = (id: number, field: keyof InvoiceFormItem, value: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updatedItem = sanitizeInvoiceFormItemBarcode({ ...item, [field]: value });
        if (field === 'length' || field === 'widthCm' || field === 'gsm') {
          return sanitizeInvoiceFormItemBarcode({
            ...updatedItem,
            weight: String(calculateFabricWeightKg(numberValue(updatedItem.length), numberValue(updatedItem.widthCm), numberValue(updatedItem.gsm))),
          });
        }
        return updatedItem;
      }),
    );
  };

  const rejectDuplicateInvoiceScan = (incoming: InvoiceFormItem, excludeLineId: number) => {
    const incomingKey = buildInvoiceLineScanDuplicateKey(sanitizeInvoiceFormItemBarcode(incoming));
    if (incomingKey.startsWith('line:')) return false;
    const duplicate = items.some((line) => {
      if (line.id === excludeLineId || isEmptyInvoiceItem(line)) return false;
      return buildInvoiceLineScanDuplicateKey(sanitizeInvoiceFormItemBarcode(line)) === incomingKey;
    });
    if (!duplicate) return false;
    playWarningBeep();
    showToast({
      type: 'warning',
      message: 'لم تتم إضافة السطر: هذه الخامة موجودة مسبقاً بنفس الباركود أو نفس بيانات الخامة والطول.',
    });
    setScanMessage('لم تتم الإضافة لأن السطر مكرر بنفس الطول/الباركود.');
    setItems((prev) =>
      prev.map((line) => {
        if (line.id !== excludeLineId) return line;
        const current = sanitizeInvoiceFormItemBarcode(line);
        const onlyScanEcho =
          !current.dsamNumber.trim() &&
          !current.rollNo.trim() &&
          !current.colorCode.trim() &&
          !current.colorName.trim() &&
          !current.length.trim() &&
          !current.weight.trim() &&
          !current.price.trim() &&
          (
            !current.materialName.trim() ||
            current.materialName.trim() === incoming.materialName.trim() ||
            current.materialName.trim() === incoming.supplierBarcode.trim() ||
            current.materialName.trim() === incoming.rawBarcodePayload.trim()
          );
        return isEmptyInvoiceItem(current) || onlyScanEcho ? { ...emptyItem(), id: line.id } : current;
      }),
    );
    return true;
  };

  const rejectDuplicateStockScan = (
    lineId: number,
    stock: FabricRollDto | StagedRollItemPayload | any,
    scannedBarcode = '',
  ) => {
    const lengthM = stock.length_m ?? stock.meters ?? stock.length ?? '';
    const incoming = sanitizeInvoiceFormItemBarcode({
      ...emptyItem(),
      id: lineId,
      materialName: stock.item_name || stock.name || '',
      dsamNumber: stock.internal_code || stock.fabricCode || stock.designNumber || '',
      rollNo: stock.roll_no || stock.rollNumber || stock.internalRollId || '',
      colorCode: stock.color_code || stock.colorCode || '',
      colorName: stock.color_name_ar || stock.colorName || '',
      length: lengthM !== '' ? String(Number(lengthM).toFixed ? Number(lengthM).toFixed(2) : lengthM) : '',
      weight: stock.actual_weight_kg || stock.calculated_weight_kg || stock.weight || '',
      supplierBarcode:
        stockBarcodeValue(stock, []) ||
        scannedBarcode ||
        String((stock as Record<string, unknown>).barcode ?? ''),
      rawBarcodePayload: scannedBarcode,
      internalRollId: String((stock as Record<string, unknown>).id ?? stock.internalRollId ?? ''),
    });
    return rejectDuplicateInvoiceScan(incoming, lineId);
  };

  /** Auto-fill من المخزون فقط عند تطابق هوية صارمة (باركود / رقم رول / UUID) — ليس باسم الخامة أو كود التصميم وحده. */
  const findStockMatchStrictIdentity = (value: string) => {
    const query = value.trim().toLowerCase();
    if (!query) return null;
    const found =
      inventorySource.find((raw) => {
        const item = raw as Record<string, unknown>;
        const candidates = [
          // identifiers from both FabricRollDto and FabricItem
          item.barcode,
          item.supplierBarcode,
          item.supplier_roll_ref,    // المورد (roll supplier reference)
          item.supplier_code_item,   // كود المورد للخامة
          item.roll_no,
          item.rollNumber,
          item.internalRollId,
          item.internal_code,        // الكود الداخلي للخامة
          item.qrCode,
          item.id,
        ]
          .filter(Boolean)
          .map((field) => String(field).trim().toLowerCase());
        return candidates.includes(query);
      }) ?? null;
    if (!found) return null;
    if (isSales && isFabricRollStockRow(found as Record<string, unknown>) && !isRollAvailableForSale(found as FabricRollDto)) {
      return null;
    }
    return found;
  };

  /**
   * Resolve a scanned identity (barcode / roll number / supplier ref / UUID) by:
   *   1) searching the local in-memory inventory (instant — works in 99% of cases),
   *   2) falling back to a targeted server lookup when nothing matches locally.
   *
   * The server fallback covers two real-world failure modes:
   *   • The user scans before the initial `listFabricRolls` request finishes
   *     (slow VPN/VPS — scanner is faster than the network).
   *   • The roll was created (or updated) after this form was opened, so it's
   *     not in the local cache yet.
   *
   * Resolved server hits are merged into `apiRolls` so subsequent scans of the
   * same code hit the local cache instantly. A per-key in-flight map prevents
   * duplicate parallel requests when the user hammers the scanner.
   */
  const lookupStockFromAnywhere = async (value: string): Promise<FabricRollDto | null> => {
    const query = value.trim();
    if (!query) return null;

    const local = findStockMatchStrictIdentity(query);
    if (local) return local as FabricRollDto;

    const cacheKey = query.toLowerCase();
    if (barcodeLookupCacheRef.current.has(cacheKey)) {
      return barcodeLookupCacheRef.current.get(cacheKey) ?? null;
    }
    const inFlight = barcodeLookupInFlightRef.current.get(cacheKey);
    if (inFlight) return inFlight;

    const requestPromise = (async (): Promise<FabricRollDto | null> => {
      try {
        // Try the dedicated barcode column first (fast, indexed). If we don't
        // find an exact identity match, broaden to the generic `search` field
        // so roll_no / supplier_roll_ref / UUID scans are still picked up.
        const exactMatchOf = (rolls: FabricRollDto[]): FabricRollDto | null => {
          const lc = cacheKey;
          for (const r of rolls) {
            const candidates = collectRollIdentityCandidates(r);
            if (candidates.includes(lc)) return r;
          }
          return null;
        };

        const saleFilter = isSales ? ({ onlyAvailable: true } as const) : ({} as Record<string, never>);

        const byBarcode = await listFabricRolls({ barcode: query, pageSize: 10, ...saleFilter });
        let match = exactMatchOf(byBarcode.data);
        if (!match) {
          const bySearch = await listFabricRolls({ search: query, pageSize: 10, ...saleFilter });
          match = exactMatchOf(bySearch.data);
        }

        if (isSales && !match) {
          const probe = await listFabricRolls({ search: query, pageSize: 25 });
          const dead = exactMatchOf(probe.data);
          if (dead && !isRollAvailableForSale(dead)) {
            showToast({
              type: 'warning',
              message: 'هذا الرول غير متاح للبيع (مباع أو لا يحتوي على طول متاح).',
            });
            barcodeLookupCacheRef.current.set(cacheKey, null);
            return null;
          }
        }

        if (match && isSales && !isRollAvailableForSale(match)) {
          showToast({ type: 'warning', message: 'هذا الرول غير متاح للبيع.' });
          barcodeLookupCacheRef.current.set(cacheKey, null);
          return null;
        }

        if (match) {
          setApiRolls((prev) => (prev.some((r) => r.id === match!.id) ? prev : [match!, ...prev]));
        }
        barcodeLookupCacheRef.current.set(cacheKey, match);
        return match;
      } catch {
        barcodeLookupCacheRef.current.set(cacheKey, null);
        return null;
      } finally {
        barcodeLookupInFlightRef.current.delete(cacheKey);
      }
    })();

    barcodeLookupInFlightRef.current.set(cacheKey, requestPromise);
    return requestPromise;
  };

  const applyStockToLine = (lineId: number, stock: FabricRollDto | StagedRollItemPayload | any) => {
    if (rejectDuplicateStockScan(lineId, stock)) return false;
    const row = stock as Record<string, unknown>;
    if (isSales && isFabricRollStockRow(row) && !isRollAvailableForSale(row)) {
      if (getRollLengthMeters(row) <= 1e-6) {
        showToast({
          type: 'warning',
          message: 'هذا الرول مباع بالكامل أو لا يحتوي على طول متاح',
        });
      } else {
        showToast({
          type: 'warning',
          message: 'هذا الرول غير متاح للبيع',
        });
      }
      return false;
    }
    const lengthM = stock.length_m ?? stock.meters ?? stock.length ?? '';
    setItems((prev) => {
      const dup = prev.some((line) => incomingStockConflictsWithLine(line, lineId, stock as Record<string, unknown>));
      if (dup) {
        playWarningBeep();
        queueMicrotask(() => {
          showToast({
            type: 'warning',
            message:
              'تنبيه: هذا السطر مكرر بنفس بيانات الرول أو الباركود. يمكنك تعديل السطر الموجود أو اختيار رول آخر.',
          });
        });
        return prev;
      }
      return prev.map((line) => {
        if (line.id !== lineId) return sanitizeInvoiceFormItemBarcode(line);
        const updated = {
              ...line,
              materialName: stock.item_name || stock.name || line.materialName,
              dsamNumber: stock.internal_code || stock.fabricCode || stock.designNumber || line.dsamNumber,
              rollNo: stock.roll_no || stock.rollNumber || stock.internalRollId || line.rollNo,
              colorCode: stock.color_code || stock.colorCode || line.colorCode,
              colorName: stock.color_name_ar || stock.colorName || line.colorName,
              length: lengthM !== '' ? String(Number(lengthM).toFixed ? Number(lengthM).toFixed(2) : lengthM) : line.length,
              widthCm: stock.width_cm ? String(Number(stock.width_cm)) : stock.rollWidth ? String(stock.rollWidth) : line.widthCm,
              gsm: stock.gsm ? String(Number(stock.gsm)) : line.gsm,
              weight: stock.actual_weight_kg || stock.calculated_weight_kg || stock.weight || line.weight,
              price: stock.sellingPrice ? String(stock.sellingPrice) : line.price,
              supplierBarcode: stockBarcodeValue(stock, [
                line.materialName,
                line.dsamNumber,
                line.colorName,
                line.colorCode,
              ]) || line.supplierBarcode,
              printBarcode: stockPrintBarcodeValue(stock, [
                line.supplierBarcode,
                line.rawBarcodePayload,
              ]) || line.printBarcode,
              internalRollId: stock.id || stock.internalRollId || line.internalRollId,
              fabricItemId: stock.item_id || stock.itemId || stock.fabricItemId || line.fabricItemId,
              rollQty: line.rollQty || '1',
            };
        return sanitizeInvoiceFormItemBarcode(updated);
      });
    });
    return true;
  };

  const ensureTrailingEmptyLine = (lineId: number) => {
    setItems((prev) => {
      const hasEmptyLine = prev.some(
        (line) =>
          line.id !== lineId &&
          !line.materialName.trim() &&
          !line.dsamNumber.trim() &&
          !line.rollNo.trim() &&
          !line.supplierBarcode.trim() &&
          !line.colorCode.trim() &&
          !line.colorName.trim() &&
          !line.length.trim() &&
          !line.weight.trim(),
      );
      const sanitized = prev.map(sanitizeInvoiceFormItemBarcode);
      return hasEmptyLine ? sanitized : [...sanitized, emptyItem()];
    });
  };

  const focusNextRowFirstField = (row: HTMLElement | null) => {
    if (!row) return;
    const tbody = row.closest('tbody');
    if (!tbody) return;
    const allRows = Array.from(tbody.querySelectorAll<HTMLElement>('[data-invoice-item-row]'));
    const rowIdx = allRows.indexOf(row);
    const nextRow = allRows[rowIdx + 1];
    if (!nextRow) return;
    const nextInputs = collectInvoiceLineNavInputs(nextRow);
    if (nextInputs[0]) focusAndSelect(nextInputs[0]);
  };

  const handleMaterialInput = async (lineId: number, raw: string) => {
    updateItem(lineId, 'materialName', raw);
    const local = findStockMatchStrictIdentity(raw);
    if (local) {
      applyStockToLine(lineId, local);
      return;
    }
    // Server fallback only for inputs that look like an identifier — we don't
    // want to spam the API while the user is typing a free-text material name.
    if (isLikelyIdentityBarcodePayload(raw.trim())) {
      const remote = await lookupStockFromAnywhere(raw);
      if (remote) applyStockToLine(lineId, remote);
    }
  };

  const nextInternalRollId = () => {
    const ids = [...inventory, ...items]
      .map((item) => item.internalRollId || item.rollNumber || '')
      .map((value) => {
        const match = value.match(/TXR-\d{4}-(\d{6})/);
        return match ? Number(match[1]) : 0;
      });
    const maxId = Math.max(internalRollSequenceRef.current, ...(ids.length ? ids : [0]));
    const nextId = maxId + 1;
    internalRollSequenceRef.current = nextId;
    return `TXR-${new Date().getFullYear()}-${String(nextId).padStart(6, '0')}`;
  };

  const applyParsedScanToLine = (lineId: number, parsed: ParsedSupplierLabel) => {
    const internalRollId = nextInternalRollId();
    const incoming = sanitizeInvoiceFormItemBarcode({
      ...emptyItem(),
      id: lineId,
      materialName: parsed.itemName || parsed.articleCode,
      dsamNumber: parsed.designNumber,
      rollNo: parsed.lotNumber,
      colorCode: parsed.colorCode,
      colorName: parsed.colorName,
      length: parsed.meters.toFixed(2),
      weight: parsed.netWeight.toFixed(2),
      supplierBarcode: parsed.supplierBarcode || '',
      internalRollId,
      rawQrPayload: parsed.rawQrPayload || '',
      rawBarcodePayload: parsed.rawBarcodePayload || '',
    });
    if (rejectDuplicateInvoiceScan(incoming, lineId)) return false;
    setItems((prev) => {
      const updated = prev.map((line) =>
        line.id === lineId
          ? {
              ...line,
              materialName: parsed.itemName || parsed.articleCode,
              dsamNumber: parsed.designNumber,
              rollNo: parsed.lotNumber,
              colorCode: parsed.colorCode,
              colorName: parsed.colorName,
              length: parsed.meters.toFixed(2),
              widthCm: line.widthCm || '150',
              gsm: line.gsm || '150',
              weight: parsed.netWeight.toFixed(2),
              note: `Supplier QR prototype scan${parsed.qualityGrade ? ` | Q:${parsed.qualityGrade}` : ''}`,
              supplierBarcode: parsed.supplierBarcode || line.supplierBarcode || '',
              qualityGrade: parsed.qualityGrade || line.qualityGrade || '1',
              internalRollId,
              rawQrPayload: parsed.rawQrPayload || '',
              rawBarcodePayload: parsed.rawBarcodePayload || line.rawBarcodePayload || '',
            }
          : line,
      );
      const hasEmptyLine = updated.some(
        (line) =>
          line.id !== lineId &&
          !line.materialName.trim() &&
          !line.dsamNumber.trim() &&
          !line.rollNo.trim() &&
          !line.supplierBarcode.trim() &&
          !line.colorCode.trim() &&
          !line.colorName.trim() &&
          !line.length.trim() &&
          !line.weight.trim(),
      );
      return hasEmptyLine ? updated : [...updated, emptyItem()];
    });
    setLatestScannedLineId(lineId);
    if (!isSales) {
      setStagedRoll({
        item: {
          name: parsed.itemName || parsed.articleCode,
          fabricCode: parsed.articleCode || parsed.itemName,
          designNumber: parsed.designNumber,
          colorName: parsed.colorName,
          colorCode: parsed.colorCode,
          lotNumber: parsed.lotNumber,
          lengthType: 'meter' as const,
          length: parsed.meters,
          rollWidth: 150,
          weight: parsed.netWeight,
          warehouseId: warehouse,
          barcode: parsed.supplierBarcode || '',
          supplierBarcode: parsed.supplierBarcode || '',
          qualityGrade: parsed.qualityGrade || '1',
          internalRollId,
          costPrice: 0,
          sellingPrice: 0,
          minStockLevel: 0,
          status: 'available' as const,
          type: parsed.itemName || parsed.articleCode,
          yards: Number((parsed.meters * 1.09361).toFixed(2)),
          meters: parsed.meters,
          rollNumber: internalRollId,
        },
        action: 'staged',
      });
    }
    return true;
  };

  const normalizeScannedPayload = (value: string) =>
    String(value || '')
      .replace(/[｜¦]/g, '|')
      .replace(/\r?\n/g, '|')
      .replace(/\t/g, '|')
      .trim();

  const shouldReplaceScannedField = (currentValue: string, rawPayload: string) => {
    const current = String(currentValue || '').trim();
    return !current || current === rawPayload || current.includes('|') || current.length > 40;
  };

  const handleScannedValueOnMaterialField = async (lineId: number, rawValue: string) => {
    const raw = normalizeScannedPayload(rawValue);
    if (!raw) return false;

    const rollQr = parseRollIdentityQrPayload(raw);
    if (rollQr) {
      const stock =
        (rollQr.rollId ? await lookupStockFromAnywhere(rollQr.rollId) : null) ||
        (rollQr.barcode ? await lookupStockFromAnywhere(rollQr.barcode) : null);
      if (isSales && !stock) {
        return false;
      }
      const incoming = sanitizeInvoiceFormItemBarcode({
        ...emptyItem(),
        id: lineId,
        supplierBarcode: rollQr.barcode || '',
        internalRollId: rollQr.rollId || '',
        rollNo: rollQr.lot || '',
        materialName: rollQr.fabricName || rollQr.articleCode || '',
        dsamNumber: rollQr.articleCode || '',
        colorName: rollQr.fabricColor || '',
        colorCode: rollQr.colorCode || '',
        length: Number.isFinite(Number(rollQr.lengthM)) ? Number(rollQr.lengthM).toFixed(2) : '',
        weight: Number.isFinite(Number(rollQr.weightKg)) ? Number(rollQr.weightKg).toFixed(2) : '',
        rawQrPayload: raw,
        rawBarcodePayload: rollQr.barcode || '',
      });
      if (stock ? rejectDuplicateStockScan(lineId, stock, rollQr.barcode || raw) : rejectDuplicateInvoiceScan(incoming, lineId)) {
        return false;
      }
      setItems((prev) =>
        prev.map((line) => {
          if (line.id !== lineId) return sanitizeInvoiceFormItemBarcode(line);
          return sanitizeInvoiceFormItemBarcode({
                ...line,
                supplierBarcode: rollQr.barcode || (shouldReplaceScannedField(line.supplierBarcode, raw) ? '' : line.supplierBarcode),
                internalRollId: rollQr.rollId || line.internalRollId,
                rollNo: line.rollNo || rollQr.lot || line.rollNo,
                materialName: shouldReplaceScannedField(line.materialName, raw)
                  ? (rollQr.fabricName || rollQr.articleCode || line.materialName)
                  : line.materialName,
                dsamNumber: shouldReplaceScannedField(line.dsamNumber, raw)
                  ? (rollQr.articleCode || line.dsamNumber)
                  : line.dsamNumber,
                colorName: shouldReplaceScannedField(line.colorName, raw)
                  ? (rollQr.fabricColor || line.colorName)
                  : line.colorName,
                colorCode: shouldReplaceScannedField(line.colorCode, raw)
                  ? (rollQr.colorCode || line.colorCode)
                  : line.colorCode,
                length:
                  !line.length.trim() && Number.isFinite(Number(rollQr.lengthM))
                    ? Number(rollQr.lengthM).toFixed(2)
                    : line.length,
                weight:
                  !line.weight.trim() && Number.isFinite(Number(rollQr.weightKg))
                    ? Number(rollQr.weightKg).toFixed(2)
                    : line.weight,
                widthCm:
                  !line.widthCm.trim() && Number.isFinite(Number(rollQr.widthCm))
                    ? String(Number(rollQr.widthCm))
                    : line.widthCm,
                gsm:
                  !line.gsm.trim() && Number.isFinite(Number(rollQr.gsm))
                    ? String(Number(rollQr.gsm))
                    : line.gsm,
                rawQrPayload: raw,
              });
        }),
      );
      if (stock) applyStockToLine(lineId, stock);
      ensureTrailingEmptyLine(lineId);
      setLatestScannedLineId(lineId);
      return true;
    }

    if (raw.includes('|')) {
      if (isCompleteSupplierQrPayload(raw)) {
        const parsed = parseSupplierLabelQr(raw);
        return applyParsedScanToLine(lineId, parsed);
      }
      showToast({ type: 'warning', message: 'QR غير مدعوم. استخدم QR المورد أو QR الرول أو باركود.' });
      return false;
    }

    if (isLikelyIdentityBarcodePayload(raw)) {
      const stock = await lookupStockFromAnywhere(raw);
      if (stock ? rejectDuplicateStockScan(lineId, stock, raw) : rejectDuplicateInvoiceScan({ ...emptyItem(), id: lineId, supplierBarcode: raw, rawBarcodePayload: raw }, lineId)) {
        return false;
      }
      if (isSales && !stock) {
        return false;
      }
      setItems((prev) =>
        prev.map((line) =>
          line.id === lineId
            ? sanitizeInvoiceFormItemBarcode({ ...line, supplierBarcode: raw, rawBarcodePayload: raw })
            : sanitizeInvoiceFormItemBarcode(line),
        ),
      );
      if (stock) applyStockToLine(lineId, stock);
      ensureTrailingEmptyLine(lineId);
      setLatestScannedLineId(lineId);
      if (stagedRoll) {
        setStagedRoll({
          ...stagedRoll,
          item: { ...stagedRoll.item, supplierBarcode: raw, barcode: raw },
        });
      }
      return true;
    }
    return false;
  };

  const handleBarcodeFieldSubmit = async (lineId: number, rawValue: string, rowEl?: HTMLElement | null) => {
    const raw = normalizeScannedPayload(rawValue);
    if (!raw) return;

    const rollQr = parseRollIdentityQrPayload(raw);
    if (rollQr) {
      const stock =
        (rollQr.rollId ? await lookupStockFromAnywhere(rollQr.rollId) : null) ||
        (rollQr.barcode ? await lookupStockFromAnywhere(rollQr.barcode) : null);
      if (isSales && !stock) {
        return;
      }
      const incoming = sanitizeInvoiceFormItemBarcode({
        ...emptyItem(),
        id: lineId,
        supplierBarcode: rollQr.barcode || '',
        internalRollId: rollQr.rollId || '',
        rollNo: rollQr.lot || '',
        materialName: rollQr.fabricName || rollQr.articleCode || '',
        dsamNumber: rollQr.articleCode || '',
        colorName: rollQr.fabricColor || '',
        colorCode: rollQr.colorCode || '',
        length: Number.isFinite(Number(rollQr.lengthM)) ? Number(rollQr.lengthM).toFixed(2) : '',
        weight: Number.isFinite(Number(rollQr.weightKg)) ? Number(rollQr.weightKg).toFixed(2) : '',
        rawQrPayload: raw,
        rawBarcodePayload: rollQr.barcode || '',
      });
      if (stock ? rejectDuplicateStockScan(lineId, stock, rollQr.barcode || raw) : rejectDuplicateInvoiceScan(incoming, lineId)) {
        return;
      }
      setItems((prev) =>
        prev.map((line) => {
          if (line.id !== lineId) return sanitizeInvoiceFormItemBarcode(line);
          return sanitizeInvoiceFormItemBarcode({
                ...line,
                supplierBarcode: rollQr.barcode || (shouldReplaceScannedField(line.supplierBarcode, raw) ? '' : line.supplierBarcode),
                internalRollId: rollQr.rollId || line.internalRollId,
                rollNo: line.rollNo || rollQr.lot || line.rollNo,
                materialName: shouldReplaceScannedField(line.materialName, raw)
                  ? (rollQr.fabricName || rollQr.articleCode || line.materialName)
                  : line.materialName,
                dsamNumber: shouldReplaceScannedField(line.dsamNumber, raw)
                  ? (rollQr.articleCode || line.dsamNumber)
                  : line.dsamNumber,
                colorName: shouldReplaceScannedField(line.colorName, raw)
                  ? (rollQr.fabricColor || line.colorName)
                  : line.colorName,
                colorCode: shouldReplaceScannedField(line.colorCode, raw)
                  ? (rollQr.colorCode || line.colorCode)
                  : line.colorCode,
                length:
                  !line.length.trim() && Number.isFinite(Number(rollQr.lengthM))
                    ? Number(rollQr.lengthM).toFixed(2)
                    : line.length,
                weight:
                  !line.weight.trim() && Number.isFinite(Number(rollQr.weightKg))
                    ? Number(rollQr.weightKg).toFixed(2)
                    : line.weight,
                widthCm:
                  !line.widthCm.trim() && Number.isFinite(Number(rollQr.widthCm))
                    ? String(Number(rollQr.widthCm))
                    : line.widthCm,
                gsm:
                  !line.gsm.trim() && Number.isFinite(Number(rollQr.gsm))
                    ? String(Number(rollQr.gsm))
                    : line.gsm,
                rawQrPayload: raw,
              });
        }),
      );
      if (stock) applyStockToLine(lineId, stock);
      setLatestScannedLineId(lineId);
      ensureTrailingEmptyLine(lineId);
      window.setTimeout(() => focusNextRowFirstField(rowEl || null), 60);
      return;
    }

    if (raw.includes('|')) {
      if (isCompleteSupplierQrPayload(raw)) {
        const parsed = parseSupplierLabelQr(raw);
        const applied = applyParsedScanToLine(lineId, parsed);
        if (applied) {
          ensureTrailingEmptyLine(lineId);
          window.setTimeout(() => focusNextRowFirstField(rowEl || null), 60);
        }
        return;
      }
      showToast({ type: 'warning', message: 'QR غير مدعوم. استخدم QR المورد أو QR الرول أو باركود.' });
      return;
    }

    if (isLikelyIdentityBarcodePayload(raw)) {
      const stock = await lookupStockFromAnywhere(raw);
      if (stock ? rejectDuplicateStockScan(lineId, stock, raw) : rejectDuplicateInvoiceScan({ ...emptyItem(), id: lineId, supplierBarcode: raw, rawBarcodePayload: raw }, lineId)) {
        return;
      }
      if (isSales && !stock) {
        return;
      }
      setItems((prev) =>
        prev.map((line) =>
          line.id === lineId
            ? sanitizeInvoiceFormItemBarcode({ ...line, supplierBarcode: raw, rawBarcodePayload: raw })
            : sanitizeInvoiceFormItemBarcode(line),
        ),
      );
      if (stock) applyStockToLine(lineId, stock);
      setLatestScannedLineId(lineId);
      ensureTrailingEmptyLine(lineId);
      window.setTimeout(() => focusNextRowFirstField(rowEl || null), 60);
      return;
    }

    // Last-chance fallback: even if our heuristics didn't classify this as a
    // "likely barcode" payload, try a server lookup anyway. This protects
    // against shorter scanner outputs (e.g. 4-digit internal codes) that
    // `isLikelyIdentityBarcodePayload` may otherwise reject.
    const fallback = await lookupStockFromAnywhere(raw);
    if (fallback) {
      if (rejectDuplicateStockScan(lineId, fallback, raw)) return;
      applyStockToLine(lineId, fallback);
      setLatestScannedLineId(lineId);
      ensureTrailingEmptyLine(lineId);
      window.setTimeout(() => focusNextRowFirstField(rowEl || null), 60);
    }
  };

  const handleDedicatedScanSubmit = async (value = scanInput) => {
    const raw = normalizeScannedPayload(value);
    if (!raw) return;

    if (parseRollIdentityQrPayload(raw) || isCompleteSupplierQrPayload(raw)) {
      const targetLine = items.find((line) => !line.materialName.trim()) || items[items.length - 1];
      if (!targetLine) return;
      const rollIdentityQr = parseRollIdentityQrPayload(raw);
      const applied = await handleScannedValueOnMaterialField(targetLine.id, raw);
      if (applied) setScanMessage('تم تحليل QR وتعبئة السطر تلقائيًا.');
      else if (isSales && rollIdentityQr)
        setScanMessage('تعذر تعبئة السطر: الرول غير متاح للبيع أو غير موجود في المخزون المتاح.');
      setScanInput('');
      return;
    }

    if (isLikelyIdentityBarcodePayload(raw)) {
      const targetLine = items.find((line) => !line.materialName.trim()) || items[items.length - 1];
      if (!targetLine) return;
      const applied = await handleScannedValueOnMaterialField(targetLine.id, raw);
      if (applied) {
        setScanMessage('تم تحليل الباركود وتعبئة السطر تلقائيًا.');
      } else {
        setScanMessage(
          isSales
            ? 'لم يُعثر على رول متاح للبيع بهذا الرمز، أو أن الرول مباع/غير صالح للبيع.'
            : 'لم يُعثر على رول بهذا الباركود في المخزون. تحقق من رقم الباركود أو حالة الرول.',
        );
      }
      setScanInput('');
      return;
    }

    setScanMessage('تعذر تحليل القيمة. امسح QR أو باركود رقمي صالح.');
  };

  const groupText = (value: string) => value.trim() || 'غير محدد';

  const updateGroupPrice = (materialName: string, designCode: string, pricePerMeter: number, price: string) => {
    setItems((prev) =>
      prev.map((item) =>
        sanitizeInvoiceFormItemBarcode(
          groupText(item.materialName) === materialName &&
            groupText(item.dsamNumber) === designCode &&
            Math.max(0, numberValue(item.price)) === pricePerMeter
            ? { ...item, price }
            : item,
        ),
      ),
    );
  };

  const getItemError = (item: InvoiceFormItem, field: 'length' | 'weight' | 'price' | 'rollQty' | 'materialName') => {
    if (field === 'materialName') {
      if (wholesaleSalesUi && !item.materialName.trim()) return 'اسم الخامة مطلوب';
      return '';
    }
    const value = numberValue(item[field]);
    if (field === 'rollQty' && isSales && value <= 0) return 'العدد يجب أن يكون أكبر من صفر';
    if (field === 'length' && !isSales && value <= 0) return 'الطول يجب أن يكون أكبر من صفر';
    if (field === 'price' && value < 0) return 'السعر لا يمكن أن يكون سالبا';
    if (field === 'weight' && value < 0) return 'الوزن لا يمكن أن يكون سالبا';
    return '';
  };

  const warnIfDuplicateLine = (lineId: number) => {
    const line = items.find((x) => x.id === lineId);
    if (!line) return;
    const hasStrongIdentity =
      Boolean(line.supplierBarcode.trim()) ||
      Boolean(line.internalRollId.trim()) ||
      Boolean(line.rollNo.trim()) ||
      (Boolean(line.materialName.trim()) && Boolean(line.dsamNumber.trim()) && Boolean(line.colorName.trim()));
    if (!hasStrongIdentity) return;

    const keys = items
      .filter((x) => !isEmptyInvoiceItem(x))
      .map((x) => ({ id: x.id, key: buildInvoiceSaveDuplicateKey(x, warehouse, { salesWholesale: wholesaleSalesUi }) }));
    const current = keys.find((k) => k.id === lineId);
    if (!current) return;
    const count = keys.reduce((acc, k) => (k.key === current.key ? acc + 1 : acc), 0);
    if (count <= 1) return;

    playWarningBeep();
    showToast({
      type: 'warning',
      message: 'تنبيه: تم إدخال نفس الخامة/الباركود أكثر من مرة داخل الفاتورة',
    });
  };

  const activeItems = items.filter((item) => !isEmptyInvoiceItem(item));
  const hasValidationErrors = activeItems.some(
    (item) =>
      getItemError(item, 'price') ||
      (wholesaleSalesUi ? getItemError(item, 'materialName') : '') ||
      (isSales ? getItemError(item, 'rollQty') : getItemError(item, 'length')),
  );

  const mergeRollIntoApiRolls = (r: FabricRollDto) => {
    setApiRolls((prev) => {
      const i = prev.findIndex((x) => x.id === r.id);
      if (i === -1) return [...prev, r];
      const n = [...prev];
      n[i] = { ...n[i], ...r };
      return n;
    });
  };

  async function syncMissingRollPhysicalFromInvoiceLine(
    item: InvoiceFormItem,
    rolls: FabricRollDto[],
    mergeRoll: (r: FabricRollDto) => void,
    opts: {
      field: 'length' | 'weight' | 'both';
      lengthInput?: string;
      weightInput?: string;
      toastOnSuccess: boolean;
      toastOnError: boolean;
    },
  ): Promise<'applied' | 'noop' | 'error'> {
    if (!isSales) return 'noop';
    const rollId = String(item.internalRollId || '').trim();
    if (!INVOICE_LINE_UUID_RE.test(rollId)) return 'noop';

    let roll = rolls.find((r) => r.id === rollId);
    if (!roll) {
      try {
        const full = await getFabricRoll(rollId);
        const { movements: _mov, ...rest } = full as FabricRollDto & { movements?: unknown[] };
        roll = rest;
        mergeRoll(rest);
      } catch {
        if (opts.toastOnError) {
          showToast({ type: 'error', message: 'تعذر تحديث بيانات الرول في المخزون' });
        }
        return 'error';
      }
    }

    const lenStr = opts.lengthInput ?? item.length;
    const wStr = opts.weightInput ?? item.weight;
    const lenVal = Number(String(lenStr).replace(',', '.'));
    const wVal = Number(String(wStr).replace(',', '.'));

    const payload: { lengthMeters?: number; weightKg?: number } = {};
    if (
      (opts.field === 'length' || opts.field === 'both') &&
      invoiceRollLengthMissingInInventory(roll.length_m) &&
      Number.isFinite(lenVal) &&
      lenVal > 0
    ) {
      payload.lengthMeters = lenVal;
    }
    if (
      (opts.field === 'weight' || opts.field === 'both') &&
      invoiceRollActualWeightMissingInInventory(roll.actual_weight_kg) &&
      Number.isFinite(wVal) &&
      wVal > 0
    ) {
      payload.weightKg = wVal;
    }
    if (Object.keys(payload).length === 0) return 'noop';

    if (rollPatchInFlightRef.current.has(rollId)) return 'noop';
    rollPatchInFlightRef.current.add(rollId);
    try {
      const result = await completeMissingRollFields(rollId, payload);
      mergeRoll(result.data);
      if (result.applied && opts.toastOnSuccess) {
        showToast({
          type: 'success',
          message: result.message || 'تم تحديث بيانات الرول في المخزون',
        });
      }
      return result.applied ? 'applied' : 'noop';
    } catch (e) {
      if (opts.toastOnError) {
        const msg =
          e instanceof ApiRequestError ? e.message : 'تعذر تحديث بيانات الرول في المخزون';
        showToast({ type: 'error', message: msg });
      }
      return 'error';
    } finally {
      rollPatchInFlightRef.current.delete(rollId);
    }
  }

  const advanceInvoiceLineFocus = (e: KeyboardEvent<HTMLInputElement>, item: InvoiceFormItem) => {
    const target = e.currentTarget;
    const row = target.closest('[data-invoice-item-row]') as HTMLElement | null;
    if (!row) return;

    const inputs = collectInvoiceLineNavInputs(row);
    const idx = inputs.indexOf(target);
    if (idx === -1) return;

    if (idx < inputs.length - 1) {
      e.preventDefault();
      focusAndSelect(inputs[idx + 1]);
      return;
    }

    e.preventDefault();

    if (summaryOpen && !hideMaterialSummarySection) {
      const pricePm = numberValue(item.price);
      const gr = summary.groups.find(
        (g) =>
          groupText(item.materialName) === g.materialName &&
          groupText(item.dsamNumber) === g.designCode &&
          Math.abs(g.pricePerMeter - pricePm) < 1e-4,
      );
      if (gr) {
        const priceEl = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-invoice-summary-price]')).find(
          (inp) => inp.dataset.summaryMaterial === gr.materialName && inp.dataset.summaryDesign === gr.designCode,
        );
        if (priceEl && priceEl.offsetParent !== null) {
          focusAndSelect(priceEl);
          return;
        }
      }
    }

    const tbody = row.closest('tbody');
    if (!tbody) return;
    const allRows = Array.from(tbody.querySelectorAll<HTMLElement>('[data-invoice-item-row]'));
    const rowIdx = allRows.indexOf(row);
    const nextRow = allRows[rowIdx + 1];
    if (nextRow) {
      const nextInputs = collectInvoiceLineNavInputs(nextRow);
      if (nextInputs[0]) {
        focusAndSelect(nextInputs[0]);
        return;
      }
    }

    handleAddItem();
    window.setTimeout(() => {
      const table = tbody.closest('table');
      const lastRow = table?.querySelector('tbody tr[data-invoice-item-row]:last-child') as HTMLElement | null;
      const first = lastRow ? collectInvoiceLineNavInputs(lastRow)[0] : null;
      focusAndSelect(first);
    }, 50);
  };

  const handleInvoiceLineEnter = (e: KeyboardEvent<HTMLInputElement>, item: InvoiceFormItem) => {
    if (e.key !== 'Enter') return;
    if (e.nativeEvent.isComposing) return;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

    const target = e.currentTarget;
    const row = target.closest('[data-invoice-item-row]') as HTMLElement | null;
    if (!row) return;

    const inputs = collectInvoiceLineNavInputs(row);
    const idx = inputs.indexOf(target);
    if (idx === -1) return;

    if (isSales && !wholesaleSalesUi && idx === 5) {
      e.preventDefault();
      void (async () => {
        await syncMissingRollPhysicalFromInvoiceLine(item, apiRolls, mergeRollIntoApiRolls, {
          field: 'length',
          lengthInput: target.value,
          toastOnSuccess: true,
          toastOnError: true,
        });
        advanceInvoiceLineFocus(e, item);
      })();
      return;
    }

    if (isSales && idx === 6) {
      e.preventDefault();
      void (async () => {
        await syncMissingRollPhysicalFromInvoiceLine(item, apiRolls, mergeRollIntoApiRolls, {
          field: 'weight',
          weightInput: target.value,
          toastOnSuccess: true,
          toastOnError: true,
        });
        advanceInvoiceLineFocus(e, item);
      })();
      return;
    }

    advanceInvoiceLineFocus(e, item);
  };

  const totalAmount = wholesaleSalesUi && isSales ? 0 : summary.totals.totalAmount;
  const finalTotalAmount = wholesaleSalesUi && isSales ? 0 : Math.max(0, totalAmount - numberValue(discount));

  const handleSave = async (status: 'draft' | 'final') => {
    if (editBlocked || draftLoading) return;
    if (!activeItems.length) return;
    if (hasValidationErrors) return;

    /** جملة: الحفظ دائماً كمسودة — التأكيد المحاسبي عند موافقة المدير في التسليم */
    const effectiveStatus = isSales && wholesaleSalesUi ? 'draft' : status;

    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const dupSaveKeys = activeItems.map((i) =>
      buildInvoiceSaveDuplicateKey(i, warehouse, { salesWholesale: wholesaleSalesUi }),
    );
    const seenSave = new Set<string>();
    for (const k of dupSaveKeys) {
      if (seenSave.has(k)) {
        playWarningBeep();
        showToast({
          type: 'warning',
          message: wholesaleSalesUi
            ? 'لا يمكن حفظ الفاتورة: سطر مكرر بنفس الخامة. ادمج الكمية أو احذف التكرار.'
            : 'لا يمكن حفظ الفاتورة: سطر مكرر بنفس هوية الرول أو الباركود أو نفس بيانات الخامة واللون والطول. ادمج الكمية أو احذف التكرار.',
        });
        return;
      }
      seenSave.add(k);
    }

    if (isSales && !wholesaleSalesUi) {
      let rollsAcc = [...apiRolls];
      const mergeRollDuringSave = (r: FabricRollDto) => {
        rollsAcc = rollsAcc.some((x) => x.id === r.id)
          ? rollsAcc.map((x) => (x.id === r.id ? { ...x, ...r } : x))
          : [...rollsAcc, r];
        setApiRolls(rollsAcc);
      };
      for (const item of activeItems) {
        const r = await syncMissingRollPhysicalFromInvoiceLine(
          item,
          rollsAcc,
          mergeRollDuringSave,
          { field: 'both', toastOnSuccess: false, toastOnError: true },
        );
        if (r === 'error') return;
      }
      for (const item of activeItems) {
        const rid = String(item.internalRollId || '').trim();
        if (!INVOICE_LINE_UUID_RE.test(rid)) continue;
        const roll = rollsAcc.find((r) => r.id === rid);
        if (!roll) {
          showToast({
            type: 'error',
            message: 'لا يمكن حفظ الفاتورة: يوجد رول ناقص البيانات في المخزون',
          });
          return;
        }
        if (numberValue(item.length) > 0 && invoiceRollLengthMissingInInventory(roll.length_m)) {
          showToast({
            type: 'error',
            message: 'لا يمكن حفظ الفاتورة: يوجد رول ناقص البيانات في المخزون',
          });
          return;
        }
      }
      if (status === 'final') {
        for (const item of activeItems) {
          const rid = String(item.internalRollId || '').trim();
          if (!INVOICE_LINE_UUID_RE.test(rid)) continue;
          const roll = rollsAcc.find((r) => r.id === rid);
          if (!roll) continue;
          const stockLen = Number(roll.length_m);
          const qty = numberValue(item.length);
          if (qty > stockLen + 1e-4) {
            showToast({
              type: 'warning',
              message: 'الكمية المدخلة أكبر من المتر المتاح على الرول في المخزون',
            });
            return;
          }
        }
      }
    }

    const paidAmount =
      wholesaleSalesUi && isSales ? 0 : saleType === 'cash' ? finalTotalAmount : numberValue(paymentAmount);

    if (!partyId || !uuidRe.test(partyId)) {
      showToast({
        type: 'warning',
        message: 'لحفظ الفاتورة في قاعدة البيانات اختر عميلاً أو مورداً مسجّلاً في النظام (لا يمكن استخدام «نقدي سريع» الفارغ).',
      });
      return;
    }

    if (status === 'final' && paidAmount > 0) {
      const uuidReCash =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (uuidReCash.test(partyId) && !cashboxId) {
        showToast({
          type: 'warning',
          message: 'اختر الصندوق المالي لربط الدفعة بخزينة حقيقية وتوليد السند تلقائياً على الخادم.',
        });
        return;
      }
    }

    const lineRound2 = (n: number) => Math.round(n * 100) / 100;

    const apiLines = activeItems.map((item, index) => {
      const rollRaw = String(item.internalRollId || '').trim();
      const fabricRollId = uuidRe.test(rollRaw) ? rollRaw : null;
      const unitPrice = Math.max(0, numberValue(item.price));
      const itemIdRaw = String(item.fabricItemId || '').trim();
      const fabricItemId = uuidRe.test(itemIdRaw) ? itemIdRaw : null;
      const desc =
        [item.materialName, item.dsamNumber, item.colorName].filter((p) => String(p).trim()).join(' · ') ||
        `سطر ${index + 1}`;

      if (isSales) {
        const quantity = numberValue(item.rollQty);
        const lineTotal = wholesaleSalesUi ? 0 : lineRound2(quantity * unitPrice);
        return {
          fabricRollId: null,
          fabricItemId,
          description: desc,
          quantity,
          unit: 'roll' as const,
          unitPrice,
          lineDiscount: 0,
          lineTax: 0,
          lineTotal,
          metadata: {
            materialName: item.materialName,
            fabricName: item.materialName,
            fabricItemId: fabricItemId || undefined,
            designCode: item.dsamNumber,
            colorCode: item.colorCode,
            colorName: item.colorName,
            lengthM: numberValue(item.length) || undefined,
            lengthUnit: item.lengthUnit,
            pricingUnit: wholesaleSalesUi ? 'meter' : 'roll',
            pendingTafnidPricing: wholesaleSalesUi || undefined,
            barcode: meaningfulBarcode(item.supplierBarcode, [item.materialName, item.dsamNumber, item.colorName, item.colorCode]) || '',
            supplierBarcode: meaningfulBarcode(item.supplierBarcode, [item.materialName, item.dsamNumber, item.colorName, item.colorCode]) || '',
            printBarcode: item.printBarcode || printableShortBarcode(item.supplierBarcode) || printableShortBarcode(item.rawBarcodePayload) || '',
            rollNo: item.rollNo,
            rollNumber: item.rollNo,
            weightKg: Math.max(0, numberValue(item.weight)),
            widthCm: Math.max(0, numberValue(item.widthCm)),
            gsm: Math.max(0, numberValue(item.gsm)),
            rawQrPayload: item.rawQrPayload || undefined,
            rawBarcodePayload: item.rawBarcodePayload || undefined,
          },
        };
      }

      const quantity = numberValue(item.length);
      const unit = item.lengthUnit === 'yard' ? ('yard' as const) : ('meter' as const);
      return {
        fabricRollId,
        fabricItemId,
        description: desc,
        quantity,
        unit,
        unitPrice,
        lineDiscount: 0,
        lineTax: 0,
        lineTotal: lineRound2(quantity * unitPrice),
        metadata: {
          materialName: item.materialName,
          fabricName: item.materialName,
          fabricItemId: fabricItemId || undefined,
          designCode: item.dsamNumber,
          colorCode: item.colorCode,
          colorName: item.colorName,
          barcode: meaningfulBarcode(item.supplierBarcode, [item.materialName, item.dsamNumber, item.colorName, item.colorCode]) || '',
          supplierBarcode: meaningfulBarcode(item.supplierBarcode, [item.materialName, item.dsamNumber, item.colorName, item.colorCode]) || '',
          printBarcode: item.printBarcode || printableShortBarcode(item.supplierBarcode) || printableShortBarcode(item.rawBarcodePayload) || '',
          rollNo: item.rollNo,
          rollNumber: item.rollNo,
          weightKg: Math.max(0, numberValue(item.weight)),
          widthCm: Math.max(0, numberValue(item.widthCm)),
          gsm: Math.max(0, numberValue(item.gsm)),
          rawQrPayload: item.rawQrPayload || undefined,
          rawBarcodePayload: item.rawBarcodePayload || undefined,
        },
      };
    });

    const paymentStatus: 'unpaid' | 'partial' | 'paid' =
      paidAmount <= 0
        ? 'unpaid'
        : paidAmount >= finalTotalAmount - 1e-4
          ? 'paid'
          : 'partial';

    const partyNameForVoucher =
      (selectedParty as { name?: string; company?: string })?.name ||
      (selectedParty as { company?: string })?.company ||
      'جهة';

    const warehouseLabel = warehouse === 'main' ? 'المستودع الرئيسي' : 'مستودع الجملة';

    const currencyCode = String(currency || 'USD').trim().toUpperCase();
    const rate = currencyCode === 'USD' ? 1 : normalizeExchangeRate(exchangeRateToUsd);
    if (!rate) {
      showToast({ type: 'warning', message: 'يرجى إدخال سعر صرف صحيح' });
      return;
    }
    const subtotalUsd = round2(convertToUsd(totalAmount, rate));
    const discountUsd = round2(convertToUsd(numberValue(discount), rate));
    const taxUsd = 0;
    const totalUsd = round2(convertToUsd(finalTotalAmount, rate));
    const paidUsd = round2(convertToUsd(paidAmount, rate));
    const remainingUsd = round2(convertToUsd(Math.max(0, finalTotalAmount - paidAmount), rate));

    const invoicePayload = {
      date,
      partyId,
      invoiceNumber,
      currency,
      warehouse,
      notes: headerNotes.trim(),
      totalAmount: finalTotalAmount,
      paidAmount,
      remainingAmount: Math.max(0, finalTotalAmount - paidAmount),
      status: status === 'draft' ? ('unpaid' as const) : paymentStatus,
      items: activeItems.map((item, index) => {
        const quantity = isSales ? numberValue(item.rollQty) : numberValue(item.length);
        const unitPrice = Math.max(0, numberValue(item.price));
        return {
          fabricId: item.materialName || item.rollNo || `LINE-${index + 1}`,
          quantity,
          unitType: 'meter' as const,
          unitPrice,
          total: quantity * unitPrice,
          fabricName: item.materialName,
          materialName: item.materialName,
          designCode: item.dsamNumber,
          rollNumber: item.rollNo,
          rollNo: item.rollNo,
          colorCode: item.colorCode,
          colorName: item.colorName,
          weight: Math.max(0, numberValue(item.weight)),
          weightKg: Math.max(0, numberValue(item.weight)),
          widthCm: Math.max(0, numberValue(item.widthCm)),
          gsm: Math.max(0, numberValue(item.gsm)),
          barcode: meaningfulBarcode(item.supplierBarcode, [item.materialName, item.dsamNumber, item.colorName, item.colorCode]) || '',
          supplierBarcode: meaningfulBarcode(item.supplierBarcode, [item.materialName, item.dsamNumber, item.colorName, item.colorCode]) || undefined,
          printBarcode: item.printBarcode || printableShortBarcode(item.supplierBarcode) || printableShortBarcode(item.rawBarcodePayload) || undefined,
          lotNumber: item.rollNo || undefined,
          qualityGrade: item.qualityGrade || undefined,
          internalRollId: item.internalRollId || undefined,
          rawQrPayload: item.rawQrPayload || undefined,
          rawBarcodePayload: item.rawBarcodePayload || undefined,
          note: item.note,
        };
      }),
    };

    const notesPayload = headerNotes.trim() || null;

    const trimmedInvoiceNo = invoiceNumber.trim();
    const isInvoiceNoUiPlaceholder =
      trimmedInvoiceNo === INVOICE_NUMBER_PENDING_LABEL || trimmedInvoiceNo === INVOICE_NUMBER_MISSING_LABEL;

    const invoicePersistCommon = {
      invoiceDate: date.slice(0, 10),
      warehouseId: null as string | null,
      warehouseLabel,
      currencyCode,
      exchangeRateToUsd: rate,
      notes: notesPayload,
      subtotal: totalAmount,
      discountTotal: numberValue(discount),
      taxTotal: 0,
      totalAmount: finalTotalAmount,
      paidAmount,
      remainingAmount: Math.max(0, finalTotalAmount - paidAmount),
      subtotalUsd,
      discountTotalUsd: discountUsd,
      taxTotalUsd: taxUsd,
      totalAmountUsd: totalUsd,
      paidAmountUsd: paidUsd,
      remainingAmountUsd: remainingUsd,
      paymentStatus,
      lines: apiLines,
    };

    const salesPersistBodyCreate: SalesInvoiceCreatePayload = {
      invoiceNo: CREATE_INVOICE_API_NO_STUB,
      ...invoicePersistCommon,
      customerId: partyId,
    };

    const salesPersistBodyUpdate: Partial<SalesInvoiceCreatePayload> = {
      ...invoicePersistCommon,
      customerId: partyId,
      ...(isInvoiceNoUiPlaceholder || !trimmedInvoiceNo ? {} : { invoiceNo: trimmedInvoiceNo }),
    };

    const purchasePersistBodyCreate: PurchaseInvoiceCreatePayload = {
      invoiceNo: CREATE_INVOICE_API_NO_STUB,
      ...invoicePersistCommon,
      supplierId: partyId,
      supplierInvoiceNo: supplierInvoiceNo.trim() || null,
    };

    const purchasePersistBodyUpdate: Partial<PurchaseInvoiceCreatePayload> = {
      ...invoicePersistCommon,
      supplierId: partyId,
      supplierInvoiceNo: supplierInvoiceNo.trim() || null,
      ...(isInvoiceNoUiPlaceholder || !trimmedInvoiceNo ? {} : { invoiceNo: trimmedInvoiceNo }),
    };

    if (editInvoiceId && status === 'final' && !wholesaleSalesUi) {
      if (
        !window.confirm(
          wholesaleSalesUi
            ? 'سيتم تأكيد الفاتورة وإرسالها لقسم التسليم. لن يُخصم المخزون حتى يفنّد أمين المستودع ويوافق المدير. هل تريد المتابعة؟'
            : 'سيتم ترحيل الفاتورة وسيؤثر ذلك على المخزون والحسابات، هل أنت متأكد؟',
        )
      ) {
        return;
      }
    }

    try {
      if (!editInvoiceId) {
        if (isSales) {
          const created = await postSalesInvoice({
            ...salesPersistBodyCreate,
            confirm: effectiveStatus === 'final',
            cashboxId: effectiveStatus === 'final' && paidAmount > 0 ? cashboxId || null : null,
            partyNameForVoucher,
          });
          const newNo = created.data.invoiceNo?.trim() || '';
          if (!newNo) {
            showToast({ type: 'error', message: 'تعذر قراءة رقم الفاتورة من الخادم' });
            return;
          }
          invoicePayload.invoiceNumber = newNo;
          const savedInvoiceForActions: Invoice = {
            ...invoicePayload,
            id: created.data.id,
            date,
            type: 'sale',
            partyId,
            partyDisplayName: partyNameForVoucher,
            invoiceNumber: newNo,
            currency,
            warehouse: warehouseLabel,
            notes: headerNotes.trim() || undefined,
            totalAmount: finalTotalAmount,
            paidAmount,
            remainingAmount: Math.max(0, finalTotalAmount - paidAmount),
            subtotalUsd,
            discountUsd,
            taxUsd,
            totalAmountUsd: totalUsd,
            paidAmountUsd: paidUsd,
            remainingAmountUsd: remainingUsd,
            status: effectiveStatus === 'draft' ? 'unpaid' : paymentStatus,
          };
          flushSync(() => {
            setInvoiceNumber(newNo);
            setSavedSaleInvoice({
              invoice: savedInvoiceForActions,
              partyName: partyNameForVoucher,
            });
          });
          showToast({
            type: 'success',
            message: wholesaleSalesUi
              ? `تم الحفظ — أُرسلت فاتورة ${newNo} لقسم التسليم (مسودة)`
              : effectiveStatus === 'draft'
                ? `تم حفظ المسودة برقم: ${newNo}`
                : `تم إنشاء وتأكيد الفاتورة رقم: ${newNo}`,
          });
        } else {
          const created = await postPurchaseInvoice({
            ...purchasePersistBodyCreate,
            confirm: effectiveStatus === 'final',
            cashboxId: effectiveStatus === 'final' && paidAmount > 0 ? cashboxId || null : null,
            partyNameForVoucher,
          });
          const newNo = created.data.invoiceNo?.trim() || '';
          if (!newNo) {
            showToast({ type: 'error', message: 'تعذر قراءة رقم الفاتورة من الخادم' });
            return;
          }
          invoicePayload.invoiceNumber = newNo;
          setInvoiceNumber(newNo);
          showToast({
            type: 'success',
            message:
              status === 'draft'
                ? `تم حفظ المسودة برقم: ${newNo}`
                : `تم إنشاء وتأكيد الفاتورة رقم: ${newNo}`,
          });
        }
      } else if (isSales) {
        await updateSalesInvoice(editInvoiceId, salesPersistBodyUpdate);
        const noAfterSave =
          isInvoiceNoUiPlaceholder || !trimmedInvoiceNo ? INVOICE_NUMBER_MISSING_LABEL : trimmedInvoiceNo;
        if (status === 'draft' || wholesaleSalesUi) {
          showToast({
            type: 'success',
            message: wholesaleSalesUi
              ? `تم الحفظ — أُرسلت فاتورة ${noAfterSave} لقسم التسليم (مسودة)`
              : `تم حفظ المسودة برقم: ${noAfterSave}`,
          });
        }
        if (status === 'final' && !wholesaleSalesUi) {
          await confirmSalesInvoice(editInvoiceId, {
            cashboxId: paidAmount > 0 ? cashboxId || null : null,
            partyNameForVoucher,
          });
          const confirmedNo =
            isInvoiceNoUiPlaceholder || !trimmedInvoiceNo ? INVOICE_NUMBER_MISSING_LABEL : trimmedInvoiceNo;
          invoicePayload.invoiceNumber = confirmedNo;
          const savedInvoiceForActions: Invoice = {
            ...invoicePayload,
            id: editInvoiceId,
            date,
            type: 'sale',
            partyId,
            partyDisplayName: partyNameForVoucher,
            invoiceNumber: confirmedNo,
            currency,
            warehouse: warehouseLabel,
            notes: headerNotes.trim() || undefined,
            totalAmount: finalTotalAmount,
            paidAmount,
            remainingAmount: Math.max(0, finalTotalAmount - paidAmount),
            subtotalUsd,
            discountUsd,
            taxUsd,
            totalAmountUsd: totalUsd,
            paidAmountUsd: paidUsd,
            remainingAmountUsd: remainingUsd,
            status: paymentStatus,
          };
          flushSync(() => {
            setSavedSaleInvoice({
              invoice: savedInvoiceForActions,
              partyName: partyNameForVoucher,
            });
          });
          showToast({
            type: 'success',
            message: wholesaleSalesUi
              ? `تم تأكيد الفاتورة ${confirmedNo} — ظهرت في قسم التسليم لأمين المستودع`
              : `تم تأكيد الفاتورة رقم: ${confirmedNo}`,
          });
        }
      } else {
        await updatePurchaseInvoice(editInvoiceId, purchasePersistBodyUpdate);
        const noAfterSave =
          isInvoiceNoUiPlaceholder || !trimmedInvoiceNo ? INVOICE_NUMBER_MISSING_LABEL : trimmedInvoiceNo;
        if (status === 'draft') {
          showToast({
            type: 'success',
            message: `تم حفظ المسودة برقم: ${noAfterSave}`,
          });
        }
        if (status === 'final') {
          await confirmPurchaseInvoice(editInvoiceId, {
            cashboxId: paidAmount > 0 ? cashboxId || null : null,
            partyNameForVoucher,
          });
          const confirmedNo =
            isInvoiceNoUiPlaceholder || !trimmedInvoiceNo ? INVOICE_NUMBER_MISSING_LABEL : trimmedInvoiceNo;
          setInvoiceNumber(confirmedNo);
          showToast({
            type: 'success',
            message: `تم ترحيل فاتورة الشراء رقم: ${confirmedNo}`,
          });
        }
      }
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر حفظ الفاتورة، يرجى المحاولة مرة أخرى',
      });
      return;
    }

    try {
      await sendTelegramInvoiceNotification({
        invoice: invoicePayload,
        invoiceType: isSales ? 'sale' : 'purchase',
        partyName: selectedParty?.name || (selectedParty as any)?.company || 'عميل',
      });
    } catch (error) {
      console.warn('Telegram invoice notification failed', error);
    }

    if (isSales) {
      if (editInvoiceId && status === 'draft') return;
      return;
    }

    if (!editInvoiceId || status === 'final') {
      navigate('/invoices/purchases');
    }
  };

  const inputClass = (hasError = false) =>
    `w-full bg-white border rounded px-2 py-1.5 focus:outline-none focus:border-indigo-500 shadow-sm ${
      hasError ? 'border-rose-300 bg-rose-50' : 'border-slate-200'
    }`;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <InvoiceSaveActionsModal
        isOpen={Boolean(savedSaleInvoice)}
        invoice={savedSaleInvoice?.invoice ?? null}
        partyName={savedSaleInvoice?.partyName ?? ''}
        onClose={() => {
          setSavedSaleInvoice(null);
          navigate('/invoices/sales');
        }}
      />
      {draftLoading && editInvoiceId ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-900">
          جاري تحميل المسودة...
        </div>
      ) : null}
      {editInvoiceId && editBlocked && !draftLoading ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-amber-950 space-y-3">
          <p className="font-black">لا يمكن تعديل فاتورة مؤكدة أو ملغاة</p>
          <p className="text-sm">لا يمكن تعديل فاتورة مؤكدة. يجب إلغاؤها أو إصدار مستند تصحيحي.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate(`/invoices/statement/${editInvoiceId}`)}
              className="rounded-lg bg-white border border-amber-300 px-4 py-2 text-sm font-bold text-amber-900 hover:bg-amber-100"
            >
              كشف الفاتورة
            </button>
            <button
              type="button"
              onClick={() => navigate(isSales ? '/invoices/sales' : '/invoices/purchases')}
              className="rounded-lg bg-amber-800 px-4 py-2 text-sm font-bold text-white hover:bg-amber-900"
            >
              العودة للقائمة
            </button>
          </div>
        </div>
      ) : null}
      {materialSuggest &&
        materialSuggestOptions.length > 0 &&
        createPortal(
          <div
            ref={materialSuggestDropdownRef}
            style={{
              position: 'fixed',
              top: Math.min(window.innerHeight - 12, materialSuggest.rect.bottom + 6),
              left: Math.max(8, Math.min(materialSuggest.rect.left, window.innerWidth - materialSuggest.rect.width - 8)),
              width: materialSuggest.rect.width,
              zIndex: 100000,
            }}
          >
            <div className="rounded-lg border border-slate-200 bg-white shadow-2xl overflow-hidden">
              <ul className="max-h-80 overflow-auto text-sm">
                {materialSuggestOptions.map((opt, idx) => (
                  <li key={opt.key} className="border-b last:border-b-0 border-slate-100">
                    <button
                      type="button"
                      onMouseEnter={() => setMaterialSuggestIndex(idx)}
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        applyStockToLine(materialSuggest.lineId, opt.stock);
                        setMaterialSuggest(null);
                      }}
                      className={`w-full text-right px-3 py-2 hover:bg-indigo-50 ${
                        idx === materialSuggestIndex ? 'bg-indigo-50' : 'bg-white'
                      }`}
                    >
                      <div className="font-bold text-slate-800">{opt.title || '—'}</div>
                      {opt.subtitle ? (
                        <div className="text-xs text-slate-500 font-mono mt-0.5" dir="ltr">
                          {opt.subtitle}
                        </div>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>,
          document.body,
        )}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">
              {editInvoiceId
                ? isSales
                  ? 'تعديل مسودة فاتورة مبيعات'
                  : 'تعديل مسودة فاتورة مشتريات'
                : isSales
                  ? 'فاتورة مبيعات جديدة'
                  : 'فاتورة مشتريات جديدة'}
            </h2>
            <p className="text-slate-500 mt-1 text-sm">
              {isSales
                ? wholesaleSalesUi
                  ? 'تسجيل بيع بالجملة — اسم الخامة، عدد الأتواب، السعر، والمجموع'
                  : 'تسجيل بيع بالجملة — باركود، عدد الأتواب، السعر، والمجموع'
                : 'تسجيل شراء — باركود، الطول (متر/ياردة)، السعر، والمجموع'}
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          {!isSales && !editInvoiceId ? (
            <Link
              to="/purchases/import-excel"
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700 transition shadow-sm font-medium"
            >
              <FileUp className="w-4 h-4" />
              <span className="hidden sm:inline">استيراد من Excel</span>
            </Link>
          ) : null}
          <button onClick={() => navigate(-1)} className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition shadow-sm font-medium">
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">إلغاء</span>
          </button>
          <button onClick={() => handleSave('draft')} disabled={hasValidationErrors || draftLoading || editBlocked} className="bg-amber-50 text-amber-700 border border-amber-200 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-amber-100 transition shadow-sm font-medium disabled:opacity-50">
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">حفظ مسودة</span>
          </button>
          <button onClick={() => handleSave('final')} disabled={hasValidationErrors || draftLoading || editBlocked} className="bg-indigo-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition shadow-sm font-medium disabled:opacity-50">
            <Save className="w-4 h-4" />
            <span className="hidden sm:inline">{wholesaleSalesUi ? 'حفظ وإرسال للتسليم' : 'حفظ نهائي'}</span>
          </button>
        </div>
      </div>

      <div
        className={`bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4 ${editBlocked || draftLoading ? 'pointer-events-none opacity-50' : ''}`}
        data-enter-scope
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">رقم الفاتورة</label>
              <input
                type="text"
                value={invoiceNumber}
                readOnly
                onKeyDown={focusNextFormControl}
                className={`w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-600 focus:outline-none ${
                  invoiceNumber === INVOICE_NUMBER_PENDING_LABEL || invoiceNumber === INVOICE_NUMBER_MISSING_LABEL
                    ? 'font-sans text-slate-500'
                    : 'font-mono'
                }`}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">التاريخ</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                onKeyDown={focusNextFormControl}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">المستودع</label>
              <select
                value={warehouse}
                onChange={(e) => setWarehouse(e.target.value)}
                onKeyDown={focusNextFormControl}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
              >
                <option value="main">المستودع الرئيسي</option>
                <option value="sub">مستودع الجملة</option>
              </select>
            </div>
            <div className={`space-y-1.5 ${partyId ? 'pb-5' : ''}`}>
              <label className="text-xs font-bold text-slate-700">{isSales ? 'العميل' : 'المورد'}</label>
              <div className="relative">
                <SmartPartySearch
                  options={partyOptions}
                  selectedId={partyId}
                  onSelect={setPartyId}
                  onEnterFallback={focusNextFormControl}
                  placeholder={isSales ? 'اكتب أول حرف من اسم العميل أو رقم الهاتف' : 'اكتب أول حرف من اسم المورد أو رقم الهاتف'}
                  emptyLabel={isSales ? 'اختر عميلا من النتائج' : 'اختر موردا من النتائج'}
                />
                <input
                  type="search"
                  value=""
                  onChange={() => undefined}
                  onKeyDown={focusNextFormControl}
                  placeholder={isSales ? 'بحث باسم العميل أو الهاتف أو البريد' : 'بحث باسم المورد أو الهاتف أو البريد'}
                  className="hidden"
                />
                <select value={partyId} onChange={(e) => setPartyId(e.target.value)} onKeyDown={focusNextFormControl} className="hidden">
                  <option value="">-- نقدي سريع --</option>
                  {isSales
                    ? partyOptions.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)
                    : partyOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
                {partyId && selectedParty && (
                  <div className={`absolute -bottom-5 right-2 text-xs font-bold font-mono px-1 ${balanceColor}`}>
                    {partyStatementBalanceLoading ? 'جاري تحميل الرصيد...' : `الرصيد السابق: ${Math.abs(partyBalance).toFixed(2)} (${balanceText})`}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-end">
            <div className={`col-span-1 space-y-1.5 ${isSales ? 'md:col-span-3' : 'md:col-span-2'}`}>
              <label className="text-xs font-bold text-slate-700">العملة</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                onKeyDown={focusNextFormControl}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-500"
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.nameAr} ({c.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-1 md:col-span-2 space-y-1.5">
              <label className="text-xs font-bold text-slate-600">سعر الصرف</label>
              <input
                type="number"
                step="0.000001"
                value={String(currency || 'USD').trim().toUpperCase() === 'USD' ? '1' : exchangeRateToUsd}
                disabled={String(currency || 'USD').trim().toUpperCase() === 'USD'}
                onChange={(e) => setExchangeRateToUsd(e.target.value)}
                onKeyDown={focusNextFormControl}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 font-mono text-left"
                dir="ltr"
                title="عدد وحدات العملة مقابل 1 دولار أمريكي"
              />
            </div>
            {!isSales ? (
              <div className="col-span-2 md:col-span-3 space-y-1.5">
                <label className="text-xs font-bold text-slate-600">رقم فاتورة المورد</label>
                <input
                  type="text"
                  value={supplierInvoiceNo}
                  onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                  onKeyDown={focusNextFormControl}
                  className={`${inputClass()} py-1.5 text-sm`}
                  dir="ltr"
                  placeholder="اختياري"
                />
              </div>
            ) : null}
            <div className={`col-span-2 space-y-1.5 ${isSales ? 'md:col-span-7' : 'md:col-span-5'}`}>
              <label className="text-xs font-bold text-slate-600">ملاحظات الفاتورة</label>
              <textarea
                value={headerNotes}
                onChange={(e) => setHeaderNotes(e.target.value)}
                onKeyDown={focusNextFormControl}
                rows={1}
                className={`${inputClass()} min-h-0 resize-y text-sm py-1.5 max-h-16 w-full`}
                placeholder="اختياري"
              />
            </div>
          </div>
        </div>

        {!isSales && (
        <section className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-bold text-cyan-900">مسح QR / باركود (خيار للمحاسب)</div>
            {rollsLoading && (
              <div className="flex items-center gap-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                جاري تحميل المخزون… يمكنك المسح الآن وسيتم البحث من السيرفر تلقائياً.
              </div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleDedicatedScanSubmit(e.currentTarget.value);
                }
              }}
              placeholder='امسح QR أو الباركود هنا ثم Enter'
              className="flex-1 bg-white border border-cyan-300 rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
            />
            <button
              type="button"
              onClick={() => void handleDedicatedScanSubmit()}
              className="px-4 py-2 rounded-lg bg-cyan-700 text-white hover:bg-cyan-800 font-bold"
            >
              تحليل
            </button>
          </div>
          {scanMessage && <div className="text-xs font-bold text-cyan-800">{scanMessage}</div>}
        </section>
        )}

        <hr className="border-slate-100" />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900">أصناف الفاتورة</h3>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={handleAddItem} className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1 transition">
                <Plus className="w-4 h-4" /> إضافة صنف
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border border-slate-200">
                  <th className="p-3 font-bold w-12 text-center">#</th>
                  {!wholesaleSalesUi ? <th className="p-3 font-bold min-w-[140px]">باركورد</th> : null}
                  <th className="p-3 font-bold min-w-[220px]">اسم التوب</th>
                  <th className="p-3 font-bold w-20">عدد</th>
                  {!wholesaleSalesUi ? <th className="p-3 font-bold min-w-[120px]">متر/يارد</th> : null}
                  <th className="p-3 font-bold w-28">{wholesaleSalesUi ? 'سعر المتر' : 'سعر'}</th>
                  <th className="p-3 font-bold w-28">مجموع</th>
                  <th className="p-3 font-bold w-12 text-center"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const lengthError = getItemError(item, 'length');
                  const rollQtyError = getItemError(item, 'rollQty');
                  const materialError = wholesaleSalesUi ? getItemError(item, 'materialName') : '';
                  const priceError = getItemError(item, 'price');
                  const lineTotal = computeInvoiceLineTotal(item, isSales, wholesaleSalesUi);
                  const materialFieldIndex = wholesaleSalesUi ? 0 : 1;
                  const rollQtyFieldIndex = wholesaleSalesUi ? 1 : 2;
                  const lengthFieldIndex = 3;
                  const priceFieldIndex = wholesaleSalesUi ? 2 : 4;
                  return (
                    <tr key={item.id} data-invoice-item-row className="border-b border-x border-slate-200">
                      <td className="p-2 text-center font-bold text-slate-400">{index + 1}</td>
                      {!wholesaleSalesUi ? (
                      <td className="p-2">
                        <div className="relative">
                          <QrCode className="w-4 h-4 absolute right-3 top-2.5 text-slate-400" />
                          <input
                            type="text"
                            data-invoice-field-index={0}
                            autoComplete="off"
                            placeholder="امسح الباركود"
                            value={item.supplierBarcode}
                            onChange={(e) => {
                              const raw = e.target.value || '';
                              updateItem(item.id, 'supplierBarcode', raw);
                              setLatestScannedLineId(item.id);

                              const normalized = raw.trim();
                              const timerKey = item.id * 1000 + 777;
                              const existingTimer = scanParseTimersRef.current[timerKey];
                              if (existingTimer) clearTimeout(existingTimer);
                              if (parseRollIdentityQrPayload(normalized) || (isLikelyIdentityBarcodePayload(normalized) && normalized.length >= 4)) {
                                scanParseTimersRef.current[timerKey] = setTimeout(() => {
                                  const row = e.currentTarget.closest('[data-invoice-item-row]') as HTMLElement | null;
                                  void handleBarcodeFieldSubmit(item.id, normalized, row);
                                }, 120);
                              }
                            }}
                            onBlur={(e) => {
                              const normalized = (e.currentTarget.value || '').trim();
                              if (parseRollIdentityQrPayload(normalized) || isLikelyIdentityBarcodePayload(normalized)) {
                                const row = e.currentTarget.closest('[data-invoice-item-row]') as HTMLElement | null;
                                void handleBarcodeFieldSubmit(item.id, normalized, row);
                              }
                              window.setTimeout(() => warnIfDuplicateLine(item.id), 0);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                const raw = (e.currentTarget.value || '').trim();
                                if (parseRollIdentityQrPayload(raw) || isLikelyIdentityBarcodePayload(raw)) {
                                  e.preventDefault();
                                  const row = e.currentTarget.closest('[data-invoice-item-row]') as HTMLElement | null;
                                  void handleBarcodeFieldSubmit(item.id, raw, row);
                                  return;
                                }
                              }
                              handleInvoiceLineEnter(e, item);
                            }}
                            className="w-full bg-white border border-slate-200 rounded pr-9 pl-2 py-1.5 focus:outline-none focus:border-indigo-500 shadow-sm font-mono text-xs"
                            dir="ltr"
                          />
                        </div>
                      </td>
                      ) : null}
                      <td className="p-2">
                        <div className="relative">
                          <input
                            type="text"
                            data-invoice-field-index={materialFieldIndex}
                            autoComplete="off"
                            placeholder="اسم التوب / الخامة"
                            value={item.materialName}
                            onFocus={(e) => {
                              materialSuggestInputRef.current = e.currentTarget;
                              setMaterialSuggest({
                                lineId: item.id,
                                query: e.currentTarget.value || '',
                                rect: e.currentTarget.getBoundingClientRect(),
                              });
                            }}
                            onChange={(e) => {
                              const raw = e.target.value || '';
                              void handleMaterialInput(item.id, raw);
                              materialSuggestInputRef.current = e.currentTarget;
                              setMaterialSuggest({
                                lineId: item.id,
                                query: raw,
                                rect: e.currentTarget.getBoundingClientRect(),
                              });

                              const normalized = raw.trim();
                              const existingTimer = scanParseTimersRef.current[item.id];
                              if (existingTimer) {
                                clearTimeout(existingTimer);
                              }
                              scanParseTimersRef.current[item.id] = setTimeout(() => {
                                if (parseRollIdentityQrPayload(normalized) || isCompleteSupplierQrPayload(normalized)) {
                                  void handleScannedValueOnMaterialField(item.id, normalized);
                                  return;
                                }
                                if (isLikelyIdentityBarcodePayload(normalized)) {
                                  void handleScannedValueOnMaterialField(item.id, normalized);
                                }
                              }, 140);
                            }}
                            onBlur={(e) => {
                              const normalized = (e.currentTarget.value || '').trim();
                              if (
                                parseRollIdentityQrPayload(normalized)
                                || isCompleteSupplierQrPayload(normalized)
                                || isLikelyIdentityBarcodePayload(normalized)
                              ) {
                                void handleScannedValueOnMaterialField(item.id, normalized);
                                return;
                              }
                              const stock = findStockMatchStrictIdentity(normalized);
                              if (stock) applyStockToLine(item.id, stock);
                              window.setTimeout(() => {
                                setMaterialSuggest((prev) => (prev?.lineId === item.id ? null : prev));
                              }, 120);
                              window.setTimeout(() => warnIfDuplicateLine(item.id), 0);
                            }}
                            onKeyDown={(e) => {
                              const suggestActive =
                                materialSuggest?.lineId === item.id && materialSuggestOptions.length > 0;
                              if (suggestActive) {
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  setMaterialSuggestIndex((prev) =>
                                    Math.min(prev + 1, materialSuggestOptions.length - 1),
                                  );
                                  return;
                                }
                                if (e.key === 'ArrowUp') {
                                  e.preventDefault();
                                  setMaterialSuggestIndex((prev) => Math.max(prev - 1, 0));
                                  return;
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setMaterialSuggest(null);
                                  return;
                                }
                                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                  const raw = (e.currentTarget.value || '').trim();
                                  if (!raw.includes('|') && !isLikelyBarcodePayload(raw)) {
                                    const opt = materialSuggestOptions[materialSuggestIndex];
                                    if (opt) {
                                      applyStockToLine(item.id, opt.stock);
                                      updateItem(
                                        item.id,
                                        'supplierBarcode',
                                        stockBarcodeValue(opt.stock, [item.materialName, item.dsamNumber, item.colorName, item.colorCode]) || item.supplierBarcode,
                                      );
                                      setMaterialSuggest(null);
                                      advanceInvoiceLineFocus(e, item);
                                      return;
                                    }
                                  }
                                }
                              } else if (e.key === 'ArrowDown') {
                                materialSuggestInputRef.current = e.currentTarget;
                                setMaterialSuggest({
                                  lineId: item.id,
                                  query: e.currentTarget.value || '',
                                  rect: e.currentTarget.getBoundingClientRect(),
                                });
                              }
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                const raw = (e.currentTarget.value || '').trim();
                                if (parseRollIdentityQrPayload(raw) || isLikelyIdentityBarcodePayload(raw)) {
                                  e.preventDefault();
                                  void handleScannedValueOnMaterialField(item.id, raw);
                                  return;
                                }
                              }
                              handleInvoiceLineEnter(e, item);
                            }}
                            className={`w-full bg-white border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-500 shadow-sm${
                              materialError ? ' border-red-300' : ''
                            }`}
                            title={materialError}
                          />
                        </div>
                      </td>
                      <td className="p-2">
                        <input
                          data-invoice-field-index={rollQtyFieldIndex}
                          type="number"
                          min="1"
                          step="1"
                          value={item.rollQty}
                          onChange={(e) => updateItem(item.id, 'rollQty', e.target.value)}
                          onKeyDown={(e) => handleInvoiceLineEnter(e, item)}
                          title={rollQtyError}
                          placeholder={isSales ? 'عدد الأتواب' : '1'}
                          className={inputClass(Boolean(rollQtyError))}
                        />
                      </td>
                      {!wholesaleSalesUi ? (
                      <td className="p-2">
                        <div className="flex items-center gap-1">
                          <input
                            data-invoice-field-index={lengthFieldIndex}
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.length}
                            onChange={(e) => updateItem(item.id, 'length', e.target.value)}
                            onBlur={(e) => {
                              if (isSales) {
                                void syncMissingRollPhysicalFromInvoiceLine(item, apiRolls, mergeRollIntoApiRolls, {
                                  field: 'length',
                                  lengthInput: e.currentTarget.value,
                                  toastOnSuccess: true,
                                  toastOnError: false,
                                });
                              }
                            }}
                            onKeyDown={(e) => handleInvoiceLineEnter(e, item)}
                            title={lengthError}
                            placeholder={isSales ? 'اختياري' : 'الطول'}
                            className={`${inputClass(Boolean(lengthError))} min-w-[4.5rem]`}
                          />
                          <select
                            value={item.lengthUnit}
                            onChange={(e) => updateItemLengthUnit(item.id, e.target.value as 'meter' | 'yard')}
                            className="rounded border border-slate-200 bg-white px-1 py-1.5 text-xs"
                          >
                            <option value="meter">م</option>
                            <option value="yard">ي</option>
                          </select>
                        </div>
                      </td>
                      ) : null}
                      <td className="p-2">
                        <input
                          data-invoice-field-index={priceFieldIndex}
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.price}
                          onChange={(e) => updateItem(item.id, 'price', e.target.value)}
                          onKeyDown={(e) => handleInvoiceLineEnter(e, item)}
                          title={priceError}
                          placeholder={wholesaleSalesUi ? 'سعر المتر' : undefined}
                          className={inputClass(Boolean(priceError))}
                        />
                      </td>
                      <td className="p-2 font-bold text-slate-700 bg-slate-50 text-center font-mono text-xs">
                        {wholesaleSalesUi && isSales ? (
                          <span className="text-amber-700">{WHOLESALE_PENDING_TOTAL_LABEL}</span>
                        ) : (
                          lineTotal.toFixed(2)
                        )}
                      </td>
                      <td className="hidden p-2">
                        <input type="text" value={item.dsamNumber} readOnly className="hidden" />
                        <input type="text" value={item.colorName} readOnly className="hidden" />
                        <input type="text" value={item.colorCode} readOnly className="hidden" />
                        <input type="number" value={item.weight} readOnly className="hidden" />
                        <input type="text" value={item.rollNo} readOnly className="hidden" />
                      </td>
                      <td className="p-2 text-center">
                        <button onClick={() => handleRemoveItem(item.id)} disabled={items.length === 1} className="text-slate-400 hover:text-rose-500 disabled:opacity-30 transition p-1">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50 font-bold border-t border-slate-300 text-slate-700">
                <tr>
                  <td colSpan={6} className="p-3 text-left">المجموع:</td>
                  <td className="p-3 font-mono text-indigo-700">
                    {wholesaleSalesUi && isSales ? (
                      <span className="text-amber-700">{WHOLESALE_PENDING_TOTAL_LABEL}</span>
                    ) : (
                      money(totalAmount, currency)
                    )}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {!hideMaterialSummarySection && (
        <section className="rounded-xl border border-slate-200 bg-slate-50">
          <button type="button" onClick={() => setSummaryOpen(!summaryOpen)} className="w-full flex items-center justify-between px-5 py-4 text-right">
            <div>
              <h3 className="text-lg font-bold text-slate-900">ملخص تفنيد الفاتورة حسب الخامة</h3>
              <p className="text-sm text-slate-500">يتحدث مباشرة حسب الخامة والتصميم والسعر</p>
            </div>
            {summaryOpen ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
          </button>

          {summaryOpen && (
            <div className="px-5 pb-5 space-y-4">
              <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
                <table className="w-full text-sm text-right">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="p-3">الخامة / القماش</th>
                      <th className="p-3">كود التصميم</th>
                      <th className="p-3">عدد الألوان</th>
                      <th className="p-3">عدد الرولات</th>
                      <th className="p-3">إجمالي الأمتار</th>
                      <th className="p-3">سعر المتر</th>
                      <th className="p-3">الإجمالي</th>
                      <th className="p-3">إجمالي الوزن</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.groups.map((group) => (
                      <tr key={`${group.materialName}-${group.designCode}`} className="border-t border-slate-100">
                        <td className="p-3 font-bold">{group.materialName}</td>
                        <td className="p-3 font-mono text-xs">{group.designCode}</td>
                        <td className="p-3">{group.colorCount}</td>
                        <td className="p-3">{group.rollCount}</td>
                        <td className="p-3 font-mono">{group.totalMeters.toFixed(2)}</td>
                        <td className="p-3">
                           <input
                             type="number"
                             min="0"
                             data-invoice-summary-price
                             data-summary-material={group.materialName}
                             data-summary-design={group.designCode}
                             value={group.pricePerMeter === 0 ? '' : group.pricePerMeter}
                             onChange={(event) => updateGroupPrice(group.materialName, group.designCode, group.pricePerMeter, event.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key !== 'Enter' || ev.nativeEvent.isComposing) return;
                              ev.preventDefault();
                              focusNextFormControl(ev);
                            }}
                            className="w-28 bg-white border border-slate-200 rounded px-2 py-1.5 text-left font-mono focus:outline-none focus:border-indigo-500"
                            dir="ltr"
                          />
                        </td>
                        <td className="p-3 font-mono font-bold text-indigo-700">
                          {wholesaleSalesUi && isSales ? (
                            <span className="text-amber-700">{WHOLESALE_PENDING_TOTAL_LABEL}</span>
                          ) : (
                            money(group.totalAmount, currency)
                          )}
                        </td>
                        <td className="p-3 font-mono">{group.totalKg.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <SummaryStat label="إجمالي الرولات" value={summary.totals.rollCount.toString()} />
                <SummaryStat label="إجمالي الأمتار" value={summary.totals.totalMeters.toFixed(2)} />
                <SummaryStat label="إجمالي الوزن" value={summary.totals.totalKg.toFixed(2)} />
                <SummaryStat
                  label={`إجمالي ${currency}`}
                  value={
                    wholesaleSalesUi && isSales ? WHOLESALE_PENDING_TOTAL_LABEL : money(summary.totals.totalAmount, currency)
                  }
                />
                <SummaryStat label="عدد المجموعات" value={summary.totals.groupCount.toString()} />
              </div>
            </div>
          )}
        </section>
        )}

        <hr className="border-slate-100" />

        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 flex flex-col md:flex-row gap-8 justify-between items-start">
          <div className="w-full md:w-2/3 space-y-4">
            <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2">طريقة الدفع والحساب</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">نوع البيع</label>
                <select value={saleType} onChange={(e) => setSaleType(e.target.value)} onKeyDown={focusNextFormControl} className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2 text-slate-900 focus:outline-none focus:border-indigo-500">
                  <option value="cash">نقدي</option>
                  <option value="credit">آجل</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">اختيار صندوق مالي (من الخادم)</label>
                <select value={cashboxId} onChange={(e) => setCashboxId(e.target.value)} onKeyDown={focusNextFormControl} className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2 text-slate-900 focus:outline-none focus:border-indigo-500">
                  <option value="">-- اختر الصندوق --</option>
                  {cashboxOptions.map((box) => (
                    <option key={box.id} value={box.id}>
                      {box.name} ({box.code})
                    </option>
                  ))}
                </select>
                {cashboxOptions.length === 0 && (
                  <p className="text-xs text-amber-700">لا صناديق من الخادم — أنشئ صندوقاً من إعدادات الخزينة أو شغّل البذرة.</p>
                )}
              </div>
              {saleType === 'credit' && (
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الدفعة النقدية المقدمة</label>
                  <input type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} onKeyDown={focusNextFormControl} placeholder="0.00" className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2 text-slate-900 focus:outline-none focus:border-indigo-500" />
                </div>
              )}
            </div>
          </div>

          <div className="w-full md:w-1/3 bg-white p-4 rounded-lg shadow-sm border border-slate-200 space-y-3">
            <div className="flex justify-between items-center text-sm mb-2 border-b border-slate-100 pb-2">
              <span className="text-slate-600">إجمالي المواد</span>
              <span className="font-bold font-mono">
                {wholesaleSalesUi && isSales ? (
                  <span className="text-amber-700">{WHOLESALE_PENDING_TOTAL_LABEL}</span>
                ) : (
                  money(totalAmount, currency)
                )}
              </span>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">قيمة الحسم الممنوح</label>
              <input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} onKeyDown={focusNextFormControl} placeholder="0.00" className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-1.5 text-slate-900 focus:outline-none focus:border-indigo-500 text-left font-mono" dir="ltr" />
            </div>
            <div className="space-y-1 pt-3 border-t border-slate-100">
              <label className="text-xs font-bold text-indigo-700">الإجمالي النهائي للمطالبة</label>
              <div className="w-full bg-indigo-50 border border-indigo-200 rounded px-3 py-2 text-indigo-900 font-bold text-lg text-left font-mono" dir="ltr">
                {wholesaleSalesUi && isSales ? (
                  <span className="text-amber-800">{WHOLESALE_PENDING_TOTAL_LABEL}</span>
                ) : (
                  money(finalTotalAmount, currency)
                )}
              </div>
              {wholesaleSalesUi && isSales ? (
                <p className="text-xs text-amber-800">يُحسب الإجمالي بعد تفنيد الأتواب في قسم التسليم (أمتار × سعر المتر).</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const SummaryStat = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-white border border-slate-200 rounded-lg p-3">
    <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</div>
    <div className="mt-1 font-black text-slate-900 font-mono">{value}</div>
  </div>
);
