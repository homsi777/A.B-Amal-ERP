import type { FastifyPluginAsync } from 'fastify';
import { authenticateRequest } from '../middleware/auth.js';
import { listInventoryMovementsLog } from '../services/inventoryMovementsLogService.js';

export const inventoryMovementsLogRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string | undefined>;
    const result = await listInventoryMovementsLog(companyId, {
      movementKind: q.movementKind,
      warehouseId: q.warehouseId,
      search: q.search,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
    return reply.send({ ok: true, ...result });
  });
};
