import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from '../middleware/errorHandler.js';

const warehouseBody = z.object({
  code: z.string().min(1, 'الكود مطلوب'),
  name: z.string().min(1, 'الاسم مطلوب'),
  type: z.string().default('MAIN'),
  address: z.string().optional().default(''),
});

const locationBody = z.object({
  code: z.string().min(1, 'الكود مطلوب'),
  name: z.string().min(1, 'الاسم مطلوب'),
});

export const warehouseRoutes: FastifyPluginAsync = async (app) => {
  // ===== Warehouses =====
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';
    const status = q.status;
    const pool = getPool();

    const conditions: string[] = ['company_id=$1'];
    const params: unknown[] = [companyId];
    let p = 2;
    if (search) { conditions.push(`(name ILIKE $${p} OR code ILIKE $${p})`); params.push(`%${search}%`); p++; }
    if (status === 'active') conditions.push('is_active=true');
    else if (status === 'inactive') conditions.push('is_active=false');

    const where = conditions.join(' AND ');
    const rows = await pool.query(
      `SELECT id,code,name,type,address,is_active,created_at,updated_at
       FROM warehouses WHERE ${where} ORDER BY name ASC`,
      params,
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `SELECT id,code,name,type,address,is_active,created_at,updated_at
       FROM warehouses WHERE id=$1 AND company_id=$2`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'المستودع غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const parsed = warehouseBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    try {
      const row = await pool.query(
        `INSERT INTO warehouses(company_id,code,name,type,address)
         VALUES($1,$2,$3,$4,$5)
         RETURNING id,code,name,type,address,is_active,created_at`,
        [companyId, d.code.toUpperCase(), d.name, d.type.toUpperCase(), d.address],
      );
      return reply.status(201).send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'كود المستودع مستخدم مسبقاً', 'DUPLICATE');
      throw e;
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = warehouseBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    try {
      const row = await pool.query(
        `UPDATE warehouses SET name=$3,type=$4,address=$5,updated_at=now()
         WHERE id=$1 AND company_id=$2
         RETURNING id,code,name,type,address,is_active,updated_at`,
        [id, companyId, d.name, d.type.toUpperCase(), d.address],
      );
      if (!row.rows.length) return sendError(reply, 404, 'المستودع غير موجود', 'NOT_FOUND');
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'كود المستودع مستخدم مسبقاً', 'DUPLICATE');
      throw e;
    }
  });

  app.patch('/:id/toggle-status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `UPDATE warehouses SET is_active=NOT is_active,updated_at=now()
       WHERE id=$1 AND company_id=$2 RETURNING id,code,is_active`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'المستودع غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  // ===== Warehouse Locations =====
  app.get('/:warehouseId/locations', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { warehouseId } = req.params as { warehouseId: string };
    const pool = getPool();
    const rows = await pool.query(
      `SELECT id,code,name,warehouse_id,is_active,created_at
       FROM warehouse_locations WHERE warehouse_id=$1 AND company_id=$2 ORDER BY code ASC`,
      [warehouseId, companyId],
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.post('/:warehouseId/locations', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { warehouseId } = req.params as { warehouseId: string };
    const parsed = locationBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const pool = getPool();
    const whCheck = await pool.query(
      'SELECT id FROM warehouses WHERE id=$1 AND company_id=$2',
      [warehouseId, companyId],
    );
    if (!whCheck.rows.length) return sendError(reply, 404, 'المستودع غير موجود', 'NOT_FOUND');
    try {
      const row = await pool.query(
        `INSERT INTO warehouse_locations(company_id,warehouse_id,code,name)
         VALUES($1,$2,$3,$4) RETURNING id,code,name,warehouse_id,is_active,created_at`,
        [companyId, warehouseId, parsed.data.code, parsed.data.name],
      );
      return reply.status(201).send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'كود الموقع مستخدم مسبقاً في هذا المستودع', 'DUPLICATE');
      throw e;
    }
  });
};

export const warehouseLocationRoutes: FastifyPluginAsync = async (app) => {
  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = locationBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const pool = getPool();
    const row = await pool.query(
      `UPDATE warehouse_locations SET name=$3,updated_at=now()
       WHERE id=$1 AND company_id=$2 RETURNING id,code,name,is_active`,
      [id, companyId, parsed.data.name],
    );
    if (!row.rows.length) return sendError(reply, 404, 'الموقع غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.patch('/:id/toggle-status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `UPDATE warehouse_locations SET is_active=NOT is_active,updated_at=now()
       WHERE id=$1 AND company_id=$2 RETURNING id,is_active`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'الموقع غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });
};
