import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  confirmCashboxTransfer,
  createCashboxTransfer,
  getCashboxTransferById,
  listCashboxTransfers,
  voidCashboxTransfer,
} from '../services/cashboxTransferService.js';
import { ArabicErrors } from '../utils/arabicErrors.js';

const createTransferBody = z.object({
  transferDate: z.string().optional(),
  fromCashboxId: z.string().uuid(),
  toCashboxId: z.string().uuid(),
  amount: z.coerce.number().positive(),
  currencyCode: z.string().trim().min(1).default('USD'),
  notes: z.string().optional().nullable(),
});

function handleTransferError(reply: FastifyReply, e: unknown) {
  const code = (e as { code?: string }).code;
  const message = e instanceof Error ? e.message : ArabicErrors.server;
  if (code === 'NOT_FOUND') return sendError(reply, 404, message, code);
  if (code === 'VALIDATION' || code === 'INVALID_STATE' || code === 'INSUFFICIENT_BALANCE') {
    return sendError(reply, 400, message, code);
  }
  throw e;
}

export const cashboxTransferRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const result = await listCashboxTransfers(companyId, {
      status: q.status,
      fromDate: q.fromDate,
      toDate: q.toDate,
      page: parseInt(q.page) || 1,
      pageSize: parseInt(q.pageSize) || 20,
    });
    return reply.send({ ok: true, ...result });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    try {
      const row = await getCashboxTransferById(companyId, id);
      return reply.send({ ok: true, data: row });
    } catch (e) {
      return handleTransferError(reply, e);
    }
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = createTransferBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    try {
      const row = await createCashboxTransfer(companyId, userId, parsed.data);
      return reply.status(201).send({ ok: true, data: row });
    } catch (e) {
      return handleTransferError(reply, e);
    }
  });

  app.post('/:id/confirm', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    try {
      const row = await confirmCashboxTransfer(companyId, userId, id);
      return reply.send({ ok: true, data: row });
    } catch (e) {
      return handleTransferError(reply, e);
    }
  });

  app.post('/:id/void', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    try {
      const row = await voidCashboxTransfer(companyId, userId, id);
      return reply.send({ ok: true, data: row });
    } catch (e) {
      return handleTransferError(reply, e);
    }
  });
};
