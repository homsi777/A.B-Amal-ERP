import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  createIntakeOperation,
  finalizeIntakeOperation,
  getIntakeOperationById,
} from '../services/intakeOperationService.js';

function handleServiceError(reply: FastifyReply, e: unknown) {
  const err = e as { code?: string; message?: string; issues?: unknown };
  if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
  if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || 'حالة غير صالحة', 'INVALID_STATE');
  if (err.code === 'INVALID_STOCK') return sendError(reply, 400, err.message || 'مخزون غير صالح', 'INVALID_STOCK');
  if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || 'بيانات غير صالحة', 'VALIDATION');
  if (err.issues) return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION');
  throw e;
}

export const intakeOperationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      const op = await getIntakeOperationById(client, companyId, id);
      if (!op) return sendError(reply, 404, 'عملية الإدخال غير موجودة', 'NOT_FOUND');
      return reply.send({ ok: true, data: op });
    } finally {
      client.release();
    }
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await createIntakeOperation(client, companyId, userId, req.body);
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: row });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return handleServiceError(reply, e);
    } finally {
      client.release();
    }
  });

  app.post('/:id/finalize', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await finalizeIntakeOperation(client, companyId, userId, id);
      await client.query('COMMIT');
      return reply.send({ ok: true, data: result });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return handleServiceError(reply, e);
    } finally {
      client.release();
    }
  });
};
