import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { getPool } from '../db/pool.js';
import { getGlChartOfAccounts, getGlJournalLines } from '../services/glReportService.js';
import { postManualJournal } from '../services/glPostingService.js';
import { ensureCompanyGlCoa } from '../services/glCoaService.js';

const manualJournalBody = z.object({
  entryDate: z.string().min(1),
  description: z.string().min(1),
  lines: z
    .array(
      z.object({
        glAccountId: z.string().uuid(),
        debit: z.coerce.number().nonnegative().default(0),
        credit: z.coerce.number().nonnegative().default(0),
        currencyCode: z.string().optional(),
        description: z.string().optional().nullable(),
        cashboxId: z.string().uuid().optional().nullable(),
        partyType: z.enum(['CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OTHER']).optional().nullable(),
        partyId: z.string().uuid().optional().nullable(),
      }),
    )
    .min(2),
});

export const financeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/chart-of-accounts', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const data = await getGlChartOfAccounts(companyId);
    return reply.send({
      ok: true,
      data,
      meta: {
        note:
          'أرصدة الحسابات محسوبة من مجموع قيود دفتر اليومية المُرحَّلة (سندات، مرتجعات، رواتب، قيود يدوية).',
      },
    });
  });

  app.get('/journal', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const data = await getGlJournalLines(companyId, {
      dateFrom: q.dateFrom?.trim(),
      dateTo: q.dateTo?.trim(),
      search: q.search?.trim(),
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    });
    return reply.send({
      ok: true,
      data,
      meta: {
        note: 'سجل القيود المزدوجة المرحَّل في النظام — كل سند مؤكد يولّد قيداً متوازناً في GL.',
      },
    });
  });

  app.get('/gl-accounts', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureCompanyGlCoa(client, companyId);
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
    const rows = await pool.query(
      `SELECT id, code, name, account_type, system_key
       FROM gl_accounts
       WHERE company_id = $1 AND is_posting = true
       ORDER BY sort_order, code`,
      [companyId],
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.post('/journal-entries', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = manualJournalBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const entryId = await postManualJournal(client, {
        companyId,
        entryDate: parsed.data.entryDate,
        description: parsed.data.description,
        userId,
        lines: parsed.data.lines,
      });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: { id: entryId } });
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === 'GL_UNBALANCED' || (e as { code?: string }).code === 'VALIDATION') {
        return sendError(reply, 400, e instanceof Error ? e.message : ArabicErrors.validation, 'VALIDATION');
      }
      throw e;
    } finally {
      client.release();
    }
  });
};
