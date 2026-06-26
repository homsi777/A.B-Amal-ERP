import type { FastifyPluginAsync } from 'fastify';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  cancelCustomerDiscount,
  createCustomerDiscount,
  listCustomerDiscounts,
} from '../services/customerDiscountService.js';

export const customerDiscountRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const customerId = q.customerId?.trim();
    if (!customerId) {
      return sendError(reply, 400, 'customerId مطلوب', 'VALIDATION');
    }
    const data = await listCustomerDiscounts(companyId, customerId, {
      fromDate: q.fromDate,
      toDate: q.toDate,
      status: q.status,
    });
    return reply.send({ ok: true, data });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const body = req.body as { customerId?: string };
    const customerId = String(body?.customerId ?? '').trim();
    if (!customerId) {
      return sendError(reply, 400, 'customerId مطلوب', 'VALIDATION');
    }
    try {
      const data = await createCustomerDiscount(companyId, customerId, userId, req.body);
      return reply.status(201).send({
        ok: true,
        data,
        message: `تم تسجيل حسم العميل ${data.discount_no} وترحيله محاسبياً.`,
      });
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'NOT_FOUND') {
        return sendError(reply, 404, e instanceof Error ? e.message : 'غير موجود', 'NOT_FOUND');
      }
      if (code === 'VALIDATION' || code === 'INVALID_STATE') {
        return sendError(reply, 400, e instanceof Error ? e.message : 'بيانات غير صالحة', code);
      }
      throw e;
    }
  });

  app.post('/:id/cancel', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    try {
      const data = await cancelCustomerDiscount(companyId, id, userId, req.body);
      return reply.send({
        ok: true,
        data,
        message: `تم إلغاء حسم العميل ${data.discount_no} وعكس أثره المحاسبي.`,
      });
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'NOT_FOUND') {
        return sendError(reply, 404, e instanceof Error ? e.message : 'غير موجود', 'NOT_FOUND');
      }
      if (code === 'VALIDATION' || code === 'INVALID_STATE') {
        return sendError(reply, 400, e instanceof Error ? e.message : 'بيانات غير صالحة', code);
      }
      throw e;
    }
  });
};
