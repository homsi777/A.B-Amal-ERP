import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from '../middleware/errorHandler.js';

const itemBody = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  internal_code: z.string().min(1, 'الكود الداخلي مطلوب'),
  supplier_code: z.string().optional().default(''),
  fabric_type: z.string().optional().default(''),
  unit: z.string().default('meter'),
  notes: z.string().optional().default(''),
  category_id: z.string().uuid().nullable().optional(),
  supplier_id: z.string().uuid().nullable().optional(),
});

export const fabricItemRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';
    const status = q.status;
    const categoryId = q.categoryId;
    const supplierId = q.supplierId;
    const fabricType = q.fabricType?.trim() || '';
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['fi.company_id=$1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (search) {
      conditions.push(`(fi.name ILIKE $${p} OR fi.internal_code ILIKE $${p} OR fi.supplier_code ILIKE $${p})`);
      params.push(`%${search}%`); p++;
    }
    if (status === 'active') conditions.push('fi.is_active=true');
    else if (status === 'inactive') conditions.push('fi.is_active=false');
    if (categoryId) { conditions.push(`fi.category_id=$${p}`); params.push(categoryId); p++; }
    if (supplierId) { conditions.push(`fi.supplier_id=$${p}`); params.push(supplierId); p++; }
    if (fabricType) { conditions.push(`fi.fabric_type ILIKE $${p}`); params.push(`%${fabricType}%`); p++; }

    const where = conditions.join(' AND ');
    const pool = getPool();
    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT fi.id,fi.internal_code,fi.supplier_code,fi.name,fi.fabric_type,fi.unit,fi.notes,
                fi.is_active,fi.category_id,fi.supplier_id,
                fc.name AS category_name, s.name AS supplier_name,
                fi.created_at,fi.updated_at
         FROM fabric_items fi
         LEFT JOIN fabric_categories fc ON fc.id=fi.category_id
         LEFT JOIN suppliers s ON s.id=fi.supplier_id
         WHERE ${where} ORDER BY fi.name ASC LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM fabric_items fi WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `SELECT fi.id,fi.internal_code,fi.supplier_code,fi.name,fi.fabric_type,fi.unit,fi.notes,
              fi.is_active,fi.category_id,fi.supplier_id,
              fc.name AS category_name, s.name AS supplier_name,
              fi.created_at,fi.updated_at
       FROM fabric_items fi
       LEFT JOIN fabric_categories fc ON fc.id=fi.category_id
       LEFT JOIN suppliers s ON s.id=fi.supplier_id
       WHERE fi.id=$1 AND fi.company_id=$2`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'الخامة غير موجودة', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const parsed = itemBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    try {
      const row = await pool.query(
        `INSERT INTO fabric_items(company_id,category_id,supplier_id,internal_code,supplier_code,name,fabric_type,unit,notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id,internal_code,supplier_code,name,fabric_type,unit,notes,is_active,category_id,supplier_id,created_at`,
        [companyId, d.category_id ?? null, d.supplier_id ?? null, d.internal_code,
         d.supplier_code, d.name, d.fabric_type, d.unit, d.notes],
      );
      return reply.status(201).send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'الكود الداخلي مستخدم مسبقاً', 'DUPLICATE');
      throw e;
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = itemBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    try {
      const row = await pool.query(
        `UPDATE fabric_items
         SET name=$3,supplier_code=$4,fabric_type=$5,unit=$6,notes=$7,
             category_id=$8,supplier_id=$9,updated_at=now()
         WHERE id=$1 AND company_id=$2
         RETURNING id,internal_code,supplier_code,name,fabric_type,unit,notes,is_active,category_id,supplier_id,updated_at`,
        [id, companyId, d.name, d.supplier_code, d.fabric_type, d.unit, d.notes,
         d.category_id ?? null, d.supplier_id ?? null],
      );
      if (!row.rows.length) return sendError(reply, 404, 'الخامة غير موجودة', 'NOT_FOUND');
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'الكود الداخلي مستخدم مسبقاً', 'DUPLICATE');
      throw e;
    }
  });

  app.patch('/:id/toggle-status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `UPDATE fabric_items SET is_active=NOT is_active,updated_at=now()
       WHERE id=$1 AND company_id=$2 RETURNING id,is_active`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'الخامة غير موجودة', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });
};
