import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { insertPartyActivityLog } from '../services/partyActivityLogService.js';

const manualBody = z.object({
  partyType: z.enum(['CUSTOMER', 'SUPPLIER']),
  partyId: z.string().uuid().optional().nullable(),
  partyName: z.string().min(1),
  activityType: z.string().min(1).default('NOTE'),
  description: z.string().min(1),
  amount: z.coerce.number().optional().nullable(),
  currencyCode: z.string().optional().nullable(),
});

export const partyActivityLogRoutes: FastifyPluginAsync = async (app) => {
  app.get('/summary', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const pool = getPool();
    const [byType, total] = await Promise.all([
      pool.query(
        `SELECT party_type, COUNT(*)::int AS n FROM party_activity_logs WHERE company_id=$1 GROUP BY party_type`,
        [companyId],
      ),
      pool.query<{ c: string }>(`SELECT COUNT(*)::int AS c FROM party_activity_logs WHERE company_id=$1`, [
        companyId,
      ]),
    ]);
    return reply.send({
      ok: true,
      data: {
        byPartyType: Object.fromEntries(byType.rows.map((r) => [r.party_type, r.n])),
        total: parseInt(total.rows[0].c, 10),
      },
    });
  });

  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const partyType = q.partyType as 'CUSTOMER' | 'SUPPLIER' | undefined;
    const partyId = q.partyId?.trim();
    const search = q.search?.trim() || '';
    const activityType = q.activityType?.trim();
    const dateFrom = q.dateFrom?.trim();
    const dateTo = q.dateTo?.trim();
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['company_id = $1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (partyType && ['CUSTOMER', 'SUPPLIER'].includes(partyType)) {
      conditions.push(`party_type = $${p}`);
      params.push(partyType);
      p++;
    }
    if (partyId) {
      conditions.push(`party_id = $${p}`);
      params.push(partyId);
      p++;
    }
    if (search) {
      conditions.push(`(party_name ILIKE $${p} OR description ILIKE $${p} OR COALESCE(reference_no,'') ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }
    if (activityType) {
      conditions.push(`activity_type = $${p}`);
      params.push(activityType);
      p++;
    }
    if (dateFrom) {
      conditions.push(`activity_at >= $${p}::timestamptz`);
      params.push(`${dateFrom}T00:00:00Z`);
      p++;
    }
    if (dateTo) {
      conditions.push(`activity_at < ($${p}::date + interval '1 day')`);
      params.push(dateTo);
      p++;
    }

    const where = conditions.join(' AND ');
    const pool = getPool();
    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT id, party_type, party_id, party_name, activity_type, reference_type, reference_id, reference_no,
                amount, currency_code, description, activity_at, created_at
         FROM party_activity_logs WHERE ${where}
         ORDER BY activity_at DESC
         LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM party_activity_logs WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = manualBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    await insertPartyActivityLog(pool, {
      companyId,
      partyType: d.partyType,
      partyId: d.partyId ?? null,
      partyName: d.partyName,
      activityType: d.activityType,
      description: d.description,
      userId,
      amount: d.amount ?? null,
      currencyCode: d.currencyCode ?? null,
    });
    return reply.status(201).send({ ok: true, data: { created: true } });
  });
};
