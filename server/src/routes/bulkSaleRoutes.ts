import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { createBulkSale, listBulkSales, updateBulkSale } from '../services/bulkSaleService.js';

function handleServiceError(reply: FastifyReply, e: unknown) {
  const err = e as { code?: string; message?: string; issues?: unknown };
  if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
  if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || 'بيانات غير صالحة', 'VALIDATION');
  if (err.issues) return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION');
  throw e;
}

export const bulkSaleRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { onlyUnused } = req.query as { onlyUnused?: string };
    const rows = await listBulkSales(getPool(), companyId, { onlyUnused: onlyUnused === 'true' });
    return reply.send({ ok: true, data: rows });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    try {
      const row = await createBulkSale(getPool(), companyId, userId, req.body);
      return reply.status(201).send({ ok: true, data: row });
    } catch (e: unknown) {
      return handleServiceError(reply, e);
    }
  });

  app.patch('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    try {
      const row = await updateBulkSale(getPool(), companyId, id, req.body);
      return reply.send({ ok: true, data: row });
    } catch (e: unknown) {
      return handleServiceError(reply, e);
    }
  });
};
