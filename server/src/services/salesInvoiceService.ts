import type { PoolClient } from 'pg';
import { z } from 'zod';

/** Pool or client — list/detail helpers only need `.query`. */
type DbQuery = Pick<PoolClient, 'query'>;
import { postSalesInvoiceToGl, reverseSalesInvoiceGl } from './glPostingService.js';
import { applyVoucherConfirmation, cancelConfirmedVoucher, insertDraftVoucher } from './voucherCashboxService.js';
import { getExchangeRateToUsdTx } from './exchangeRateService.js';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';
import {
  assertSalesInvoiceCustomerMatchesOrder,
  syncCustomerOrderFulfillmentForInvoice,
} from './customerOrderFulfillmentService.js';
import {
  allocateHeaderDiscountToLines,
  INVOICE_AMOUNT_EPS,
  validateInvoiceLineAmounts,
} from './invoiceAmountHelpers.js';
import { isStatementImportLineMetadata } from './statementImportSaleLines.js';

const EPS = INVOICE_AMOUNT_EPS;

export const invoiceLineSchema = z.object({
  fabricRollId: z.string().uuid().optional().nullable(),
  fabricItemId: z.string().uuid().optional().nullable(),
  variantId: z.string().uuid().optional().nullable(),
  warehouseId: z.string().uuid().optional().nullable(),
  description: z.string().optional().default(''),
  quantity: z.coerce.number().nonnegative(),
  unit: z.enum(['meter', 'yard']).default('meter'),
  unitPrice: z.coerce.number().nonnegative(),
  lineDiscount: z.coerce.number().nonnegative().default(0),
  lineTax: z.coerce.number().nonnegative().default(0),
  lineTotal: z.coerce.number().nonnegative(),
  unitPriceUsd: z.coerce.number().nonnegative().optional(),
  lineDiscountUsd: z.coerce.number().nonnegative().optional(),
  lineTaxUsd: z.coerce.number().nonnegative().optional(),
  lineTotalUsd: z.coerce.number().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional().nullable(),
  customerOrderLineId: z.string().uuid().optional().nullable(),
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
  customerOrderId: z.string().uuid().optional().nullable(),
  cashboxId: z.string().uuid().optional().nullable(),
  partyNameForVoucher: z.string().optional().nullable(),
});

const salesLinesRequirePositiveUnitPrice = (
  lines: z.infer<typeof invoiceLineSchema>[] | undefined,
): boolean => {
  if (!lines?.length) return true;
  return lines.every((ln) => ln.quantity <= EPS || ln.unitPrice > 0);
};

const SALES_METER_PRICE_REQUIRED_MSG =
  'لا يمكن حفظ فاتورة البيع: أدخل سعر المتر (يجب أن يكون أكبر من صفر) لكل سطر';

function assertSalesInvoiceLinesHaveMeterPrice(
  lines: Array<{ quantity: unknown; unit?: unknown; unit_price?: unknown; unitPrice?: unknown }>,
): void {
  for (const ln of lines) {
    const qtyM = quantityToMeters(Number(ln.quantity), (ln.unit as 'meter' | 'yard') || 'meter');
    const unitPrice = Number(ln.unitPrice ?? ln.unit_price ?? 0);
    if (qtyM > EPS && (!Number.isFinite(unitPrice) || unitPrice <= 0)) {
      throw Object.assign(new Error(SALES_METER_PRICE_REQUIRED_MSG), { code: 'VALIDATION' });
    }
  }
}

export const salesInvoiceCreateSchema = salesInvoiceCreateBaseSchema
  .refine(
    (d) => Math.abs(d.subtotal - d.discountTotal + d.taxTotal - d.totalAmount) <= EPS,
    { message: 'إجمالي الفاتورة لا يطابق (المجموع − الخصم + الضريبة)', path: ['totalAmount'] },
  )
  .refine((d) => salesLinesRequirePositiveUnitPrice(d.lines), {
    message: SALES_METER_PRICE_REQUIRED_MSG,
    path: ['lines'],
  });

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
  )
  .refine((d) => salesLinesRequirePositiveUnitPrice(d.lines), {
    message: SALES_METER_PRICE_REQUIRED_MSG,
    path: ['lines'],
  });

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

function parseSalesLineMetadata(ln: { metadata: unknown }): Record<string, unknown> {
  try {
    return typeof ln.metadata === 'string'
      ? JSON.parse(ln.metadata) as Record<string, unknown>
      : (ln.metadata as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

/** After voiding a sale, roll must be sellable again (not stuck RESERVED/SOLD from the old flow). */
function rollStatusAfterSalesVoid(prevStatus: string, restoredLengthM: number): string {
  const st = String(prevStatus || 'AVAILABLE').toUpperCase();
  if (restoredLengthM <= EPS) {
    if (st === 'DAMAGED' || st === 'INACTIVE') return st;
    return 'INACTIVE';
  }
  if (st === 'RESERVED' || st === 'SOLD') return 'AVAILABLE';
  if (st === 'DAMAGED' || st === 'INACTIVE' || st === 'TRANSFERRED') return st;
  return 'AVAILABLE';
}

function resolveVoidRollRestoreTarget(
  ln: { quantity: unknown; unit: unknown; fabric_roll_id: string | null; metadata: unknown },
  snap: {
    prev_length_m?: number;
    prev_status?: string;
    qty_sold_m?: number;
    fabric_roll_id?: string;
  } | undefined,
  currentLengthM: number,
  currentStatus: string,
): { rollId: string | null; lengthM: number; status: string } {
  const rollId = String(snap?.fabric_roll_id ?? ln.fabric_roll_id ?? '').trim() || null;
  if (!rollId) return { rollId: null, lengthM: currentLengthM, status: currentStatus };

  const qtyM = quantityToMeters(Number(ln.quantity), (ln.unit as 'meter' | 'yard') || 'meter');
  const snapPrevLen = snap?.prev_length_m;
  const hasSnapLen = snapPrevLen != null && Number.isFinite(Number(snapPrevLen));

  let lengthM: number;
  if (hasSnapLen) {
    lengthM = round2(Number(snapPrevLen));
  } else {
    const qtySold = Number(snap?.qty_sold_m ?? qtyM);
    lengthM = round2(currentLengthM + (Number.isFinite(qtySold) ? qtySold : 0));
  }

  const prevSt = hasSnapLen ? String(snap?.prev_status ?? 'AVAILABLE') : currentStatus;
  const status = rollStatusAfterSalesVoid(prevSt, lengthM);
  return { rollId, lengthM, status };
}

/**
 * إصلاح أتواب عالقة (SOLD/RESERVED) بعد إلغاء فاتورة بيع سابقة — يُستدعى عند البحث للبيع.
 */
export async function repairRollStuckAfterVoidedSale(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  identityToken: string,
): Promise<boolean> {
  const token = String(identityToken ?? '').trim();
  if (!token) return false;

  const stuck = await client.query<{
    roll_id: string;
    length_m: string;
    status: string;
    metadata: unknown;
    quantity: string;
    unit: string;
    invoice_id: string;
    invoice_no: string;
  }>(
    `SELECT fr.id AS roll_id, fr.length_m, fr.status,
            sil.metadata, sil.quantity, sil.unit,
            si.id AS invoice_id, si.invoice_no
       FROM fabric_rolls fr
       INNER JOIN sales_invoice_lines sil
         ON sil.fabric_roll_id = fr.id AND sil.company_id = fr.company_id
       INNER JOIN sales_invoices si
         ON si.id = sil.invoice_id AND si.company_id = sil.company_id
      WHERE fr.company_id = $1
        AND si.document_status = 'VOIDED'
        AND fr.status IN ('SOLD', 'RESERVED')
        AND (
          lower(trim(fr.barcode)) = lower($2::text)
          OR lower(trim(coalesce(fr.roll_no, ''))) = lower($2::text)
          OR lower(trim(coalesce(fr.supplier_roll_ref, ''))) = lower($2::text)
        )
      ORDER BY si.voided_at DESC NULLS LAST, si.updated_at DESC
      LIMIT 1`,
    [companyId, token],
  );
  if (!stuck.rows.length) return false;

  const row = stuck.rows[0];
  const snap = parseSalesLineMetadata({ metadata: row.metadata }).inventory as
    | {
        fabric_roll_id?: string;
        prev_length_m?: number;
        prev_status?: string;
        qty_sold_m?: number;
      }
    | undefined;

  const target = resolveVoidRollRestoreTarget(
    {
      quantity: row.quantity,
      unit: row.unit,
      fabric_roll_id: row.roll_id,
      metadata: row.metadata,
    },
    snap,
    Number(row.length_m),
    row.status,
  );
  if (!target.rollId) return false;

  const qtySold = round2(target.lengthM - Number(row.length_m));
  await client.query(
    `UPDATE fabric_rolls SET length_m=$3, status=$4, updated_at=now() WHERE id=$1 AND company_id=$2`,
    [target.rollId, companyId, target.lengthM, target.status],
  );
  await client.query(
    `INSERT INTO inventory_movements (
       company_id, roll_id, movement_type, old_status, new_status,
       length_delta_m, reference_type, reference_id, reference_no, notes, created_by_user_id
     ) VALUES ($1,$2,'RETURN',$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      companyId,
      target.rollId,
      row.status,
      target.status,
      qtySold > EPS
        ? qtySold
        : snap?.qty_sold_m ?? quantityToMeters(Number(row.quantity), (row.unit as 'meter' | 'yard') || 'meter'),
      'SALES_INVOICE_VOID',
      row.invoice_id,
      row.invoice_no,
      `إصلاح تلقائي بعد إلغاء — ${row.invoice_no}`,
      userId,
    ],
  );
  return true;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** يعيد fabric_roll_id من السطر أو يبحث بالباركود/رقم الثوب في metadata. */
export async function resolveSalesInvoiceLineRollId(
  client: PoolClient,
  companyId: string,
  ln: { fabric_roll_id: string | null; metadata: unknown },
  opts: { requireAvailable?: boolean } = {},
): Promise<string | null> {
  return resolveFabricRollIdForSalesLine(client, companyId, ln, opts);
}

async function resolveFabricRollIdForSalesLine(
  client: PoolClient,
  companyId: string,
  ln: { fabric_roll_id: string | null; metadata: unknown },
  opts: { requireAvailable?: boolean } = {},
): Promise<string | null> {
  const requireAvailable = opts.requireAvailable !== false;
  const linked = ln.fabric_roll_id as string | null;
  if (linked) return linked;

  const meta = parseSalesLineMetadata(ln);
  for (const key of ['internalRollId', 'fabricRollId']) {
    const id = String(meta[key] ?? '').trim();
    if (!UUID_RE.test(id)) continue;
    const r = await client.query<{ id: string }>(
      `SELECT id FROM fabric_rolls
       WHERE company_id = $1 AND id = $2::uuid
         ${requireAvailable ? "AND status = 'AVAILABLE' AND length_m > 0" : ''}
       LIMIT 1`,
      [companyId, id],
    );
    if (r.rows.length) return r.rows[0].id;
  }

  const tokens = [
    meta.barcode,
    meta.supplierBarcode,
    meta.printBarcode,
    meta.rollNo,
    meta.rollNumber,
  ]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);

  for (const token of tokens) {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM fabric_rolls
       WHERE company_id = $1
         AND status = 'AVAILABLE'
         AND length_m > 0
         AND (
           lower(trim(barcode)) = lower($2::text)
           OR lower(trim(coalesce(roll_no, ''))) = lower($2::text)
           OR lower(trim(coalesce(supplier_roll_ref, ''))) = lower($2::text)
         )
       ORDER BY created_at ASC
       LIMIT 1`,
      [companyId, token],
    );
    if (r.rows.length) return r.rows[0].id;
  }
  return null;
}

/** يربط أسطر فاتورة المبيعات بأتواب المخزون عند غياب fabric_roll_id. */
export async function backfillSalesInvoiceLineRollLinks(
  client: PoolClient,
  companyId: string,
  invoiceId: string,
): Promise<number> {
  const lines = await client.query<{ id: string; fabric_roll_id: string | null; metadata: unknown }>(
    `SELECT id, fabric_roll_id, metadata FROM sales_invoice_lines WHERE invoice_id=$1 AND company_id=$2`,
    [invoiceId, companyId],
  );
  let updated = 0;
  for (const ln of lines.rows) {
    if (ln.fabric_roll_id) continue;
    const rollId = await resolveFabricRollIdForSalesLine(client, companyId, ln);
    if (!rollId) continue;
    await client.query(
      `UPDATE sales_invoice_lines SET fabric_roll_id=$3 WHERE id=$1 AND company_id=$2`,
      [ln.id, companyId, rollId],
    );
    updated += 1;
  }
  return updated;
}

const DRAFT_SALE_RESERVE_REF = 'SALES_INVOICE_DRAFT';

async function rollLinkedToOtherDraftSale(
  client: PoolClient,
  companyId: string,
  rollId: string,
  excludeInvoiceId: string,
): Promise<boolean> {
  const r = await client.query<{ id: string }>(
    `SELECT si.id
     FROM sales_invoice_lines sil
     INNER JOIN sales_invoices si
       ON si.id = sil.invoice_id AND si.company_id = sil.company_id
     WHERE sil.company_id = $1
       AND sil.fabric_roll_id = $2::uuid
       AND si.document_status = 'DRAFT'
       AND si.id <> $3::uuid
     LIMIT 1`,
    [companyId, rollId, excludeInvoiceId],
  );
  return r.rows.length > 0;
}

async function releaseDraftSalesRollReservation(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  rollId: string,
  invoiceId: string,
  invoiceNo: string,
): Promise<void> {
  if (await rollLinkedToOtherDraftSale(client, companyId, rollId, invoiceId)) return;

  const rollRow = await client.query<{ status: string }>(
    `SELECT status FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [rollId, companyId],
  );
  if (!rollRow.rows.length || rollRow.rows[0].status !== 'RESERVED') return;

  await client.query(
    `UPDATE fabric_rolls SET status='AVAILABLE', updated_at=now() WHERE id=$1 AND company_id=$2`,
    [rollId, companyId],
  );
  await client.query(
    `INSERT INTO inventory_movements (
       company_id, roll_id, movement_type, old_status, new_status,
       reference_type, reference_id, reference_no, notes, created_by_user_id
     ) VALUES ($1,$2,'RELEASE_RESERVATION',$3,$4,$5,$6,$7,$8,$9)`,
    [
      companyId,
      rollId,
      'RESERVED',
      'AVAILABLE',
      DRAFT_SALE_RESERVE_REF,
      invoiceId,
      invoiceNo,
      `إلغاء حجز — مسودة ${invoiceNo}`,
      userId,
    ],
  );
}

async function reserveDraftSalesRoll(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  rollId: string,
  invoiceId: string,
  invoiceNo: string,
): Promise<void> {
  const rollRow = await client.query<{ status: string }>(
    `SELECT status FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [rollId, companyId],
  );
  if (!rollRow.rows.length) return;
  const status = rollRow.rows[0].status;
  if (status === 'RESERVED') return;
  if (status !== 'AVAILABLE') {
    throw Object.assign(
      new Error(`الثوب ${rollId} غير متاح للحجز (الحالة: ${status})`),
      { code: 'INVALID_STOCK' },
    );
  }

  await client.query(
    `UPDATE fabric_rolls SET status='RESERVED', updated_at=now() WHERE id=$1 AND company_id=$2`,
    [rollId, companyId],
  );
  await client.query(
    `INSERT INTO inventory_movements (
       company_id, roll_id, movement_type, old_status, new_status,
       reference_type, reference_id, reference_no, notes, created_by_user_id
     ) VALUES ($1,$2,'RESERVE',$3,$4,$5,$6,$7,$8,$9)`,
    [
      companyId,
      rollId,
      'AVAILABLE',
      'RESERVED',
      DRAFT_SALE_RESERVE_REF,
      invoiceId,
      invoiceNo,
      `حجز — مسودة بيع ${invoiceNo}`,
      userId,
    ],
  );
}

/** يحجز أتواب أسطر المسودة ويحرّر الأتواب التي أُزيلت من الفاتورة. */
export async function syncDraftSalesInvoiceRollReservations(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  invoiceId: string,
  opts: { previousRollIds?: string[] } = {},
): Promise<void> {
  const inv = await client.query<{ invoice_no: string; document_status: string }>(
    `SELECT invoice_no, document_status FROM sales_invoices WHERE id=$1 AND company_id=$2`,
    [invoiceId, companyId],
  );
  if (!inv.rows.length || inv.rows[0].document_status !== 'DRAFT') return;
  const invoiceNo = String(inv.rows[0].invoice_no);

  const lineRows = await client.query<{ fabric_roll_id: string }>(
    `SELECT fabric_roll_id FROM sales_invoice_lines
     WHERE invoice_id=$1 AND company_id=$2 AND fabric_roll_id IS NOT NULL`,
    [invoiceId, companyId],
  );
  const nextRollIds = [...new Set(lineRows.rows.map((r) => r.fabric_roll_id))];
  const prevRollIds = opts.previousRollIds ?? [];
  const nextSet = new Set(nextRollIds);

  for (const rollId of prevRollIds) {
    if (!nextSet.has(rollId)) {
      await releaseDraftSalesRollReservation(client, companyId, userId, rollId, invoiceId, invoiceNo);
    }
  }
  for (const rollId of nextRollIds) {
    await reserveDraftSalesRoll(client, companyId, userId, rollId, invoiceId, invoiceNo);
  }
}

export async function releaseAllDraftSalesInvoiceRollReservations(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  invoiceId: string,
): Promise<void> {
  const inv = await client.query<{ invoice_no: string; document_status: string }>(
    `SELECT invoice_no, document_status FROM sales_invoices WHERE id=$1 AND company_id=$2`,
    [invoiceId, companyId],
  );
  if (!inv.rows.length || inv.rows[0].document_status !== 'DRAFT') return;
  const invoiceNo = String(inv.rows[0].invoice_no);

  const lineRows = await client.query<{ fabric_roll_id: string }>(
    `SELECT DISTINCT fabric_roll_id FROM sales_invoice_lines
     WHERE invoice_id=$1 AND company_id=$2 AND fabric_roll_id IS NOT NULL`,
    [invoiceId, companyId],
  );
  for (const row of lineRows.rows) {
    await releaseDraftSalesRollReservation(
      client,
      companyId,
      userId,
      row.fabric_roll_id,
      invoiceId,
      invoiceNo,
    );
  }
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
    let fabricRollId = ln.fabricRollId ?? null;
    if (!fabricRollId) {
      fabricRollId = await resolveFabricRollIdForSalesLine(client, companyId, {
        fabric_roll_id: null,
        metadata: ln.metadata ?? {},
      });
    }
    const unitPriceUsd = ln.unitPriceUsd ?? computeUsd4(ln.unitPrice, exchangeRateToUsd);
    const lineDiscountUsd = ln.lineDiscountUsd ?? computeUsd(ln.lineDiscount, exchangeRateToUsd);
    const lineTaxUsd = ln.lineTaxUsd ?? computeUsd(ln.lineTax, exchangeRateToUsd);
    const lineTotalUsd = ln.lineTotalUsd ?? computeUsd(ln.lineTotal, exchangeRateToUsd);
    await client.query(
      `INSERT INTO sales_invoice_lines (
         company_id, invoice_id, line_no, fabric_roll_id, fabric_item_id, variant_id, warehouse_id,
         description, quantity, unit, unit_price, line_discount, line_tax, line_total,
         unit_price_usd, line_discount_usd, line_tax_usd, line_total_usd, metadata, customer_order_line_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20)`,
      [
        companyId,
        invoiceId,
        i,
        fabricRollId,
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
        ln.customerOrderLineId ??
          (typeof ln.metadata?.customerOrderLineId === 'string' ? ln.metadata.customerOrderLineId : null),
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
    `SELECT sil.*,
            fi.internal_code AS item_internal_code,
            fi.supplier_code AS item_supplier_code
     FROM sales_invoice_lines sil
     LEFT JOIN fabric_rolls fr ON fr.id = sil.fabric_roll_id AND fr.company_id = sil.company_id
     LEFT JOIN fabric_items fi ON fi.id = COALESCE(sil.fabric_item_id, fr.item_id) AND fi.company_id = sil.company_id
     WHERE sil.invoice_id=$1 AND sil.company_id=$2
     ORDER BY sil.line_no`,
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
  assertSalesInvoiceLinesHaveMeterPrice(d.lines);

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
  if (d.customerOrderId) {
    await assertSalesInvoiceCustomerMatchesOrder(client, companyId, d.customerOrderId, d.customerId);
  }

  const pay = paymentStatuses(d.totalAmount, d.paidAmount);
  const remainingUsd = computeUsd(pay.remaining, exchangeRateToUsd);

  const ins = await client.query<{ id: string }>(
    `INSERT INTO sales_invoices (
       company_id, invoice_no, invoice_date, customer_id, warehouse_id, warehouse_label,
       currency_code, notes, subtotal, discount_total, tax_total, total_amount,
       paid_amount, remaining_amount, payment_status, document_status,
       exchange_rate_to_usd, subtotal_usd, discount_total_usd, tax_total_usd, total_amount_usd,
       paid_amount_usd, remaining_amount_usd, customer_order_id,
       created_by_user_id, updated_by_user_id
     ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'DRAFT',$16,$17,$18,$19,$20,$21,$22,$23,$24,$24)
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
      d.customerOrderId ?? null,
      userId,
    ],
  );

  const invoiceId = ins.rows[0].id;
  const linesToSave = prepareSalesInvoiceLines(d.lines, d.discountTotal, d.subtotal, d.taxTotal, d.totalAmount);
  await insertLines(client, companyId, invoiceId, exchangeRateToUsd, linesToSave);
  await backfillSalesInvoiceLineRollLinks(client, companyId, invoiceId);
  await syncDraftSalesInvoiceRollReservations(client, companyId, userId, invoiceId);

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
  if (d.customerOrderId) {
    const customerId = d.customerId ?? (await client.query(`SELECT customer_id FROM sales_invoices WHERE id=$1`, [invoiceId])).rows[0]?.customer_id;
    if (customerId) {
      await assertSalesInvoiceCustomerMatchesOrder(client, companyId, d.customerOrderId, String(customerId));
    }
  }

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
       customer_order_id = COALESCE($25, customer_order_id),
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
      d.customerOrderId ?? null,
    ],
  );

  if (d.lines && d.lines.length > 0) {
    const oldRollRows = await client.query<{ fabric_roll_id: string }>(
      `SELECT DISTINCT fabric_roll_id FROM sales_invoice_lines
       WHERE invoice_id=$1 AND company_id=$2 AND fabric_roll_id IS NOT NULL`,
      [invoiceId, companyId],
    );
    const previousRollIds = oldRollRows.rows.map((r) => r.fabric_roll_id);

    const linesToSave = prepareSalesInvoiceLines(
      d.lines,
      nextDiscount,
      nextSubtotal,
      nextTax,
      nextTotal,
    );
    await client.query(`DELETE FROM sales_invoice_lines WHERE invoice_id=$1 AND company_id=$2`, [invoiceId, companyId]);
    await insertLines(client, companyId, invoiceId, nextRate, linesToSave);
    await backfillSalesInvoiceLineRollLinks(client, companyId, invoiceId);
    await syncDraftSalesInvoiceRollReservations(client, companyId, userId, invoiceId, { previousRollIds });
  }

  const persistedLines = await client.query<{ quantity: string; unit: string; unit_price: string }>(
    `SELECT quantity, unit, unit_price FROM sales_invoice_lines WHERE invoice_id=$1 AND company_id=$2 ORDER BY line_no`,
    [invoiceId, companyId],
  );
  assertSalesInvoiceLinesHaveMeterPrice(persistedLines.rows);
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
  await releaseAllDraftSalesInvoiceRollReservations(client, companyId, null, invoiceId);
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

  assertSalesInvoiceLinesHaveMeterPrice(lines.rows);

  const linesForCogs: { quantityMeters: number; unitCostPerMeter: number | null }[] = [];

  for (const ln of lines.rows) {
    const qtyM = quantityToMeters(Number(ln.quantity), ln.unit as 'meter' | 'yard');

    if (isStatementImportLineMetadata(ln.metadata)) {
      const meta = parseSalesLineMetadata(ln);
      meta.inventory = { skipped: true, reason: 'STATEMENT_IMPORT' };
      await client.query(
        `UPDATE sales_invoice_lines SET
           metadata=$3::jsonb,
           cost_missing=true,
           cost_source='MISSING'
         WHERE id=$1 AND company_id=$2`,
        [ln.id, companyId, JSON.stringify(meta)],
      );
      continue;
    }

    let rollId = await resolveFabricRollIdForSalesLine(client, companyId, ln);
    if (!rollId) {
      if (qtyM > EPS) {
        throw Object.assign(
          new Error('سطر الفاتورة غير مربوط بثوب في المخزون — لا يمكن تأكيد البيع'),
          { code: 'VALIDATION' },
        );
      }
      continue;
    }

    if (!ln.fabric_roll_id) {
      await client.query(
        `UPDATE sales_invoice_lines SET fabric_roll_id=$3 WHERE id=$1 AND company_id=$2`,
        [ln.id, companyId, rollId],
      );
    }

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
    if (roll.status !== 'AVAILABLE' && roll.status !== 'RESERVED') {
      throw Object.assign(new Error(`الثوب ${rollId} غير متاح للبيع`), { code: 'INVALID_STOCK' });
    }
    if (roll.status === 'RESERVED') {
      const reservedForThis = await client.query<{ id: string }>(
        `SELECT id FROM sales_invoice_lines
         WHERE invoice_id=$1 AND company_id=$2 AND fabric_roll_id=$3::uuid
         LIMIT 1`,
        [invoiceId, companyId, rollId],
      );
      if (!reservedForThis.rows.length) {
        throw Object.assign(new Error('الثوب محجوز لفاتورة مسودة أخرى'), { code: 'INVALID_STOCK' });
      }
    }

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
    const fullSale = soldQty >= len - EPS || newLen <= EPS;
    const preSaleStatus = roll.status === 'RESERVED' ? 'AVAILABLE' : roll.status;

    let meta: Record<string, unknown> = parseSalesLineMetadata(ln);
    meta.inventory = {
      fabric_roll_id: rollId,
      prev_length_m: len,
      prev_status: preSaleStatus,
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
        `UPDATE fabric_rolls SET length_m=$3, status='AVAILABLE', updated_at=now() WHERE id=$1 AND company_id=$2`,
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

  await syncCustomerOrderFulfillmentForInvoice(client, companyId, invoiceId, userId);
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
    const meta = parseSalesLineMetadata(ln);
    const snap = meta.inventory as
      | {
          fabric_roll_id?: string;
          prev_length_m?: number;
          prev_status?: string;
          qty_sold_m?: number;
        }
      | undefined;

    const rollId = String(snap?.fabric_roll_id ?? ln.fabric_roll_id ?? '').trim();
    if (!rollId) continue;

    const r = await client.query<{ length_m: string; status: string }>(
      `SELECT length_m, status FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`,
      [rollId, companyId],
    );
    if (!r.rows.length) continue;

    const target = resolveVoidRollRestoreTarget(
      ln,
      snap,
      Number(r.rows[0].length_m),
      r.rows[0].status,
    );
    if (!target.rollId) continue;

    const qtySold = round2(
      target.lengthM - Number(r.rows[0].length_m),
    );

    await client.query(
      `UPDATE fabric_rolls SET length_m=$3, status=$4, updated_at=now() WHERE id=$1 AND company_id=$2`,
      [rollId, companyId, target.lengthM, target.status],
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
        target.status,
        qtySold > EPS
          ? qtySold
          : snap?.qty_sold_m ?? quantityToMeters(Number(ln.quantity), (ln.unit as 'meter' | 'yard') || 'meter'),
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

  await syncCustomerOrderFulfillmentForInvoice(client, companyId, invoiceId, userId);
}
