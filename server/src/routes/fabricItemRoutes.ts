import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from '../middleware/errorHandler.js';

const compositionLineBody = z.object({
  percent: z.number().min(1).max(100),
  fiberTypeId: z.string().uuid().nullable().optional(),
  fiberName: z.string().min(1),
});

const itemBody = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  internal_code: z.string().min(1, 'الكود الداخلي مطلوب'),
  supplier_code: z.string().optional().default(''),
  fabric_type: z.string().optional().default(''),
  unit: z.string().default('meter'),
  notes: z.string().optional().default(''),
  category_id: z.string().uuid().nullable().optional(),
  supplier_id: z.string().uuid().nullable().optional(),
  // كود التصميم ورقم التصميم الحقيقيان — مستقلان عن internal_code، مصدر
  // ART CODE / DESIGN NO بالكارتيله المرتبطة بهذه الخامة. بلا default عمداً:
  // undefined (غير مُرسَل، كما بشاشة استلام البضاعة القديمة) = لا تغيير على
  // التحديث، تمييزاً عن '' المُرسَلة عمداً لمسح الحقل.
  design_code: z.string().optional(),
  design_no: z.string().optional(),
  // تركيب الخامة — يُحفَظ هنا مرة واحدة ويُسحَب تلقائياً لكل كارتيله لاحقة
  // لنفس الخامة. اختياري بالكامل (undefined = لا تغيير على الحقل الحالي).
  composition_lines: z.array(compositionLineBody).max(5).optional(),
});

function validateCompositionLines(lines: Array<{ percent: number; fiberName: string }>): string | null {
  if (lines.length === 0) return null;
  if (lines.length > 5) return 'الحد الأقصى 5 مكوّنات للخليط';
  const total = lines.reduce((sum, line) => sum + line.percent, 0);
  if (total !== 100) return `مجموع نسب التركيب ${total}% — يجب أن يكون 100% بالضبط`;
  return null;
}

export const fabricItemRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';
    const status = q.status;
    const categoryId = q.categoryId;
    const supplierId = q.supplierId;
    const fabricType = q.fabricType?.trim() || '';
    const unit = q.unit?.trim() || '';
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
    if (unit) { conditions.push(`fi.unit=$${p}`); params.push(unit); p++; }

    const where = conditions.join(' AND ');
    const pool = getPool();
    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT fi.id,fi.internal_code,fi.supplier_code,fi.name,fi.fabric_type,fi.unit,fi.notes,
                fi.is_active,fi.category_id,fi.supplier_id,fi.design_code,fi.design_no,
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
              fi.is_active,fi.category_id,fi.supplier_id,fi.design_code,fi.design_no,
              fc.name AS category_name, s.name AS supplier_name,
              fi.composition_lines, fi.care_symbols,
              fi.width_value, fi.width_unit, fi.width_tolerance_enabled, fi.width_tolerance_percent,
              fi.weight_value, fi.weight_unit, fi.weight_tolerance_enabled, fi.weight_tolerance_percent,
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

  // ألوان الخامة الفعلية — اتحاد الفاريانتات المسجّلة مع الألوان الموجودة
  // فعلياً على أتواب المستودع (حتى لو لم تُسجَّل كفاريانت بعد). مصدر موحّد
  // لشاشة الكارتيله بدل الاعتماد حصراً على fabric_item_variants.
  app.get('/:id/colors', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const item = await pool.query(`SELECT id FROM fabric_items WHERE id=$1 AND company_id=$2`, [id, companyId]);
    if (!item.rows.length) return sendError(reply, 404, 'الخامة غير موجودة', 'NOT_FOUND');

    const rows = await pool.query(
      `WITH roll_colors AS (
         SELECT color_id,
                COUNT(*)::int AS roll_count,
                COALESCE(SUM(length_m),0) AS total_meters,
                (ARRAY_AGG(variant_id) FILTER (WHERE variant_id IS NOT NULL))[1] AS roll_variant_id
           FROM fabric_rolls
          WHERE company_id = $1 AND item_id = $2 AND color_id IS NOT NULL
          GROUP BY color_id
       )
       SELECT fc.id AS color_id, fc.name_ar, fc.name_tr, fc.color_code, fc.hex_color,
              COALESCE(rc.roll_count, 0)::int AS roll_count,
              COALESCE(rc.total_meters, 0) AS total_meters,
              COALESCE(fiv.id, rc.roll_variant_id) AS variant_id,
              fiv.variant_code
         FROM fabric_colors fc
         LEFT JOIN roll_colors rc ON rc.color_id = fc.id
         LEFT JOIN fabric_item_variants fiv
                ON fiv.item_id = $2 AND fiv.company_id = $1 AND fiv.color_id = fc.id
        WHERE fc.id IN (
                SELECT color_id FROM roll_colors
                UNION
                SELECT color_id FROM fabric_item_variants WHERE item_id = $2 AND company_id = $1
              )
        ORDER BY fc.name_ar ASC`,
      [companyId, id],
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const parsed = itemBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    if (d.composition_lines) {
      const compositionError = validateCompositionLines(d.composition_lines);
      if (compositionError) return sendError(reply, 400, compositionError, 'VALIDATION');
    }
    const pool = getPool();
    try {
      const row = await pool.query(
        `INSERT INTO fabric_items(
           company_id,category_id,supplier_id,internal_code,supplier_code,name,fabric_type,unit,notes,
           design_code,design_no,composition_lines
         )
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
         RETURNING id,internal_code,supplier_code,name,fabric_type,unit,notes,is_active,category_id,supplier_id,
                   design_code,design_no,created_at`,
        [companyId, d.category_id ?? null, d.supplier_id ?? null, d.internal_code,
         d.supplier_code, d.name, d.fabric_type, d.unit, d.notes,
         d.design_code ?? '', d.design_no ?? '', JSON.stringify(d.composition_lines ?? [])],
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
    if (d.composition_lines) {
      const compositionError = validateCompositionLines(d.composition_lines);
      if (compositionError) return sendError(reply, 400, compositionError, 'VALIDATION');
    }
    const pool = getPool();
    try {
      const row = await pool.query(
        `UPDATE fabric_items
         SET name=$3,supplier_code=$4,fabric_type=$5,unit=$6,notes=$7,
             category_id=$8,supplier_id=$9,
             design_code = CASE WHEN $10::boolean THEN $11 ELSE design_code END,
             design_no = CASE WHEN $12::boolean THEN $13 ELSE design_no END,
             composition_lines = CASE WHEN $14::boolean THEN $15::jsonb ELSE composition_lines END,
             updated_at=now()
         WHERE id=$1 AND company_id=$2
         RETURNING id,internal_code,supplier_code,name,fabric_type,unit,notes,is_active,category_id,supplier_id,
                   design_code,design_no,updated_at`,
        [id, companyId, d.name, d.supplier_code, d.fabric_type, d.unit, d.notes,
         d.category_id ?? null, d.supplier_id ?? null,
         d.design_code !== undefined, d.design_code ?? '',
         d.design_no !== undefined, d.design_no ?? '',
         d.composition_lines !== undefined, JSON.stringify(d.composition_lines ?? [])],
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
