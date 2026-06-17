import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from '../middleware/errorHandler.js';

const cartelaBody = z.object({
  title: z.string().optional().default(''),
  artCode: z.string().optional().default(''),
  designNo: z.string().optional().default(''),
  colour: z.string().optional().default(''),
  widthValue: z.string().optional().default(''),
  widthUnit: z.string().optional().default('cm'),
  widthToleranceEnabled: z.boolean().optional().default(true),
  widthTolerancePercent: z.number().min(0).max(100).optional().default(3),
  weightValue: z.string().optional().default(''),
  weightUnit: z.string().optional().default('gr/m²'),
  weightToleranceEnabled: z.boolean().optional().default(true),
  weightTolerancePercent: z.number().min(0).max(100).optional().default(5),
  composition: z.string().optional().default(''),
  serialNo: z.string().optional().default(''),
  showLogo: z.boolean().optional().default(true),
});

function mapCartelaRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    art_code: row.art_code,
    design_no: row.design_no,
    colour: row.colour,
    width_value: row.width_value,
    width_unit: row.width_unit,
    width_tolerance_enabled: row.width_tolerance_enabled,
    width_tolerance_percent: row.width_tolerance_percent,
    weight_value: row.weight_value,
    weight_unit: row.weight_unit,
    weight_tolerance_enabled: row.weight_tolerance_enabled,
    weight_tolerance_percent: row.weight_tolerance_percent,
    composition: row.composition,
    serial_no: row.serial_no,
    show_logo: row.show_logo,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const cartelaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';

    const conditions = ['company_id = $1'];
    const params: unknown[] = [companyId];
    if (search) {
      conditions.push(`(title ILIKE $2 OR art_code ILIKE $2 OR design_no ILIKE $2 OR serial_no ILIKE $2)`);
      params.push(`%${search}%`);
    }

    const rows = await getPool().query(
      `SELECT id, title, art_code, design_no, colour, serial_no, show_logo, created_at, updated_at
         FROM cartela_labels
        WHERE ${conditions.join(' AND ')}
        ORDER BY updated_at DESC
        LIMIT 200`,
      params,
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const row = await getPool().query(
      `SELECT * FROM cartela_labels WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'الكارتيلا غير موجودة', 'NOT_FOUND');
    return reply.send({ ok: true, data: mapCartelaRow(row.rows[0]) });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = cartelaBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const row = await getPool().query(
      `INSERT INTO cartela_labels (
         company_id, title, art_code, design_no, colour,
         width_value, width_unit, width_tolerance_enabled, width_tolerance_percent,
         weight_value, weight_unit, weight_tolerance_enabled, weight_tolerance_percent,
         composition, serial_no, show_logo, created_by_user_id, updated_by_user_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17
       )
       RETURNING *`,
      [
        companyId,
        d.title.trim(),
        d.artCode.trim(),
        d.designNo.trim(),
        d.colour.trim(),
        d.widthValue.trim(),
        d.widthUnit.trim(),
        d.widthToleranceEnabled,
        d.widthTolerancePercent,
        d.weightValue.trim(),
        d.weightUnit.trim(),
        d.weightToleranceEnabled,
        d.weightTolerancePercent,
        d.composition.trim(),
        d.serialNo.trim(),
        d.showLogo,
        userId,
      ],
    );
    return reply.status(201).send({ ok: true, data: mapCartelaRow(row.rows[0]) });
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = cartelaBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const row = await getPool().query(
      `UPDATE cartela_labels
          SET title = $3,
              art_code = $4,
              design_no = $5,
              colour = $6,
              width_value = $7,
              width_unit = $8,
              width_tolerance_enabled = $9,
              width_tolerance_percent = $10,
              weight_value = $11,
              weight_unit = $12,
              weight_tolerance_enabled = $13,
              weight_tolerance_percent = $14,
              composition = $15,
              serial_no = $16,
              show_logo = $17,
              updated_by_user_id = $18,
              updated_at = now()
        WHERE id = $1 AND company_id = $2
        RETURNING *`,
      [
        id,
        companyId,
        d.title.trim(),
        d.artCode.trim(),
        d.designNo.trim(),
        d.colour.trim(),
        d.widthValue.trim(),
        d.widthUnit.trim(),
        d.widthToleranceEnabled,
        d.widthTolerancePercent,
        d.weightValue.trim(),
        d.weightUnit.trim(),
        d.weightToleranceEnabled,
        d.weightTolerancePercent,
        d.composition.trim(),
        d.serialNo.trim(),
        d.showLogo,
        userId,
      ],
    );
    if (!row.rows.length) return sendError(reply, 404, 'الكارتيلا غير موجودة', 'NOT_FOUND');
    return reply.send({ ok: true, data: mapCartelaRow(row.rows[0]) });
  });

  app.delete('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const row = await getPool().query(
      `DELETE FROM cartela_labels WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'الكارتيلا غير موجودة', 'NOT_FOUND');
    return reply.send({ ok: true });
  });
};
