import type { PoolClient } from 'pg';
import { z } from 'zod';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';
import { createProcessingExternalJob } from './externalJobService.js';
import { validateAndBuildReturnDraft, type CreateReturnBody } from './returnInvoiceDraftValidation.js';
import { createSalesInvoice } from './salesInvoiceService.js';

const createIntakeOperationSchema = z.object({
  // اختياري فقط عند actionType='RETURN' (الجهة الفعلية عميل لا مورّد) — يبقى
  // إلزامياً لكل الإجراءات الأخرى، يُتحقَّق منه صراحة بالأسفل.
  supplierId: z.string().uuid('المورد مطلوب').optional().nullable(),
  warehouseId: z.string().uuid('المستودع مطلوب'),
  actionType: z.enum(['PROCESSING', 'STOCK', 'RETURN', 'PURCHASE']),
  customerId: z.string().uuid().optional().nullable(),
  fabricStage: z.enum(['RAW', 'FINISHED']).optional().nullable(),
  preparationTypeId: z.string().uuid().optional().nullable(),
});

/** عند actionType='STOCK' فقط — الأتواب المُحدَّدة للبيع (بسعرها لكل منها)
 * وعميل واحد لها جميعاً؛ تُبنى منها فاتورة بيع واحدة حقيقية عند الإنهاء.
 * الأتواب غير المذكورة هنا تذهب لإرسالية المخزون كالمعتاد. */
const finalizeStockSaleSchema = z.object({
  customerId: z.string().uuid(),
  lines: z.array(z.object({
    rollId: z.string().uuid(),
    unitPrice: z.coerce.number().nonnegative(),
  })).min(1),
});

export type IntakeOperationRow = {
  id: string;
  company_id: string;
  order_no: string;
  supplier_id: string | null;
  warehouse_id: string;
  action_type: 'PROCESSING' | 'STOCK' | 'RETURN' | 'PURCHASE';
  customer_id: string | null;
  fabric_stage: 'RAW' | 'FINISHED' | null;
  preparation_type_id: string | null;
  status: 'DRAFT' | 'COMPLETED' | 'VOID';
  result_external_job_id: string | null;
  result_dispatch_slip_id: string | null;
  result_return_invoice_id: string | null;
  result_sales_invoice_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function createIntakeOperation(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  raw: unknown,
): Promise<IntakeOperationRow> {
  const input = createIntakeOperationSchema.parse(raw);

  if (input.actionType === 'RETURN' && !input.customerId) {
    throw Object.assign(new Error('إجراء "مرتجع" يتطلب اختيار عميل'), { code: 'VALIDATION' });
  }
  if (input.actionType === 'PROCESSING' && (!input.fabricStage || !input.preparationTypeId)) {
    throw Object.assign(
      new Error('إجراء "مصنعية" يتطلب مرحلة الخامة ونوع التجهيز'),
      { code: 'VALIDATION' },
    );
  }
  // "مرتجع": الجهة الفعلية عميل لا مورّد — المورّد غير مطلوب ولا يُتحقَّق منه
  // إطلاقاً بهذه الحالة. كل الإجراءات الأخرى تبقى تتطلب مورّداً كما كانت.
  if (input.actionType !== 'RETURN' && !input.supplierId) {
    throw Object.assign(new Error('المورد مطلوب'), { code: 'VALIDATION' });
  }

  if (input.actionType !== 'RETURN') {
    const supplierRow = await client.query<{ is_active: boolean; is_processing_party: boolean }>(
      `SELECT is_active, is_processing_party FROM suppliers WHERE id=$1 AND company_id=$2`,
      [input.supplierId, companyId],
    );
    if (!supplierRow.rows.length) throw Object.assign(new Error('المورد غير موجود'), { code: 'NOT_FOUND' });
    if (!supplierRow.rows[0].is_active) throw Object.assign(new Error('المورد غير نشط'), { code: 'VALIDATION' });
    if (input.actionType === 'PROCESSING' && !supplierRow.rows[0].is_processing_party) {
      throw Object.assign(new Error('هذا المورد ليس جهة تجهيز (مصبغة/مطبعة)'), { code: 'VALIDATION' });
    }
  }

  const whRow = await client.query<{ is_active: boolean; fabric_stage: string | null }>(
    `SELECT is_active, fabric_stage FROM warehouses WHERE id=$1 AND company_id=$2`,
    [input.warehouseId, companyId],
  );
  if (!whRow.rows.length) throw Object.assign(new Error('المستودع غير موجود'), { code: 'NOT_FOUND' });
  if (!whRow.rows[0].is_active) throw Object.assign(new Error('المستودع غير نشط'), { code: 'VALIDATION' });
  if (input.actionType === 'PROCESSING' && whRow.rows[0].fabric_stage !== input.fabricStage) {
    const current = whRow.rows[0].fabric_stage;
    throw Object.assign(
      new Error(
        current == null
          ? 'هذا المستودع غير مُصنَّف (خام/جاهز) بعد — صنّفه أولاً من إعدادات المستودعات'
          : `هذا المستودع مُصنَّف "${current === 'RAW' ? 'خام' : 'جاهز'}" ولا يطابق مرحلة الخامة المختارة`,
      ),
      { code: 'VALIDATION' },
    );
  }

  if (input.actionType === 'PROCESSING') {
    const prepRow = await client.query<{ is_active: boolean }>(
      `SELECT is_active FROM external_job_preparation_types WHERE id=$1 AND company_id=$2`,
      [input.preparationTypeId, companyId],
    );
    if (!prepRow.rows.length) throw Object.assign(new Error('نوع التجهيز غير موجود'), { code: 'NOT_FOUND' });
    if (!prepRow.rows[0].is_active) throw Object.assign(new Error('نوع التجهيز غير فعّال'), { code: 'VALIDATION' });
  }

  if (input.customerId) {
    const custRow = await client.query('SELECT id FROM customers WHERE id=$1 AND company_id=$2', [input.customerId, companyId]);
    if (!custRow.rows.length) throw Object.assign(new Error('العميل غير موجود'), { code: 'NOT_FOUND' });
  }

  const orderNo = await generateSequentialDocumentNo(client, companyId, 'INTAKE_ORDER');

  const ins = await client.query<IntakeOperationRow>(
    `INSERT INTO intake_operations (
       company_id, order_no, supplier_id, warehouse_id, action_type,
       customer_id, fabric_stage, preparation_type_id, created_by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      companyId, orderNo, input.actionType === 'RETURN' ? null : input.supplierId,
      input.warehouseId, input.actionType,
      input.customerId ?? null, input.fabricStage ?? null, input.preparationTypeId ?? null, userId,
    ],
  );
  return ins.rows[0];
}

export async function getIntakeOperationById(
  client: PoolClient,
  companyId: string,
  id: string,
): Promise<IntakeOperationRow | null> {
  const res = await client.query<IntakeOperationRow>(
    `SELECT * FROM intake_operations WHERE id=$1 AND company_id=$2`,
    [id, companyId],
  );
  return res.rows[0] ?? null;
}

type FinalizeResult = {
  operation: IntakeOperationRow;
  externalJob?: { id: string; jobNo: string };
  dispatchSlip?: { id: string; slipNo: string };
  returnInvoice?: { id: string; returnNo: string };
  salesInvoice?: { id: string; invoiceNo: string };
};

/**
 * يُنفَّذ بعد حفظ كل الأتواب بشاشة "إنشاء مادة" ضمن سياق هذه العملية
 * (fabric_rolls.intake_operation_id = هذا المعرّف). ينفّذ الإجراء المحدَّد
 * مسبقاً بالشاشة الأولى، ثم يُغلق العملية (status='COMPLETED'). `rawSale`
 * مقبول فقط عند actionType='STOCK' — الأتواب المحدَّدة للبيع فيه تُستثنى من
 * إرسالية المخزون وتُباع بفاتورة واحدة حقيقية لعميل واحد بدلاً من ذلك.
 */
export async function finalizeIntakeOperation(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  intakeOperationId: string,
  rawSale?: unknown,
): Promise<FinalizeResult> {
  const opRes = await client.query<IntakeOperationRow>(
    `SELECT * FROM intake_operations WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [intakeOperationId, companyId],
  );
  const op = opRes.rows[0];
  if (!op) throw Object.assign(new Error('عملية الإدخال غير موجودة'), { code: 'NOT_FOUND' });
  if (op.status !== 'DRAFT') {
    throw Object.assign(new Error('تم إنهاء هذه العملية مسبقاً'), { code: 'INVALID_STATE' });
  }

  const rollsRes = await client.query<{
    id: string; item_id: string; length_m: string; barcode: string;
  }>(
    `SELECT id, item_id, length_m, barcode FROM fabric_rolls
     WHERE intake_operation_id=$1 AND company_id=$2 FOR UPDATE`,
    [intakeOperationId, companyId],
  );
  if (!rollsRes.rows.length) {
    throw Object.assign(
      new Error('لا توجد أتواب مُدخَلة بهذه العملية — أدخلي الخامات أولاً من شاشة إنشاء مادة'),
      { code: 'VALIDATION' },
    );
  }
  const rolls = rollsRes.rows;
  const rollIds = rolls.map((r) => r.id);

  const result: FinalizeResult = { operation: op };

  if (op.action_type === 'PROCESSING') {
    const job = await createProcessingExternalJob(client, companyId, userId, {
      supplierId: op.supplier_id,
      fabricStage: op.fabric_stage,
      preparationTypeId: op.preparation_type_id,
      sourceWarehouseId: op.warehouse_id,
      rollIds,
    });
    await client.query(
      `UPDATE intake_operations SET status='COMPLETED', result_external_job_id=$1, updated_at=now() WHERE id=$2`,
      [job.id, intakeOperationId],
    );
    result.externalJob = { id: job.id, jobNo: job.jobNo };
  } else if (op.action_type === 'STOCK' || op.action_type === 'PURCHASE') {
    let soldRollIds = new Set<string>();
    let saleInput: z.infer<typeof finalizeStockSaleSchema> | null = null;
    const hasSalePayload =
      op.action_type === 'STOCK'
      && rawSale != null
      && typeof rawSale === 'object'
      && Array.isArray((rawSale as { lines?: unknown }).lines)
      && ((rawSale as { lines: unknown[] }).lines.length > 0);
    if (hasSalePayload) {
      saleInput = finalizeStockSaleSchema.parse(rawSale);
      soldRollIds = new Set(saleInput.lines.map((l) => l.rollId));
      const unknownRollId = saleInput.lines.find((l) => !rolls.some((r) => r.id === l.rollId));
      if (unknownRollId) {
        throw Object.assign(new Error('أحد الأتواب المحدَّدة للبيع لا ينتمي لهذه العملية'), { code: 'VALIDATION' });
      }
    }
    const stockRolls = rolls.filter((r) => !soldRollIds.has(r.id));
    const soldRolls = rolls.filter((r) => soldRollIds.has(r.id));

    if (saleInput && soldRolls.length > 0) {
      const priceByRoll = new Map(saleInput.lines.map((l) => [l.rollId, l.unitPrice]));
      const saleLines = soldRolls.map((r) => {
        const qty = Number(r.length_m) || 0;
        const unitPrice = priceByRoll.get(r.id) ?? 0;
        return {
          fabricRollId: r.id,
          quantity: qty,
          unit: 'meter' as const,
          unitPrice,
          lineTotal: Math.round(qty * unitPrice * 100) / 100,
        };
      });
      const subtotal = Math.round(saleLines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;
      const invoiceResult = await createSalesInvoice(client, companyId, userId, {
        invoiceNo: 'AUTO',
        invoiceDate: new Date().toISOString().slice(0, 10),
        customerId: saleInput.customerId,
        warehouseId: op.warehouse_id,
        currencyCode: 'USD',
        subtotal,
        discountTotal: 0,
        taxTotal: 0,
        totalAmount: subtotal,
        paidAmount: 0,
        remainingAmount: subtotal,
        notes: `مُنشأة تلقائياً من عملية إدخال خامة رقم ${op.order_no}`,
        lines: saleLines,
        confirm: true,
      });
      result.salesInvoice = { id: invoiceResult.id, invoiceNo: invoiceResult.invoiceNo };
    }

    let slipId: string | null = null;
    let slipNo: string | null = null;
    if (stockRolls.length > 0) {
      slipNo = await generateSequentialDocumentNo(client, companyId, 'INTAKE_DISPATCH_SLIP');
      const slipIns = await client.query<{ id: string }>(
        `INSERT INTO intake_dispatch_slips (company_id, intake_operation_id, slip_no, slip_type, warehouse_id, supplier_id, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [companyId, intakeOperationId, slipNo, op.action_type, op.warehouse_id, op.supplier_id, userId],
      );
      slipId = slipIns.rows[0].id;
      for (const roll of stockRolls) {
        await client.query(
          `INSERT INTO intake_dispatch_slip_lines (slip_id, fabric_roll_id) VALUES ($1,$2)`,
          [slipId, roll.id],
        );
      }
      result.dispatchSlip = { id: slipId, slipNo };
    }

    await client.query(
      `UPDATE intake_operations
       SET status='COMPLETED', result_dispatch_slip_id=$1, result_sales_invoice_id=$2, updated_at=now()
       WHERE id=$3`,
      [slipId, result.salesInvoice?.id ?? null, intakeOperationId],
    );
  } else {
    // RETURN — فاتورة مرتجع مبيعات حقيقية، مسودة غير مُرحَّلة محاسبياً حتى
    // تُسعَّر وتُؤكَّد لاحقاً (postReturnInvoiceToGl هو ما يخصم فعلياً من ذمة
    // العميل، عبر PATCH /:id/confirm الموجود أصلاً — لا نكرر منطقه هنا).
    const lines: CreateReturnBody['lines'] = rolls.map((r) => ({
      description: `مرتجع — توب ${r.barcode} (عملية إدخال ${op.order_no})`,
      quantity: Number(r.length_m) || 0,
      unitPrice: 0,
      unit: 'meter' as const,
      fabricRollId: null,
      fabricItemId: r.item_id,
      originalSalesInvoiceLineId: null,
      originalPurchaseInvoiceLineId: null,
      returnReason: null,
      notes: null,
    }));

    const body: CreateReturnBody = {
      returnType: 'SALES_RETURN',
      customerId: op.customer_id,
      supplierId: null,
      originalSalesInvoiceId: null,
      originalPurchaseInvoiceId: null,
      originalInvoiceNo: `عملية إدخال خامة ${op.order_no}`,
      returnDate: undefined,
      currencyCode: 'USD',
      exchangeRateToUsd: 1,
      discountTotal: 0,
      taxTotal: 0,
      notes: `مُنشأة تلقائياً من عملية إدخال خامة رقم ${op.order_no}`,
      reason: null,
      settlementType: 'CREDIT_BALANCE',
      lines,
    };

    const validated = await validateAndBuildReturnDraft(client, companyId, body, { excludeReturnId: null });
    const returnNo = `RTN-${op.order_no}`;

    const ins = await client.query<{ id: string; return_no: string }>(
      `INSERT INTO return_invoices (
         company_id, return_no, return_type, customer_id, supplier_id, original_invoice_no,
         original_sales_invoice_id, original_purchase_invoice_id, settlement_type, reason,
         return_date, currency_code, exchange_rate_to_usd,
         subtotal, discount_total, tax_total, total_amount,
         subtotal_usd, discount_total_usd, tax_total_usd, total_amount_usd,
         status, notes, created_by_user_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()::date,$11,$12,$13,$14,$15,$16,$13,$14,$15,$16,'DRAFT',$17,$18)
       RETURNING id, return_no`,
      [
        companyId, returnNo, body.returnType, body.customerId, body.supplierId,
        body.originalInvoiceNo, validated.originalSalesInvoiceId, validated.originalPurchaseInvoiceId,
        validated.settlementType, validated.reason,
        validated.currencyCode, validated.exchangeRateToUsd,
        validated.subtotal, validated.discountTotal, validated.taxTotal, validated.totalAmount,
        body.notes, userId,
      ],
    );
    const returnId = ins.rows[0].id;

    for (const ln of validated.lines) {
      await client.query(
        `INSERT INTO return_invoice_lines (
           company_id, return_invoice_id, fabric_roll_id, fabric_item_id,
           description, quantity, unit, unit_price, line_total, unit_price_usd, line_total_usd, notes,
           original_sales_invoice_line_id, original_purchase_invoice_line_id, returned_from_quantity, return_reason
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$9,$10,$11,$12,$13,$14)`,
        [
          companyId, returnId, ln.fabricRollId, ln.fabricItemId,
          ln.description, ln.quantity, ln.unit, ln.unitPrice, ln.lineTotal, ln.notes,
          ln.originalSalesInvoiceLineId, ln.originalPurchaseInvoiceLineId,
          ln.returnedFromQuantity, ln.returnReason,
        ],
      );
    }

    await client.query(
      `UPDATE intake_operations SET status='COMPLETED', result_return_invoice_id=$1, updated_at=now() WHERE id=$2`,
      [returnId, intakeOperationId],
    );
    result.returnInvoice = { id: returnId, returnNo: ins.rows[0].return_no };
  }

  const updated = await client.query<IntakeOperationRow>(
    `SELECT * FROM intake_operations WHERE id=$1`,
    [intakeOperationId],
  );
  result.operation = updated.rows[0];
  return result;
}
