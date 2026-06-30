import type { PoolClient } from 'pg';
import { z } from 'zod';
import { postPurchaseInvoiceToGl, reversePurchaseInvoiceGl } from './glPostingService.js';
import { applyVoucherConfirmation, cancelConfirmedVoucher, insertDraftVoucher } from './voucherCashboxService.js';
import { invoiceLineSchema, paymentStatuses, quantityToMeters } from './salesInvoiceService.js';
import { getExchangeRateToUsdTx } from './exchangeRateService.js';
import { calcWeight, generateBarcode, archiveFabricRollBarcode } from '../utils/rollHelpers.js';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';
import {
  allocateHeaderDiscountToLines,
  computePaymentApplication,
  INVOICE_AMOUNT_EPS,
  validateInvoiceLineAmounts,
} from './invoiceAmountHelpers.js';

type DbQuery = Pick<PoolClient, 'query'>;

const EPS = INVOICE_AMOUNT_EPS;

export type PurchaseInvoiceStockBlock = {
  rollId: string;
  barcode: string;
  reason: string;
};

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
  name: string,
): Promise<string> {
  const byName = await client.query<{ id: string }>(
    `SELECT id FROM fabric_categories
     WHERE company_id=$1 AND parent_id IS NOT DISTINCT FROM $2
       AND lower(trim(name))=lower(trim($3))
     LIMIT 1`,
    [companyId, parentId, name],
  );
  if (byName.rows.length) return byName.rows[0].id;

  try {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO fabric_categories (company_id, parent_id, code, name, is_active)
       VALUES ($1,$2,$3,$3,true)
       RETURNING id`,
      [companyId, parentId, name],
    );
    return ins.rows[0].id;
  } catch (e: unknown) {
    if ((e as { code?: string }).code !== '23505') throw e;
    const again = await client.query<{ id: string }>(
      `SELECT id FROM fabric_categories
       WHERE company_id=$1 AND parent_id IS NOT DISTINCT FROM $2
         AND lower(trim(name))=lower(trim($3))
       LIMIT 1`,
      [companyId, parentId, name],
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

  const l1 = await ensureCategoryNode(client, companyId, null, mName);
  const l2 = await ensureCategoryNode(client, companyId, l1, dCode);
  const l3 = await ensureCategoryNode(client, companyId, l2, cName);
  await ensureCategoryNode(client, companyId, l3, cCode);
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
  if (opts.documentStatus === 'ALL') {
    /* include voided and every status */
  } else if (opts.documentStatus && ['DRAFT', 'CONFIRMED', 'VOIDED'].includes(opts.documentStatus)) {
    conds.push(`pi.document_status = $${p}`);
    params.push(opts.documentStatus);
    p++;
  } else {
    // Default list: hide cancelled test invoices from daily operations
    conds.push(`pi.document_status <> 'VOIDED'`);
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
    `SELECT pil.*,
            fi.internal_code AS item_internal_code,
            fi.supplier_code AS item_supplier_code
     FROM purchase_invoice_lines pil
     LEFT JOIN fabric_rolls fr ON fr.id = pil.fabric_roll_id AND fr.company_id = pil.company_id
     LEFT JOIN fabric_items fi ON fi.id = COALESCE(pil.fabric_item_id, fr.item_id) AND fi.company_id = pil.company_id
     WHERE pil.invoice_id=$1 AND pil.company_id=$2
     ORDER BY pil.line_no`,
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

/** Permanent removal of a VOIDED purchase invoice (test cleanup). */
export async function purgeVoidedPurchaseInvoice(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  invoiceId: string,
): Promise<{ invoiceNo: string; rollsDeactivated: number }> {
  const cur = await client.query<{ document_status: string; invoice_no: string }>(
    `SELECT document_status, invoice_no FROM purchase_invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [invoiceId, companyId],
  );
  if (!cur.rows.length) throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });
  if (cur.rows[0].document_status !== 'VOIDED') {
    throw Object.assign(new Error('يمكن الحذف النهائي للفواتير الملغاة فقط (تنظيف تجارب)'), { code: 'INVALID_STATE' });
  }

  const returns = await client.query(
    `SELECT id FROM return_invoices
     WHERE company_id=$1 AND original_purchase_invoice_id=$2
     LIMIT 1`,
    [companyId, invoiceId],
  );
  if (returns.rows.length) {
    throw Object.assign(new Error('لا يمكن حذف فاتورة مرتبطة بمرتجعات شراء'), { code: 'INVALID_STATE' });
  }

  await client.query(
    `DELETE FROM journal_entries
     WHERE company_id=$1 AND source_id=$2
       AND source_type IN ('PURCHASE_INVOICE', 'PURCHASE_INVOICE_REVERSAL')`,
    [companyId, invoiceId],
  );

  await client.query(
    `UPDATE purchase_import_batches SET created_purchase_invoice_id=NULL, updated_at=now()
     WHERE company_id=$1 AND created_purchase_invoice_id=$2`,
    [companyId, invoiceId],
  );

  await client.query(
    `UPDATE purchase_import_rows SET created_purchase_invoice_line_id=NULL, updated_at=now()
     WHERE company_id=$1 AND created_purchase_invoice_line_id IN (
       SELECT id FROM purchase_invoice_lines WHERE invoice_id=$2 AND company_id=$1
     )`,
    [companyId, invoiceId],
  );

  const invoiceNo = String(cur.rows[0].invoice_no);
  const rollIds = await collectPurchaseInvoiceRollIds(client, companyId, invoiceId, invoiceNo);
  for (const rollId of rollIds) {
    await deactivatePurchaseInvoiceRoll(
      client,
      companyId,
      userId,
      rollId,
      invoiceId,
      invoiceNo,
      `حذف نهائي لفاتورة شراء ملغاة ${invoiceNo}`,
    );
  }

  await client.query(`DELETE FROM purchase_invoices WHERE id=$1 AND company_id=$2`, [invoiceId, companyId]);
  return { invoiceNo, rollsDeactivated: rollIds.length };
}

/** Deactivate rolls left active after void/purge of purchase invoices (inventory repair). */
export async function repairStalePurchaseInvoiceRolls(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  opts: { invoiceNos?: string[] } = {},
): Promise<{ deactivated: number; barcodes: string[]; skippedSold: number; barcodesReleased: string[] }> {
  const invoiceNos = opts.invoiceNos?.map((s) => s.trim()).filter(Boolean) ?? [];
  const params: unknown[] = [companyId];
  let explicitNoFilter = '';
  if (invoiceNos.length) {
    params.push(invoiceNos);
    explicitNoFilter = ` OR NULLIF(trim(fr.purchase_invoice_no), '') = ANY($${params.length}::text[])`;
  }

  const rows = await client.query<{ id: string; barcode: string; purchase_invoice_no: string | null }>(
    `SELECT fr.id,
            COALESCE(NULLIF(trim(fr.barcode), ''), fr.id::text) AS barcode,
            fr.purchase_invoice_no
     FROM fabric_rolls fr
     WHERE fr.company_id = $1
       AND fr.status NOT IN ('SOLD', 'INACTIVE')
       AND (
         EXISTS (
           SELECT 1 FROM purchase_invoices pi
           WHERE pi.company_id = fr.company_id
             AND pi.document_status = 'VOIDED'
             AND (
               pi.id = fr.purchase_invoice_id
               OR NULLIF(trim(pi.invoice_no), '') = NULLIF(trim(fr.purchase_invoice_no), '')
             )
         )
         OR (
           NULLIF(trim(fr.purchase_invoice_no), '') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM purchase_invoices pi
             WHERE pi.company_id = fr.company_id
               AND pi.document_status IN ('DRAFT', 'CONFIRMED')
               AND NULLIF(trim(pi.invoice_no), '') = NULLIF(trim(fr.purchase_invoice_no), '')
           )
           AND (
             NOT EXISTS (
               SELECT 1 FROM purchase_invoices pi
               WHERE pi.company_id = fr.company_id
                 AND (
                   pi.id = fr.purchase_invoice_id
                   OR NULLIF(trim(pi.invoice_no), '') = NULLIF(trim(fr.purchase_invoice_no), '')
                 )
             )
             OR EXISTS (
               SELECT 1 FROM purchase_invoices pi
               WHERE pi.company_id = fr.company_id
                 AND pi.document_status = 'VOIDED'
                 AND NULLIF(trim(pi.invoice_no), '') = NULLIF(trim(fr.purchase_invoice_no), '')
             )
           )
         )
         ${explicitNoFilter}
       )`,
    params,
  );

  const barcodes: string[] = [];
  let skippedSold = 0;
  for (const row of rows.rows) {
    const sold = await client.query(
      `SELECT 1 FROM inventory_movements
       WHERE company_id=$1 AND roll_id=$2 AND movement_type='SALE' LIMIT 1`,
      [companyId, row.id],
    );
    if (sold.rows.length) {
      skippedSold += 1;
      continue;
    }
    const invNo = row.purchase_invoice_no?.trim() || '—';
    await deactivatePurchaseInvoiceRoll(
      client,
      companyId,
      userId,
      row.id,
      null,
      invNo,
      `إصلاح مخزون — فاتورة شراء ملغاة/محذوفة ${invNo}`,
    );
    barcodes.push(row.barcode);
  }

  const released: string[] = [];
  const inactiveParams: unknown[] = [companyId];
  let inactiveInvoiceFilter = '';
  if (invoiceNos.length) {
    inactiveParams.push(invoiceNos);
    inactiveInvoiceFilter = ` AND NULLIF(trim(im.reference_no), '') = ANY($${inactiveParams.length}::text[])`;
  }

  const inactiveRows = await client.query<{ id: string; barcode: string }>(
    `SELECT fr.id, fr.barcode
     FROM fabric_rolls fr
     WHERE fr.company_id = $1
       AND fr.status = 'INACTIVE'
       AND COALESCE(fr.length_m, 0) <= 0
       AND position('~VOID~' in fr.barcode) = 0
       AND EXISTS (
         SELECT 1 FROM inventory_movements im
         WHERE im.company_id = fr.company_id
           AND im.roll_id = fr.id
           AND im.reference_type = 'PURCHASE_INVOICE_VOID'
           ${inactiveInvoiceFilter}
       )`,
    inactiveParams,
  );

  for (const row of inactiveRows.rows) {
    const original = row.barcode.trim();
    if (!original) continue;
    await archiveFabricRollBarcode(client, companyId, row.id, original);
    released.push(original);
  }

  return { deactivated: barcodes.length, barcodes, skippedSold, barcodesReleased: released };
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

async function collectPurchaseInvoiceRollIds(
  client: PoolClient,
  companyId: string,
  invoiceId: string,
  invoiceNo: string,
): Promise<string[]> {
  const rows = await client.query<{ id: string }>(
    `SELECT DISTINCT fr.id
     FROM fabric_rolls fr
     LEFT JOIN purchase_invoice_lines pil
       ON pil.fabric_roll_id = fr.id AND pil.company_id = fr.company_id AND pil.invoice_id = $2
     WHERE fr.company_id = $1
       AND (
         pil.invoice_id IS NOT NULL
         OR fr.purchase_invoice_id = $2
         OR NULLIF(trim(fr.purchase_invoice_no), '') = NULLIF(trim($3), '')
       )`,
    [companyId, invoiceId, invoiceNo],
  );
  return rows.rows.map((r) => r.id);
}

async function deactivatePurchaseInvoiceRoll(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  rollId: string,
  invoiceId: string | null,
  invoiceNo: string,
  notesSuffix: string,
): Promise<void> {
  const r = await client.query<{ length_m: string; status: string; warehouse_id: string | null; barcode: string }>(
    `SELECT length_m, status, warehouse_id, barcode FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [rollId, companyId],
  );
  if (!r.rows.length) return;
  const prevLen = parseFloat(String(r.rows[0].length_m));
  const prevStatus = r.rows[0].status;
  const prevBarcode = String(r.rows[0].barcode ?? '').trim();
  if (prevStatus === 'INACTIVE' && prevLen <= 0) {
    if (prevBarcode && !prevBarcode.includes('~VOID~')) {
      await archiveFabricRollBarcode(client, companyId, rollId, prevBarcode);
    }
    return;
  }

  await client.query(
    `UPDATE fabric_rolls SET
       status='INACTIVE',
       length_m=0,
       calculated_weight_kg=0,
       actual_weight_kg=CASE WHEN actual_weight_kg IS NOT NULL THEN 0 ELSE NULL END,
       purchase_invoice_id=NULL,
       purchase_invoice_line_id=NULL,
       purchase_invoice_no=NULL,
       updated_at=now()
     WHERE id=$1 AND company_id=$2`,
    [rollId, companyId],
  );

  if (prevBarcode && !prevBarcode.includes('~VOID~')) {
    await archiveFabricRollBarcode(client, companyId, rollId, prevBarcode);
  }

  await client.query(
    `INSERT INTO inventory_movements (
       company_id, roll_id, movement_type,
       from_warehouse_id, to_warehouse_id,
       old_status, new_status,
       length_delta_m,
       reference_type, reference_id, reference_no,
       notes, created_by_user_id
     ) VALUES ($1,$2,'STATUS_CHANGE',$3,$3,$4,'INACTIVE',$5,'PURCHASE_INVOICE_VOID',$6,$7,$8,$9)`,
    [
      companyId,
      rollId,
      r.rows[0].warehouse_id,
      prevStatus,
      prevLen > 0 ? -prevLen : null,
      invoiceId,
      invoiceNo,
      notesSuffix,
      userId,
    ],
  );
}

async function cancelPurchaseInvoicePaymentVouchers(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  invoiceNo: string,
  primaryVoucherId: string | null,
): Promise<void> {
  const ids = new Set<string>();
  if (primaryVoucherId) ids.add(primaryVoucherId);
  const linked = await client.query<{ id: string }>(
    `SELECT id FROM vouchers
     WHERE company_id=$1 AND status='CONFIRMED'
       AND reference_document_type='PURCHASE_INVOICE'
       AND reference_document_no=$2`,
    [companyId, invoiceNo],
  );
  for (const row of linked.rows) ids.add(row.id);
  for (const voucherId of ids) {
    await cancelConfirmedVoucher(client, { companyId, voucherId, userId });
  }
}

async function repostPurchaseInvoiceGl(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  invoiceId: string,
  inv: Record<string, unknown>,
): Promise<void> {
  const invoiceNo = String(inv.invoice_no);
  await reversePurchaseInvoiceGl(client, {
    companyId,
    purchaseInvoiceId: invoiceId,
    invoiceNo,
    userId,
  });
  await client.query(
    `DELETE FROM journal_entries
     WHERE company_id = $1 AND source_id = $2 AND source_type = 'PURCHASE_INVOICE_REVERSAL'`,
    [companyId, invoiceId],
  );
  await client.query(
    `DELETE FROM journal_entries
     WHERE company_id = $1 AND source_id = $2 AND source_type = 'PURCHASE_INVOICE'`,
    [companyId, invoiceId],
  );

  const totalAmt = Number(inv.total_amount);
  if (totalAmt <= 0) return;

  const ccy = String(inv.currency_code || 'USD');
  const rate =
    Number(inv.exchange_rate_to_usd) > 0
      ? Number(inv.exchange_rate_to_usd)
      : ccy.trim().toUpperCase() === 'USD'
        ? 1
        : NaN;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw Object.assign(new Error('لا يمكن تحديث القيود بدون سعر صرف'), { code: 'VALIDATION' });
  }
  const entryDate =
    inv.invoice_date instanceof Date
      ? inv.invoice_date.toISOString().slice(0, 10)
      : String(inv.invoice_date).slice(0, 10);
  const totalUsd = Number(inv.total_amount_usd ?? 0) || computeUsd(totalAmt, rate);

  await postPurchaseInvoiceToGl(client, {
    companyId,
    purchaseInvoiceId: invoiceId,
    invoiceNo,
    invoiceDate: entryDate,
    supplierId: String(inv.supplier_id),
    totalAmountUsd: totalUsd,
    currencyCode: ccy,
    userId,
  });
}

async function createRollFromPurchaseLine(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  invoiceId: string,
  invoiceNo: string,
  inv: Record<string, unknown>,
  ln: z.infer<typeof invoiceLineSchema>,
  targetWarehouseId: string,
): Promise<string> {
  const meta = ((ln.metadata as Record<string, unknown> | null | undefined) ?? {}) as Record<string, unknown>;
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
  if (!barcode) barcode = await generateBarcode(client, companyId);

  const rollIns = await client.query<{ id: string }>(
    `INSERT INTO fabric_rolls
       (company_id, roll_no, barcode, item_id, color_id, variant_id, supplier_id,
        warehouse_id, location_id, length_m, width_cm, gsm,
        calculated_weight_kg, actual_weight_kg, unit_cost, currency_code,
        batch_no, container_no, purchase_invoice_no, purchase_invoice_id, supplier_roll_ref,
        notes, created_by_user_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'AVAILABLE')
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
      Number(ln.unitPrice ?? 0) || null,
      String(inv.currency_code || 'USD'),
      null,
      null,
      invoiceNo,
      invoiceId,
      cleanText(meta.supplierBarcode ?? meta.supplierRollRef) || null,
      cleanText(meta.note ?? ln.description) || null,
      userId,
    ],
  );
  const rollId = rollIns.rows[0].id;

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
      invoiceNo,
      `استلام مرتبط بفاتورة شراء ${invoiceNo}`,
      userId,
    ],
  );

  return rollId;
}

async function syncExistingPurchaseRoll(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  invoiceId: string,
  invoiceNo: string,
  inv: Record<string, unknown>,
  rollId: string,
  ln: z.infer<typeof invoiceLineSchema>,
  targetWarehouseId: string,
): Promise<void> {
  const meta = ((ln.metadata as Record<string, unknown> | null | undefined) ?? {}) as Record<string, unknown>;
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

  const cur = await client.query<{ length_m: string; status: string }>(
    `SELECT length_m, status FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [rollId, companyId],
  );
  if (!cur.rows.length) {
    throw Object.assign(new Error('ثوب مرتبط بالفاتورة غير موجود'), { code: 'NOT_FOUND' });
  }
  const prevLen = parseFloat(String(cur.rows[0].length_m));
  const delta = round2(lengthM - prevLen);

  await client.query(
    `UPDATE fabric_rolls SET
       item_id=$3,
       color_id=$4,
       warehouse_id=$5,
       length_m=$6,
       width_cm=$7,
       gsm=$8,
       calculated_weight_kg=$9,
       actual_weight_kg=$10,
       unit_cost=$11,
       purchase_invoice_id=$12,
       purchase_invoice_no=$13,
       updated_at=now()
     WHERE id=$1 AND company_id=$2`,
    [
      rollId,
      companyId,
      itemId,
      colorId,
      targetWarehouseId,
      lengthM,
      widthCm,
      gsm,
      calcWt,
      actualWeight,
      Number(ln.unitPrice ?? 0) || null,
      invoiceId,
      invoiceNo,
    ],
  );

  if (Math.abs(delta) > EPS) {
    await client.query(
      `INSERT INTO inventory_movements (
         company_id, roll_id, movement_type, length_delta_m,
         reference_type, reference_id, reference_no, notes, created_by_user_id
       ) VALUES ($1,$2,'ADJUSTMENT',$3,'PURCHASE_INVOICE',$4,$5,$6,$7)`,
      [
        companyId,
        rollId,
        delta,
        invoiceId,
        invoiceNo,
        `تعديل فاتورة شراء ${invoiceNo}`,
        userId,
      ],
    );
  }
}

export async function getPurchaseInvoiceEditEligibility(
  client: PoolClient,
  companyId: string,
  invoiceId: string,
): Promise<{ editable: boolean; documentStatus: string; blocks: PurchaseInvoiceStockBlock[] }> {
  const cur = await client.query<{ document_status: string }>(
    `SELECT document_status FROM purchase_invoices WHERE id=$1 AND company_id=$2`,
    [invoiceId, companyId],
  );
  if (!cur.rows.length) {
    throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });
  }
  const documentStatus = String(cur.rows[0].document_status);
  if (documentStatus !== 'CONFIRMED') {
    return {
      editable: false,
      documentStatus,
      blocks: [{ rollId: '', barcode: '', reason: 'التعديل متاح للفواتير المؤكدة فقط' }],
    };
  }
  const stock = await checkPurchaseInvoiceStockEditable(client, companyId, invoiceId);
  return { editable: stock.ok, documentStatus, blocks: stock.blocks };
}

export async function updatePurchaseInvoiceConfirmed(
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
  if (!parsed.data.lines?.length) {
    throw Object.assign(new Error('يجب أن تحتوي الفاتورة على سطر واحد على الأقل'), { code: 'VALIDATION' });
  }

  const invRow = await client.query(
    `SELECT * FROM purchase_invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [invoiceId, companyId],
  );
  if (!invRow.rows.length) throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });
  const inv = invRow.rows[0];
  if (inv.document_status !== 'CONFIRMED') {
    throw Object.assign(new Error('لا يمكن تعديل فاتورة غير مؤكدة من هذا المسار'), { code: 'INVALID_STATE' });
  }

  const eligibility = await checkPurchaseInvoiceStockEditable(client, companyId, invoiceId);
  if (!eligibility.ok) {
    const first = eligibility.blocks[0];
    const detail = first?.barcode ? ` (${first.barcode}: ${first.reason})` : first?.reason ? ` (${first.reason})` : '';
    throw Object.assign(new Error(`لا يمكن تعديل الفاتورة — خامات مرتبطة ببيع أو حركة${detail}`), {
      code: 'INVALID_STOCK',
    });
  }

  const d = parsed.data as Partial<PurchaseInvoiceCreateInput> & { lines: z.infer<typeof invoiceLineSchema>[] };
  const currentPaid = Number(inv.paid_amount);
  const nextPaid = d.paidAmount ?? currentPaid;
  if (Math.abs(nextPaid - currentPaid) > EPS) {
    throw Object.assign(new Error('لا يمكن تغيير الدفعة من شاشة التعديل — استخدم سندات الصرف'), { code: 'VALIDATION' });
  }

  if (d.supplierId) await assertSupplier(client, companyId, d.supplierId);

  const nextCurrency = String(d.currencyCode ?? inv.currency_code ?? 'USD').trim().toUpperCase();
  const nextSubtotal = d.subtotal ?? Number(inv.subtotal);
  const nextDiscount = d.discountTotal ?? Number(inv.discount_total);
  const nextTax = d.taxTotal ?? Number(inv.tax_total);
  const nextTotal = d.totalAmount ?? Number(inv.total_amount);
  const pay = paymentStatuses(nextTotal, currentPaid);

  let nextRate = d.exchangeRateToUsd != null ? Number(d.exchangeRateToUsd) : Number(inv.exchange_rate_to_usd);
  if (!Number.isFinite(nextRate) || nextRate <= 0) {
    nextRate = nextCurrency === 'USD' ? 1 : (await getExchangeRateToUsdTx(client, companyId, nextCurrency)) ?? NaN;
  }
  if (!Number.isFinite(nextRate) || nextRate <= 0) {
    throw Object.assign(new Error('لا يمكن تنفيذ العملية بدون سعر صرف'), { code: 'VALIDATION' });
  }
  if (nextCurrency === 'USD') nextRate = 1;

  const targetWarehouseId = await resolveWarehouseForPurchaseInvoice(
    client,
    companyId,
    (d.warehouseId ?? inv.warehouse_id) as string | null,
  );
  const invoiceNo = String(inv.invoice_no);

  const oldLines = await client.query<{ fabric_roll_id: string | null }>(
    `SELECT fabric_roll_id FROM purchase_invoice_lines WHERE invoice_id=$1 AND company_id=$2`,
    [invoiceId, companyId],
  );
  const oldRollIds = new Set(
    oldLines.rows.map((r) => r.fabric_roll_id).filter((x): x is string => x != null && x.length > 0),
  );

  const linesToSave = preparePurchaseInvoiceLines(d.lines, nextDiscount, nextSubtotal, nextTax, nextTotal);
  const newRollIds = new Set(
    linesToSave
      .map((ln) => ln.fabricRollId)
      .filter((x): x is string => x != null && x.length > 0),
  );

  for (const rollId of oldRollIds) {
    if (!newRollIds.has(rollId)) {
      await deactivatePurchaseInvoiceRoll(
        client,
        companyId,
        userId,
        rollId,
        invoiceId,
        invoiceNo,
        `إزالة ثوب من فاتورة شراء ${invoiceNo} (تعديل)`,
      );
    }
  }

  const rollIdsForLines: string[] = [];
  for (const ln of linesToSave) {
    const existingRollId = ln.fabricRollId ?? null;
    if (existingRollId && oldRollIds.has(existingRollId)) {
      await syncExistingPurchaseRoll(client, companyId, userId, invoiceId, invoiceNo, inv, existingRollId, ln, targetWarehouseId);
      rollIdsForLines.push(existingRollId);
    } else {
      const created = await createRollFromPurchaseLine(
        client,
        companyId,
        userId,
        invoiceId,
        invoiceNo,
        inv,
        ln,
        targetWarehouseId,
      );
      rollIdsForLines.push(created);
    }
  }

  const subtotalUsd = computeUsd(nextSubtotal, nextRate);
  const discountUsd = computeUsd(nextDiscount, nextRate);
  const taxUsd = computeUsd(nextTax, nextRate);
  const totalUsd = computeUsd(nextTotal, nextRate);
  const paidUsd = computeUsd(currentPaid, nextRate);
  const remainingUsd = computeUsd(pay.remaining, nextRate);

  await client.query(
    `UPDATE purchase_invoices SET
       invoice_date = COALESCE($3::date, invoice_date),
       supplier_id = COALESCE($4, supplier_id),
       warehouse_id = COALESCE($5, warehouse_id),
       warehouse_label = COALESCE($6, warehouse_label),
       supplier_invoice_no = COALESCE($7, supplier_invoice_no),
       currency_code = $8,
       exchange_rate_to_usd = $9,
       notes = COALESCE($10, notes),
       subtotal = $11,
       discount_total = $12,
       tax_total = $13,
       total_amount = $14,
       remaining_amount = $15,
       payment_status = $16,
       subtotal_usd = $17,
       discount_total_usd = $18,
       tax_total_usd = $19,
       total_amount_usd = $20,
       paid_amount_usd = $21,
       remaining_amount_usd = $22,
       updated_by_user_id = $23,
       updated_at = now()
     WHERE id=$1 AND company_id=$2`,
    [
      invoiceId,
      companyId,
      d.invoiceDate?.slice(0, 10) ?? null,
      d.supplierId ?? null,
      d.warehouseId ?? null,
      d.warehouseLabel?.trim() ?? null,
      d.supplierInvoiceNo?.trim() ?? null,
      nextCurrency,
      nextRate,
      d.notes?.trim() ?? null,
      nextSubtotal,
      nextDiscount,
      nextTax,
      nextTotal,
      pay.remaining,
      pay.paymentStatus,
      subtotalUsd,
      discountUsd,
      taxUsd,
      totalUsd,
      paidUsd,
      remainingUsd,
      userId,
    ],
  );

  await client.query(`DELETE FROM purchase_invoice_lines WHERE invoice_id=$1 AND company_id=$2`, [invoiceId, companyId]);

  let i = 0;
  for (const ln of linesToSave) {
    i++;
    const rollId = rollIdsForLines[i - 1];
    const unitCostUsd = (ln as { unitPriceUsd?: number }).unitPriceUsd ?? computeUsd4(ln.unitPrice, nextRate);
    const lineDiscountUsd = (ln as { lineDiscountUsd?: number }).lineDiscountUsd ?? computeUsd(ln.lineDiscount, nextRate);
    const lineTaxUsd = (ln as { lineTaxUsd?: number }).lineTaxUsd ?? computeUsd(ln.lineTax, nextRate);
    const lineTotalUsd = (ln as { lineTotalUsd?: number }).lineTotalUsd ?? computeUsd(ln.lineTotal, nextRate);
    await client.query(
      `INSERT INTO purchase_invoice_lines (
         company_id, invoice_id, line_no, fabric_roll_id, fabric_item_id, variant_id, warehouse_id,
         description, quantity, unit, unit_cost, line_discount, line_tax, line_total,
         unit_cost_usd, line_discount_usd, line_tax_usd, line_total_usd, metadata
       ) VALUES ($1,$2,$3,$4,(SELECT item_id FROM fabric_rolls WHERE id=$4 AND company_id=$1),NULL,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        companyId,
        invoiceId,
        i,
        rollId,
        targetWarehouseId,
        ln.description ?? '',
        ln.quantity,
        ln.unit ?? 'meter',
        ln.unitPrice,
        ln.lineDiscount ?? 0,
        ln.lineTax ?? 0,
        ln.lineTotal,
        unitCostUsd,
        lineDiscountUsd,
        lineTaxUsd,
        lineTotalUsd,
        JSON.stringify((ln as { metadata?: unknown }).metadata ?? {}),
      ],
    );
    await client.query(
      `UPDATE fabric_rolls SET purchase_invoice_line_id=(
         SELECT id FROM purchase_invoice_lines WHERE invoice_id=$3 AND company_id=$1 AND line_no=$4 LIMIT 1
       ), updated_at=now()
       WHERE id=$2 AND company_id=$1`,
      [companyId, rollId, invoiceId, i],
    );
  }

  const refreshed = await client.query(`SELECT * FROM purchase_invoices WHERE id=$1 AND company_id=$2`, [invoiceId, companyId]);
  await repostPurchaseInvoiceGl(client, companyId, userId, invoiceId, refreshed.rows[0]);
}

export async function checkPurchaseInvoiceStockEditable(
  client: PoolClient,
  companyId: string,
  invoiceId: string,
): Promise<{ ok: boolean; blocks: PurchaseInvoiceStockBlock[] }> {
  const blocks: PurchaseInvoiceStockBlock[] = [];

  const returns = await client.query(
    `SELECT id FROM return_invoices
     WHERE company_id=$1 AND original_purchase_invoice_id=$2 AND status='CONFIRMED'
     LIMIT 1`,
    [companyId, invoiceId],
  );
  if (returns.rows.length) {
    blocks.push({
      rollId: '',
      barcode: '',
      reason: 'توجد مرتجعات شراء مؤكدة مرتبطة بهذه الفاتورة',
    });
    return { ok: false, blocks };
  }

  const rows = await client.query<{
    roll_id: string;
    barcode: string;
    status: string;
    has_confirmed_sale: boolean;
    has_sale_movement: boolean;
    has_post_receipt_movement: boolean;
  }>(
    `SELECT fr.id AS roll_id,
            COALESCE(NULLIF(trim(fr.barcode), ''), NULLIF(trim(fr.roll_no), ''), fr.id::text) AS barcode,
            fr.status,
            EXISTS (
              SELECT 1 FROM sales_invoice_lines sil
              JOIN sales_invoices si ON si.id = sil.invoice_id AND si.company_id = sil.company_id
              WHERE sil.fabric_roll_id = fr.id AND sil.company_id = fr.company_id
                AND si.document_status = 'CONFIRMED'
            ) AS has_confirmed_sale,
            EXISTS (
              SELECT 1 FROM inventory_movements im
              WHERE im.roll_id = fr.id AND im.company_id = fr.company_id
                AND im.movement_type = 'SALE'
            ) AS has_sale_movement,
            EXISTS (
              SELECT 1 FROM inventory_movements im
              WHERE im.roll_id = fr.id AND im.company_id = fr.company_id
                AND im.movement_type IN ('TRANSFER_OUT', 'DAMAGE', 'SALE')
                AND NOT (im.reference_type = 'PURCHASE_INVOICE' AND im.reference_id = $3::uuid)
            ) AS has_post_receipt_movement
     FROM purchase_invoice_lines pil
     JOIN fabric_rolls fr ON fr.id = pil.fabric_roll_id AND fr.company_id = pil.company_id
     WHERE pil.invoice_id = $1 AND pil.company_id = $2 AND pil.fabric_roll_id IS NOT NULL`,
    [invoiceId, companyId, invoiceId],
  );

  for (const r of rows.rows) {
    if (r.status === 'SOLD' || r.has_confirmed_sale || r.has_sale_movement) {
      blocks.push({ rollId: r.roll_id, barcode: r.barcode, reason: 'تم بيع خامات من هذه الفاتورة' });
    } else if (r.status === 'TRANSFERRED' || r.has_post_receipt_movement) {
      blocks.push({ rollId: r.roll_id, barcode: r.barcode, reason: 'يوجد نقل أو تلف أو حركة بعد الاستلام' });
    } else if (r.status === 'RESERVED') {
      blocks.push({ rollId: r.roll_id, barcode: r.barcode, reason: 'ثوب محجوز للبيع' });
    }
  }

  return { ok: blocks.length === 0, blocks };
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

  const invoiceNo = String(inv.invoice_no);
  const stock = await checkPurchaseInvoiceStockEditable(client, companyId, invoiceId);
  if (!stock.ok) {
    const first = stock.blocks[0];
    const detail = first?.barcode ? ` (${first.barcode}: ${first.reason})` : first?.reason ? ` (${first.reason})` : '';
    throw Object.assign(new Error(`لا يمكن إلغاء الفاتورة — خامات مرتبطة ببيع أو حركة${detail}`), {
      code: 'INVALID_STOCK',
    });
  }

  const rollIds = await collectPurchaseInvoiceRollIds(client, companyId, invoiceId, invoiceNo);
  for (const rollId of rollIds) {
    await deactivatePurchaseInvoiceRoll(
      client,
      companyId,
      userId,
      rollId,
      invoiceId,
      invoiceNo,
      `إلغاء فاتورة شراء ${invoiceNo}`,
    );
  }

  await client.query(
    `UPDATE purchase_import_batches SET created_purchase_invoice_id=NULL, updated_at=now()
     WHERE company_id=$1 AND created_purchase_invoice_id=$2`,
    [companyId, invoiceId],
  );

  await client.query(
    `UPDATE purchase_import_rows SET created_purchase_invoice_line_id=NULL, updated_at=now()
     WHERE company_id=$1 AND created_purchase_invoice_line_id IN (
       SELECT id FROM purchase_invoice_lines WHERE invoice_id=$2 AND company_id=$1
     )`,
    [companyId, invoiceId],
  );

  await client.query(
    `UPDATE purchase_invoice_lines
     SET fabric_roll_id=NULL
     WHERE company_id=$1 AND invoice_id=$2`,
    [companyId, invoiceId],
  );

  await reversePurchaseInvoiceGl(client, {
    companyId,
    purchaseInvoiceId: invoiceId,
    invoiceNo,
    userId,
  });

  await cancelPurchaseInvoicePaymentVouchers(
    client,
    companyId,
    userId,
    invoiceNo,
    inv.payment_voucher_id as string | null,
  );

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
