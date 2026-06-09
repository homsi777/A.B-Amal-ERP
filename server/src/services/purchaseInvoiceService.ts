import type { PoolClient } from 'pg';
import { z } from 'zod';
import { postPurchaseInvoiceToGl, reversePurchaseInvoiceGl } from './glPostingService.js';
import { applyVoucherConfirmation, cancelConfirmedVoucher, insertDraftVoucher } from './voucherCashboxService.js';
import { invoiceLineSchema, paymentStatuses, quantityToMeters } from './salesInvoiceService.js';
import { getExchangeRateToUsdTx } from './exchangeRateService.js';
import { calcWeight, generateBarcode } from '../utils/rollHelpers.js';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';
import {
  allocateHeaderDiscountToLines,
  computePaymentApplication,
  INVOICE_AMOUNT_EPS,
  validateInvoiceLineAmounts,
} from './invoiceAmountHelpers.js';

type DbQuery = Pick<PoolClient, 'query'>;

const EPS = INVOICE_AMOUNT_EPS;

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

function cleanText(v: unknown): string {
  return String(v ?? '').trim();
}

function cleanNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function slugCode(v: string): string {
  const s = v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (s) return s.slice(0, 32);
  let hash = 2166136261;
  for (let i = 0; i < v.length; i++) {
    hash ^= v.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `x${Math.abs(hash >>> 0).toString(16)}`;
}

async function findOrCreateFabricItem(
  client: PoolClient,
  companyId: string,
  materialName: string,
  designCode: string,
): Promise<string> {
  const byCode = designCode
    ? await client.query<{ id: string }>(
        `SELECT id FROM fabric_items
         WHERE company_id=$1 AND lower(trim(internal_code))=lower(trim($2))
         LIMIT 1`,
        [companyId, designCode],
      )
    : { rows: [] as { id: string }[] };
  if (byCode.rows.length) return byCode.rows[0].id;

  const byName = materialName
    ? await client.query<{ id: string }>(
        `SELECT id FROM fabric_items
         WHERE company_id=$1 AND lower(trim(name))=lower(trim($2))
         LIMIT 1`,
        [companyId, materialName],
      )
    : { rows: [] as { id: string }[] };
  if (byName.rows.length) return byName.rows[0].id;

  const internalCode = designCode || `AUTO-${slugCode(materialName || 'ITEM')}`;
  try {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO fabric_items (company_id, name, internal_code, supplier_code, is_active)
       VALUES ($1,$2,$3,$4,true)
       RETURNING id`,
      [companyId, materialName || internalCode, internalCode, null],
    );
    return ins.rows[0].id;
  } catch (e: unknown) {
    if ((e as { code?: string }).code !== '23505') throw e;
    const again = await client.query<{ id: string }>(
      `SELECT id FROM fabric_items
       WHERE company_id=$1 AND lower(trim(internal_code))=lower(trim($2))
       LIMIT 1`,
      [companyId, internalCode],
    );
    if (!again.rows.length) throw e;
    return again.rows[0].id;
  }
}

async function findOrCreateColor(
  client: PoolClient,
  companyId: string,
  colorName: string,
  colorCode: string,
): Promise<string | null> {
  if (!colorName && !colorCode) return null;
  const byColorCode = colorCode
    ? await client.query<{ id: string }>(
        `SELECT id FROM fabric_colors
         WHERE (company_id=$1 OR company_id IS NULL) AND lower(trim(color_code))=lower(trim($2))
         LIMIT 1`,
        [companyId, colorCode],
      )
    : { rows: [] as { id: string }[] };
  if (byColorCode.rows.length) return byColorCode.rows[0].id;

  const byName = colorName
    ? await client.query<{ id: string }>(
        `SELECT id FROM fabric_colors
         WHERE (company_id=$1 OR company_id IS NULL) AND lower(trim(name_ar))=lower(trim($2))
         LIMIT 1`,
        [companyId, colorName],
      )
    : { rows: [] as { id: string }[] };
  if (byName.rows.length) return byName.rows[0].id;

  const ins = await client.query<{ id: string }>(
    `INSERT INTO fabric_colors (company_id, name_ar, name_tr, color_code, supplier_color_code, is_active)
     VALUES ($1,$2,$3,$4,$5,true)
     RETURNING id`,
    [companyId, colorName || colorCode || 'لون', '', colorCode || colorName || null, null],
  );
  return ins.rows[0].id;
}

async function ensureCategoryNode(
  client: PoolClient,
  companyId: string,
  parentId: string | null,
  code: string,
  name: string,
  level: number,
): Promise<string> {
  const byCode = await client.query<{ id: string; parent_id: string | null }>(
    `SELECT id, parent_id FROM fabric_categories
     WHERE company_id=$1 AND lower(trim(code))=lower(trim($2))
     LIMIT 1`,
    [companyId, code],
  );
  if (byCode.rows.length) return byCode.rows[0].id;

  try {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO fabric_categories (company_id, parent_id, code, name, is_active)
       VALUES ($1,$2,$3,$4,true)
       RETURNING id`,
      [companyId, parentId, code, name],
    );
    return ins.rows[0].id;
  } catch (e: unknown) {
    if ((e as { code?: string }).code !== '23505') throw e;
    const again = await client.query<{ id: string }>(
      `SELECT id FROM fabric_categories
       WHERE company_id=$1 AND lower(trim(code))=lower(trim($2))
       LIMIT 1`,
      [companyId, code],
    );
    if (!again.rows.length) throw e;
    return again.rows[0].id;
  }
}

async function ensureFabricCategoryChain(
  client: PoolClient,
  companyId: string,
  materialName: string,
  designCode: string,
  colorName: string,
  colorCode: string,
): Promise<void> {
  const mName = materialName || 'خامة غير محددة';
  const dCode = designCode || mName;
  const cName = colorName || 'لون غير محدد';
  const cCode = colorCode || cName;

  const l1 = await ensureCategoryNode(client, companyId, null, `L1_${slugCode(mName)}`, mName, 1);
  const l2 = await ensureCategoryNode(client, companyId, l1, `L2_${slugCode(dCode)}`, dCode, 2);
  const l3 = await ensureCategoryNode(client, companyId, l2, `L3_${slugCode(cName)}`, cName, 3);
  await ensureCategoryNode(client, companyId, l3, `L4_${slugCode(cCode)}`, cCode, 4);
}

async function resolveWarehouseForPurchaseInvoice(
  client: PoolClient,
  companyId: string,
  preferredWarehouseId: string | null,
): Promise<string> {
  if (preferredWarehouseId) {
    const ch = await client.query<{ id: string }>(
      `SELECT id FROM warehouses WHERE id=$1 AND company_id=$2 LIMIT 1`,
      [preferredWarehouseId, companyId],
    );
    if (ch.rows.length) return ch.rows[0].id;
  }
  const fallback = await client.query<{ id: string }>(
    `SELECT id FROM warehouses
     WHERE company_id=$1
     ORDER BY created_at ASC
     LIMIT 1`,
    [companyId],
  );
  if (!fallback.rows.length) {
    throw Object.assign(new Error('لا يمكن ترحيل خامات الفاتورة للمخزون بدون مستودع واحد على الأقل'), { code: 'VALIDATION' });
  }
  return fallback.rows[0].id;
}

const purchaseInvoiceCreateBaseSchema = z.object({
  invoiceNo: z.string().min(1),
  supplierInvoiceNo: z.string().optional().nullable(),
  invoiceDate: z.string().min(1),
  supplierId: z.string().uuid(),
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

export const purchaseInvoiceCreateSchema = purchaseInvoiceCreateBaseSchema.refine(
  (d) => Math.abs(d.subtotal - d.discountTotal + d.taxTotal - d.totalAmount) <= EPS,
  { message: 'إجمالي الفاتورة لا يطابق (المجموع − الخصم + الضريبة)', path: ['totalAmount'] },
);

export const purchaseInvoiceUpdateDraftSchema = purchaseInvoiceCreateBaseSchema
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

export type PurchaseInvoiceCreateInput = z.infer<typeof purchaseInvoiceCreateSchema>;

function preparePurchaseInvoiceLines(
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

async function assertSupplier(client: PoolClient, companyId: string, supplierId: string): Promise<{ name: string }> {
  const r = await client.query<{ name: string }>(
    `SELECT name FROM suppliers WHERE id=$1 AND company_id=$2`,
    [supplierId, companyId],
  );
  if (!r.rows.length) {
    throw Object.assign(new Error('المورد غير موجود'), { code: 'NOT_FOUND' });
  }
  return r.rows[0];
}

async function insertPurchaseLines(
  client: PoolClient,
  companyId: string,
  invoiceId: string,
  exchangeRateToUsd: number,
  lines: z.infer<typeof invoiceLineSchema>[],
): Promise<void> {
  let i = 0;
  for (const ln of lines) {
    i++;
    const unitCostUsd = (ln as any).unitPriceUsd ?? computeUsd4(ln.unitPrice, exchangeRateToUsd);
    const lineDiscountUsd = (ln as any).lineDiscountUsd ?? computeUsd(ln.lineDiscount, exchangeRateToUsd);
    const lineTaxUsd = (ln as any).lineTaxUsd ?? computeUsd(ln.lineTax, exchangeRateToUsd);
    const lineTotalUsd = (ln as any).lineTotalUsd ?? computeUsd(ln.lineTotal, exchangeRateToUsd);
    await client.query(
      `INSERT INTO purchase_invoice_lines (
         company_id, invoice_id, line_no, fabric_roll_id, fabric_item_id, variant_id, warehouse_id,
         description, quantity, unit, unit_cost, line_discount, line_tax, line_total,
         unit_cost_usd, line_discount_usd, line_tax_usd, line_total_usd, metadata
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
        unitCostUsd,
        lineDiscountUsd,
        lineTaxUsd,
        lineTotalUsd,
        JSON.stringify(ln.metadata ?? {}),
      ],
    );
  }
}

export async function listPurchaseInvoices(
  db: DbQuery,
  companyId: string,
  opts: {
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    supplierId?: string;
    documentStatus?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<{ rows: unknown[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const conds: string[] = ['pi.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;

  if (opts.search?.trim()) {
    conds.push(`(pi.invoice_no ILIKE $${p} OR s.name ILIKE $${p})`);
    params.push(`%${opts.search.trim()}%`);
    p++;
  }
  if (opts.dateFrom) {
    conds.push(`pi.invoice_date >= $${p}::date`);
    params.push(opts.dateFrom);
    p++;
  }
  if (opts.dateTo) {
    conds.push(`pi.invoice_date <= $${p}::date`);
    params.push(opts.dateTo);
    p++;
  }
  if (opts.supplierId) {
    conds.push(`pi.supplier_id = $${p}::uuid`);
    params.push(opts.supplierId);
    p++;
  }
  if (opts.documentStatus && ['DRAFT', 'CONFIRMED', 'VOIDED'].includes(opts.documentStatus)) {
    conds.push(`pi.document_status = $${p}`);
    params.push(opts.documentStatus);
    p++;
  }

  const where = conds.join(' AND ');
  const [rows, countRow] = await Promise.all([
    db.query(
      `SELECT pi.*, s.name AS supplier_name
       FROM purchase_invoices pi
       INNER JOIN suppliers s ON s.id = pi.supplier_id AND s.company_id = pi.company_id
       WHERE ${where}
       ORDER BY pi.invoice_date DESC, pi.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM purchase_invoices pi WHERE ${where}`, params),
  ]);

  return { rows: rows.rows, total: countRow.rows[0].total, page, pageSize };
}

export async function getPurchaseInvoiceById(
  db: DbQuery,
  companyId: string,
  id: string,
): Promise<{ header: Record<string, unknown>; lines: Record<string, unknown>[] } | null> {
  const h = await db.query(
    `SELECT pi.*, s.name AS supplier_name
     FROM purchase_invoices pi
     INNER JOIN suppliers s ON s.id = pi.supplier_id AND s.company_id = pi.company_id
     WHERE pi.id=$1 AND pi.company_id=$2`,
    [id, companyId],
  );
  if (!h.rows.length) return null;
  const lines = await db.query(
    `SELECT * FROM purchase_invoice_lines WHERE invoice_id=$1 AND company_id=$2 ORDER BY line_no`,
    [id, companyId],
  );
  return { header: h.rows[0] as Record<string, unknown>, lines: lines.rows as Record<string, unknown>[] };
}

export async function createPurchaseInvoice(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  raw: unknown,
): Promise<{ id: string; invoiceNo: string; documentStatus: string }> {
  const parsed = purchaseInvoiceCreateSchema.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error('بيانات فاتورة الشراء غير صالحة'), { code: 'VALIDATION', details: parsed.error.flatten() });
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

  const invoiceNo = await generateSequentialDocumentNo(client, companyId, 'PURCHASE_INVOICE');
  const dup = await client.query(`SELECT id FROM purchase_invoices WHERE company_id=$1 AND invoice_no=$2`, [
    companyId,
    invoiceNo,
  ]);
  if (dup.rows.length) throw Object.assign(new Error('رقم فاتورة مشتريات مكرر'), { code: 'DUPLICATE' });

  await assertSupplier(client, companyId, d.supplierId);

  const pay = paymentStatuses(d.totalAmount, d.paidAmount);
  const subtotalUsd = computeUsd(d.subtotal, exchangeRateToUsd);
  const discountTotalUsd = computeUsd(d.discountTotal, exchangeRateToUsd);
  const taxTotalUsd = computeUsd(d.taxTotal, exchangeRateToUsd);
  const totalAmountUsd = computeUsd(d.totalAmount, exchangeRateToUsd);
  const paidAmountUsd = computeUsd(d.paidAmount, exchangeRateToUsd);
  const remainingUsd = computeUsd(pay.remaining, exchangeRateToUsd);

  const ins = await client.query<{ id: string }>(
    `INSERT INTO purchase_invoices (
       company_id, invoice_no, supplier_invoice_no, invoice_date, supplier_id, warehouse_id, warehouse_label,
       currency_code, notes, subtotal, discount_total, tax_total, total_amount,
       paid_amount, remaining_amount, payment_status, document_status,
       exchange_rate_to_usd, subtotal_usd, discount_total_usd, tax_total_usd, total_amount_usd,
       paid_amount_usd, remaining_amount_usd,
       created_by_user_id, updated_by_user_id
     ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'DRAFT',$17,$18,$19,$20,$21,$22,$23,$24,$24)
     RETURNING id`,
    [
      companyId,
      invoiceNo,
      d.supplierInvoiceNo?.trim() || null,
      d.invoiceDate.slice(0, 10),
      d.supplierId,
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
  const linesToSave = preparePurchaseInvoiceLines(d.lines, d.discountTotal, d.subtotal, d.taxTotal, d.totalAmount);
  await insertPurchaseLines(client, companyId, invoiceId, exchangeRateToUsd, linesToSave);

  if (d.confirm) {
    await confirmPurchaseInvoice(client, companyId, userId, invoiceId, {
      cashboxId: d.cashboxId ?? null,
      partyNameForVoucher: d.partyNameForVoucher?.trim() || null,
    });
  }

  const st = await client.query<{ document_status: string }>(`SELECT document_status FROM purchase_invoices WHERE id=$1`, [
    invoiceId,
  ]);
  return { id: invoiceId, invoiceNo, documentStatus: st.rows[0].document_status };
}

export async function updatePurchaseInvoiceDraft(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  invoiceId: string,
  raw: unknown,
): Promise<void> {
  const parsed = purchaseInvoiceUpdateDraftSchema.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error('بيانات فاتورة الشراء غير صالحة'), { code: 'VALIDATION', details: parsed.error.flatten() });
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
     FROM purchase_invoices
     WHERE id=$1 AND company_id=$2
     FOR UPDATE`,
    [invoiceId, companyId],
  );
  if (!cur.rows.length) throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });
  if (cur.rows[0].document_status !== 'DRAFT') {
    throw Object.assign(new Error('لا يمكن تعديل فاتورة مؤكدة أو ملغاة'), { code: 'INVALID_STATE' });
  }

  const d = parsed.data as Partial<PurchaseInvoiceCreateInput> & { lines?: z.infer<typeof invoiceLineSchema>[] };
  if (d.supplierId) await assertSupplier(client, companyId, d.supplierId);

  if (d.invoiceNo?.trim()) {
    const dup = await client.query(
      `SELECT id FROM purchase_invoices WHERE company_id=$1 AND invoice_no=$2 AND id <> $3::uuid`,
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
    `UPDATE purchase_invoices SET
       invoice_no = COALESCE($4, invoice_no),
       invoice_date = COALESCE($5::date, invoice_date),
       supplier_id = COALESCE($6, supplier_id),
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
       updated_by_user_id = $3,
       updated_at = now()
     WHERE id=$1 AND company_id=$2`,
    [
      invoiceId,
      companyId,
      userId,
      d.invoiceNo?.trim() ?? null,
      d.invoiceDate?.slice(0, 10) ?? null,
      d.supplierId ?? null,
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
    const linesToSave = preparePurchaseInvoiceLines(d.lines, nextDiscount, nextSubtotal, nextTax, nextTotal);
    await client.query(`DELETE FROM purchase_invoice_lines WHERE invoice_id=$1 AND company_id=$2`, [invoiceId, companyId]);
    await insertPurchaseLines(client, companyId, invoiceId, nextRate, linesToSave);
  }
}

export async function deletePurchaseInvoiceDraft(client: PoolClient, companyId: string, invoiceId: string): Promise<void> {
  const cur = await client.query<{ document_status: string }>(
    `SELECT document_status FROM purchase_invoices WHERE id=$1 AND company_id=$2`,
    [invoiceId, companyId],
  );
  if (!cur.rows.length) throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });
  if (cur.rows[0].document_status !== 'DRAFT') {
    throw Object.assign(new Error('لا يمكن حذف فاتورة مؤكدة.'), { code: 'INVALID_STATE' });
  }
  await client.query(`DELETE FROM purchase_invoices WHERE id=$1 AND company_id=$2`, [invoiceId, companyId]);
}

export async function confirmPurchaseInvoice(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  invoiceId: string,
  opts: { cashboxId?: string | null; partyNameForVoucher?: string | null; skipStockMovement?: boolean } = {},
): Promise<void> {
  const invRow = await client.query(
    `SELECT * FROM purchase_invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [invoiceId, companyId],
  );
  if (!invRow.rows.length) throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });
  const inv = invRow.rows[0];
  if (inv.document_status !== 'DRAFT') {
    throw Object.assign(new Error('الفاتورة مؤكدة مسبقاً'), { code: 'INVALID_STATE' });
  }

  const lines = await client.query(
    `SELECT * FROM purchase_invoice_lines WHERE invoice_id=$1 AND company_id=$2 ORDER BY line_no`,
    [invoiceId, companyId],
  );

  const targetWarehouseId = await resolveWarehouseForPurchaseInvoice(client, companyId, inv.warehouse_id ?? null);

  for (const ln of lines.rows) {
    let rollId = ln.fabric_roll_id as string | null;
    if (!rollId) {
      const meta = ((ln.metadata as Record<string, unknown> | null) || {}) as Record<string, unknown>;
      const materialName = cleanText(meta.materialName ?? meta.fabricName ?? ln.description);
      const designCode = cleanText(meta.designCode ?? meta.dsamNumber ?? meta.articleCode);
      const colorName = cleanText(meta.colorName ?? meta.fabricColor);
      const colorCode = cleanText(meta.colorCode);
      const widthCm = cleanNum(meta.widthCm);
      const gsm = cleanNum(meta.gsm);
      const qty = Number(ln.quantity ?? 0);
      const unit = (String(ln.unit || 'meter').toLowerCase() === 'yard' ? 'yard' : 'meter') as 'meter' | 'yard';
      const lengthM = Math.max(0, quantityToMeters(Number.isFinite(qty) ? qty : 0, unit));
      const actualWeight = cleanNum(meta.weightKg ?? meta.weight);
      const calcWt = calcWeight(lengthM, widthCm, gsm);

      const itemId = await findOrCreateFabricItem(client, companyId, materialName, designCode);
      const colorId = await findOrCreateColor(client, companyId, colorName, colorCode);

      await ensureFabricCategoryChain(client, companyId, materialName, designCode, colorName, colorCode);

      let barcode = cleanText(meta.supplierBarcode ?? meta.barcode);
      if (barcode) {
        const dup = await client.query<{ id: string }>(
          `SELECT id FROM fabric_rolls WHERE company_id=$1 AND barcode=$2 LIMIT 1`,
          [companyId, barcode],
        );
        if (dup.rows.length) {
          barcode = await generateBarcode(client, companyId);
        }
      } else {
        barcode = await generateBarcode(client, companyId);
      }

      const rollIns = await client.query<{ id: string }>(
        `INSERT INTO fabric_rolls
           (company_id, roll_no, barcode, item_id, color_id, variant_id, supplier_id,
            warehouse_id, location_id, length_m, width_cm, gsm,
            calculated_weight_kg, actual_weight_kg, unit_cost, currency_code,
            batch_no, container_no, purchase_invoice_no, supplier_roll_ref,
            notes, created_by_user_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'AVAILABLE')
         RETURNING id`,
        [
          companyId,
          cleanText(meta.rollNo ?? meta.rollNumber) || null,
          barcode,
          itemId,
          colorId,
          null,
          inv.supplier_id ?? null,
          targetWarehouseId,
          null,
          lengthM,
          widthCm,
          gsm,
          calcWt,
          actualWeight,
          Number(ln.unit_cost ?? 0) || null,
          String(inv.currency_code || 'USD'),
          null,
          null,
          String(inv.invoice_no),
          cleanText(meta.supplierBarcode ?? meta.supplierRollRef) || null,
          cleanText(meta.note ?? ln.description) || null,
          userId,
        ],
      );
      rollId = rollIns.rows[0].id;

      await client.query(
        `UPDATE purchase_invoice_lines
         SET fabric_roll_id=$3, fabric_item_id=$4, warehouse_id=$5
         WHERE id=$1 AND company_id=$2`,
        [ln.id, companyId, rollId, itemId, targetWarehouseId],
      );
    }
    const invNo = String(inv.invoice_no);
    await client.query(
      `UPDATE fabric_rolls SET purchase_invoice_no=COALESCE(purchase_invoice_no, $3), updated_at=now()
       WHERE id=$1 AND company_id=$2`,
      [rollId, companyId, invNo],
    );
    if (!opts.skipStockMovement) {
      await client.query(
        `INSERT INTO inventory_movements (
           company_id, roll_id, movement_type, length_delta_m,
           reference_type, reference_id, reference_no, notes, created_by_user_id
         ) VALUES ($1,$2,'PURCHASE_RECEIPT', NULL, $3,$4,$5,$6,$7)`,
        [
          companyId,
          rollId,
          'PURCHASE_INVOICE',
          invoiceId,
          invNo,
          `استلام مرتبط بفاتورة شراء ${invNo}`,
          userId,
        ],
      );
    }
  }

  const totalAmt = Number(inv.total_amount);
  const paidAmt = Number(inv.paid_amount);
  const ccy = String(inv.currency_code || 'USD');
  const rate = Number(inv.exchange_rate_to_usd) > 0 ? Number(inv.exchange_rate_to_usd) : (ccy.trim().toUpperCase() === 'USD' ? 1 : NaN);
  const exchangeRateToUsd = ccy.trim().toUpperCase() === 'USD' ? 1 : rate;
  if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
    throw Object.assign(new Error('لا يمكن تأكيد الفاتورة بدون سعر صرف'), { code: 'VALIDATION' });
  }
  const entryDate =
    inv.invoice_date instanceof Date ? inv.invoice_date.toISOString().slice(0, 10) : String(inv.invoice_date).slice(0, 10);
  const totalUsd = Number(inv.total_amount_usd ?? 0) || computeUsd(totalAmt, exchangeRateToUsd);
  const paidUsd = Number(inv.paid_amount_usd ?? 0) || computeUsd(paidAmt, exchangeRateToUsd);

  if (totalAmt > 0) {
    await postPurchaseInvoiceToGl(client, {
      companyId,
      purchaseInvoiceId: invoiceId,
      invoiceNo: String(inv.invoice_no),
      invoiceDate: entryDate,
      supplierId: String(inv.supplier_id),
      totalAmountUsd: totalUsd,
      currencyCode: ccy,
      userId,
    });
  }

  let voucherIdOut: string | null = null;
  if (paidAmt > EPS) {
    const cashboxId = opts.cashboxId ?? null;
    if (!cashboxId) {
      throw Object.assign(new Error('دفعة تتطلب اختيار صندوق'), { code: 'VALIDATION' });
    }
    const sup = await assertSupplier(client, companyId, String(inv.supplier_id));
    const partyName = opts.partyNameForVoucher?.trim() || sup.name;
    const vd = await insertDraftVoucher(client, {
      companyId,
      userId,
      voucherType: 'PAYMENT',
      voucherDate: entryDate,
      cashboxId,
      partyType: 'SUPPLIER',
      partyId: String(inv.supplier_id),
      partyName,
      amount: paidAmt,
      currencyCode: ccy,
      exchangeRateToUsd,
      amountUsd: paidUsd,
      description: `صرف — فاتورة مشتريات ${inv.invoice_no}`,
      notes: `مرتبطة بفاتورة شراء ${invoiceId}`,
      referenceDocumentType: 'PURCHASE_INVOICE',
      referenceDocumentNo: String(inv.invoice_no),
    });

    await applyVoucherConfirmation(client, {
      companyId,
      voucherId: vd.id,
      voucherNo: vd.voucherNo,
      voucherDate: entryDate,
      voucherType: 'PAYMENT',
      amount: paidAmt,
      currencyCode: ccy,
      exchangeRateToUsd,
      amountUsd: paidUsd,
      cashboxId,
      partyType: 'SUPPLIER',
      partyId: String(inv.supplier_id),
      partyName,
      description: `صرف — فاتورة مشتريات ${inv.invoice_no}`,
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
    `UPDATE purchase_invoices SET
       document_status='CONFIRMED',
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

export async function voidPurchaseInvoice(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  invoiceId: string,
): Promise<void> {
  const invRow = await client.query(
    `SELECT * FROM purchase_invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [invoiceId, companyId],
  );
  if (!invRow.rows.length) throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });
  const inv = invRow.rows[0];
  if (inv.document_status !== 'CONFIRMED') {
    throw Object.assign(new Error('يمكن إلغاء الفواتير المؤكدة فقط'), { code: 'INVALID_STATE' });
  }

  await reversePurchaseInvoiceGl(client, {
    companyId,
    purchaseInvoiceId: invoiceId,
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
    `UPDATE purchase_invoices SET document_status='VOIDED', voided_at=now(), updated_by_user_id=$3, updated_at=now()
     WHERE id=$1 AND company_id=$2`,
    [invoiceId, companyId, userId],
  );
}

type VoucherPaymentRef = {
  voucherType: string;
  amount: number;
  referenceDocumentType: string | null;
  referenceDocumentNo: string | null;
  partyType: string | null;
  partyId: string | null;
};

export async function validatePurchaseInvoicePaymentVoucher(
  client: PoolClient,
  companyId: string,
  voucher: VoucherPaymentRef,
): Promise<void> {
  if (voucher.voucherType !== 'PAYMENT') return;
  const refType = String(voucher.referenceDocumentType ?? '').trim();
  const refNo = String(voucher.referenceDocumentNo ?? '').trim();
  if (refType !== 'PURCHASE_INVOICE' || !refNo) return;

  const inv = await client.query<{
    document_status: string;
    remaining_amount: string;
    supplier_id: string;
  }>(
    `SELECT document_status, remaining_amount, supplier_id
     FROM purchase_invoices
     WHERE company_id=$1 AND invoice_no=$2
     FOR UPDATE`,
    [companyId, refNo],
  );
  if (!inv.rows.length) {
    throw Object.assign(new Error('فاتورة المشتريات المرجعية غير موجودة'), { code: 'VALIDATION' });
  }
  const row = inv.rows[0];
  if (row.document_status !== 'CONFIRMED') {
    throw Object.assign(new Error('يمكن ربط سند الصرف بفاتورة مشتريات مؤكدة فقط'), { code: 'VALIDATION' });
  }
  if (voucher.partyType === 'SUPPLIER' && voucher.partyId && row.supplier_id !== voucher.partyId) {
    throw Object.assign(new Error('المورد لا يطابق فاتورة المشتريات'), { code: 'VALIDATION' });
  }
  const remaining = Number(row.remaining_amount);
  if (remaining <= EPS) {
    throw Object.assign(new Error('الفاتورة مدفوعة بالكامل ولا يمكن صرف مبلغ إضافي'), { code: 'VALIDATION' });
  }
  const amt = Number(voucher.amount);
  if (amt > remaining + EPS) {
    throw Object.assign(new Error('مبلغ السند يتجاوز المتبقي على الفاتورة'), { code: 'VALIDATION' });
  }
}

export async function applyPurchaseInvoicePaymentOnVoucherConfirm(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  voucher: VoucherPaymentRef & { voucherId: string; exchangeRateToUsd: number },
): Promise<void> {
  if (voucher.voucherType !== 'PAYMENT') return;
  const refType = String(voucher.referenceDocumentType ?? '').trim();
  const refNo = String(voucher.referenceDocumentNo ?? '').trim();
  if (refType !== 'PURCHASE_INVOICE' || !refNo) return;

  const inv = await client.query<{
    id: string;
    total_amount: string;
    paid_amount: string;
    remaining_amount: string;
    exchange_rate_to_usd: string;
  }>(
    `SELECT id, total_amount, paid_amount, remaining_amount, exchange_rate_to_usd
     FROM purchase_invoices
     WHERE company_id=$1 AND invoice_no=$2 AND document_status='CONFIRMED'
     FOR UPDATE`,
    [companyId, refNo],
  );
  if (!inv.rows.length) return;

  const row = inv.rows[0];
  const totalAmt = Number(row.total_amount);
  const paidAmt = Number(row.paid_amount);
  const remaining = Number(row.remaining_amount);
  const payment = computePaymentApplication(totalAmt, paidAmt, remaining, Number(voucher.amount));
  if (!payment) return;
  const applyAmt = payment.applyAmount;

  const rate =
    Number(voucher.exchangeRateToUsd) > 0
      ? Number(voucher.exchangeRateToUsd)
      : Number(row.exchange_rate_to_usd) > 0
        ? Number(row.exchange_rate_to_usd)
        : 1;
  const newPaid = payment.newPaid;
  const pay = paymentStatuses(totalAmt, newPaid);
  const paidUsd = computeUsd(newPaid, rate);
  const remainingUsd = computeUsd(pay.remaining, rate);

  await client.query(
    `UPDATE purchase_invoices SET
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
