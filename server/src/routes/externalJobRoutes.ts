import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  createExternalJob,
  listExternalJobs,
  getExternalJobById,
  confirmExternalJob,
  receiveExternalJobLine,
  setExternalJobFee,
  postExternalJobFee,
  voidExternalJob,
  listPreparationTypes,
  createPreparationType,
  updatePreparationType,
  createProcessingExternalJob,
  editProcessingExternalJob,
  voidProcessingExternalJob,
} from '../services/externalJobService.js';

function handleServiceError(reply: FastifyReply, e: unknown) {
  const err = e as { code?: string; message?: string; issues?: unknown };
  if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
  if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || 'حالة غير صالحة', 'INVALID_STATE');
  if (err.code === 'INVALID_STOCK') return sendError(reply, 400, err.message || 'مخزون غير صالح', 'INVALID_STOCK');
  if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || 'بيانات غير صالحة', 'VALIDATION');
  if (err.code === 'DUPLICATE') return sendError(reply, 409, err.message || 'مكرَّر', 'DUPLICATE');
  if (err.code === 'PASSWORD_INVALID') return sendError(reply, 403, 'كلمة المرور غير صحيحة', 'PASSWORD_INVALID');
  if (err.code === 'REAUTH_RATE_LIMITED') return sendError(reply, 429, err.message || 'محاولات كثيرة جداً', 'REAUTH_RATE_LIMITED');
  if (err.issues) return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION');
  throw e;
}

export const externalJobRoutes: FastifyPluginAsync = async (app) => {
  // ===== Preparation types ("مصنعية") — مُسجَّلة قبل '/:id' كمسارات حرفية =====
  app.get('/preparation-types', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const pool = getPool();
    const data = await listPreparationTypes(pool, companyId, q.includeInactive === 'true');
    return reply.send({ ok: true, data });
  });

  app.post('/preparation-types', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const pool = getPool();
    try {
      const data = await createPreparationType(pool, companyId, req.body);
      return reply.status(201).send({ ok: true, data });
    } catch (e: unknown) {
      return handleServiceError(reply, e);
    }
  });

  app.patch('/preparation-types/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    try {
      const data = await updatePreparationType(pool, companyId, id, req.body);
      return reply.send({ ok: true, data });
    } catch (e: unknown) {
      return handleServiceError(reply, e);
    }
  });

  // ===== Processing ("مصنعية") dispatch =====
  app.post('/processing', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await createProcessingExternalJob(client, companyId, userId, req.body);
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: result });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return handleServiceError(reply, e);
    } finally {
      client.release();
    }
  });

  app.patch('/:id/processing', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await editProcessingExternalJob(client, companyId, userId, id, req.body);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return handleServiceError(reply, e);
    } finally {
      client.release();
    }
  });

  app.post('/:id/void-processing', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await voidProcessingExternalJob(client, companyId, userId, id, req.body);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return handleServiceError(reply, e);
    } finally {
      client.release();
    }
  });

  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const pool = getPool();
    const result = await listExternalJobs(pool, companyId, {
      search: q.search,
      supplierId: q.supplierId,
      documentStatus: q.documentStatus,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      jobKind: q.jobKind,
      page: q.page ? parseInt(q.page, 10) : undefined,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : undefined,
    });
    return reply.send({ ok: true, ...result });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const data = await getExternalJobById(pool, companyId, id);
    if (!data) return sendError(reply, 404, 'المهمة الخارجية غير موجودة', 'NOT_FOUND');
    return reply.send({ ok: true, data });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await createExternalJob(client, companyId, userId, req.body);
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: result });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return handleServiceError(reply, e);
    } finally {
      client.release();
    }
  });

  app.post('/:id/confirm', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await confirmExternalJob(client, companyId, userId, id);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return handleServiceError(reply, e);
    } finally {
      client.release();
    }
  });

  app.post('/:id/lines/:lineId/receive', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { lineId } = req.params as { id: string; lineId: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await receiveExternalJobLine(client, companyId, userId, lineId, req.body);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return handleServiceError(reply, e);
    } finally {
      client.release();
    }
  });

  app.post('/:id/fee', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setExternalJobFee(client, companyId, id, req.body);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return handleServiceError(reply, e);
    } finally {
      client.release();
    }
  });

  app.post('/:id/post-fee', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await postExternalJobFee(client, companyId, userId, id);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return handleServiceError(reply, e);
    } finally {
      client.release();
    }
  });

  app.post('/:id/void', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const body = (req.body as Record<string, unknown>) || {};
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await voidExternalJob(client, companyId, userId, id, typeof body.reason === 'string' ? body.reason : null);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return handleServiceError(reply, e);
    } finally {
      client.release();
    }
  });
};
