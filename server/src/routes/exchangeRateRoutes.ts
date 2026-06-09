import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { listExchangeRates, getExchangeRate, updateExchangeRate } from '../services/exchangeRateService.js';
import { ArabicErrors } from '../utils/arabicErrors.js';

const updateBody = z.object({
  exchangeRateToUsd: z.coerce.number(),
  isActive: z.coerce.boolean().optional(),
});

export const exchangeRateRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    try {
      const { companyId } = req.user!;
      const rows = await listExchangeRates(companyId);
      return reply.send({ ok: true, data: rows });
    } catch (error) {
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    }
  });

  app.get('/:currencyCode', { preHandler: authenticateRequest }, async (req, reply) => {
    try {
      const { companyId } = req.user!;
      const { currencyCode } = req.params as { currencyCode: string };
      const row = await getExchangeRate(companyId, currencyCode);
      if (!row) {
        return sendError(reply, 404, 'العملة غير موجودة', 'NOT_FOUND');
      }
      return reply.send({ ok: true, data: row });
    } catch (error) {
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    }
  });

  app.put('/:currencyCode', { preHandler: authenticateRequest }, async (req, reply) => {
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, parsed.error.errors[0]?.message || ArabicErrors.validation, 'VALIDATION');
    }
    try {
      const { companyId, sub: userId } = req.user!;
      const { currencyCode } = req.params as { currencyCode: string };
      const updated = await updateExchangeRate({
        companyId,
        userId,
        currencyCode,
        exchangeRateToUsd: parsed.data.exchangeRateToUsd,
        isActive: parsed.data.isActive,
      });
      return reply.send({ ok: true, data: updated });
    } catch (error) {
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    }
  });
};
