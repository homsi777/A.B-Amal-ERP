import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from '../middleware/errorHandler.js';

const hexRegex = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

const colorBody = z.object({
  name_ar: z.string().min(1, 'الاسم العربي مطلوب'),
  name_tr: z.string().optional().default(''),
  color_code: z.string().min(1, 'كود اللون مطلوب'),
  supplier_color_code: z.string().optional().default(''),
  hex_color: z
    .string()
    .optional()
    .refine((v) => !v || hexRegex.test(v), { message: 'صيغة اللون السداسي غير صحيحة (#RGB أو #RRGGBB)' }),
  notes: z.string().optional().default(''),
});

export const fabricColorRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';
    const colorCode = q.colorCode?.trim() || '';
    const supplierCode = q.supplierColorCode?.trim() || '';
    const status = q.status;
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['(company_id=$1 OR company_id IS NULL)'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (search) {
      conditions.push(`(name_ar ILIKE $${p} OR name_tr ILIKE $${p} OR color_code ILIKE $${p})`);
      params.push(`%${search}%`); p++;
    }
    if (colorCode) { conditions.push(`color_code ILIKE $${p}`); params.push(`%${colorCode}%`); p++; }
    if (supplierCode) { conditions.push(`supplier_color_code ILIKE $${p}`); params.push(`%${supplierCode}%`); p++; }
    if (status === 'active') conditions.push('is_active=true');
    else if (status === 'inactive') conditions.push('is_active=false');

    const where = conditions.join(' AND ');
    const pool = getPool();
    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT id,name_ar,name_tr,color_code,supplier_color_code,hex_color,notes,is_active,created_at,updated_at
         FROM fabric_colors WHERE ${where} ORDER BY name_ar ASC LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM fabric_colors WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `SELECT id,name_ar,name_tr,color_code,supplier_color_code,hex_color,notes,is_active,created_at,updated_at
       FROM fabric_colors WHERE id=$1 AND (company_id=$2 OR company_id IS NULL)`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'اللون غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const parsed = colorBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    const row = await pool.query(
      `INSERT INTO fabric_colors(company_id,name_ar,name_tr,color_code,supplier_color_code,hex_color,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,name_ar,name_tr,color_code,supplier_color_code,hex_color,notes,is_active,created_at`,
      [companyId, d.name_ar, d.name_tr, d.color_code, d.supplier_color_code, d.hex_color || null, d.notes],
    );
    return reply.status(201).send({ ok: true, data: row.rows[0] });
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = colorBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    const row = await pool.query(
      `UPDATE fabric_colors
       SET name_ar=$3,name_tr=$4,color_code=$5,supplier_color_code=$6,hex_color=$7,notes=$8,updated_at=now()
       WHERE id=$1 AND company_id=$2
       RETURNING id,name_ar,name_tr,color_code,supplier_color_code,hex_color,notes,is_active,updated_at`,
      [id, companyId, d.name_ar, d.name_tr, d.color_code, d.supplier_color_code, d.hex_color || null, d.notes],
    );
    if (!row.rows.length) return sendError(reply, 404, 'اللون غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.patch('/:id/toggle-status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `UPDATE fabric_colors SET is_active=NOT is_active,updated_at=now()
       WHERE id=$1 AND company_id=$2 RETURNING id,is_active`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'اللون غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });
};
