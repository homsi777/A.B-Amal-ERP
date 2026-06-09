import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from '../middleware/errorHandler.js';
import { insertPartyActivityLog } from '../services/partyActivityLogService.js';
import { getSupplierStatement } from '../services/partyStatementService.js';

const supplierBody = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  code: z.string().optional(),
  phone: z.string().optional().default(''),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional().default(''),
  country: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  telegramChatId: z.string().trim().max(64).optional().default(''),
  telegramEnabled: z.boolean().optional().default(false),
  telegramLabel: z.string().trim().max(120).optional().default(''),
});

function genCode(prefix = 'SUP') {
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

async function assertTelegramChatAvailable(companyId: string, chatId: string, targetId?: string) {
  const value = chatId.trim();
  if (!value) return;
  const duplicate = await getPool().query<{ target_name: string }>(
    `SELECT target_name FROM telegram_chat_links
     WHERE company_id=$1 AND chat_id=$2 AND is_active=true
       AND ($3::uuid IS NULL OR target_id IS DISTINCT FROM $3::uuid)
     LIMIT 1`,
    [companyId, value, targetId ?? null],
  );
  if (duplicate.rows.length) {
    throw Object.assign(new Error(`هذا Chat ID مرتبط مسبقاً بـ ${duplicate.rows[0].target_name}.`), { code: 'TELEGRAM_DUPLICATE' });
  }
}

export const supplierRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';
    const status = q.status; // 'active' | 'inactive' | undefined
    const country = q.country?.trim() || '';
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['company_id = $1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (search) {
      conditions.push(`(name ILIKE $${p} OR code ILIKE $${p} OR phone ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }
    if (status === 'active') { conditions.push(`is_active = true`); }
    else if (status === 'inactive') { conditions.push(`is_active = false`); }
    if (country) { conditions.push(`country ILIKE $${p}`); params.push(`%${country}%`); p++; }

    const where = conditions.join(' AND ');
    const pool = getPool();
    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT id,code,name,phone,email,address,country,notes,telegram_chat_id,telegram_enabled,telegram_label,is_active,created_at,updated_at
         FROM suppliers WHERE ${where} ORDER BY name ASC LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM suppliers WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.get('/:id/statement', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, string>;
    try {
      const data = await getSupplierStatement(companyId, id, {
        fromDate: q.fromDate?.trim() || undefined,
        toDate: q.toDate?.trim() || undefined,
        currency: q.currency?.trim() || undefined,
      });
      return reply.send({ ok: true, data });
    } catch (e) {
      if ((e as { code?: string }).code === 'NOT_FOUND') {
        return sendError(reply, 404, e instanceof Error ? e.message : 'المورد غير موجود', 'NOT_FOUND');
      }
      throw e;
    }
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `SELECT id,code,name,phone,email,address,country,notes,telegram_chat_id,telegram_enabled,telegram_label,is_active,created_at,updated_at
       FROM suppliers WHERE id=$1 AND company_id=$2`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'المورد غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const parsed = supplierBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const code = d.code?.trim() || genCode();
    const pool = getPool();
    try {
      await assertTelegramChatAvailable(companyId, d.telegramChatId);
      const row = await pool.query(
        `INSERT INTO suppliers(company_id,code,name,phone,email,address,country,notes,telegram_chat_id,telegram_enabled,telegram_label)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id,code,name,phone,email,address,country,notes,telegram_chat_id,telegram_enabled,telegram_label,is_active,created_at`,
        [companyId, code, d.name, d.phone, d.email || null, d.address, d.country, d.notes, d.telegramChatId || null, d.telegramEnabled, d.telegramLabel || null],
      );
      try {
        await insertPartyActivityLog(pool, {
          companyId,
          partyType: 'SUPPLIER',
          partyId: row.rows[0].id,
          partyName: row.rows[0].name,
          activityType: 'CREATED',
          description: 'إنشاء مورد جديد',
          userId: req.user!.sub,
        });
      } catch {
        /* ignore */
      }
      return reply.status(201).send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'كود المورد مستخدم مسبقاً', 'DUPLICATE');
      if ((e as { code?: string }).code === 'TELEGRAM_DUPLICATE')
        return sendError(reply, 409, e instanceof Error ? e.message : 'Chat ID مستخدم مسبقاً', 'TELEGRAM_DUPLICATE_CHAT');
      throw e;
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = supplierBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    try {
      await assertTelegramChatAvailable(companyId, d.telegramChatId, id);
      const row = await pool.query(
        `UPDATE suppliers SET name=$3,phone=$4,email=$5,address=$6,country=$7,notes=$8,
           telegram_chat_id=$9,telegram_enabled=$10,telegram_label=$11,updated_at=now()
         WHERE id=$1 AND company_id=$2
         RETURNING id,code,name,phone,email,address,country,notes,telegram_chat_id,telegram_enabled,telegram_label,is_active,updated_at`,
        [id, companyId, d.name, d.phone, d.email || null, d.address, d.country, d.notes, d.telegramChatId || null, d.telegramEnabled, d.telegramLabel || null],
      );
      if (!row.rows.length) return sendError(reply, 404, 'المورد غير موجود', 'NOT_FOUND');
      try {
        await insertPartyActivityLog(pool, {
          companyId,
          partyType: 'SUPPLIER',
          partyId: id,
          partyName: row.rows[0].name,
          activityType: 'UPDATED',
          description: 'تحديث بيانات المورد',
          userId: req.user!.sub,
        });
      } catch {
        /* ignore */
      }
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'كود المورد مستخدم مسبقاً', 'DUPLICATE');
      if ((e as { code?: string }).code === 'TELEGRAM_DUPLICATE')
        return sendError(reply, 409, e instanceof Error ? e.message : 'Chat ID مستخدم مسبقاً', 'TELEGRAM_DUPLICATE_CHAT');
      throw e;
    }
  });

  app.patch('/:id/toggle-status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `UPDATE suppliers SET is_active = NOT is_active, updated_at=now()
       WHERE id=$1 AND company_id=$2 RETURNING id,is_active`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'المورد غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });
};
