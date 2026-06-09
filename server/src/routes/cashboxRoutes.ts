import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { generateDocumentNo } from '../utils/documentNumbers.js';

const createBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  currencyCode: z.string().min(1).default('USD'),
  openingBalance: z.coerce.number().default(0),
  isDefault: z.boolean().optional().default(false),
  notes: z.string().optional().nullable(),
});

const updateBody = z.object({
  name: z.string().min(1),
  notes: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
});

const adjustmentBody = z.object({
  direction: z.enum(['IN', 'OUT']),
  amount: z.coerce.number().positive(),
  description: z.string().min(1),
});

export const cashboxRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const active = q.active;
    const currency = q.currency?.trim();
    const search = q.search?.trim() || '';

    const conditions: string[] = ['company_id = $1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (active === 'true') conditions.push('is_active = true');
    else if (active === 'false') conditions.push('is_active = false');

    if (currency) {
      conditions.push(`currency_code = $${p}`);
      params.push(currency);
      p++;
    }
    if (search) {
      conditions.push(`(name ILIKE $${p} OR code ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }

    const where = conditions.join(' AND ');
    const pool = getPool();
    const rows = await pool.query(
      `SELECT id, code, name, currency_code, opening_balance, current_balance, is_default, is_active, notes, created_at, updated_at
       FROM cashboxes WHERE ${where} ORDER BY is_default DESC, name ASC`,
      params,
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  /** كل حركات الصناديق للشركة (سجل الخزينة الموحد) */
  app.get('/movements/all', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize) || 50));
    const offset = (page - 1) * pageSize;

    const pool = getPool();
    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT m.id, m.movement_no, m.cashbox_id, c.name AS cashbox_name, m.movement_type, m.direction,
                m.amount, m.currency_code, m.exchange_rate_to_usd, m.amount_usd, m.balance_after, m.source_type, m.source_no, m.description,
                m.movement_at, m.created_at
         FROM cashbox_movements m
         JOIN cashboxes c ON c.id = m.cashbox_id AND c.company_id = m.company_id
         WHERE m.company_id = $1
         ORDER BY m.movement_at DESC, m.created_at DESC
         LIMIT $2 OFFSET $3`,
        [companyId, pageSize, offset],
      ),
      pool.query<{ c: string }>(`SELECT COUNT(*)::int AS c FROM cashbox_movements WHERE company_id = $1`, [
        companyId,
      ]),
    ]);

    return reply.send({
      ok: true,
      data: rows.rows,
      total: parseInt(countRow.rows[0].c, 10),
      page,
      pageSize,
    });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `SELECT id, code, name, currency_code, opening_balance, current_balance, is_default, is_active, notes, created_at, updated_at
       FROM cashboxes WHERE id=$1 AND company_id=$2`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'الصندوق غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (d.isDefault) {
        await client.query(`UPDATE cashboxes SET is_default=false, updated_at=now() WHERE company_id=$1`, [
          companyId,
        ]);
      }

      const ins = await client.query(
        `INSERT INTO cashboxes (
           company_id, code, name, currency_code, opening_balance, current_balance,
           is_default, is_active, notes, created_by_user_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)
         RETURNING id, code, name, currency_code, opening_balance, current_balance, is_default, is_active, created_at`,
        [
          companyId,
          d.code.trim(),
          d.name.trim(),
          d.currencyCode,
          d.openingBalance,
          d.openingBalance,
          d.isDefault,
          d.notes ?? null,
          userId,
        ],
      );

      if (d.openingBalance !== 0) {
        const movNo = generateDocumentNo('MOV');
        const dir = d.openingBalance >= 0 ? 'IN' : 'OUT';
        const amt = Math.abs(d.openingBalance);
        await client.query(
          `INSERT INTO cashbox_movements (
             company_id, cashbox_id, movement_no, movement_type, direction, amount,
             currency_code, balance_after, source_type, description, created_by_user_id
           ) VALUES ($1,$2,$3,'OPENING',$4,$5,$6,$7,'MANUAL',$8,$9)`,
          [
            companyId,
            ins.rows[0].id,
            movNo,
            dir,
            amt,
            d.currencyCode,
            d.openingBalance,
            'رصيد افتتاحي',
            userId,
          ],
        );
      }

      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: ins.rows[0] });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'كود الصندوق مستخدم مسبقاً', 'DUPLICATE');
      throw e;
    } finally {
      client.release();
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (d.isDefault === true) {
        await client.query(`UPDATE cashboxes SET is_default=false, updated_at=now() WHERE company_id=$1`, [
          companyId,
        ]);
      }

      const row = await client.query(
        `UPDATE cashboxes SET
           name = COALESCE($3, name),
           notes = $4,
           is_default = CASE WHEN $5::boolean IS NULL THEN is_default ELSE $5 END,
           updated_at = now()
         WHERE id=$1 AND company_id=$2
         RETURNING id, code, name, currency_code, opening_balance, current_balance, is_default, is_active, updated_at`,
        [id, companyId, d.name, d.notes ?? null, d.isDefault ?? null],
      );
      if (!row.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'الصندوق غير موجود', 'NOT_FOUND');
      }
      await client.query('COMMIT');
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.patch('/:id/toggle-status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `UPDATE cashboxes SET is_active = NOT is_active, updated_at=now()
       WHERE id=$1 AND company_id=$2 RETURNING id, is_active`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'الصندوق غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.get('/:id/movements', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize) || 50));
    const offset = (page - 1) * pageSize;

    const pool = getPool();
    const box = await pool.query(`SELECT id FROM cashboxes WHERE id=$1 AND company_id=$2`, [id, companyId]);
    if (!box.rows.length) return sendError(reply, 404, 'الصندوق غير موجود', 'NOT_FOUND');

    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT id, movement_no, movement_type, direction, amount, currency_code, balance_after,
                source_type, source_no, description, movement_at, created_at
         FROM cashbox_movements
         WHERE cashbox_id=$1 AND company_id=$2
         ORDER BY movement_at DESC, created_at DESC
         LIMIT $3 OFFSET $4`,
        [id, companyId, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM cashbox_movements WHERE cashbox_id=$1 AND company_id=$2`, [
        id,
        companyId,
      ]),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.post('/:id/adjustment', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = adjustmentBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const box = await client.query<{ current_balance: string; currency_code: string }>(
        `SELECT current_balance, currency_code FROM cashboxes WHERE id=$1 AND company_id=$2 AND is_active=true FOR UPDATE`,
        [id, companyId],
      );
      if (!box.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'الصندوق غير موجود أو غير نشط', 'NOT_FOUND');
      }

      const prev = Number(box.rows[0].current_balance);
      const curCode = box.rows[0].currency_code;
      const delta = d.direction === 'IN' ? d.amount : -d.amount;
      const next = prev + delta;

      const movNo = generateDocumentNo('MOV');
      await client.query(
        `INSERT INTO cashbox_movements (
           company_id, cashbox_id, movement_no, movement_type, direction, amount,
           currency_code, balance_after, source_type, description, created_by_user_id
         ) VALUES ($1,$2,$3,'ADJUSTMENT',$4,$5,$6,$7,'MANUAL',$8,$9,$10)`,
        [
          companyId,
          id,
          movNo,
          d.direction,
          d.amount,
          curCode,
          next,
          d.description,
          userId,
        ],
      );

      await client.query(`UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`, [
        id,
        companyId,
        next,
      ]);

      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: { movementNo: movNo, balanceAfter: next } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
};
