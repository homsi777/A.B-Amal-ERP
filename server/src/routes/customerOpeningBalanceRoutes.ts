import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { postCustomerOpeningBalance } from '../services/customerOpeningBalanceService.js';

const body = z.object({
  amount: z.coerce.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  direction: z.enum(['DEBIT', 'CREDIT']),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح'),
  description: z.string().optional().nullable(),
});

export const customerOpeningBalanceRoutes: FastifyPluginAsync = async (app) => {
  app.post('/:customerId/opening-balance', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { customerId } = req.params as { customerId: string };
    const parsed = body.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await postCustomerOpeningBalance(client, {
        companyId,
        userId,
        customerId,
        amount: d.amount,
        direction: d.direction,
        asOfDate: d.asOfDate,
        description: d.description,
      });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: result });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err?.code === 'DUPLICATE') return sendError(reply, 409, err.message || 'مكرر', 'DUPLICATE');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });
};
