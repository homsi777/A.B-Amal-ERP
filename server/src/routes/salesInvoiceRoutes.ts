import type { FastifyPluginAsync } from 'fastify';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import {
  confirmSalesInvoice,
  createSalesInvoice,
  deleteSalesInvoiceDraft,
  getSalesInvoiceById,
  getSalesInvoiceEditEligibility,
  listSalesInvoices,
  updateSalesInvoiceDraft,
  updateSalesInvoiceConfirmed,
  voidSalesInvoice,
} from '../services/salesInvoiceService.js';

/** PostgreSQL foreign_key_violation (23503) على yarn_lot_id/fabric_roll_id —
 * يحدث إن أرسلت الواجهة معرّفاً لا ينتمي فعلياً للجدول المتوقَّع (مثال واقعي:
 * مسح باركود توب على سطر "بيع بالوزن" كان يُرسِل معرّف التوب كـ yarnLotId).
 * يُترجَم لرسالة عربية واضحة 400 بدل تسريبه كخطأ خادم 500 خام. */
function foreignKeyViolationMessage(e: unknown): string | null {
  const err = e as { code?: string; constraint?: string };
  if (err?.code !== '23503') return null;
  if (err.constraint?.includes('yarn_lot_id')) {
    return 'دفعة الخيط المرتبطة بهذا السطر غير موجودة بالمخزون — أعد مسح/اختيار الدفعة.';
  }
  if (err.constraint?.includes('fabric_roll_id')) {
    return 'التوب المرتبط بهذا السطر غير موجود بالمخزون — أعد مسح/اختيار التوب.';
  }
  return 'أحد السطور مرتبط بعنصر مخزون غير موجود.';
}

export const salesInvoiceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const pool = getPool();
    const result = await listSalesInvoices(pool, companyId, {
      search: q.search,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      customerId: q.customerId,
      documentStatus: q.documentStatus,
      page: q.page ? parseInt(q.page, 10) : undefined,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : undefined,
    });
    return reply.send({ ok: true, ...result });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const data = await getSalesInvoiceById(pool, companyId, id);
    if (!data) return sendError(reply, 404, 'فاتورة المبيعات غير موجودة', 'NOT_FOUND');
    return reply.send({ ok: true, data });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await createSalesInvoice(client, companyId, userId, req.body);
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: result });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'DUPLICATE') return sendError(reply, 409, err.message || 'تعارض', 'DUPLICATE');
      if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err.code === 'INVALID_STOCK') return sendError(reply, 400, err.message || 'مخزون', 'INVALID_STOCK');
      const fkMessage = foreignKeyViolationMessage(e);
      if (fkMessage) return sendError(reply, 400, fkMessage, 'INVALID_STOCK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.get('/:id/edit-eligibility', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      const data = await getSalesInvoiceEditEligibility(client, companyId, id);
      return reply.send({ ok: true, data });
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      throw e;
    } finally {
      client.release();
    }
  });

  app.put('/:id/confirmed', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await updateSalesInvoiceConfirmed(client, companyId, userId, id, req.body);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || '', 'INVALID_STATE');
      if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || '', 'VALIDATION');
      if (err.code === 'INVALID_STOCK') return sendError(reply, 400, err.message || '', 'INVALID_STOCK');
      const fkMessage = foreignKeyViolationMessage(e);
      if (fkMessage) return sendError(reply, 400, fkMessage, 'INVALID_STOCK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await updateSalesInvoiceDraft(client, companyId, userId, id, req.body);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || '', 'INVALID_STATE');
      if (err.code === 'DUPLICATE') return sendError(reply, 409, err.message || '', 'DUPLICATE');
      const fkMessage = foreignKeyViolationMessage(e);
      if (fkMessage) return sendError(reply, 400, fkMessage, 'INVALID_STOCK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.delete('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deleteSalesInvoiceDraft(client, companyId, id);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || '', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || '', 'INVALID_STATE');
      throw e;
    } finally {
      client.release();
    }
  });

  app.post('/:id/confirm', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const body = (req.body as Record<string, unknown>) || {};
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await confirmSalesInvoice(client, companyId, userId, id, {
        cashboxId: typeof body.cashboxId === 'string' ? body.cashboxId : null,
        partyNameForVoucher: typeof body.partyNameForVoucher === 'string' ? body.partyNameForVoucher : null,
      });
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || '', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || '', 'INVALID_STATE');
      if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || '', 'VALIDATION');
      if (err.code === 'INVALID_STOCK') return sendError(reply, 400, err.message || '', 'INVALID_STOCK');
      const fkMessage = foreignKeyViolationMessage(e);
      if (fkMessage) return sendError(reply, 400, fkMessage, 'INVALID_STOCK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.post('/:id/void', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await voidSalesInvoice(client, companyId, userId, id);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || '', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || '', 'INVALID_STATE');
      if (err.code === 'INVALID_STOCK') return sendError(reply, 400, err.message || '', 'INVALID_STOCK');
      throw e;
    } finally {
      client.release();
    }
  });
};
