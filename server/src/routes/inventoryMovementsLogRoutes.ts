import type { FastifyPluginAsync } from 'fastify';
import { authenticateRequest } from '../middleware/auth.js';
import { listInventoryMovementsLog } from '../services/inventoryMovementsLogService.js';
import { listInventoryMovementDocuments, type DocKind } from '../services/inventoryMovementDocumentsService.js';

export const inventoryMovementsLogRoutes: FastifyPluginAsync = async (app) => {
  // عرض مجمَّع حسب المستند (إدخال مخزون/شراء/مصنعية/مرتجع، بيع) — سطر واحد
  // لكل عملية، لا لكل توب. التفاصيل الفردية عبر GET / نفسها بتصفية
  // referenceType/referenceId لنفس المستند.
  app.get('/documents', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string | undefined>;
    const result = await listInventoryMovementDocuments(companyId, {
      docKind: q.docKind as DocKind | undefined,
      warehouseId: q.warehouseId,
      search: q.search,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
    return reply.send({ ok: true, ...result });
  });

  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string | undefined>;
    const result = await listInventoryMovementsLog(companyId, {
      movementKind: q.movementKind,
      warehouseId: q.warehouseId,
      search: q.search,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      referenceType: q.referenceType,
      referenceId: q.referenceId,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
    return reply.send({ ok: true, ...result });
  });
};
