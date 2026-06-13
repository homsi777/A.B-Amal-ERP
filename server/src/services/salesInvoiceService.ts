import type { PoolClient } from 'pg';
import { z } from 'zod';

/** Pool or client — list/detail helpers only need `.query`. */
type DbQuery = Pick<PoolClient, 'query'>;
import { postSalesInvoiceToGl, reverseSalesInvoiceGl } from './glPostingService.js';
import { applyVoucherConfirmation, cancelConfirmedVoucher, insertDraftVoucher } from './voucherCashboxService.js';
import { getExchangeRateToUsdTx } from './exchangeRateService.js';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';
import {
  allocateHeaderDiscountToLines,
  INVOICE_AMOUNT_EPS,
  validateInvoiceLineAmounts,
} from './invoiceAmountHelpers.js';

const EPS = INVOICE_AMOUNT_EPS;

export const invoiceLineSchema = z.object({
  fabricRollId: z.string().uuid().optional().nullable(),
  fabricItemId: z.string().uuid().optional().nullable(),
  variantId: z.string().uuid().optional().nullable(),
  warehouseId: z.string().uuid().optional().nullable(),
  description: z.string().optional().default(''),
  quantity: z.coerce.number().nonnegative(),
  unit: z.enum(['meter', 'yard', 'roll']).default('meter'),
  unitPrice: z.coerce.number().nonnegative(),
  lineDiscount: z.coerce.number().nonnegative().default(0),
  lineTax: z.coerce.number().nonnegative().default(0),
  lineTotal: z.coerce.number().nonnegative(),
  unitPriceUsd: z.coerce.number().nonnegative().optional(),
  lineDiscountUsd: z.coerce.number().nonnegative().optional(),
  lineTaxUsd: z.coerce.number().nonnegative().optional(),
  lineTotalUsd: z.coerce.number().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export const salesInvoiceCreateBaseSchema = z.object({
  invoiceNo: z.string().min(1),
  invoiceDate: z.string().min(1),
  customerId: z.string().uuid(),
  warehouseId: z.string().uuid().optional().nullable(),
  warehouseLabel: z.string().optional().nullable(),
  currencyCode: z.string().min(1).default('USD'),
  exchangeRateToUsd: z.coerce.number().optional(),
  notes: z.string().optional().nullable(),
  subtotal: z.coerce.number().nonnegative(),
  discountTotal: z.coerce.number().nonnegative().default(0),
  taxTotal: z.coerce.number().nonnegative().default(0),
  totalAmount: z.coerce.number().nonnegative(),
  paidAmount: z.coerce.number().nonnegative().default(0),
  remainingAmount: z.coerce.number().nonnegative(),
  subtotalUsd: z.coerce.number().nonnegative().optional(),
  discountTotalUsd: z.coerce.number().nonnegative().optional(),
  taxTotalUsd: z.coerce.number().nonnegative().optional(),
  totalAmountUsd: z.coerce.number().nonnegative().optional(),
  paidAmountUsd: z.coerce.number().nonnegative().optional(),
  remainingAmountUsd: z.coerce.number().nonnegative().optional(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']).default('unpaid'),
  lines: z.array(invoiceLineSchema).min(1),
  confirm: z.boolean().optional().default(false),
  cashboxId: z.string().uuid().optional().nullable(),
  partyNameForVoucher: z.string().optional().nullable(),
});

export const salesInvoiceCreateSchema = salesInvoiceCreateBaseSchema.refine(
  (d) => Math.abs(d.subtotal - d.discountTotal + d.taxTotal - d.totalAmount) <= EPS,
  { message: 'إجمالي الفاتورة لا يطابق (المجموع − الخصم + الضريبة)', path: ['totalAmount'] },
);

export const salesInvoiceUpdateDraftSchema = salesInvoiceCreateBaseSchema
  .omit({ confirm: true })
  .partial({ lines: true })
  .refine(
    (d) => {
      const subtotal = d.subtotal;
      const discount = d.discountTotal ?? 0;
      const tax = d.taxTotal ?? 0;
      const total = d.totalAmount;
      if (subtotal == null || total == null) return true;
      return Math.abs(subtotal - discount + tax - total) <= EPS;
    },
    { message: 'إجمالي الفاتورة لا يطابق (المجموع − الخصم + الضريبة)', path: ['totalAmount'] },
  );

export type SalesInvoiceCreateInput = z.infer<typeof salesInvoiceCreateSchema>;

function prepareSalesInvoiceLines(
  lines: z.infer<typeof invoiceLineSchema>[],
  discountTotal: number,
  subtotal: number,
  taxTotal: number,
  totalAmount: number,
): z.infer<typeof invoiceLineSchema>[] {
  const allocated = allocateHeaderDiscountToLines(lines, discountTotal);
  validateInvoiceLineAmounts(allocated, subtotal, discountTotal, taxTotal, totalAmount);
  return allocated as z.infer<typeof invoiceLineSchema>[];
}

export function quantityToMeters(quantity: number, unit: 'meter' | 'yard'): number {
  return unit === 'yard' ? Math.round(quantity * 0.9144 * 1000) / 1000 : quantity;
}

export function paymentStatuses(total: number, paid: number): { paymentStatus: 'unpaid' | 'partial' | 'paid'; remaining: number } {
  const remaining = Math.max(0, round2(total - paid));
  if (paid <= 0) return { paymentStatus: 'unpaid', remaining };
  if (remaining <= EPS) return { paymentStatus: 'paid', remaining: 0 };
  return { paymentStatus: 'partial', remaining };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function computeUsd(amountOriginal: number, exchangeRateToUsd: number): number {
  if (!Number.isFinite(amountOriginal) || !Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) return 0;
  return round2(amountOriginal / exchangeRateToUsd);
}

function computeUsd4(amountOriginal: number, exchangeRateToUsd: number): number {
  if (!Number.isFinite(amountOriginal) || !Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) return 0;
  return round4(amountOriginal / exchangeRateToUsd);
}

type SalesLineCostSnapshot = {
  costUnitPrice: number | null;
  costTotal: number | null;
  costCurrencyCode: string | null;
  costExchangeRateToUsd: number | null;
  costUnitPriceUsd: number | null;
  costTotalUsd: number | null;
  costSource: 'FABRIC_ROLL_AT_CONFIRMATION' | 'MISSING';
  costMissing: boolean;
};

async function buildSalesLineCostSnapshot(
  client: PoolClient,
  companyId: string,
  quantityMeters: number,
  unitCost: number | null,
  rollCurrencyCode: string | null,
  invoiceCurrencyCode: string,
  invoiceExchangeRateToUsd: number,
): Promise<SalesLineCostSnapshot> {
  const currencyCode = String(rollCurrencyCode || invoiceCurrencyCode || 'USD').trim().toUpperCase();
  if (unitCost == null || !Number.isFinite(unitCost) || unitCost <= 0) {
    return {
      costUnitPrice: null,
      costTotal: null,
      costCurrencyCode: currencyCode || null,
      costExchangeRateToUsd: null,
      costUnitPriceUsd: null,
      costTotalUsd: null,
      costSource: 'MISSING',
      costMissing: true,
    };
  }

  let exchangeRateToUsd = currencyCode === 'USD' ? 1 : NaN;
  if (currencyCode !== 'USD') {
    const fromDb = await getExchangeRateToUsdTx(client, companyId, currencyCode);
    exchangeRateToUsd =
      fromDb ??
      (currencyCode === invoiceCurrencyCode.trim().toUpperCase() && Number.isFinite(invoiceExchangeRateToUsd)
        ? invoiceExchangeRateToUsd
        : NaN);
  }

  const costTotal = round2(quantityMeters * unitCost);
  const hasUsdRate = Number.isFinite(exchangeRateToUsd) && exchangeRateToUsd > 0;
  return {
    costUnitPrice: round4(unitCost),
    costTotal,
    costCurrencyCode: currencyCode,
    costExchangeRateToUsd: hasUsdRate ? exchangeRateToUsd : null,
    costUnitPriceUsd: hasUsdRate ? computeUsd4(unitCost, exchangeRateToUsd) : null,
    costTotalUsd: hasUsdRate ? computeUsd(costTotal, exchangeRateToUsd) : null,
    costSource: 'FABRIC_ROLL_AT_CONFIRMATION',
    costMissing: !hasUsdRate,
  };
}

async function assertCustomer(client: PoolClient, companyId: string, customerId: string): Promise<{ name: string }> {
  const r = await client.query<{ name: string }>(
    `SELECT name FROM customers WHERE id=$1 AND company_id=$2`,
    [customerId, companyId],
  );
  if (!r.rows.length) {
    throw Object.assign(new Error('العميل غير موجود'), { code: 'NOT_FOUND' });
  }
  return r.rows[0];
}

async function insertLines(
  client: PoolClient,
  companyId: string,
  invoiceId: string,
  exchangeRateToUsd: number,
  lines: z.infer<typeof invoiceLineSchema>[],
): Promise<void> {
  let i = 0;
  for (const ln of lines) {
    i++;
    const unitPriceUsd = ln.unitPriceUsd ?? computeUsd4(ln.unitPrice, exchangeRateToUsd);
    const lineDiscountUsd = ln.lineDiscountUsd ?? computeUsd(ln.lineDiscount, exchangeRateToUsd);
    const lineTaxUsd = ln.lineTaxUsd ?? computeUsd(ln.lineTax, exchangeRateToUsd);
    const lineTotalUsd = ln.lineTotalUsd ?? computeUsd(ln.lineTotal, exchangeRateToUsd);
    await client.query(
      `INSERT INTO sales_invoice_lines (
         company_id, invoice_id, line_no, fabric_roll_id, fabric_item_id, variant_id, warehouse_id,
         description, quantity, unit, unit_price, line_discount, line_tax, line_total,
         unit_price_usd, line_discount_usd, line_tax_usd, line_total_usd, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)`,
      [
        companyId,
        invoiceId,
        i,
        ln.fabricRollId ?? null,
        ln.fabricItemId ?? null,
        ln.variantId ?? null,
        ln.warehouseId ?? null,
        ln.description ?? '',
        ln.quantity,
        ln.unit,
        ln.unitPrice,
        ln.lineDiscount,
        ln.lineTax,
        ln.lineTotal,
        unitPriceUsd,
        lineDiscountUsd,
        lineTaxUsd,
        lineTotalUsd,
        JSON.stringify(ln.metadata ?? {}),
      ],
    );
  }
}

export async function listSalesInvoices(
  db: DbQuery,
  companyId: string,
  opts: {
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    customerId?: string;
    documentStatus?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<{ rows: unknown[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const conds: string[] = ['si.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;

  if (opts.search?.trim()) {
    conds.push(`(si.invoice_no ILIKE $${p} OR c.name ILIKE $${p})`);
    params.push(`%${opts.search.trim()}%`);
    p++;
  }
  if (opts.dateFrom) {
    conds.push(`si.invoice_date >= $${p}::date`);
    params.push(opts.dateFrom);
    p++;
  }
  if (opts.dateTo) {
    conds.push(`si.invoice_date <= $${p}::date`);
    params.push(opts.dateTo);
    p++;
  }
  if (opts.customerId) {
    conds.push(`si.customer_id = $${p}::uuid`);
    params.push(opts.customerId);
    p++;
  }
  if (opts.documentStatus && ['DRAFT', 'CONFIRMED', 'VOIDED'].includes(opts.documentStatus)) {
    conds.push(`si.document_status = $${p}`);
    params.push(opts.documentStatus);
    p++;
  }

  const where = conds.join(' AND ');
  const [rows, countRow] = await Promise.all([
    db.query(
      `SELECT si.*, c.name AS customer_name
       FROM sales_invoices si
       INNER JOIN customers c ON c.id = si.customer_id AND c.company_id = si.company_id
       WHERE ${where}
       ORDER BY si.invoice_date DESC, si.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM sales_invoices si WHERE ${where}`, params),
  ]);

  return { rows: rows.rows, total: countRow.rows[0].total, page, pageSize };
}

export async function getSalesInvoiceById(
  db: DbQuery,
  companyId: string,
  id: string,
): Promise<{ header: Record<string, unknown>; lines: Record<string, unknown>[] } | null> {
  const h = await db.query(
    `SELECT si.*, c.name AS customer_name
     FROM sales_invoices si
     INNER JOIN customers c ON c.id = si.customer_id AND c.company_id = si.company_id
     WHERE si.id=$1 AND si.company_id=$2`,
    [id, companyId],
  );
  if (!h.rows.length) return null;
  const lines = await db.query(
    `SELECT * FROM sales_invoice_lines WHERE invoice_id=$1 AND company_id=$2 ORDER BY line_no`,
    [id, companyId],
  );
  return { header: h.rows[0] as Record<string, unknown>, lines: lines.rows as Record<string, unknown>[] };
}

export async function createSalesInvoice(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  raw: unknown,
): Promise<{ id: string; invoiceNo: string; documentStatus: string }> {
  const parsed = salesInvoiceCreateSchema.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error('بيانات الفاتورة غير صالحة'), { code: 'VALIDATION', details: parsed.error.flatten() });
  }
  const d = parsed.data;

  const currencyCode = String(d.currencyCode || 'USD').trim().toUpperCase();
  let exchangeRateToUsd = d.exchangeRateToUsd != null ? Number(d.exchangeRateToUsd) : NaN;
  if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
    if (currencyCode === 'USD') {
      exchangeRateToUsd = 1;
    } else {
      const fromDb = await getExchangeRateToUsdTx(client, companyId, currencyCode);
      exchangeRateToUsd = fromDb ?? NaN;
    }
  }
  if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
    throw Object.assign(new Error('لا يمكن تنفيذ العملية بدون سعر صرف'), { code: 'VALIDATION' });
  }
  if (currencyCode === 'USD') exchangeRateToUsd = 1;

  const subtotalUsd = computeUsd(d.subtotal, exchangeRateToUsd);
  const discountTotalUsd = computeUsd(d.discountTotal, exchangeRateToUsd);
  const taxTotalUsd = computeUsd(d.taxTotal, exchangeRateToUsd);
  const totalAmountUsd = computeUsd(d.totalAmount, exchangeRateToUsd);
  const paidAmountUsd = computeUsd(d.paidAmount, exchangeRateToUsd);

  const invoiceNo = await generateSequentialDocumentNo(client, companyId, 'SALES_INVOICE');
  const dup = await client.query(
    `SELECT id FROM sales_invoices WHERE company_id=$1 AND invoice_no=$2`,
    [companyId, invoiceNo],
  );
  if (dup.rows.length) {
    throw Object.assign(new Error('رقم فاتورة مبيعات مكرر'), { code: 'DUPLICATE' });
  }

  await assertCustomer(client, companyId, d.customerId);

  const pay = paymentStatuses(d.totalAmount, d.paidAmount);
  const remainingUsd = computeUsd(pay.remaining, exchangeRateToUsd);

  const ins = await client.query<{ id: string }>(
    `INSERT INTO sales_invoices (
       company_id, invoice_no, invoice_date, customer_id, warehouse_id, warehouse_label,
       currency_code, notes, subtotal, discount_total, tax_total, total_amount,
       paid_amount, remaining_amount, payment_status, document_status, delivery_status,
       exchange_rate_to_usd, subtotal_usd, discount_total_usd, tax_total_usd, total_amount_usd,
       paid_amount_usd, remaining_amount_usd,
       created_by_user_id, updated_by_user_id
     ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'DRAFT','IN_DELIVERY',$16,$17,$18,$19,$20,$21,$22,$23,$23)
     RETURNING id`,
    [
      companyId,
      invoiceNo,
      d.invoiceDate.slice(0, 10),
      d.customerId,
      d.warehouseId ?? null,
      d.warehouseLabel?.trim() || null,
      currencyCode,
      d.notes?.trim() || null,
      d.subtotal,
      d.discountTotal,
      d.taxTotal,
      d.totalAmount,
      d.paidAmount,
      pay.remaining,
      pay.paymentStatus,
      exchangeRateToUsd,
      subtotalUsd,
      discountTotalUsd,
      taxTotalUsd,
      totalAmountUsd,
      paidAmountUsd,
      remainingUsd,
      userId,
    ],
  );

  const invoiceId = ins.rows[0].id;
  const linesToSave = prepareSalesInvoiceLines(d.lines, d.discountTotal, d.subtotal, d.taxTotal, d.totalAmount);
  await insertLines(client, companyId, invoiceId, exchangeRateToUsd, linesToSave);

  if (d.confirm) {
    await confirmSalesInvoice(client, companyId, userId, invoiceId, {
      cashboxId: d.cashboxId ?? null,
      partyNameForVoucher: d.partyNameForVoucher?.trim() || null,
    });
  }

  const st = await client.query<{ document_status: string }>(
    `SELECT document_status FROM sales_invoices WHERE id=$1`,
    [invoiceId],
  );
  return { id: invoiceId, invoiceNo, documentStatus: st.rows[0].document_status };
}

export async function updateSalesInvoiceDraft(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  invoiceId: string,
  raw: unknown,
): Promise<void> {
  const parsed = salesInvoiceUpdateDraftSchema.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error('بيانات الفاتورة غير صالحة'), { code: 'VALIDATION', details: parsed.error.flatten() });
  }

  const cur = await client.query<{
    document_status: string;
    currency_code: string;
    exchange_rate_to_usd: string;
    subtotal: string;
    discount_total: string;
    tax_total: string;
    total_amount: string;
    paid_amount: string;
    remaining_amount: string;
  }>(
    `SELECT document_status, currency_code, exchange_rate_to_usd, subtotal, discount_total, tax_total, total_amount, paid_amount, remaining_amount
     FROM sales_invoices
     WHERE id=$1 AND company_id=$2
     FOR UPDATE`,
    [invoiceId, companyId],
  );
  if (!cur.rows.length) throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });
  if (cur.rows[0].document_status !== 'DRAFT') {
    throw Object.assign(new Error('لا يمكن تعديل فاتورة مؤكدة أو ملغاة'), { code: 'INVALID_STATE' });
  }

  const d = parsed.data as Partial<SalesInvoiceCreateInput> & { lines?: z.infer<typeof invoiceLineSchema>[] };
  if (d.customerId) await assertCustomer(client, companyId, d.customerId);

  if (d.invoiceNo?.trim()) {
    const dup = await client.query(
      `SELECT id FROM sales_invoices WHERE company_id=$1 AND invoice_no=$2 AND id <> $3::uuid`,
      [companyId, d.invoiceNo.trim(), invoiceId],
    );
    if (dup.rows.length) throw Object.assign(new Error('رقم فاتورة مكرر'), { code: 'DUPLICATE' });
  }

  const current = cur.rows[0];
  const nextCurrency = String(d.currencyCode ?? current.currency_code ?? 'USD').trim().toUpperCase();
  const nextSubtotal = d.subtotal ?? Number(current.subtotal);
  const nextDiscount = d.discountTotal ?? Number(current.discount_total);
  const nextTax = d.taxTotal ?? Number(current.tax_total);
  const nextTotal = d.totalAmount ?? Number(current.total_amount);
  const nextPaid = d.paidAmount ?? Number(current.paid_amount);
  const pay = paymentStatuses(nextTotal, nextPaid);

  let nextRate = d.exchangeRateToUsd != null ? Number(d.exchangeRateToUsd) : Number(current.exchange_rate_to_usd);
  if (!Number.isFinite(nextRate) || nextRate <= 0) {
    if (nextCurrency === 'USD') {
      nextRate = 1;
    } else {
      const fromDb = await getExchangeRateToUsdTx(client, companyId, nextCurrency);
      nextRate = fromDb ?? NaN;
    }
  }
  if (!Number.isFinite(nextRate) || nextRate <= 0) {
    throw Object.assign(new Error('لا يمكن تنفيذ العملية بدون سعر صرف'), { code: 'VALIDATION' });
  }
  if (nextCurrency === 'USD') nextRate = 1;

  const subtotalUsd = computeUsd(nextSubtotal, nextRate);
  const discountUsd = computeUsd(nextDiscount, nextRate);
  const taxUsd = computeUsd(nextTax, nextRate);
  const totalUsd = computeUsd(nextTotal, nextRate);
  const paidUsd = computeUsd(nextPaid, nextRate);
  const remainingUsd = computeUsd(pay.remaining, nextRate);

  await client.query(
    `UPDATE sales_invoices SET
       invoice_no = COALESCE($4, invoice_no),
       invoice_date = COALESCE($5::date, invoice_date),
       customer_id = COALESCE($6, customer_id),
       warehouse_id = COALESCE($7, warehouse_id),
       warehouse_label = COALESCE($8, warehouse_label),
       currency_code = $9,
       exchange_rate_to_usd = $10,
       notes = COALESCE($11, notes),
       subtotal = COALESCE($12, subtotal),
       discount_total = COALESCE($13, discount_total),
       tax_total = COALESCE($14, tax_total),
       total_amount = COALESCE($15, total_amount),
       paid_amount = COALESCE($16, paid_amount),
       remaining_amount = COALESCE($17, remaining_amount),
       payment_status = $18,
       subtotal_usd = $19,
       discount_total_usd = $20,
       tax_total_usd = $21,
       total_amount_usd = $22,
       paid_amount_usd = $23,
       remaining_amount_usd = $24,
       delivery_status = CASE WHEN delivery_status = 'FULFILLED' THEN delivery_status ELSE 'IN_DELIVERY' END,
       updated_by_user_id = $3,
       updated_at = now()
     WHERE id=$1 AND company_id=$2`,
    [
      invoiceId,
      companyId,
      userId,
      d.invoiceNo?.trim() ?? null,
      d.invoiceDate?.slice(0, 10) ?? null,
      d.customerId ?? null,
      d.warehouseId ?? null,
      d.warehouseLabel?.trim() ?? null,
      nextCurrency,
      nextRate,
      d.notes?.trim() ?? null,
      d.subtotal ?? null,
      d.discountTotal ?? null,
      d.taxTotal ?? null,
      d.totalAmount ?? null,
      d.paidAmount ?? null,
      pay.remaining,
      pay.paymentStatus,
      subtotalUsd,
      discountUsd,
      taxUsd,
      totalUsd,
      paidUsd,
      remainingUsd,
    ],
  );

  if (d.lines && d.lines.length > 0) {
    const linesToSave = prepareSalesInvoiceLines(
      d.lines,
      nextDiscount,
      nextSubtotal,
      nextTax,
      nextTotal,
    );
    await client.query(`DELETE FROM sales_invoice_lines WHERE invoice_id=$1 AND company_id=$2`, [invoiceId, companyId]);
    await insertLines(client, companyId, invoiceId, nextRate, linesToSave);
  }
}

export async function deleteSalesInvoiceDraft(client: PoolClient, companyId: string, invoiceId: string): Promise<void> {
  const cur = await client.query<{ document_status: string }>(
    `SELECT document_status FROM sales_invoices WHERE id=$1 AND company_id=$2`,
    [invoiceId, companyId],
  );
  if (!cur.rows.length) throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });
  if (cur.rows[0].document_status !== 'DRAFT') {
    throw Object.assign(new Error('لا يمكن حذف فاتورة مؤكدة. استخدم الإلغاء.'), { code: 'INVALID_STATE' });
  }
  await client.query(`DELETE FROM sales_invoices WHERE id=$1 AND company_id=$2`, [invoiceId, companyId]);
}

export async function confirmSalesInvoice(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  invoiceId: string,
  opts: { cashboxId?: string | null; partyNameForVoucher?: string | null } = {},
): Promise<void> {
  const invRow = await client.query(
    `SELECT * FROM sales_invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [invoiceId, companyId],
  );
  if (!invRow.rows.length) throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });
  const inv = invRow.rows[0];
  if (inv.document_status !== 'DRAFT') {
    throw Object.assign(new Error('الفاتورة مؤكدة مسبقاً'), { code: 'INVALID_STATE' });
  }

  const ccy = String(inv.currency_code || 'USD');
  const rate = Number(inv.exchange_rate_to_usd) > 0 ? Number(inv.exchange_rate_to_usd) : (ccy.trim().toUpperCase() === 'USD' ? 1 : NaN);
  const exchangeRateToUsd = ccy.trim().toUpperCase() === 'USD' ? 1 : rate;
  if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
    throw Object.assign(new Error('ظ„ط§ ظٹظ…ظƒظ† طھط£ظƒظٹط¯ ط§ظ„ظپط§طھظˆط±ط© ط¨ط¯ظˆظ† ط³ط¹ط± طµط±ظپ'), { code: 'VALIDATION' });
  }

  const lines = await client.query(
    `SELECT * FROM sales_invoice_lines WHERE invoice_id=$1 AND company_id=$2 ORDER BY line_no`,
    [invoiceId, companyId],
  );

  const linesForCogs: { quantityMeters: number; unitCostPerMeter: number | null }[] = [];

  /** Obada جملة: خصم المخزون عند التسليم والتفنيد وليس عند تأكيد الفاتورة */
  const deferStockToDelivery = true;

  if (!deferStockToDelivery) for (const ln of lines.rows) {
    const rollId = ln.fabric_roll_id as string | null;
    if (!rollId) continue;

    const rollRow = await client.query<{
      id: string;
      length_m: string;
      status: string;
      unit_cost: string | null;
      currency_code: string | null;
    }>(`SELECT id, length_m, status, unit_cost, currency_code FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`, [
      rollId,
      companyId,
    ]);
    if (!rollRow.rows.length) {
      throw Object.assign(new Error('الثوب غير موجود'), { code: 'NOT_FOUND' });
    }
    const roll = rollRow.rows[0];
    if (roll.status !== 'AVAILABLE') {
      throw Object.assign(new Error(`الثوب ${rollId} غير متاح للبيع`), { code: 'INVALID_STOCK' });
    }

    const qtyM = quantityToMeters(Number(ln.quantity), ln.unit as 'meter' | 'yard');
    const len = Number(roll.length_m);
    if (qtyM > len + EPS) {
      throw Object.assign(new Error('الكمية المباعة أكبر من رصيد المتر على الثوب'), { code: 'INVALID_STOCK' });
    }

    const uc = roll.unit_cost != null ? Number(roll.unit_cost) : null;
    const costSnapshot = await buildSalesLineCostSnapshot(
      client,
      companyId,
      qtyM,
      uc,
      roll.currency_code,
      ccy,
      exchangeRateToUsd,
    );
    linesForCogs.push({ quantityMeters: qtyM, unitCostPerMeter: costSnapshot.costUnitPriceUsd ?? uc });

    const soldQty = Math.min(qtyM, len);
    const newLen = round2(len - soldQty);
    const fullSale = newLen <= EPS;

    let meta: Record<string, unknown> = {};
    try {
      meta =
        typeof ln.metadata === 'string'
          ? JSON.parse(ln.metadata) as Record<string, unknown>
          : (ln.metadata as Record<string, unknown>) ?? {};
    } catch {
      meta = {};
    }
    meta.inventory = {
      fabric_roll_id: rollId,
      prev_length_m: len,
      prev_status: roll.status,
      qty_sold_m: soldQty,
      final_length_m: fullSale ? 0 : newLen,
      final_status: fullSale ? 'SOLD' : 'AVAILABLE',
    };

    if (fullSale) {
      await client.query(
        `UPDATE fabric_rolls SET length_m=0, status='SOLD', updated_at=now() WHERE id=$1 AND company_id=$2`,
        [rollId, companyId],
      );
      await client.query(
        `INSERT INTO inventory_movements (
           company_id, roll_id, movement_type, old_status, new_status,
           length_delta_m, reference_type, reference_id, reference_no, notes, created_by_user_id
         ) VALUES ($1,$2,'SALE',$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          companyId,
          rollId,
          roll.status,
          'SOLD',
          -len,
          'SALES_INVOICE',
          invoiceId,
          inv.invoice_no,
          `بيع — ${inv.invoice_no}`,
          userId,
        ],
      );
    } else {
      await client.query(
        `UPDATE fabric_rolls SET length_m=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
        [rollId, companyId, newLen],
      );
      await client.query(
        `INSERT INTO inventory_movements (
           company_id, roll_id, movement_type, old_status, new_status,
           length_delta_m, reference_type, reference_id, reference_no, notes, created_by_user_id
         ) VALUES ($1,$2,'SALE',$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          companyId,
          rollId,
          roll.status,
          'AVAILABLE',
          -soldQty,
          'SALES_INVOICE',
          invoiceId,
          inv.invoice_no,
          `بيع جزئي — ${inv.invoice_no}`,
          userId,
        ],
      );
    }

    await client.query(
      `UPDATE sales_invoice_lines SET
         metadata=$3::jsonb,
         cost_unit_price=$4,
         cost_total=$5,
         cost_currency_code=$6,
         cost_exchange_rate_to_usd=$7,
         cost_unit_price_usd=$8,
         cost_total_usd=$9,
         cost_source=$10,
         cost_snapshot_at=now(),
         cost_missing=$11
       WHERE id=$1 AND company_id=$2`,
      [
        ln.id,
        companyId,
        JSON.stringify(meta),
        costSnapshot.costUnitPrice,
        costSnapshot.costTotal,
        costSnapshot.costCurrencyCode,
        costSnapshot.costExchangeRateToUsd,
        costSnapshot.costUnitPriceUsd,
        costSnapshot.costTotalUsd,
        costSnapshot.costSource,
        costSnapshot.costMissing,
      ],
    );
  }

  const totalAmt = Number(inv.total_amount);
  const paidAmt = Number(inv.paid_amount);
  if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
    throw Object.assign(new Error('لا يمكن تأكيد الفاتورة بدون سعر صرف'), { code: 'VALIDATION' });
  }
  const entryDate = inv.invoice_date instanceof Date ? inv.invoice_date.toISOString().slice(0, 10) : String(inv.invoice_date).slice(0, 10);
  const totalUsd = Number(inv.total_amount_usd ?? 0) || computeUsd(totalAmt, exchangeRateToUsd);
  const paidUsd = Number(inv.paid_amount_usd ?? 0) || computeUsd(paidAmt, exchangeRateToUsd);

  if (totalAmt > 0) {
    await postSalesInvoiceToGl(client, {
      companyId,
      salesInvoiceId: invoiceId,
      invoiceNo: String(inv.invoice_no),
      invoiceDate: entryDate,
      customerId: String(inv.customer_id),
      totalAmountUsd: totalUsd,
      currencyCode: ccy,
      userId,
      linesForCogs,
    });
  }

  let voucherIdOut: string | null = null;
  if (paidAmt > EPS) {
    const cashboxId = opts.cashboxId ?? null;
    if (!cashboxId) {
      throw Object.assign(new Error('دفعة تتطلب اختيار صندوق'), { code: 'VALIDATION' });
    }
    const cust = await assertCustomer(client, companyId, String(inv.customer_id));
    const partyName = opts.partyNameForVoucher?.trim() || cust.name;
    const vd = await insertDraftVoucher(client, {
      companyId,
      userId,
      voucherType: 'RECEIPT',
      voucherDate: entryDate,
      cashboxId,
      partyType: 'CUSTOMER',
      partyId: String(inv.customer_id),
      partyName,
      amount: paidAmt,
      currencyCode: ccy,
      exchangeRateToUsd,
      amountUsd: paidUsd,
      description: `قبض — فاتورة مبيعات ${inv.invoice_no}`,
      notes: `مرتبطة بفاتورة ${invoiceId}`,
      referenceDocumentType: 'SALE_INVOICE',
      referenceDocumentNo: String(inv.invoice_no),
    });

    await applyVoucherConfirmation(client, {
      companyId,
      voucherId: vd.id,
      voucherNo: vd.voucherNo,
      voucherDate: entryDate,
      voucherType: 'RECEIPT',
      amount: paidAmt,
      currencyCode: ccy,
      exchangeRateToUsd,
      amountUsd: paidUsd,
      cashboxId,
      partyType: 'CUSTOMER',
      partyId: String(inv.customer_id),
      partyName,
      description: `قبض — فاتورة مبيعات ${inv.invoice_no}`,
      userId,
    });

    await client.query(
      `UPDATE vouchers SET status='CONFIRMED', confirmed_at=now(), updated_at=now() WHERE id=$1 AND company_id=$2`,
      [vd.id, companyId],
    );
    voucherIdOut = vd.id;
  }

  const pay = paymentStatuses(totalAmt, paidAmt);
  const remainingUsd = computeUsd(pay.remaining, exchangeRateToUsd);
  await client.query(
    `UPDATE sales_invoices SET
       document_status='CONFIRMED',
       delivery_status=COALESCE(delivery_status, 'IN_DELIVERY'),
       confirmed_at=now(),
       remaining_amount=$3,
       payment_status=$4,
       remaining_amount_usd=$7,
       total_amount_usd=COALESCE(NULLIF(total_amount_usd, 0), $8),
       paid_amount_usd=COALESCE(NULLIF(paid_amount_usd, 0), $9),
       payment_voucher_id=COALESCE($5, payment_voucher_id),
       updated_by_user_id=$6,
       updated_at=now()
     WHERE id=$1 AND company_id=$2`,
    [invoiceId, companyId, pay.remaining, pay.paymentStatus, voucherIdOut, userId, remainingUsd, totalUsd, paidUsd],
  );
}

type VoucherReceiptRef = {
  voucherType: string;
  amount: number;
  referenceDocumentType: string | null;
  referenceDocumentNo: string | null;
  partyType: string | null;
  partyId: string | null;
};

export async function validateSaleInvoiceReceiptVoucher(
  client: PoolClient,
  companyId: string,
  voucher: VoucherReceiptRef,
): Promise<void> {
  if (voucher.voucherType !== 'RECEIPT') return;
  const refType = String(voucher.referenceDocumentType ?? '').trim();
  const refNo = String(voucher.referenceDocumentNo ?? '').trim();
  if (refType !== 'SALE_INVOICE' || !refNo) return;

  const inv = await client.query<{
    document_status: string;
    remaining_amount: string;
    payment_status: string;
    customer_id: string;
  }>(
    `SELECT document_status, remaining_amount, payment_status, customer_id
     FROM sales_invoices
     WHERE company_id=$1 AND invoice_no=$2
     FOR UPDATE`,
    [companyId, refNo],
  );
  if (!inv.rows.length) {
    throw Object.assign(new Error('فاتورة المبيعات المرجعية غير موجودة'), { code: 'VALIDATION' });
  }
  const row = inv.rows[0];
  if (row.document_status !== 'CONFIRMED') {
    throw Object.assign(new Error('يمكن ربط سند القبض بفاتورة مبيعات مؤكدة فقط'), { code: 'VALIDATION' });
  }
  if (voucher.partyType === 'CUSTOMER' && voucher.partyId && row.customer_id !== voucher.partyId) {
    throw Object.assign(new Error('العميل لا يطابق فاتورة المبيعات'), { code: 'VALIDATION' });
  }
  const remaining = Number(row.remaining_amount);
  if (remaining <= EPS) {
    throw Object.assign(new Error('الفاتورة مدفوعة بالكامل ولا يمكن قبض مبلغ إضافي'), { code: 'VALIDATION' });
  }
  const amt = Number(voucher.amount);
  if (amt > remaining + EPS) {
    throw Object.assign(new Error('مبلغ السند يتجاوز المتبقي على الفاتورة'), { code: 'VALIDATION' });
  }
}

export async function applySaleInvoiceReceiptOnVoucherConfirm(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  voucher: VoucherReceiptRef & { voucherId: string; exchangeRateToUsd: number },
): Promise<void> {
  if (voucher.voucherType !== 'RECEIPT') return;
  const refType = String(voucher.referenceDocumentType ?? '').trim();
  const refNo = String(voucher.referenceDocumentNo ?? '').trim();
  if (refType !== 'SALE_INVOICE' || !refNo) return;

  const inv = await client.query<{
    id: string;
    total_amount: string;
    paid_amount: string;
    remaining_amount: string;
    exchange_rate_to_usd: string;
  }>(
    `SELECT id, total_amount, paid_amount, remaining_amount, exchange_rate_to_usd
     FROM sales_invoices
     WHERE company_id=$1 AND invoice_no=$2 AND document_status='CONFIRMED'
     FOR UPDATE`,
    [companyId, refNo],
  );
  if (!inv.rows.length) return;

  const row = inv.rows[0];
  const totalAmt = Number(row.total_amount);
  const paidAmt = Number(row.paid_amount);
  const remaining = Number(row.remaining_amount);
  const applyAmt = Math.min(Number(voucher.amount), Math.max(0, remaining));
  if (applyAmt <= EPS) return;

  const rate =
    Number(voucher.exchangeRateToUsd) > 0
      ? Number(voucher.exchangeRateToUsd)
      : Number(row.exchange_rate_to_usd) > 0
        ? Number(row.exchange_rate_to_usd)
        : 1;
  const newPaid = round2(paidAmt + applyAmt);
  const pay = paymentStatuses(totalAmt, newPaid);
  const paidUsd = computeUsd(newPaid, rate);
  const remainingUsd = computeUsd(pay.remaining, rate);

  await client.query(
    `UPDATE sales_invoices SET
       paid_amount=$3,
       remaining_amount=$4,
       payment_status=$5,
       paid_amount_usd=$6,
       remaining_amount_usd=$7,
       payment_voucher_id=COALESCE(payment_voucher_id, $8),
       updated_by_user_id=$9,
       updated_at=now()
     WHERE id=$1 AND company_id=$2`,
    [row.id, companyId, newPaid, pay.remaining, pay.paymentStatus, paidUsd, remainingUsd, voucher.voucherId, userId],
  );
}

export async function voidSalesInvoice(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  invoiceId: string,
): Promise<void> {
  const invRow = await client.query(
    `SELECT * FROM sales_invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [invoiceId, companyId],
  );
  if (!invRow.rows.length) throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });
  const inv = invRow.rows[0];
  if (inv.document_status !== 'CONFIRMED') {
    throw Object.assign(new Error('يمكن إلغاء الفواتير المؤكدة فقط'), { code: 'INVALID_STATE' });
  }

  const lines = await client.query(`SELECT * FROM sales_invoice_lines WHERE invoice_id=$1 AND company_id=$2`, [
    invoiceId,
    companyId,
  ]);

  for (const ln of lines.rows) {
    let meta: Record<string, unknown> = {};
    try {
      meta =
        typeof ln.metadata === 'string'
          ? JSON.parse(ln.metadata) as Record<string, unknown>
          : (ln.metadata as Record<string, unknown>) ?? {};
    } catch {
      meta = {};
    }
    const snap = meta.inventory as
      | {
          fabric_roll_id?: string;
          prev_length_m?: number;
          prev_status?: string;
          qty_sold_m?: number;
        }
      | undefined;
    if (!snap?.fabric_roll_id) continue;

    const rollId = snap.fabric_roll_id;
    const r = await client.query<{ length_m: string; status: string }>(
      `SELECT length_m, status FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`,
      [rollId, companyId],
    );
    if (!r.rows.length) continue;

    const prevLen = snap.prev_length_m ?? 0;
    const prevSt = snap.prev_status ?? 'AVAILABLE';
    const qtySold = snap.qty_sold_m ?? 0;

    await client.query(
      `UPDATE fabric_rolls SET length_m=$3, status=$4, updated_at=now() WHERE id=$1 AND company_id=$2`,
      [rollId, companyId, prevLen, prevSt],
    );
    await client.query(
      `INSERT INTO inventory_movements (
         company_id, roll_id, movement_type, old_status, new_status,
         length_delta_m, reference_type, reference_id, reference_no, notes, created_by_user_id
       ) VALUES ($1,$2,'RETURN',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        companyId,
        rollId,
        r.rows[0].status,
        prevSt,
        qtySold,
        'SALES_INVOICE_VOID',
        invoiceId,
        inv.invoice_no,
        `عكس فاتورة — ${inv.invoice_no}`,
        userId,
      ],
    );
  }

  await reverseSalesInvoiceGl(client, {
    companyId,
    salesInvoiceId: invoiceId,
    invoiceNo: String(inv.invoice_no),
    userId,
  });

  const paymentVoucherId = inv.payment_voucher_id as string | null;
  if (paymentVoucherId) {
    await cancelConfirmedVoucher(client, {
      companyId,
      voucherId: paymentVoucherId,
      userId,
    });
  }

  await client.query(
    `UPDATE sales_invoices SET document_status='VOIDED', voided_at=now(), updated_by_user_id=$3, updated_at=now()
     WHERE id=$1 AND company_id=$2`,
    [invoiceId, companyId, userId],
  );
}
