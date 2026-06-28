import type { FastifyPluginAsync } from 'fastify';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  cancelOperatingExpense,
  createOperatingExpense,
  listExpenseCategories,
  listOperatingExpenses,
} from '../services/operatingExpenseService.js';

export const operatingExpenseRoutes: FastifyPluginAsync = async (app) => {
  app.get('/categories', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const data = await listExpenseCategories(companyId);
    return reply.send({ ok: true, data });
  });

  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const result = await listOperatingExpenses(companyId, {
      search: q.search,
      cashboxId: q.cashboxId,
      categoryId: q.categoryId,
      status: q.status,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
    return reply.send({ ok: true, ...result });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    try {
      const data = await createOperatingExpense(companyId, userId, req.body);
      return reply.status(201).send({
        ok: true,
        data,
        message: `تم تسجيل المصروف ${data.expense_no} وخصمه من الصندوق وترحيله محاسبياً.`,
      });
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'NOT_FOUND') {
        return sendError(reply, 404, e instanceof Error ? e.message : 'غير موجود', 'NOT_FOUND');
      }
      if (code === 'VALIDATION' || code === 'INVALID_STATE' || code === 'GL_CONFIG') {
        return sendError(reply, 400, e instanceof Error ? e.message : 'بيانات غير صالحة', code ?? 'VALIDATION');
      }
      throw e;
    }
  });

  app.post('/:id/cancel', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    try {
      const data = await cancelOperatingExpense(companyId, id, userId, req.body);
      return reply.send({
        ok: true,
        data,
        message: `تم إلغاء المصروف ${data.expense_no} وإرجاع المبلغ للصندوق.`,
      });
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'NOT_FOUND') {
        return sendError(reply, 404, e instanceof Error ? e.message : 'غير موجود', 'NOT_FOUND');
      }
      if (code === 'VALIDATION' || code === 'INVALID_STATE') {
        return sendError(reply, 400, e instanceof Error ? e.message : 'بيانات غير صالحة', code ?? 'VALIDATION');
      }
      throw e;
    }
  });
};
