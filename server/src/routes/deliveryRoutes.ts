import type { FastifyPluginAsync } from 'fastify';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import {
  confirmDeliveryFulfillment,
  getDeliveryDetail,
  listDeliveryQueue,
  saveDeliveryTafnid,
  saveTafnidSchema,
} from '../services/deliveryFulfillmentService.js';

export const deliveryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/queue', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const pool = getPool();
    const result = await listDeliveryQueue(pool, companyId, {
      search: q.search,
      page: q.page ? parseInt(q.page, 10) : undefined,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : undefined,
    });
    return reply.send({ ok: true, ...result });
  });

  app.get('/:invoiceId', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { invoiceId } = req.params as { invoiceId: string };
    const pool = getPool();
    const data = await getDeliveryDetail(pool, companyId, invoiceId);
    if (!data) return sendError(reply, 404, 'طلب التسليم غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data });
  });

  app.put('/:invoiceId/tafnid', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { invoiceId } = req.params as { invoiceId: string };
    const parsed = saveTafnidSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? ArabicErrors.validation;
      return sendError(reply, 400, msg, 'VALIDATION');
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await saveDeliveryTafnid(client, companyId, invoiceId, parsed.data);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || '', 'INVALID_STATE');
      if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      throw e;
    } finally {
      client.release();
    }
  });

  app.post('/:invoiceId/fulfill', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { invoiceId } = req.params as { invoiceId: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await confirmDeliveryFulfillment(client, companyId, userId, invoiceId);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || '', 'INVALID_STATE');
      if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err.code === 'INVALID_STOCK') return sendError(reply, 400, err.message || 'مخزون', 'INVALID_STOCK');
      throw e;
    } finally {
      client.release();
    }
  });
};
