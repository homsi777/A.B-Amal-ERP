import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';
import { applyVoucherCancellation, applyVoucherConfirmation } from '../services/voucherCashboxService.js';
import {
  applyPurchaseInvoicePaymentOnVoucherConfirm,
  validatePurchaseInvoicePaymentVoucher,
} from '../services/purchaseInvoiceService.js';
import {
  applySaleInvoiceReceiptOnVoucherConfirm,
  validateSaleInvoiceReceiptVoucher,
} from '../services/salesInvoiceService.js';
import { getExchangeRateToUsdTx } from '../services/exchangeRateService.js';

const partyTypeSchema = z.enum(['CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OTHER']).optional().nullable();
const paymentMethodSchema = z.enum(['CASH', 'BANK', 'TRANSFER', 'OTHER']);

const createBody = z.object({
  voucherType: z.enum(['RECEIPT', 'PAYMENT']),
  voucherDate: z.string().optional(),
  cashboxId: z.string().uuid().optional().nullable(),
  partyType: partyTypeSchema,
  partyId: z.string().uuid().optional().nullable(),
  partyName: z.string().min(1, 'اسم الجهة مطلوب'),
  amount: z.coerce.number().positive(),
  currencyCode: z.string().min(1).default('USD'),
  exchangeRateToUsd: z.coerce.number().optional(),
  amountUsd: z.coerce.number().optional(),
  paymentMethod: paymentMethodSchema.default('CASH'),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  referenceDocumentType: z.string().optional().nullable(),
  referenceDocumentNo: z.string().optional().nullable(),
});

const updateBody = createBody;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeUsd(amountOriginal: number, exchangeRateToUsd: number): number {
  if (!Number.isFinite(amountOriginal) || !Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) return 0;
  return round2(amountOriginal / exchangeRateToUsd);
}

export const voucherRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const voucherType = q.type as string | undefined;
    const status = q.status as string | undefined;
    const cashboxId = q.cashboxId?.trim();
    const partyIdFilter = q.partyId?.trim();
    const partyType = q.partyType?.trim();
    const search = q.search?.trim() || '';
    const dateFrom = q.dateFrom?.trim();
    const dateTo = q.dateTo?.trim();
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['v.company_id = $1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (voucherType && ['RECEIPT', 'PAYMENT'].includes(voucherType)) {
      conditions.push(`v.voucher_type = $${p}`);
      params.push(voucherType);
      p++;
    }
    if (status && ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status)) {
      conditions.push(`v.status = $${p}`);
      params.push(status);
      p++;
    }
    if (cashboxId) {
      conditions.push(`v.cashbox_id = $${p}`);
      params.push(cashboxId);
      p++;
    }
    if (partyType && ['CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OTHER'].includes(partyType)) {
      conditions.push(`v.party_type = $${p}`);
      params.push(partyType);
      p++;
    }
    if (partyIdFilter) {
      conditions.push(`v.party_id = $${p}::uuid`);
      params.push(partyIdFilter);
      p++;
    }
    if (search) {
      conditions.push(`(v.voucher_no ILIKE $${p} OR v.party_name ILIKE $${p} OR COALESCE(v.description,'') ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }
    if (dateFrom) {
      conditions.push(`v.voucher_date >= $${p}::date`);
      params.push(dateFrom);
      p++;
    }
    if (dateTo) {
      conditions.push(`v.voucher_date <= $${p}::date`);
      params.push(dateTo);
      p++;
    }

    const where = conditions.join(' AND ');
    const pool = getPool();

    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT v.id, v.voucher_no, v.voucher_type, v.voucher_date, v.cashbox_id, v.party_type, v.party_id,
                v.party_name, v.amount, v.currency_code, v.payment_method, v.status, v.description,
                v.reference_document_type, v.reference_document_no,
                v.confirmed_at, v.cancelled_at, v.created_at,
                c.code AS cashbox_code, c.name AS cashbox_name
         FROM vouchers v
         LEFT JOIN cashboxes c ON c.id = v.cashbox_id AND c.company_id = v.company_id
         WHERE ${where}
         ORDER BY v.voucher_date DESC, v.created_at DESC
         LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM vouchers v WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `SELECT v.*, c.code AS cashbox_code, c.name AS cashbox_name
       FROM vouchers v
       LEFT JOIN cashboxes c ON c.id = v.cashbox_id AND c.company_id = v.company_id
       WHERE v.id=$1 AND v.company_id=$2`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'السند غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const vd = d.voucherDate ? d.voucherDate : new Date().toISOString().slice(0, 10);

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const voucherNo = await generateSequentialDocumentNo(
        client,
        companyId,
        d.voucherType === 'RECEIPT' ? 'RECEIPT_VOUCHER' : 'PAYMENT_VOUCHER',
      );
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

      const amountUsd = computeUsd(d.amount, exchangeRateToUsd);
      const ins = await client.query(
        `INSERT INTO vouchers (
           company_id, voucher_no, voucher_type, voucher_date, cashbox_id, party_type, party_id, party_name,
           amount, currency_code, exchange_rate_to_usd, amount_usd,
           payment_method, status, description, notes,
           reference_document_type, reference_document_no,
           created_by_user_id
         ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,'DRAFT',$14,$15,$16,$17,$18)
         RETURNING id, voucher_no, status, voucher_date, created_at`,
        [
          companyId,
          voucherNo,
          d.voucherType,
          vd,
          d.cashboxId ?? null,
          d.partyType ?? null,
          d.partyId ?? null,
          d.partyName.trim(),
          d.amount,
          currencyCode,
          exchangeRateToUsd,
          amountUsd,
          d.paymentMethod,
          d.description ?? null,
          d.notes ?? null,
          d.referenceDocumentType?.trim() || null,
          d.referenceDocumentNo?.trim() || null,
          userId,
        ],
      );
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: ins.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query<{ status: string }>(
        `SELECT status FROM vouchers WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!cur.rows.length) return sendError(reply, 404, 'السند غير موجود', 'NOT_FOUND');
      if (cur.rows[0].status !== 'DRAFT') {
        return sendError(reply, 400, 'لا يمكن التعديل إلا في حالة مسودة', 'INVALID_STATE');
      }

      const vd = d.voucherDate ? d.voucherDate : new Date().toISOString().slice(0, 10);
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
      const amountUsd = computeUsd(d.amount, exchangeRateToUsd);

      const row = await client.query(
        `UPDATE vouchers SET
           voucher_type=$3, voucher_date=$4::date, cashbox_id=$5, party_type=$6, party_id=$7, party_name=$8,
           amount=$9, currency_code=$10, exchange_rate_to_usd=$11, amount_usd=$12,
           payment_method=$13, description=$14, notes=$15,
           reference_document_type=$16, reference_document_no=$17,
           updated_at=now(), created_by_user_id=$18
         WHERE id=$1 AND company_id=$2
         RETURNING id, voucher_no, status, updated_at`,
        [
          id,
          companyId,
          d.voucherType,
          vd,
          d.cashboxId ?? null,
          d.partyType ?? null,
          d.partyId ?? null,
          d.partyName.trim(),
          d.amount,
          currencyCode,
          exchangeRateToUsd,
          amountUsd,
          d.paymentMethod,
          d.description ?? null,
          d.notes ?? null,
          d.referenceDocumentType?.trim() || null,
          d.referenceDocumentNo?.trim() || null,
          userId,
        ],
      );
      await client.query('COMMIT');
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  // Financial confirm: lock voucher (DRAFT), cashbox + GL + invoice paid/remaining in one transaction.
  app.patch('/:id/confirm', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) {
      return sendError(reply, 400, 'معرّف السند غير صالح', 'VALIDATION');
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const v = await client.query(
        `SELECT * FROM vouchers WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!v.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'السند غير موجود', 'NOT_FOUND');
      }
      const row = v.rows[0];
      if (row.status !== 'DRAFT') {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'لا يمكن التأكيد في هذه الحالة', 'INVALID_STATE');
      }
      if (!row.cashbox_id) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'يجب اختيار صندوق قبل التأكيد', 'VALIDATION');
      }

      await validateSaleInvoiceReceiptVoucher(client, companyId, {
        voucherType: row.voucher_type,
        amount: Number(row.amount),
        referenceDocumentType: row.reference_document_type,
        referenceDocumentNo: row.reference_document_no,
        partyType: row.party_type,
        partyId: row.party_id,
      });
      await validatePurchaseInvoicePaymentVoucher(client, companyId, {
        voucherType: row.voucher_type,
        amount: Number(row.amount),
        referenceDocumentType: row.reference_document_type,
        referenceDocumentNo: row.reference_document_no,
        partyType: row.party_type,
        partyId: row.party_id,
      });

      await applyVoucherConfirmation(client, {
        companyId,
        voucherId: id,
        voucherNo: row.voucher_no,
        voucherDate:
          row.voucher_date instanceof Date
            ? row.voucher_date.toISOString().slice(0, 10)
            : String(row.voucher_date).slice(0, 10),
        voucherType: row.voucher_type,
        amount: Number(row.amount),
        currencyCode: String(row.currency_code || 'USD').trim().toUpperCase(),
        exchangeRateToUsd: Number(row.exchange_rate_to_usd ?? 1) > 0 ? Number(row.exchange_rate_to_usd ?? 1) : 1,
        amountUsd: Number(row.amount_usd ?? 0) || computeUsd(Number(row.amount), Number(row.exchange_rate_to_usd ?? 1) || 1),
        cashboxId: row.cashbox_id,
        partyType: row.party_type,
        partyId: row.party_id,
        partyName: row.party_name,
        description: row.description,
        userId,
      });

      await client.query(
        `UPDATE vouchers SET status='CONFIRMED', confirmed_at=now(), updated_at=now() WHERE id=$1 AND company_id=$2`,
        [id, companyId],
      );

      const exchangeRateToUsd =
        Number(row.exchange_rate_to_usd ?? 1) > 0 ? Number(row.exchange_rate_to_usd ?? 1) : 1;
      await applySaleInvoiceReceiptOnVoucherConfirm(client, companyId, userId, {
        voucherId: id,
        voucherType: row.voucher_type,
        amount: Number(row.amount),
        referenceDocumentType: row.reference_document_type,
        referenceDocumentNo: row.reference_document_no,
        partyType: row.party_type,
        partyId: row.party_id,
        exchangeRateToUsd,
      });
      await applyPurchaseInvoicePaymentOnVoucherConfirm(client, companyId, userId, {
        voucherId: id,
        voucherType: row.voucher_type,
        amount: Number(row.amount),
        referenceDocumentType: row.reference_document_type,
        referenceDocumentNo: row.reference_document_no,
        partyType: row.party_type,
        partyId: row.party_id,
        exchangeRateToUsd,
      });

      await client.query('COMMIT');
      return reply.send({ ok: true, data: { id, status: 'CONFIRMED' } });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err?.code === 'GL_UNBALANCED') return sendError(reply, 400, err.message || 'قيد محاسبي غير متوازن', 'GL_UNBALANCED');
      if (err?.code === '22P02') return sendError(reply, 400, 'معرّف غير صالح', 'VALIDATION');
      if (err?.code === '23503') return sendError(reply, 400, err.message || 'مرجع غير صالح', 'VALIDATION');
      if (err?.code === '23505') return sendError(reply, 409, err.message || 'تعارض في البيانات', 'CONFLICT');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  app.patch('/:id/cancel', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) {
      return sendError(reply, 400, 'معرّف السند غير صالح', 'VALIDATION');
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const v = await client.query(
        `SELECT * FROM vouchers WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!v.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'السند غير موجود', 'NOT_FOUND');
      }
      const row = v.rows[0];
      if (row.status === 'CANCELLED') {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'السند ملغى مسبقاً', 'INVALID_STATE');
      }

      if (row.status === 'CONFIRMED' && row.cashbox_id) {
        await applyVoucherCancellation(client, {
          companyId,
          voucherId: id,
          voucherNo: row.voucher_no,
          voucherType: row.voucher_type,
          amount: Number(row.amount),
          currencyCode: String(row.currency_code || 'USD').trim().toUpperCase(),
          exchangeRateToUsd: Number(row.exchange_rate_to_usd ?? 1) > 0 ? Number(row.exchange_rate_to_usd ?? 1) : 1,
          amountUsd: Number(row.amount_usd ?? 0) || computeUsd(Number(row.amount), Number(row.exchange_rate_to_usd ?? 1) || 1),
          cashboxId: row.cashbox_id,
          userId,
        });
      }

      await client.query(
        `UPDATE vouchers SET status='CANCELLED', cancelled_at=now(), updated_at=now() WHERE id=$1 AND company_id=$2`,
        [id, companyId],
      );

      await client.query('COMMIT');
      return reply.send({ ok: true, data: { id, status: 'CANCELLED' } });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err?.code === 'GL_UNBALANCED') return sendError(reply, 400, err.message || 'قيد محاسبي غير متوازن', 'GL_UNBALANCED');
      if (err?.code === '22P02') return sendError(reply, 400, 'معرّف غير صالح', 'VALIDATION');
      if (err?.code === '23503') return sendError(reply, 400, err.message || 'مرجع غير صالح', 'VALIDATION');
      if (err?.code === '23505') return sendError(reply, 409, err.message || 'تعارض في البيانات', 'CONFLICT');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });
};
