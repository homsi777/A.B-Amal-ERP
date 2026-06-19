import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from '../middleware/errorHandler.js';
import { allocateCartelaSerialNo, resolveCartelaSerialNo } from '../services/cartelaSerialService.js';

const VALID_CARE_SYMBOLS = new Set([
  'wash_30', 'wash_40', 'wash_60',
  'iron_low', 'iron_medium', 'iron_high',
  'no_bleach', 'no_tumble_dry', 'tumble_dry',
  'dry_clean_p', 'dry_clean_f', 'line_dry',
]);

const compositionLineSchema = z.object({
  percent: z.number().int().min(1).max(100),
  fiberTypeId: z.string().uuid().nullable().optional(),
  fiberName: z.string().min(1).max(80),
});

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
  compositionLines: z.array(compositionLineSchema).max(5).optional().default([]),
  careSymbols: z.array(z.string()).optional().default([]),
  serialNo: z.string().optional().default(''),
  showLogo: z.boolean().optional().default(true),
  fontSizePt: z.number().min(4.5).max(11).optional().default(6.8),
});

const fiberTypeBody = z.object({
  nameEn: z.string().min(1).max(80),
});

function formatCompositionText(lines: Array<{ percent: number; fiberName: string }>): string {
  return [...lines]
    .filter((line) => line.percent > 0 && line.fiberName.trim())
    .sort((a, b) => b.percent - a.percent)
    .map((line) => `${line.percent}% ${line.fiberName.trim().toUpperCase()}`)
    .join('  ');
}

function validateCompositionLines(lines: Array<{ percent: number; fiberName: string }>): string | null {
  if (lines.length === 0) return null;
  if (lines.length > 5) return 'الحد الأقصى 5 مكوّنات للخليط';
  const total = lines.reduce((sum, line) => sum + line.percent, 0);
  if (total !== 100) return `مجموع النسب ${total}% — يجب أن يكون 100% بالضبط`;
  return null;
}

function normalizeCareSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.filter((id) => VALID_CARE_SYMBOLS.has(id)))];
}

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
    composition_lines: row.composition_lines ?? [],
    care_symbols: row.care_symbols ?? [],
    serial_no: row.serial_no,
    show_logo: row.show_logo,
    font_size_pt: row.font_size_pt ?? 6.8,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseCartelaPayload(data: z.infer<typeof cartelaBody>) {
  const compositionLines = data.compositionLines.map((line) => ({
    percent: line.percent,
    fiberTypeId: line.fiberTypeId ?? null,
    fiberName: line.fiberName.trim(),
  }));
  const compositionError = validateCompositionLines(compositionLines);
  if (compositionError) {
    return { error: compositionError as string };
  }
  return {
    data: {
      ...data,
      compositionLines,
      compositionText: formatCompositionText(compositionLines),
      careSymbols: normalizeCareSymbols(data.careSymbols),
    },
  };
}

function mapCartelaDbError(reply: FastifyReply, err: unknown): boolean {
  const code = (err as { code?: string }).code;
  if (code === '42P01' || code === '42703') {
    void sendError(
      reply,
      503,
      'جداول الكارتيله غير جاهزة على السيرفر. نفّذ: npm run server:migrate ثم pm2 restart clotexerp-server',
      'CARTELA_SCHEMA_MISSING',
    );
    return true;
  }
  return false;
}

export const cartelaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/fiber-types', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    try {
      const rows = await getPool().query(
        `SELECT id, name_en, sort_order, created_at
           FROM cartela_fiber_types
          WHERE company_id = $1
          ORDER BY sort_order ASC, name_en ASC`,
        [companyId],
      );
      return reply.send({ ok: true, data: rows.rows });
    } catch (err) {
      if (mapCartelaDbError(reply, err)) return reply;
      throw err;
    }
  });

  app.post('/fiber-types', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const parsed = fiberTypeBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const nameEn = parsed.data.nameEn.trim().toUpperCase();
    try {
      const row = await getPool().query(
        `INSERT INTO cartela_fiber_types (company_id, name_en)
         VALUES ($1, $2)
         RETURNING id, name_en, sort_order, created_at`,
        [companyId, nameEn],
      );
      return reply.status(201).send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      if (mapCartelaDbError(reply, e)) return reply;
      if ((e as { code?: string }).code === '23505') {
        return sendError(reply, 409, 'نوع الخامة موجود مسبقاً', 'DUPLICATE');
      }
      throw e;
    }
  });

  app.delete('/fiber-types/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const row = await getPool().query(
      `DELETE FROM cartela_fiber_types WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'نوع الخامة غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true });
  });

  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';

    const conditions = ['company_id = $1'];
    const params: unknown[] = [companyId];
    if (search) {
      conditions.push(`(title ILIKE $2 OR art_code ILIKE $2 OR design_no ILIKE $2 OR serial_no ILIKE $2 OR composition ILIKE $2)`);
      params.push(`%${search}%`);
    }

    try {
      const rows = await getPool().query(
        `SELECT id, title, art_code, design_no, colour, serial_no, show_logo, created_at, updated_at
           FROM cartela_labels
          WHERE ${conditions.join(' AND ')}
          ORDER BY updated_at DESC
          LIMIT 200`,
        params,
      );
      return reply.send({ ok: true, data: rows.rows });
    } catch (err) {
      if (mapCartelaDbError(reply, err)) return reply;
      throw err;
    }
  });

  app.post('/generate', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = cartelaBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const payload = parseCartelaPayload(parsed.data);
    if ('error' in payload && payload.error) {
      return sendError(reply, 400, payload.error, 'VALIDATION');
    }
    const d = payload.data!;

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const autoSerial = await allocateCartelaSerialNo(client, companyId);
      const serialNo = resolveCartelaSerialNo(d.serialNo, autoSerial);
      const row = await client.query(
        `INSERT INTO cartela_labels (
           company_id, title, art_code, design_no, colour,
           width_value, width_unit, width_tolerance_enabled, width_tolerance_percent,
           weight_value, weight_unit, weight_tolerance_enabled, weight_tolerance_percent,
           composition, composition_lines, care_symbols, serial_no, show_logo, font_size_pt,
           created_by_user_id, updated_by_user_id
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,$19,$20,$20
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
          d.compositionText,
          JSON.stringify(d.compositionLines),
          JSON.stringify(d.careSymbols),
          serialNo,
          d.showLogo,
          d.fontSizePt,
          userId,
        ],
      );
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: mapCartelaRow(row.rows[0]) });
    } catch (err) {
      await client.query('ROLLBACK');
      if (mapCartelaDbError(reply, err)) return reply;
      throw err;
    } finally {
      client.release();
    }
  });

  app.get('/lookup', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const scan = String((req.query as Record<string, string>).scan ?? '').trim();
    if (!scan) return sendError(reply, 400, 'أدخل باركود أو QR الكارتيلا', 'VALIDATION');

    let serial = scan;
    let artCode = '';
    let designNo = '';
    if (/^CLOTEX\|/i.test(scan)) {
      const parts = scan.split('|').map((p) => p.trim());
      artCode = parts[1] ?? '';
      designNo = parts[2] ?? '';
      serial = parts[3] ?? '';
    } else if (/^\d{4,10}$/.test(scan)) {
      serial = scan;
    }

    try {
      const row = await getPool().query(
        `SELECT *
           FROM cartela_labels
          WHERE company_id = $1
            AND (
              ($2 <> '' AND serial_no = $2)
              OR ($3 <> '' AND $4 <> '' AND art_code ILIKE $3 AND design_no ILIKE $4)
              OR serial_no ILIKE $5
              OR art_code ILIKE $5
            )
          ORDER BY
            CASE WHEN $2 <> '' AND serial_no = $2 THEN 0 ELSE 1 END,
            updated_at DESC
          LIMIT 1`,
        [companyId, serial, artCode, designNo, scan],
      );
      if (!row.rows.length) return sendError(reply, 404, 'كارتيلا غير موجودة بهذا الباركود', 'NOT_FOUND');
      return reply.send({ ok: true, data: mapCartelaRow(row.rows[0]) });
    } catch (err) {
      if (mapCartelaDbError(reply, err)) return reply;
      throw err;
    }
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
    const payload = parseCartelaPayload(parsed.data);
    if ('error' in payload && payload.error) {
      return sendError(reply, 400, payload.error, 'VALIDATION');
    }
    const d = payload.data!;

    const row = await getPool().query(
      `INSERT INTO cartela_labels (
         company_id, title, art_code, design_no, colour,
         width_value, width_unit, width_tolerance_enabled, width_tolerance_percent,
         weight_value, weight_unit, weight_tolerance_enabled, weight_tolerance_percent,
         composition, composition_lines, care_symbols, serial_no, show_logo, font_size_pt,
         created_by_user_id, updated_by_user_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,$19,$20,$20
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
        d.compositionText,
        JSON.stringify(d.compositionLines),
        JSON.stringify(d.careSymbols),
        d.serialNo.trim(),
        d.showLogo,
        d.fontSizePt,
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
    const payload = parseCartelaPayload(parsed.data);
    if ('error' in payload && payload.error) {
      return sendError(reply, 400, payload.error, 'VALIDATION');
    }
    const d = payload.data!;

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
              composition_lines = $16::jsonb,
              care_symbols = $17::jsonb,
              serial_no = $18,
              show_logo = $19,
              font_size_pt = $20,
              updated_by_user_id = $21,
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
        d.compositionText,
        JSON.stringify(d.compositionLines),
        JSON.stringify(d.careSymbols),
        d.serialNo.trim(),
        d.showLogo,
        d.fontSizePt,
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
