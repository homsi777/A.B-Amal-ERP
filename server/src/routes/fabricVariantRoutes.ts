import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from '../middleware/errorHandler.js';

const variantBody = z.object({
  item_id: z.string().uuid('معرّف الخامة غير صالح'),
  color_id: z.string().uuid('معرّف اللون غير صالح'),
  variant_code: z.string().min(1, 'كود المتغير مطلوب'),
  width_cm: z.number().positive().nullable().optional(),
  gsm: z.number().positive().nullable().optional(),
});

export const fabricVariantRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';
    const status = q.status;
    const itemId = q.itemId;
    const colorId = q.colorId;
    const widthCm = q.widthCm ? parseFloat(q.widthCm) : undefined;
    const gsm = q.gsm ? parseFloat(q.gsm) : undefined;
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['fv.company_id=$1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (search) {
      conditions.push(`(fv.variant_code ILIKE $${p} OR fi.name ILIKE $${p} OR fc.name_ar ILIKE $${p})`);
      params.push(`%${search}%`); p++;
    }
    if (status === 'active') conditions.push('fv.is_active=true');
    else if (status === 'inactive') conditions.push('fv.is_active=false');
    if (itemId) { conditions.push(`fv.item_id=$${p}`); params.push(itemId); p++; }
    if (colorId) { conditions.push(`fv.color_id=$${p}`); params.push(colorId); p++; }
    if (widthCm !== undefined) { conditions.push(`fv.width_cm=$${p}`); params.push(widthCm); p++; }
    if (gsm !== undefined) { conditions.push(`fv.gsm=$${p}`); params.push(gsm); p++; }

    const where = conditions.join(' AND ');
    const pool = getPool();
    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT fv.id,fv.variant_code,fv.item_id,fv.color_id,fv.width_cm,fv.gsm,fv.is_active,
                fv.created_at,fv.updated_at,
                fi.name AS item_name, fi.internal_code AS item_code,
                fc.name_ar AS color_name_ar, fc.color_code, fc.hex_color
         FROM fabric_item_variants fv
         LEFT JOIN fabric_items fi ON fi.id=fv.item_id
         LEFT JOIN fabric_colors fc ON fc.id=fv.color_id
         WHERE ${where} ORDER BY fv.variant_code ASC LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM fabric_item_variants fv
         LEFT JOIN fabric_items fi ON fi.id=fv.item_id
         LEFT JOIN fabric_colors fc ON fc.id=fv.color_id
         WHERE ${where}`,
        params,
      ),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `SELECT fv.id,fv.variant_code,fv.item_id,fv.color_id,fv.width_cm,fv.gsm,fv.is_active,
              fv.created_at,fv.updated_at,
              fi.name AS item_name, fi.internal_code AS item_code,
              fc.name_ar AS color_name_ar, fc.color_code, fc.hex_color
       FROM fabric_item_variants fv
       LEFT JOIN fabric_items fi ON fi.id=fv.item_id
       LEFT JOIN fabric_colors fc ON fc.id=fv.color_id
       WHERE fv.id=$1 AND fv.company_id=$2`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'المتغير غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const parsed = variantBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    // Verify item and color belong to this company
    const itemCheck = await pool.query('SELECT id FROM fabric_items WHERE id=$1 AND company_id=$2', [d.item_id, companyId]);
    if (!itemCheck.rows.length) return sendError(reply, 404, 'الخامة غير موجودة', 'NOT_FOUND');
    const colorCheck = await pool.query('SELECT id FROM fabric_colors WHERE id=$1 AND (company_id=$2 OR company_id IS NULL)', [d.color_id, companyId]);
    if (!colorCheck.rows.length) return sendError(reply, 404, 'اللون غير موجود', 'NOT_FOUND');
    try {
      const row = await pool.query(
        `INSERT INTO fabric_item_variants(company_id,item_id,color_id,variant_code,width_cm,gsm)
         VALUES($1,$2,$3,$4,$5,$6)
         RETURNING id,variant_code,item_id,color_id,width_cm,gsm,is_active,created_at`,
        [companyId, d.item_id, d.color_id, d.variant_code, d.width_cm ?? null, d.gsm ?? null],
      );
      return reply.status(201).send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'كود المتغير مستخدم مسبقاً', 'DUPLICATE');
      throw e;
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = variantBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    try {
      const row = await pool.query(
        `UPDATE fabric_item_variants
         SET item_id=$3,color_id=$4,variant_code=$5,width_cm=$6,gsm=$7,updated_at=now()
         WHERE id=$1 AND company_id=$2
         RETURNING id,variant_code,item_id,color_id,width_cm,gsm,is_active,updated_at`,
        [id, companyId, d.item_id, d.color_id, d.variant_code, d.width_cm ?? null, d.gsm ?? null],
      );
      if (!row.rows.length) return sendError(reply, 404, 'المتغير غير موجود', 'NOT_FOUND');
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'كود المتغير مستخدم مسبقاً', 'DUPLICATE');
      throw e;
    }
  });

  app.patch('/:id/toggle-status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `UPDATE fabric_item_variants SET is_active=NOT is_active,updated_at=now()
       WHERE id=$1 AND company_id=$2 RETURNING id,is_active`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'المتغير غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });
};
