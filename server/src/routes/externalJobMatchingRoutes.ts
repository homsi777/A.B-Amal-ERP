import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  approveShortage,
  listOpenDispatchBalances,
  listOpenDispatchLines,
} from '../services/externalJobPurchaseMatchingService.js';

function handleServiceError(reply: FastifyReply, e: unknown) {
  const err = e as { code?: string; message?: string; issues?: unknown };
  if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || 'بيانات غير صالحة', 'VALIDATION');
  if (err.issues) return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION');
  throw e;
}

/** محصور بالمحاسب أو المدير — نفس قاعدة صلاحية التسعير بقسم المصنعية. */
function isApprovalAllowed(user: { role: string } | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'accountant';
}

export const externalJobMatchingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const rows = await listOpenDispatchBalances(getPool(), companyId);
    return reply.send({ ok: true, data: rows });
  });

  app.get('/:supplierId/:fabricItemId/lines', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { supplierId, fabricItemId } = req.params as { supplierId: string; fabricItemId: string };
    const rows = await listOpenDispatchLines(getPool(), companyId, supplierId, fabricItemId);
    return reply.send({ ok: true, data: rows });
  });

  app.post('/approve-shortage', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    if (!isApprovalAllowed(req.user)) return sendError(reply, 403, 'ليس لديك صلاحية اعتماد النقص', 'FORBIDDEN');
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await approveShortage(client, companyId, userId, req.body);
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
