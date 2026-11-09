import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import {
  createCheck,
  depositCheck,
  listChecks,
  markCheckCleared,
  returnCheck,
  type CheckStatus,
} from '../services/checksService.js';

const createBody = z.object({
  checkNo: z.string().min(1, 'رقم الشيك مطلوب'),
  bankName: z.string().min(1, 'اسم البنك مطلوب'),
  accountHolderName: z.string().optional().nullable(),
  partyType: z.enum(['CUSTOMER', 'SUPPLIER', 'OTHER']).optional().nullable(),
  partyId: z.string().uuid().optional().nullable(),
  partyName: z.string().optional().nullable(),
  amount: z.coerce.number().positive(),
  currencyCode: z.string().min(1).default('USD'),
  receivedDate: z.string().optional().nullable(),
  dueDate: z.string().min(1, 'تاريخ الاستحقاق مطلوب'),
  imageData: z.string().optional().nullable(),
  needsReview: z.boolean().optional().default(false),
});

const depositBody = z.object({
  bankCashboxId: z.string().uuid(),
  depositDate: z.string().optional(),
});

const returnBody = z.object({
  note: z.string().optional().nullable(),
  returnDate: z.string().optional(),
});

export const checksRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const statusParam = q.status as CheckStatus | undefined;
    const sortBy = q.sortBy as 'dueDate' | 'amountDesc' | 'amountAsc' | 'receivedDesc' | 'receivedAsc' | undefined;
    const result = await listChecks(companyId, {
      status: statusParam,
      search: q.search?.trim() || undefined,
      dueFrom: q.dueFrom?.trim() || undefined,
      dueTo: q.dueTo?.trim() || undefined,
      sortBy,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
    return reply.send({ ok: true, ...result });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const check = await createCheck(client, {
        companyId,
        userId,
        checkNo: d.checkNo,
        bankName: d.bankName,
        accountHolderName: d.accountHolderName,
        partyType: d.partyType,
        partyId: d.partyId,
        partyName: d.partyName,
        amount: d.amount,
        currencyCode: d.currencyCode,
        receivedDate: d.receivedDate ?? undefined,
        dueDate: d.dueDate,
        imageData: d.imageData,
        needsReview: d.needsReview,
      });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: check });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === '23505') return sendError(reply, 409, 'يوجد شيك بنفس الرقم والبنك مسبقاً', 'DUPLICATE');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  app.post('/:id/deposit', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = depositBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const check = await depositCheck(client, {
        companyId,
        checkId: id,
        bankCashboxId: d.bankCashboxId,
        depositDate: d.depositDate,
        userId,
      });
      await client.query('COMMIT');
      return reply.send({ ok: true, data: check });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err?.code === 'INVALID_STATE') return sendError(reply, 400, err.message || 'حالة غير صالحة', 'INVALID_STATE');
      if (err?.code === 'GL_UNBALANCED') return sendError(reply, 400, err.message || 'قيد محاسبي غير متوازن', 'GL_UNBALANCED');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  app.post('/:id/clear', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const check = await markCheckCleared(client, { companyId, checkId: id, userId });
      await client.query('COMMIT');
      return reply.send({ ok: true, data: check });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err?.code === 'INVALID_STATE') return sendError(reply, 400, err.message || 'حالة غير صالحة', 'INVALID_STATE');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  app.post('/:id/return', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = returnBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const check = await returnCheck(client, {
        companyId,
        checkId: id,
        note: d.note,
        returnDate: d.returnDate,
        userId,
      });
      await client.query('COMMIT');
      return reply.send({ ok: true, data: check });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err?.code === 'INVALID_STATE') return sendError(reply, 400, err.message || 'حالة غير صالحة', 'INVALID_STATE');
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'GL_UNBALANCED') return sendError(reply, 400, err.message || 'قيد محاسبي غير متوازن', 'GL_UNBALANCED');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });
};
