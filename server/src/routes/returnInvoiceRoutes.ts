import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { generateDocumentNo } from '../utils/documentNumbers.js';
import { insertPartyActivityLog } from '../services/partyActivityLogService.js';
import { postReturnInvoiceToGl, reverseReturnInvoiceGl } from '../services/glPostingService.js';
import {
  applyReturnInvoiceInventory,
  reverseReturnInvoiceInventory,
} from '../services/returnInvoiceStockService.js';
import { getExchangeRateToUsdTx } from '../services/exchangeRateService.js';
import {
  createReturnBodySchema,
  loadReturnInvoiceAsDraftBody,
  validateAndBuildReturnDraft,
  type ValidatedReturnDraft,
} from '../services/returnInvoiceDraftValidation.js';
import {
  getSourcePurchaseInvoiceForReturn,
  getSourceSalesInvoiceForReturn,
  listEligiblePurchaseInvoices,
  listEligibleSalesInvoices,
} from '../services/returnInvoiceEligibilityService.js';
import {
  refreshPurchaseInvoiceReturnFulfillment,
  refreshSalesInvoiceReturnFulfillment,
} from '../services/returnInvoiceLifecycleService.js';
import {
  applyReturnCashRefundCashbox,
  reverseReturnCashRefundCashbox,
} from '../services/returnInvoiceCashboxService.js';

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function computeUsd(amountOriginal: number, exchangeRateToUsd: number): number {
  if (!Number.isFinite(amountOriginal) || !Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) return 0;
  return round2(amountOriginal / exchangeRateToUsd);
}

async function resolveHeaderOriginalInvoiceNo(
  client: import('pg').PoolClient,
  companyId: string,
  v: ValidatedReturnDraft,
  fallbackText: string | null,
): Promise<string | null> {
  if (v.originalSalesInvoiceId) {
    const q = await client.query<{ invoice_no: string }>(
      `SELECT invoice_no FROM sales_invoices WHERE id=$1 AND company_id=$2`,
      [v.originalSalesInvoiceId, companyId],
    );
    return q.rows[0]?.invoice_no ?? fallbackText;
  }
  if (v.originalPurchaseInvoiceId) {
    const q = await client.query<{ invoice_no: string }>(
      `SELECT invoice_no FROM purchase_invoices WHERE id=$1 AND company_id=$2`,
      [v.originalPurchaseInvoiceId, companyId],
    );
    return q.rows[0]?.invoice_no ?? fallbackText;
  }
  return fallbackText;
}

const cancelBodySchema = z
  .object({
    cancellationReason: z.string().max(4000).optional().nullable(),
    cancellation_reason: z.string().max(4000).optional().nullable(),
  })
  .transform((o) => (o.cancellationReason ?? o.cancellation_reason)?.trim() || null);

const confirmReturnBodySchema = z.object({
  cashboxId: z.string().uuid().optional().nullable(),
});

export const returnInvoiceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';
    const returnType = q.type as string | undefined;
    const status = q.status as string | undefined;
    const dateFrom = q.dateFrom?.trim();
    const dateTo = q.dateTo?.trim();
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['r.company_id = $1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (search) {
      conditions.push(
        `(r.return_no ILIKE $${p} OR r.original_invoice_no ILIKE $${p} OR r.notes ILIKE $${p} OR osi.invoice_no ILIKE $${p} OR opi.invoice_no ILIKE $${p})`,
      );
      params.push(`%${search}%`);
      p++;
    }
    if (returnType && ['SALES_RETURN', 'PURCHASE_RETURN'].includes(returnType)) {
      conditions.push(`r.return_type = $${p}`);
      params.push(returnType);
      p++;
    }
    if (status && ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status)) {
      conditions.push(`r.status = $${p}`);
      params.push(status);
      p++;
    }
    if (dateFrom) {
      conditions.push(`r.return_date >= $${p}::date`);
      params.push(dateFrom);
      p++;
    }
    if (dateTo) {
      conditions.push(`r.return_date <= $${p}::date`);
      params.push(dateTo);
      p++;
    }

    const where = conditions.join(' AND ');
    const pool = getPool();

    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT r.id, r.return_no, r.return_type, r.customer_id, r.supplier_id, r.original_invoice_no,
                r.original_sales_invoice_id, r.original_purchase_invoice_id,
                r.settlement_type, r.reason, r.posted_at, r.cancelled_at, r.cancellation_reason,
                r.return_date, r.currency_code, r.subtotal, r.discount_total, r.tax_total, r.total_amount,
                r.status, r.notes, r.created_at, r.updated_at,
                c.name AS customer_name, s.name AS supplier_name,
                osi.invoice_no AS original_sales_invoice_no,
                opi.invoice_no AS original_purchase_invoice_no
         FROM return_invoices r
         LEFT JOIN customers c ON c.id = r.customer_id AND c.company_id = r.company_id
         LEFT JOIN suppliers s ON s.id = r.supplier_id AND s.company_id = r.company_id
         LEFT JOIN sales_invoices osi ON osi.id = r.original_sales_invoice_id AND osi.company_id = r.company_id
         LEFT JOIN purchase_invoices opi ON opi.id = r.original_purchase_invoice_id AND opi.company_id = r.company_id
         WHERE ${where}
         ORDER BY r.return_date DESC, r.created_at DESC
         LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM return_invoices r
         LEFT JOIN sales_invoices osi ON osi.id = r.original_sales_invoice_id AND osi.company_id = r.company_id
         LEFT JOIN purchase_invoices opi ON opi.id = r.original_purchase_invoice_id AND opi.company_id = r.company_id
         WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.get('/eligible-sales-invoices', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim();
    const customerId = q.customerId?.trim() || undefined;
    const dateFrom = q.dateFrom?.trim() || undefined;
    const dateTo = q.dateTo?.trim() || undefined;
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const pool = getPool();
    const { rows, total } = await listEligibleSalesInvoices(pool, {
      companyId,
      search,
      customerId: customerId || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      page,
      pageSize,
    });
    return reply.send({ ok: true, data: rows, total, page, pageSize });
  });

  app.get('/eligible-purchase-invoices', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim();
    const supplierId = q.supplierId?.trim() || undefined;
    const dateFrom = q.dateFrom?.trim() || undefined;
    const dateTo = q.dateTo?.trim() || undefined;
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const pool = getPool();
    const { rows, total } = await listEligiblePurchaseInvoices(pool, {
      companyId,
      search,
      supplierId: supplierId || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      page,
      pageSize,
    });
    return reply.send({ ok: true, data: rows, total, page, pageSize });
  });

  app.get('/source-invoice/:invType/:invId', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { invType, invId } = req.params as { invType: string; invId: string };
    const q = req.query as { excludeReturnId?: string };
    const excludeReturnId = q.excludeReturnId?.match(/^[0-9a-f-]{36}$/i) ? q.excludeReturnId : null;
    const pool = getPool();
    const client = await pool.connect();
    try {
      if (invType === 'sales') {
        const data = await getSourceSalesInvoiceForReturn(client, companyId, invId, excludeReturnId);
        if (!data) return sendError(reply, 404, 'فاتورة البيع غير موجودة أو غير مؤكدة', 'NOT_FOUND');
        return reply.send({ ok: true, data });
      }
      if (invType === 'purchase') {
        const data = await getSourcePurchaseInvoiceForReturn(client, companyId, invId, excludeReturnId);
        if (!data) return sendError(reply, 404, 'فاتورة الشراء غير موجودة أو غير مؤكدة', 'NOT_FOUND');
        return reply.send({ ok: true, data });
      }
      return sendError(reply, 400, 'نوع الفاتورة يجب أن يكون sales أو purchase', 'VALIDATION');
    } finally {
      client.release();
    }
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const head = await pool.query(
      `SELECT r.*, c.name AS customer_name, s.name AS supplier_name,
              osi.invoice_no AS original_sales_invoice_no,
              opi.invoice_no AS original_purchase_invoice_no
       FROM return_invoices r
       LEFT JOIN customers c ON c.id = r.customer_id AND c.company_id = r.company_id
       LEFT JOIN suppliers s ON s.id = r.supplier_id AND s.company_id = r.company_id
       LEFT JOIN sales_invoices osi ON osi.id = r.original_sales_invoice_id AND osi.company_id = r.company_id
       LEFT JOIN purchase_invoices opi ON opi.id = r.original_purchase_invoice_id AND opi.company_id = r.company_id
       WHERE r.id = $1 AND r.company_id = $2`,
      [id, companyId],
    );
    if (!head.rows.length) return sendError(reply, 404, 'فاتورة المرتجع غير موجودة', 'NOT_FOUND');

    const lines = await pool.query(
      `SELECT id, fabric_roll_id, fabric_item_id, description, quantity, unit, unit_price, line_total, notes,
              original_sales_invoice_line_id, original_purchase_invoice_line_id,
              returned_from_quantity, return_reason
       FROM return_invoice_lines WHERE return_invoice_id = $1 AND company_id = $2 ORDER BY id ASC`,
      [id, companyId],
    );

    const je = await pool.query(
      `SELECT id, entry_no, entry_date, description, source_type
       FROM journal_entries
       WHERE company_id = $1 AND source_type = 'RETURN_INVOICE' AND source_id = $2
       LIMIT 1`,
      [companyId, id],
    );

    return reply.send({
      ok: true,
      data: {
        ...head.rows[0],
        lines: lines.rows,
        gl_journal: je.rows[0] ?? null,
      },
    });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = createReturnBodySchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    if (d.returnType === 'SALES_RETURN' && !d.customerId) {
      return sendError(reply, 400, 'مرتجع مبيعات يتطلب عميلاً', 'VALIDATION');
    }
    if (d.returnType === 'PURCHASE_RETURN' && !d.supplierId) {
      return sendError(reply, 400, 'مرتجع مشتريات يتطلب مورداً', 'VALIDATION');
    }
    if (d.returnType === 'SALES_RETURN' && d.supplierId) {
      return sendError(reply, 400, 'مرتجع المبيعات لا يقبل مورداً', 'VALIDATION');
    }
    if (d.returnType === 'PURCHASE_RETURN' && d.customerId) {
      return sendError(reply, 400, 'مرتجع المشتريات لا يقبل عميلاً', 'VALIDATION');
    }

    const returnNo = generateDocumentNo('RTN');
    const returnDate = d.returnDate ? new Date(d.returnDate) : new Date();
    const dateStr = returnDate.toISOString().slice(0, 10);

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let validated;
      try {
        validated = await validateAndBuildReturnDraft(client, companyId, d, { excludeReturnId: null });
      } catch (e) {
        await client.query('ROLLBACK');
        if (typeof e === 'object' && e !== null && 'code' in e) {
          const code = (e as { code: string }).code;
          if (code === 'VALIDATION') {
            return sendError(reply, 400, e instanceof Error ? e.message : String(e), 'VALIDATION');
          }
          if (code === 'NOT_FOUND') {
            return sendError(reply, 404, e instanceof Error ? e.message : String(e), 'NOT_FOUND');
          }
        }
        throw e;
      }

      let exchangeRateToUsd = validated.exchangeRateToUsd;
      if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
        if (validated.currencyCode === 'USD') {
          exchangeRateToUsd = 1;
        } else {
          const fromDb = await getExchangeRateToUsdTx(client, companyId, validated.currencyCode);
          exchangeRateToUsd = fromDb ?? NaN;
        }
      }
      if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
        throw Object.assign(new Error('لا يمكن تنفيذ العملية بدون سعر صرف'), { code: 'VALIDATION' });
      }
      if (validated.currencyCode === 'USD') exchangeRateToUsd = 1;

      const subtotalUsd = computeUsd(validated.subtotal, exchangeRateToUsd);
      const discountUsd = computeUsd(validated.discountTotal, exchangeRateToUsd);
      const taxUsd = computeUsd(validated.taxTotal, exchangeRateToUsd);
      const totalUsd = computeUsd(validated.totalAmount, exchangeRateToUsd);

      const originalInvoiceNo = await resolveHeaderOriginalInvoiceNo(client, companyId, validated, d.originalInvoiceNo ?? null);

      const ins = await client.query(
        `INSERT INTO return_invoices (
           company_id, return_no, return_type, customer_id, supplier_id, original_invoice_no,
           original_sales_invoice_id, original_purchase_invoice_id, settlement_type, reason,
           return_date, currency_code, exchange_rate_to_usd,
           subtotal, discount_total, tax_total, total_amount,
           subtotal_usd, discount_total_usd, tax_total_usd, total_amount_usd,
           status, notes, created_by_user_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'DRAFT',$22,$23)
         RETURNING id, return_no, status, created_at`,
        [
          companyId,
          returnNo,
          d.returnType,
          d.customerId ?? null,
          d.supplierId ?? null,
          originalInvoiceNo,
          validated.originalSalesInvoiceId,
          validated.originalPurchaseInvoiceId,
          validated.settlementType,
          validated.reason,
          dateStr,
          validated.currencyCode,
          exchangeRateToUsd,
          validated.subtotal,
          validated.discountTotal,
          validated.taxTotal,
          validated.totalAmount,
          subtotalUsd,
          discountUsd,
          taxUsd,
          totalUsd,
          d.notes ?? null,
          userId,
        ],
      );
      const rid = ins.rows[0].id as string;

      for (const ln of validated.lines) {
        await client.query(
          `INSERT INTO return_invoice_lines (
             company_id, return_invoice_id, fabric_roll_id, fabric_item_id,
             description, quantity, unit, unit_price, line_total, unit_price_usd, line_total_usd, notes,
             original_sales_invoice_line_id, original_purchase_invoice_line_id, returned_from_quantity, return_reason
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            companyId,
            rid,
            ln.fabricRollId,
            ln.fabricItemId,
            ln.description,
            ln.quantity,
            ln.unit,
            ln.unitPrice,
            ln.lineTotal,
            computeUsd(ln.unitPrice, exchangeRateToUsd),
            computeUsd(ln.lineTotal, exchangeRateToUsd),
            ln.notes,
            ln.originalSalesInvoiceLineId,
            ln.originalPurchaseInvoiceLineId,
            ln.returnedFromQuantity,
            ln.returnReason,
          ],
        );
      }

      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: ins.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'VALIDATION') {
        return sendError(reply, 400, e instanceof Error ? e.message : String(e), 'VALIDATION');
      }
      throw e;
    } finally {
      client.release();
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = createReturnBodySchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    if (d.returnType === 'SALES_RETURN' && !d.customerId) {
      return sendError(reply, 400, 'مرتجع مبيعات يتطلب عميلاً', 'VALIDATION');
    }
    if (d.returnType === 'PURCHASE_RETURN' && !d.supplierId) {
      return sendError(reply, 400, 'مرتجع مشتريات يتطلب مورداً', 'VALIDATION');
    }
    if (d.returnType === 'SALES_RETURN' && d.supplierId) {
      return sendError(reply, 400, 'مرتجع المبيعات لا يقبل مورداً', 'VALIDATION');
    }
    if (d.returnType === 'PURCHASE_RETURN' && d.customerId) {
      return sendError(reply, 400, 'مرتجع المشتريات لا يقبل عميلاً', 'VALIDATION');
    }

    const pool = getPool();
    const cur = await pool.query(
      `SELECT status FROM return_invoices WHERE id=$1 AND company_id=$2`,
      [id, companyId],
    );
    if (!cur.rows.length) return sendError(reply, 404, 'فاتورة المرتجع غير موجودة', 'NOT_FOUND');
    if (cur.rows[0].status !== 'DRAFT') {
      return sendError(reply, 400, 'لا يمكن التعديل إلا في حالة مسودة', 'INVALID_STATE');
    }

    const returnDate = d.returnDate ? new Date(d.returnDate) : new Date();
    const dateStr = returnDate.toISOString().slice(0, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let validated;
      try {
        validated = await validateAndBuildReturnDraft(client, companyId, d, { excludeReturnId: id });
      } catch (e) {
        await client.query('ROLLBACK');
        if (typeof e === 'object' && e !== null && 'code' in e) {
          const code = (e as { code: string }).code;
          if (code === 'VALIDATION') {
            return sendError(reply, 400, e instanceof Error ? e.message : String(e), 'VALIDATION');
          }
          if (code === 'NOT_FOUND') {
            return sendError(reply, 404, e instanceof Error ? e.message : String(e), 'NOT_FOUND');
          }
        }
        throw e;
      }

      let exchangeRateToUsd = validated.exchangeRateToUsd;
      if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
        if (validated.currencyCode === 'USD') {
          exchangeRateToUsd = 1;
        } else {
          const fromDb = await getExchangeRateToUsdTx(client, companyId, validated.currencyCode);
          exchangeRateToUsd = fromDb ?? NaN;
        }
      }
      if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
        throw Object.assign(new Error('لا يمكن تنفيذ العملية بدون سعر صرف'), { code: 'VALIDATION' });
      }
      if (validated.currencyCode === 'USD') exchangeRateToUsd = 1;

      const subtotalUsd = computeUsd(validated.subtotal, exchangeRateToUsd);
      const discountUsd = computeUsd(validated.discountTotal, exchangeRateToUsd);
      const taxUsd = computeUsd(validated.taxTotal, exchangeRateToUsd);
      const totalUsd = computeUsd(validated.totalAmount, exchangeRateToUsd);

      const originalInvoiceNo = await resolveHeaderOriginalInvoiceNo(client, companyId, validated, d.originalInvoiceNo ?? null);

      await client.query(
        `UPDATE return_invoices SET
           return_type=$3, customer_id=$4, supplier_id=$5, original_invoice_no=$6,
           original_sales_invoice_id=$7, original_purchase_invoice_id=$8,
           settlement_type=$9, reason=$10,
           return_date=$11::date, currency_code=$12, exchange_rate_to_usd=$13,
           subtotal=$14, discount_total=$15, tax_total=$16,
           total_amount=$17,
           subtotal_usd=$18, discount_total_usd=$19, tax_total_usd=$20, total_amount_usd=$21,
           notes=$22, updated_at=now(), created_by_user_id=$23
         WHERE id=$1 AND company_id=$2`,
        [
          id,
          companyId,
          d.returnType,
          d.customerId ?? null,
          d.supplierId ?? null,
          originalInvoiceNo,
          validated.originalSalesInvoiceId,
          validated.originalPurchaseInvoiceId,
          validated.settlementType,
          validated.reason,
          dateStr,
          validated.currencyCode,
          exchangeRateToUsd,
          validated.subtotal,
          validated.discountTotal,
          validated.taxTotal,
          validated.totalAmount,
          subtotalUsd,
          discountUsd,
          taxUsd,
          totalUsd,
          d.notes ?? null,
          userId,
        ],
      );
      await client.query(`DELETE FROM return_invoice_lines WHERE return_invoice_id=$1 AND company_id=$2`, [id, companyId]);
      for (const ln of validated.lines) {
        await client.query(
          `INSERT INTO return_invoice_lines (
             company_id, return_invoice_id, fabric_roll_id, fabric_item_id,
             description, quantity, unit, unit_price, line_total, unit_price_usd, line_total_usd, notes,
             original_sales_invoice_line_id, original_purchase_invoice_line_id, returned_from_quantity, return_reason
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            companyId,
            id,
            ln.fabricRollId,
            ln.fabricItemId,
            ln.description,
            ln.quantity,
            ln.unit,
            ln.unitPrice,
            ln.lineTotal,
            computeUsd(ln.unitPrice, exchangeRateToUsd),
            computeUsd(ln.lineTotal, exchangeRateToUsd),
            ln.notes,
            ln.originalSalesInvoiceLineId,
            ln.originalPurchaseInvoiceLineId,
            ln.returnedFromQuantity,
            ln.returnReason,
          ],
        );
      }
      await client.query('COMMIT');
      return reply.send({ ok: true, data: { id, updated: true } });
    } catch (e) {
      await client.query('ROLLBACK');
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'VALIDATION') {
        return sendError(reply, 400, e instanceof Error ? e.message : String(e), 'VALIDATION');
      }
      throw e;
    } finally {
      client.release();
    }
  });

  // Financial confirm: single transaction — lock return (DRAFT), post inventory + GL + cashbox atomically.
  app.patch('/:id/confirm', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const confirmBody = confirmReturnBodySchema.safeParse((req.body as object | undefined) ?? {});
    const cashboxId = confirmBody.success ? confirmBody.data.cashboxId ?? null : null;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query(
        `SELECT r.*, c.name AS cname, s.name AS sname
         FROM return_invoices r
         LEFT JOIN customers c ON c.id = r.customer_id AND c.company_id = r.company_id
         LEFT JOIN suppliers s ON s.id = r.supplier_id AND s.company_id = r.company_id
         WHERE r.id=$1 AND r.company_id=$2
         FOR UPDATE OF r`,
        [id, companyId],
      );
      if (!row.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'فاتورة المرتجع غير موجودة', 'NOT_FOUND');
      }
      const r = row.rows[0] as Record<string, unknown>;
      if (r.status !== 'DRAFT') {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'لا يمكن التأكيد في هذه الحالة', 'INVALID_STATE');
      }

      const draftBody = await loadReturnInvoiceAsDraftBody(client, companyId, id);
      if (!draftBody) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'فاتورة المرتجع غير موجودة', 'NOT_FOUND');
      }

      let validated;
      try {
        validated = await validateAndBuildReturnDraft(client, companyId, draftBody, { excludeReturnId: id });
      } catch (e) {
        await client.query('ROLLBACK');
        if (typeof e === 'object' && e !== null && 'code' in e) {
          const code = (e as { code: string }).code;
          if (code === 'VALIDATION') {
            return sendError(reply, 400, e instanceof Error ? e.message : String(e), 'VALIDATION');
          }
          if (code === 'NOT_FOUND') {
            return sendError(reply, 404, e instanceof Error ? e.message : String(e), 'NOT_FOUND');
          }
        }
        throw e;
      }

      const { linesForCogs } = await applyReturnInvoiceInventory(client, {
        companyId,
        userId,
        returnInvoiceId: id,
        returnNo: r.return_no as string,
        returnType: r.return_type as 'SALES_RETURN' | 'PURCHASE_RETURN',
        lines: validated.stockInputs,
      });

      const returnDateStr =
        r.return_date instanceof Date
          ? (r.return_date as Date).toISOString().slice(0, 10)
          : String(r.return_date).slice(0, 10);

      const settlementType = validated.settlementType ?? 'CREDIT_BALANCE';
      if (settlementType === 'CASH_REFUND' && !cashboxId) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'تسوية الرد النقدي تتطلب اختيار صندوق', 'VALIDATION');
      }

      const totalAmt = Number(r.total_amount);
      const exchangeRateToUsd = Number(r.exchange_rate_to_usd ?? 1) > 0 ? Number(r.exchange_rate_to_usd ?? 1) : 1;
      const totalUsd =
        Number(r.total_amount_usd ?? 0) || computeUsd(totalAmt, exchangeRateToUsd);

      await postReturnInvoiceToGl(client, {
        companyId,
        returnInvoiceId: id,
        returnNo: r.return_no as string,
        returnDate: returnDateStr,
        returnType: r.return_type as 'SALES_RETURN' | 'PURCHASE_RETURN',
        totalAmountUsd: totalUsd,
        currencyCode: r.currency_code as string,
        customerId: (r.customer_id as string | null) ?? null,
        supplierId: (r.supplier_id as string | null) ?? null,
        userId,
        settlementType,
        cashboxId,
        linesForCogs: r.return_type === 'SALES_RETURN' ? linesForCogs : undefined,
      });

      if (settlementType === 'CASH_REFUND' && cashboxId && totalAmt > 0) {
        const partyType = r.return_type === 'SALES_RETURN' ? 'CUSTOMER' : 'SUPPLIER';
        const partyId = (partyType === 'CUSTOMER' ? r.customer_id : r.supplier_id) as string | null;
        const partyName = String((partyType === 'CUSTOMER' ? r.cname : r.sname) ?? 'جهة');
        if (!partyId) {
          await client.query('ROLLBACK');
          return sendError(reply, 400, 'المرتجع يتطلب طرفاً محدداً للرد النقدي', 'VALIDATION');
        }
        await applyReturnCashRefundCashbox(client, {
          companyId,
          returnInvoiceId: id,
          returnNo: r.return_no as string,
          returnType: r.return_type as 'SALES_RETURN' | 'PURCHASE_RETURN',
          amount: totalAmt,
          currencyCode: String(r.currency_code || 'USD'),
          exchangeRateToUsd,
          amountUsd: totalUsd,
          cashboxId,
          partyType,
          partyId,
          partyName,
          userId,
        });
      }

      const osId = r.original_sales_invoice_id as string | null;
      const opId = r.original_purchase_invoice_id as string | null;
      if (osId) await refreshSalesInvoiceReturnFulfillment(client, companyId, osId);
      if (opId) await refreshPurchaseInvoiceReturnFulfillment(client, companyId, opId);

      await client.query(
        `UPDATE return_invoices SET status='CONFIRMED', posted_at=now(), updated_at=now() WHERE id=$1 AND company_id=$2`,
        [id, companyId],
      );

      if (r.customer_id && r.cname) {
        await insertPartyActivityLog(client, {
          companyId,
          partyType: 'CUSTOMER',
          partyId: r.customer_id as string,
          partyName: r.cname as string,
          activityType: 'RETURN',
          description: `تأكيد مرتجع ${r.return_no}`,
          userId,
          referenceType: 'RETURN_INVOICE',
          referenceId: id,
          referenceNo: r.return_no as string,
          amount: r.total_amount != null ? Number(r.total_amount) : null,
          currencyCode: r.currency_code as string,
        });
      }
      if (r.supplier_id && r.sname) {
        await insertPartyActivityLog(client, {
          companyId,
          partyType: 'SUPPLIER',
          partyId: r.supplier_id as string,
          partyName: r.sname as string,
          activityType: 'RETURN',
          description: `تأكيد مرتجع ${r.return_no}`,
          userId,
          referenceType: 'RETURN_INVOICE',
          referenceId: id,
          referenceNo: r.return_no as string,
          amount: r.total_amount != null ? Number(r.total_amount) : null,
          currencyCode: r.currency_code as string,
        });
      }

      await client.query('COMMIT');
      return reply.send({
        ok: true,
        data: { id, status: 'CONFIRMED' },
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // Financial cancel: single transaction — lock return row, reverse inventory + GL + cashbox (CASH_REFUND).
  app.patch('/:id/cancel', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = cancelBodySchema.safeParse((req.body as object | undefined) ?? {});
    const cancellationReason = parsed.success ? parsed.data : null;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query(
        `SELECT ri.id, ri.status, ri.return_no, ri.return_type, ri.settlement_type,
                ri.original_sales_invoice_id, ri.original_purchase_invoice_id,
                ri.customer_id, ri.supplier_id,
                c.name AS cname, s.name AS sname
         FROM return_invoices ri
         LEFT JOIN customers c ON c.id = ri.customer_id AND c.company_id = ri.company_id
         LEFT JOIN suppliers s ON s.id = ri.supplier_id AND s.company_id = ri.company_id
         WHERE ri.id=$1 AND ri.company_id=$2
         FOR UPDATE OF ri`,
        [id, companyId],
      );
      if (!cur.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'فاتورة المرتجع غير موجودة', 'NOT_FOUND');
      }
      const inv = cur.rows[0] as {
        status: string;
        return_no: string;
        return_type: string;
        settlement_type: string | null;
        original_sales_invoice_id: string | null;
        original_purchase_invoice_id: string | null;
        customer_id: string | null;
        supplier_id: string | null;
        cname: string | null;
        sname: string | null;
      };
      if (inv.status === 'CANCELLED') {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'المرتجع ملغى مسبقاً', 'INVALID_STATE');
      }
      if (inv.status !== 'CONFIRMED') {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'الإلغاء المحاسبي متاح للمرتجعات المؤكدة فقط', 'INVALID_STATE');
      }

      await reverseReturnInvoiceInventory(client, {
        companyId,
        returnInvoiceId: id,
        returnNo: inv.return_no,
        userId,
      });
      await reverseReturnInvoiceGl(client, {
        companyId,
        returnInvoiceId: id,
        returnNo: inv.return_no,
        userId,
      });

      if (String(inv.settlement_type ?? '') === 'CASH_REFUND') {
        const partyType = inv.return_type === 'SALES_RETURN' ? 'CUSTOMER' : 'SUPPLIER';
        const partyId = (partyType === 'CUSTOMER' ? inv.customer_id : inv.supplier_id) as string | null;
        const partyName = String((partyType === 'CUSTOMER' ? inv.cname : inv.sname) ?? 'جهة');
        await reverseReturnCashRefundCashbox(client, {
          companyId,
          returnInvoiceId: id,
          returnNo: inv.return_no,
          returnType: inv.return_type as 'SALES_RETURN' | 'PURCHASE_RETURN',
          partyType,
          partyId,
          partyName,
          userId,
        });
      }

      await client.query(
        `UPDATE return_invoices SET
           status='CANCELLED',
           cancelled_at=now(),
           cancellation_reason=$3,
           updated_at=now()
         WHERE id=$1 AND company_id=$2`,
        [id, companyId, cancellationReason],
      );

      if (inv.original_sales_invoice_id) {
        await refreshSalesInvoiceReturnFulfillment(client, companyId, inv.original_sales_invoice_id);
      }
      if (inv.original_purchase_invoice_id) {
        await refreshPurchaseInvoiceReturnFulfillment(client, companyId, inv.original_purchase_invoice_id);
      }

      await client.query('COMMIT');
      return reply.send({ ok: true, data: { id, status: 'CANCELLED' } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
};
