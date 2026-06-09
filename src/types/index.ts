export interface InventoryBatch {
  id: string;
  batchNumber: string;
  productionDate?: string;
  expiryDate?: string;
  initialQuantity: number;
  currentQuantity: number;
  costPrice?: number;
  materialComposition?: string;
  supplierDetails?: string;
}

export interface CategoryItem {
  id: string;
  fabricCode: string;
  colorName: string;
  colorCode: string;
}

export interface CategoryNode {
  id: string;
  name: string;
  expanded?: boolean;
  children?: CategoryNode[];
}

export interface Category {
  id: string;
  name: string;
  expanded?: boolean;
  items: CategoryItem[];
}

export interface FabricItem {
  id: string;
  qrCode: string;
  name: string;
  fabricCode: string;
  colorName: string;
  colorCode: string;
  lengthType: 'meter' | 'yard';
  length: number;
  rollWidth: number;
  weight: number;
  warehouseId?: string; // ID of the warehouse where this item is stored
  costPrice: number;
  sellingPrice: number;
  status: 'available' | 'low_stock' | 'out_of_stock';
  barcode?: string; // Optional user-defined barcode string
  imageUrl?: string;

  // Keep legacy optional for backward compatibility
  type?: string;
  yards?: number;
  meters?: number;
  rollNumber?: string;
  trackBatches?: boolean;
  batches?: InventoryBatch[];
  minStockLevel?: number;
  designNumber?: string;
  lotNumber?: string;
  supplierBarcode?: string;
  qualityGrade?: string;
  internalRollId?: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: 'main' | 'branch' | 'showroom';
  location: string;
  manager: string;
  phone: string;
  capacityMetric: string; // e.g., square meters or rolls
  capacityValue: number;
  status: 'active' | 'inactive';
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  balance: number;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  company: string;
  balance: number;
}

export interface Invoice {
  id: string;
  date: string;
  type: 'sale' | 'purchase';
  partyId: string; // customerId or supplierId
  /** اسم العميل أو المورد من استجابة الخادم (JOIN) عند عرض فاتورة محفوظة */
  partyDisplayName?: string;
  invoiceNumber?: string;
  currency?: string;
  exchangeRateToUsd?: number;
  warehouse?: string;
  notes?: string;
  subtotal?: number;
  discountTotal?: number;
  taxTotal?: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  subtotalUsd?: number;
  discountUsd?: number;
  taxUsd?: number;
  totalAmountUsd?: number;
  paidAmountUsd?: number;
  remainingAmountUsd?: number;
  items: InvoiceItem[];
  /** حالة الدفع (من payment_status في الخادم) — يُفضّل استخدام paymentStatus للوضوح */
  status: 'paid' | 'partial' | 'unpaid';
  /** حالة المستند: DRAFT / CONFIRMED / VOIDED */
  documentStatus?: 'DRAFT' | 'CONFIRMED' | 'VOIDED';
  /** نفس قيم status عند التحميل من API (دفع) */
  paymentStatus?: 'paid' | 'partial' | 'unpaid';
}

export interface InvoiceItem {
  fabricId: string;
  quantity: number; // in yards or meters based on preference
  unitType: 'yard' | 'meter';
  unitPrice: number;
  lineDiscount?: number;
  total: number;
  // Textile details
  fabricName?: string;
  materialName?: string;
  designName?: string;
  designCode?: string;
  rollNumber?: string;
  rollNo?: string;
  colorCode?: string;
  colorName?: string;
  weight?: number;
  weightKg?: number;
  widthCm?: number;
  gsm?: number;
  barcode?: string;
  supplierBarcode?: string;
  printBarcode?: string;
  lotNumber?: string;
  qualityGrade?: string;
  internalRollId?: string;
  rawQrPayload?: string;
  rawBarcodePayload?: string;
  note?: string;
  /** عدد الأتواب (البكر) لهذا البند عند الإبلاغ عنه في الفاتورة */
  rollsCount?: number;
}

export interface Expense {
  id: string;
  date: string;
  category: string;
  amount: number;
  description: string;
}

export interface AccountInfo {
  id: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  balance: number;
  parentId?: string; // For tree structure
}

export interface Transaction {
  id: string;
  date: string;
  accountId: string;
  partyId?: string; // Links to Customer or Supplier
  type: 'debit' | 'credit';
  amount: number;
  description: string;
  referenceId?: string; // like invoice ID
}

/** طلبيات حجز خامات متوقعة (قبل وصولها للمستودع) */
export type CustomerOrderStatus =
  | 'draft'
  | 'pending_supply'
  | 'partial_ready'
  | 'ready_pickup'
  | 'completed'
  | 'cancelled';

export interface CustomerOrderLine {
  id: string;
  materialName: string;
  dsamNumber: string;
  rollNo: string;
  colorCode: string;
  colorName: string;
  /** الكمية بالمتر أو باليارد حسب unitType */
  length: number;
  widthCm: number;
  gsm: number;
  weight: number;
  price: number;
  note?: string;
  /** معاينة محلية (مثلاً base64 من رفع الملف) */
  imageUrl?: string;
  /** قيمة مسح الباركود في خانة الخامة / مرجع */
  referenceBarcode?: string;
  /** وحدة الكمية في length */
  unitType?: 'meter' | 'yard';
}

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  date: string;
  customerId: string;
  currency: string;
  warehouse?: string;
  notes?: string;
  items: CustomerOrderLine[];
  status: CustomerOrderStatus;
  templateId?: string;
  expectedDate?: string;
  /** دفعة مقدمة من العميل (اختياري) */
  advancePayment?: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderTemplateLine {
  materialName: string;
  dsamNumber: string;
  rollNo?: string;
  colorCode: string;
  colorName: string;
  length: number;
  widthCm: number;
  gsm: number;
  price: number;
  note?: string;
}

export interface OrderTemplate {
  id: string;
  name: string;
  description?: string;
  lines: OrderTemplateLine[];
  createdAt: string;
}
