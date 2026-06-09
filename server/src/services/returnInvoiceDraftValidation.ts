import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getSourcePurchaseInvoiceForReturn, getSourceSalesInvoiceForReturn } from './returnInvoiceEligibilityService.js';
import { assertQtyWithinAvailable, returnQtyToMeters } from './returnInvoiceQtyHelpers.js';
import type { ReturnLineStockInput } from './returnInvoiceStockService.js';
import { validateReturnStockLineCoverage } from './returnInvoiceStockService.js';

const EPS = 1e-4;

/** Exported for tests — true when settlement forbids any roll-linked quantity. */
export function noFinancialEffectConflictsWithPhysicalLines(
  settlementType: string,
  lines: Array<{ fabricRollId: string | null; quantity: number }>,
): boolean {
  if (settlementType !== 'NO_FINANCIAL_EFFECT') return false;
  return lines.some((l) => l.fabricRollId != null && l.quantity > EPS);
}

export const settlementTypeSchema = z.enum(['CREDIT_BALANCE', 'CASH_REFUND', 'MIXED', 'NO_FINANCIAL_EFFECT']);

export const draftLineSchema = z.object({
  description: z.string().min(1, 'وصف السطر مطلوب'),
  quantity: z.coerce.number().nonnegative(),
  unitPrice: z.coerce.number().nonnegative(),
  unit: z.enum(['meter', 'yard']).optional().default('meter'),
  fabricRollId: z.string().uuid().optional().nullable(),
  fabricItemId: z.string().uuid().optional().nullable(),
  originalSalesInvoiceLineId: z.string().uuid().optional().nullable(),
  originalPurchaseInvoiceLineId: z.string().uuid().optional().nullable(),
  returnReason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const createReturnBodySchema = z.object({
  returnType: z.enum(['SALES_RETURN', 'PURCHASE_RETURN']),
  customerId: z.string().uuid().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  originalSalesInvoiceId: z.string().uuid().optional().nullable(),
  originalPurchaseInvoiceId: z.string().uuid().optional().nullable(),
  originalInvoiceNo: z.string().optional().nullable(),
  returnDate: z.string().optional(),
  currencyCode: z.string().min(1).default('USD'),
  exchangeRateToUsd: z.coerce.number().optional(),
  discountTotal: z.coerce.number().nonnegative().default(0),
  taxTotal: z.coerce.number().nonnegative().default(0),
  notes: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
  settlementType: settlementTypeSchema.optional().default('CREDIT_BALANCE'),
  lines: z.array(draftLineSchema).min(1, 'سطر واحد على الأقل'),
});

export type CreateReturnBody = z.infer<typeof createReturnBodySchema>;

export type NormalizedReturnLine = {
  description: string;
  quantity: number;
  unit: 'meter' | 'yard';
  unitPrice: number;
  lineTotal: number;
  fabricRollId: string | null;
  fabricItemId: string | null;
  originalSalesInvoiceLineId: string | null;
  originalPurchaseInvoiceLineId: string | null;
  returnedFromQuantity: number | null;
  returnReason: string | null;
  notes: string | null;
};

export type ValidatedReturnDraft = {
  linked: boolean;
  settlementType: string;
  reason: string | null;
  originalSalesInvoiceId: string | null;
  originalPurchaseInvoiceId: string | null;
  currencyCode: string;
  exchangeRateToUsd: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  totalAmount: number;
  lines: NormalizedReturnLine[];
  stockInputs: ReturnLineStockInput[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function validateAndBuildReturnDraft(
  client: PoolClient,
  companyId: string,
  data: CreateReturnBody,
  opts: { excludeReturnId: string | null },
): Promise<ValidatedReturnDraft> {
  const st = data.settlementType ?? 'CREDIT_BALANCE';
  if (st === 'MIXED') {
    throw Object.assign(
      new Error('تسوية مختلطة غير مفعّلة بعد — استخدم تخفيض ذمة أو رد نقدي أو بدون أثر مالي'),
      { code: 'VALIDATION' },
    );
  }

  if (data.returnType === 'SALES_RETURN' && data.supplierId) {
    throw Object.assign(new Error('مرتجع المبيعات لا يقبل مورداً'), { code: 'VALIDATION' });
  }
  if (data.returnType === 'PURCHASE_RETURN' && data.customerId) {
    throw Object.assign(new Error('مرتجع المشتريات لا يقبل عميلاً'), { code: 'VALIDATION' });
  }

  const linkedSales = data.originalSalesInvoiceId != null;
  const linkedPurchase = data.originalPurchaseInvoiceId != null;
  if (linkedSales && linkedPurchase) {
    throw Object.assign(new Error('لا يمكن ربط مرتجع بفاتورة بيع وشراء معاً'), { code: 'VALIDATION' });
  }
  const linked = linkedSales || linkedPurchase;

  if (data.returnType === 'SALES_RETURN' && linked && !linkedSales) {
    throw Object.assign(new Error('مرتجع المبيعات المرتبط يتطلب فاتورة بيع أصلية'), { code: 'VALIDATION' });
  }
  if (data.returnType === 'PURCHASE_RETURN' && linked && !linkedPurchase) {
    throw Object.assign(new Error('مرتجع المشتريات المرتبط يتطلب فاتورة شراء أصلية'), { code: 'VALIDATION' });
  }

  let currencyCode = String(data.currencyCode || 'USD').trim().toUpperCase();
  let exchangeRateToUsd = data.exchangeRateToUsd != null ? Number(data.exchangeRateToUsd) : NaN;

  const normalizedLines: NormalizedReturnLine[] = [];
  let subtotal = 0;

  if (linkedSales) {
    const src = await getSourceSalesInvoiceForReturn(client, companyId, data.originalSalesInvoiceId!, opts.excludeReturnId);
    if (!src) throw Object.assign(new Error('فاتورة البيع غير موجودة أو غير مؤكدة'), { code: 'NOT_FOUND' });
    const h = src.header as { customer_id: string; currency_code: string; exchange_rate_to_usd?: string | number };
    if (String(h.customer_id) !== String(data.customerId)) {
      throw Object.assign(new Error('العميل لا يطابق فاتورة البيع الأصلية'), { code: 'VALIDATION' });
    }
    currencyCode = String(h.currency_code || 'USD').trim().toUpperCase();
    exchangeRateToUsd = Number(h.exchange_rate_to_usd ?? 1) || 1;
    if (currencyCode === 'USD') exchangeRateToUsd = 1;

    const lineMap = new Map(src.lines.map((l) => [l.id, l]));

    for (const ln of data.lines) {
      let up = ln.unitPrice;
      let desc = ln.description;
      let fr = ln.fabricRollId ?? null;
      let fi = ln.fabricItemId ?? null;
      let osId = ln.originalSalesInvoiceLineId ?? null;

      if (ln.quantity > EPS) {
        if (!osId) {
          throw Object.assign(new Error('كل بنود الكمية يجب أن ترتبط بسطر فاتورة البيع الأصلية'), { code: 'VALIDATION' });
        }
        const srcLn = lineMap.get(osId);
        if (!srcLn) {
          throw Object.assign(new Error('سطر غير موجود في فاتورة البيع الأصلية'), { code: 'VALIDATION' });
        }
        if (srcLn.fabric_roll_id && fr && String(fr) !== String(srcLn.fabric_roll_id)) {
          throw Object.assign(new Error(`التوب المختار لا يطابق سطر الفاتورة (${srcLn.barcode ?? ''})`), { code: 'VALIDATION' });
        }
        if (!fr && srcLn.fabric_roll_id) {
          fr = srcLn.fabric_roll_id;
        }
        if (!fi && srcLn.fabric_item_id) {
          fi = srcLn.fabric_item_id;
        }
        if (up <= 0) {
          up = Number(srcLn.unit_price);
        }
        if (!desc?.trim()) desc = srcLn.description || 'بند مرتجع';

        const reqM = returnQtyToMeters(ln.quantity, ln.unit ?? 'meter');
        assertQtyWithinAvailable(reqM, srcLn.available_meters, `سطر ${srcLn.line_no}`);
      }

      const lt = round2(ln.quantity * up);
      subtotal += lt;

      normalizedLines.push({
        description: desc.trim() || 'بند مرتجع',
        quantity: ln.quantity,
        unit: ln.unit ?? 'meter',
        unitPrice: up,
        lineTotal: lt,
        fabricRollId: fr,
        fabricItemId: fi,
        originalSalesInvoiceLineId: osId,
        originalPurchaseInvoiceLineId: null,
        returnedFromQuantity: osId && ln.quantity > EPS ? ln.quantity : null,
        returnReason: ln.returnReason ?? null,
        notes: ln.notes ?? null,
      });
    }
  } else if (linkedPurchase) {
    const src = await getSourcePurchaseInvoiceForReturn(client, companyId, data.originalPurchaseInvoiceId!, opts.excludeReturnId);
    if (!src) throw Object.assign(new Error('فاتورة الشراء غير موجودة أو غير مؤكدة'), { code: 'NOT_FOUND' });
    const h = src.header as { supplier_id: string; currency_code: string; exchange_rate_to_usd?: string | number };
    if (String(h.supplier_id) !== String(data.supplierId)) {
      throw Object.assign(new Error('المورد لا يطابق فاتورة الشراء الأصلية'), { code: 'VALIDATION' });
    }
    currencyCode = String(h.currency_code || 'USD').trim().toUpperCase();
    exchangeRateToUsd = Number(h.exchange_rate_to_usd ?? 1) || 1;
    if (currencyCode === 'USD') exchangeRateToUsd = 1;

    const lineMap = new Map(src.lines.map((l) => [l.id, l]));

    for (const ln of data.lines) {
      let up = ln.unitPrice;
      let opId = ln.originalPurchaseInvoiceLineId ?? null;
      let desc = ln.description;
      let fr = ln.fabricRollId ?? null;
      let fi = ln.fabricItemId ?? null;

      if (ln.quantity > EPS) {
        if (!opId) {
          throw Object.assign(new Error('كل بنود الكمية يجب أن ترتبط بسطر فاتورة الشراء الأصلية'), { code: 'VALIDATION' });
        }
        const srcLn = lineMap.get(opId);
        if (!srcLn) {
          throw Object.assign(new Error('سطر غير موجود في فاتورة الشراء الأصلية'), { code: 'NOT_FOUND' });
        }
        if (srcLn.fabric_roll_id && fr && String(fr) !== String(srcLn.fabric_roll_id)) {
          throw Object.assign(new Error(`التوب لا يطابق سطر فاتورة الشراء (${srcLn.barcode ?? ''})`), { code: 'VALIDATION' });
        }
        if (!fr && srcLn.fabric_roll_id) fr = srcLn.fabric_roll_id;
        if (!fi && srcLn.fabric_item_id) fi = srcLn.fabric_item_id;
        if (up <= 0) up = Number(srcLn.unit_price);
        if (!desc?.trim()) desc = srcLn.description || 'بند مرتجع';

        const reqM = returnQtyToMeters(ln.quantity, ln.unit ?? 'meter');
        assertQtyWithinAvailable(reqM, srcLn.available_meters, `سطر ${srcLn.line_no}`);
      }

      const lt = round2(ln.quantity * up);
      subtotal += lt;

      normalizedLines.push({
        description: desc.trim() || 'بند مرتجع',
        quantity: ln.quantity,
        unit: ln.unit ?? 'meter',
        unitPrice: up,
        lineTotal: lt,
        fabricRollId: fr,
        fabricItemId: fi,
        originalSalesInvoiceLineId: null,
        originalPurchaseInvoiceLineId: opId,
        returnedFromQuantity: opId && ln.quantity > EPS ? ln.quantity : null,
        returnReason: ln.returnReason ?? null,
        notes: ln.notes ?? null,
      });
    }
  } else {
    if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
      exchangeRateToUsd = currencyCode === 'USD' ? 1 : NaN;
    }
    for (const ln of data.lines) {
      const up = ln.unitPrice;
      const lt = round2(ln.quantity * up);
      subtotal += lt;
      normalizedLines.push({
        description: ln.description.trim(),
        quantity: ln.quantity,
        unit: ln.unit ?? 'meter',
        unitPrice: up,
        lineTotal: lt,
        fabricRollId: ln.fabricRollId ?? null,
        fabricItemId: ln.fabricItemId ?? null,
        originalSalesInvoiceLineId: null,
        originalPurchaseInvoiceLineId: null,
        returnedFromQuantity: null,
        returnReason: ln.returnReason ?? null,
        notes: ln.notes ?? null,
      });
    }
  }

  const totalAmount = round2(subtotal - data.discountTotal + data.taxTotal);
  if (st === 'NO_FINANCIAL_EFFECT' && Math.abs(totalAmount) > EPS) {
    throw Object.assign(
      new Error('نوع «بدون أثر مالي» يتطلب أن يكون إجمالي المرتجع صفراً'),
      { code: 'VALIDATION' },
    );
  }

  if (noFinancialEffectConflictsWithPhysicalLines(st, normalizedLines)) {
    throw Object.assign(
      new Error('نوع «بدون أثر مالي» لا يسمح بربط توب أو حركة مخزون — أزل التوب أو اختر تخفيض ذمة'),
      { code: 'VALIDATION' },
    );
  }

  const stockInputs: ReturnLineStockInput[] = normalizedLines.map((l) => ({
    fabricRollId: l.fabricRollId,
    quantity: l.quantity,
    unit: l.unit,
  }));

  if (!linked) {
    validateReturnStockLineCoverage(stockInputs);
  } else {
    const anyRoll = stockInputs.some((s) => s.fabricRollId && s.quantity > EPS);
    if (anyRoll) {
      validateReturnStockLineCoverage(stockInputs);
    }
  }

  return {
    linked,
    settlementType: st,
    reason: data.reason?.trim() || null,
    originalSalesInvoiceId: linkedSales ? data.originalSalesInvoiceId! : null,
    originalPurchaseInvoiceId: linkedPurchase ? data.originalPurchaseInvoiceId! : null,
    currencyCode,
    exchangeRateToUsd,
    subtotal: round2(subtotal),
    discountTotal: data.discountTotal,
    taxTotal: data.taxTotal,
    totalAmount,
    lines: normalizedLines,
    stockInputs,
  };
}

/** Rebuild request body from persisted return (for confirm-time revalidation). */
export async function loadReturnInvoiceAsDraftBody(
  client: PoolClient,
  companyId: string,
  returnId: string,
): Promise<CreateReturnBody | null> {
  const head = await client.query(
    `SELECT return_type, customer_id, supplier_id, original_invoice_no, return_date, currency_code,
            exchange_rate_to_usd, discount_total, tax_total, notes,
            reason, settlement_type,
            original_sales_invoice_id, original_purchase_invoice_id
     FROM return_invoices WHERE id = $1 AND company_id = $2`,
    [returnId, companyId],
  );
  if (!head.rows.length) return null;
  const r = head.rows[0] as Record<string, unknown>;
  const rd = r.return_date as Date | string;
  const returnDate =
    rd instanceof Date ? rd.toISOString().slice(0, 10) : String(rd).slice(0, 10);

  const lines = await client.query(
    `SELECT description, quantity, COALESCE(unit, 'meter') AS unit, unit_price,
            fabric_roll_id, fabric_item_id, notes,
            original_sales_invoice_line_id, original_purchase_invoice_line_id,
            returned_from_quantity, return_reason
     FROM return_invoice_lines
     WHERE return_invoice_id = $1 AND company_id = $2
     ORDER BY id ASC`,
    [returnId, companyId],
  );

  return {
    returnType: r.return_type as 'SALES_RETURN' | 'PURCHASE_RETURN',
    customerId: (r.customer_id as string | null) ?? null,
    supplierId: (r.supplier_id as string | null) ?? null,
    originalSalesInvoiceId: (r.original_sales_invoice_id as string | null) ?? null,
    originalPurchaseInvoiceId: (r.original_purchase_invoice_id as string | null) ?? null,
    originalInvoiceNo: (r.original_invoice_no as string | null) ?? null,
    returnDate,
    currencyCode: String(r.currency_code || 'USD'),
    exchangeRateToUsd: Number(r.exchange_rate_to_usd ?? 1),
    discountTotal: Number(r.discount_total ?? 0),
    taxTotal: Number(r.tax_total ?? 0),
    notes: (r.notes as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    settlementType: (() => {
      const stParse = settlementTypeSchema.safeParse(r.settlement_type ?? 'CREDIT_BALANCE');
      return stParse.success ? stParse.data : 'CREDIT_BALANCE';
    })(),
    lines: lines.rows.map((ln) => ({
      description: String(ln.description),
      quantity: Number(ln.quantity),
      unitPrice: Number(ln.unit_price),
      unit: (ln.unit === 'yard' ? 'yard' : 'meter') as 'meter' | 'yard',
      fabricRollId: (ln.fabric_roll_id as string | null) ?? null,
      fabricItemId: (ln.fabric_item_id as string | null) ?? null,
      originalSalesInvoiceLineId: (ln.original_sales_invoice_line_id as string | null) ?? null,
      originalPurchaseInvoiceLineId: (ln.original_purchase_invoice_line_id as string | null) ?? null,
      returnReason: (ln.return_reason as string | null) ?? null,
      notes: (ln.notes as string | null) ?? null,
    })),
  };
}
