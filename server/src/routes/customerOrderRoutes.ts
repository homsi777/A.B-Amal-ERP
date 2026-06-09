import type { FastifyPluginAsync } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';

const statusSchema = z.enum([
  'draft',
  'pending_supply',
  'partial_ready',
  'ready_pickup',
  'completed',
  'cancelled',
]);

const orderLineSchema = z.object({
  id: z.string().uuid().optional(),
  materialName: z.string().optional().default(''),
  dsamNumber: z.string().optional().default(''),
  rollNo: z.string().optional().default(''),
  colorCode: z.string().optional().default(''),
  colorName: z.string().optional().default(''),
  length: z.coerce.number().nonnegative().default(0),
  widthCm: z.coerce.number().nonnegative().default(0),
  gsm: z.coerce.number().nonnegative().default(0),
  weight: z.coerce.number().nonnegative().default(0),
  price: z.coerce.number().nonnegative().default(0),
  note: z.string().optional(),
  imageUrl: z.string().optional(),
  referenceBarcode: z.string().optional(),
  unitType: z.enum(['meter', 'yard']).optional().default('meter'),
});

const orderBodySchema = z.object({
  orderNumber: z.string().trim().optional(),
  date: z.string().min(1),
  customerId: z.string().uuid(),
  currency: z.string().trim().min(1).default('USD'),
  warehouse: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(orderLineSchema).min(1),
  status: statusSchema.default('draft'),
  templateId: z.string().uuid().optional(),
  expectedDate: z.string().optional(),
  advancePayment: z.coerce.number().nonnegative().optional().default(0),
});

const templateLineSchema = z.object({
  materialName: z.string().optional().default(''),
  dsamNumber: z.string().optional().default(''),
  rollNo: z.string().optional().default(''),
  colorCode: z.string().optional().default(''),
  colorName: z.string().optional().default(''),
  length: z.coerce.number().nonnegative().default(0),
  widthCm: z.coerce.number().nonnegative().default(0),
  gsm: z.coerce.number().nonnegative().default(0),
  price: z.coerce.number().nonnegative().default(0),
  note: z.string().optional(),
});

const templateBodySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  lines: z.array(templateLineSchema).min(1),
});

function toDateOrNull(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v.slice(0, 10) : null;
}

async function assertCustomerExists(client: PoolClient, companyId: string, customerId: string) {
  const row = await client.query('SELECT id FROM customers WHERE id=$1 AND company_id=$2 LIMIT 1', [
    customerId,
    companyId,
  ]);
  if (!row.rows.length) throw Object.assign(new Error('Customer not found'), { code: 'NOT_FOUND' });
}

async function assertTemplateExists(client: PoolClient, companyId: string, templateId?: string) {
  if (!templateId) return;
  const row = await client.query(
    'SELECT id FROM customer_order_templates WHERE id=$1 AND company_id=$2 LIMIT 1',
    [templateId, companyId],
  );
  if (!row.rows.length) throw Object.assign(new Error('Template not found'), { code: 'NOT_FOUND' });
}

async function insertOrderLines(
  client: PoolClient,
  companyId: string,
  orderId: string,
  lines: z.infer<typeof orderLineSchema>[],
) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    await client.query(
      `INSERT INTO customer_order_lines (
         company_id, order_id, line_no, material_name, dsam_number, roll_no,
         color_code, color_name, length, width_cm, gsm, weight, price,
         note, image_url, reference_barcode, unit_type
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        companyId,
        orderId,
        i + 1,
        line.materialName,
        line.dsamNumber,
        line.rollNo,
        line.colorCode,
        line.colorName,
        line.length,
        line.widthCm,
        line.gsm,
        line.weight,
        line.price,
        line.note || null,
        line.imageUrl || null,
        line.referenceBarcode || null,
        line.unitType,
      ],
    );
  }
}

async function getOrderById(client: PoolClient, companyId: string, id: string) {
  const row = await client.query(
    `SELECT
       o.id,
       o.order_no AS "orderNumber",
       o.order_date::text AS date,
       o.customer_id AS "customerId",
       o.currency_code AS currency,
       o.warehouse_label AS warehouse,
       o.notes,
       o.status,
       o.template_id AS "templateId",
       o.expected_date::text AS "expectedDate",
       o.advance_payment::float AS "advancePayment",
       o.created_at AS "createdAt",
       o.updated_at AS "updatedAt",
       COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'id', l.id,
             'materialName', l.material_name,
             'dsamNumber', l.dsam_number,
             'rollNo', l.roll_no,
             'colorCode', l.color_code,
             'colorName', l.color_name,
             'length', l.length::float,
             'widthCm', l.width_cm::float,
             'gsm', l.gsm::float,
             'weight', l.weight::float,
             'price', l.price::float,
             'note', l.note,
             'imageUrl', l.image_url,
             'referenceBarcode', l.reference_barcode,
             'unitType', l.unit_type
           )
           ORDER BY l.line_no
         ) FILTER (WHERE l.id IS NOT NULL),
         '[]'::jsonb
       ) AS items
     FROM customer_orders o
     LEFT JOIN customer_order_lines l ON l.order_id=o.id
     WHERE o.company_id=$1 AND o.id=$2
     GROUP BY o.id`,
    [companyId, id],
  );
  return row.rows[0] ?? null;
}

async function listTemplates(client: PoolClient, companyId: string) {
  const rows = await client.query(
    `SELECT
       t.id,
       t.name,
       t.description,
       t.created_at AS "createdAt",
       COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'materialName', l.material_name,
             'dsamNumber', l.dsam_number,
             'rollNo', l.roll_no,
             'colorCode', l.color_code,
             'colorName', l.color_name,
             'length', l.length::float,
             'widthCm', l.width_cm::float,
             'gsm', l.gsm::float,
             'price', l.price::float,
             'note', l.note
           )
           ORDER BY l.line_no
         ) FILTER (WHERE l.id IS NOT NULL),
         '[]'::jsonb
       ) AS lines
     FROM customer_order_templates t
     LEFT JOIN customer_order_template_lines l ON l.template_id=t.id
     WHERE t.company_id=$1
     GROUP BY t.id
     ORDER BY t.created_at DESC`,
    [companyId],
  );
  return rows.rows;
}

export const customerOrderRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize || '100', 10) || 100));
    const offset = (page - 1) * pageSize;

    const conditions = ['o.company_id=$1'];
    const params: unknown[] = [companyId];
    let p = 2;
    if (search) {
      conditions.push(`(o.order_no ILIKE $${p} OR o.notes ILIKE $${p} OR c.name ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }
    if (q.status && statusSchema.safeParse(q.status).success) {
      conditions.push(`o.status=$${p}`);
      params.push(q.status);
      p++;
    }

    const where = conditions.join(' AND ');
    const pool = getPool();
    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT
           o.id,
           o.order_no AS "orderNumber",
           o.order_date::text AS date,
           o.customer_id AS "customerId",
           o.currency_code AS currency,
           o.warehouse_label AS warehouse,
           o.notes,
           o.status,
           o.template_id AS "templateId",
           o.expected_date::text AS "expectedDate",
           o.advance_payment::float AS "advancePayment",
           o.created_at AS "createdAt",
           o.updated_at AS "updatedAt",
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'id', l.id,
                 'materialName', l.material_name,
                 'dsamNumber', l.dsam_number,
                 'rollNo', l.roll_no,
                 'colorCode', l.color_code,
                 'colorName', l.color_name,
                 'length', l.length::float,
                 'widthCm', l.width_cm::float,
                 'gsm', l.gsm::float,
                 'weight', l.weight::float,
                 'price', l.price::float,
                 'note', l.note,
                 'imageUrl', l.image_url,
                 'referenceBarcode', l.reference_barcode,
                 'unitType', l.unit_type
               )
               ORDER BY l.line_no
             ) FILTER (WHERE l.id IS NOT NULL),
             '[]'::jsonb
           ) AS items
         FROM customer_orders o
         JOIN customers c ON c.id=o.customer_id
         LEFT JOIN customer_order_lines l ON l.order_id=o.id
         WHERE ${where}
         GROUP BY o.id
         ORDER BY o.order_date DESC, o.created_at DESC
         LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM customer_orders o JOIN customers c ON c.id=o.customer_id WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: count.rows[0].total, page, pageSize });
  });

  app.get('/templates', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const client = await getPool().connect();
    try {
      return reply.send({ ok: true, data: await listTemplates(client, companyId) });
    } finally {
      client.release();
    }
  });

  app.post('/templates', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = templateBodySchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const created = await client.query(
        `INSERT INTO customer_order_templates(company_id, name, description, created_by_user_id)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [companyId, d.name, d.description || null, userId],
      );
      const templateId = created.rows[0].id as string;
      for (let i = 0; i < d.lines.length; i++) {
        const line = d.lines[i];
        await client.query(
          `INSERT INTO customer_order_template_lines (
             company_id, template_id, line_no, material_name, dsam_number, roll_no,
             color_code, color_name, length, width_cm, gsm, price, note
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            companyId,
            templateId,
            i + 1,
            line.materialName,
            line.dsamNumber,
            line.rollNo || '',
            line.colorCode,
            line.colorName,
            line.length,
            line.widthCm,
            line.gsm,
            line.price,
            line.note || null,
          ],
        );
      }
      await client.query('COMMIT');
      const data = (await listTemplates(client, companyId)).find((x) => x.id === templateId);
      return reply.status(201).send({ ok: true, data });
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505') {
        return sendError(reply, 409, 'Duplicate order template', 'DUPLICATE');
      }
      throw e;
    } finally {
      client.release();
    }
  });

  app.delete('/templates/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const row = await getPool().query(
      `DELETE FROM customer_order_templates WHERE id=$1 AND company_id=$2 RETURNING id`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'Template not found', 'NOT_FOUND');
    return reply.send({ ok: true });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const client = await getPool().connect();
    try {
      const data = await getOrderById(client, companyId, id);
      if (!data) return sendError(reply, 404, 'Order not found', 'NOT_FOUND');
      return reply.send({ ok: true, data });
    } finally {
      client.release();
    }
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = orderBodySchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await assertCustomerExists(client, companyId, d.customerId);
      await assertTemplateExists(client, companyId, d.templateId);
      const orderNo = d.orderNumber?.trim() || (await generateSequentialDocumentNo(client, companyId, 'CUSTOMER_ORDER'));
      const created = await client.query(
        `INSERT INTO customer_orders (
           company_id, order_no, order_date, customer_id, currency_code, warehouse_label,
           notes, status, template_id, expected_date, advance_payment, created_by_user_id, updated_by_user_id
         )
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,$12)
         RETURNING id`,
        [
          companyId,
          orderNo,
          d.date.slice(0, 10),
          d.customerId,
          d.currency,
          d.warehouse || null,
          d.notes || null,
          d.status,
          d.templateId || null,
          toDateOrNull(d.expectedDate),
          d.advancePayment,
          userId,
        ],
      );
      const id = created.rows[0].id as string;
      await insertOrderLines(client, companyId, id, d.items);
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: await getOrderById(client, companyId, id) });
    } catch (e) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === '23505') return sendError(reply, 409, 'Duplicate order number', 'DUPLICATE');
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'Not found', 'NOT_FOUND');
      throw e;
    } finally {
      client.release();
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = orderBodySchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await assertCustomerExists(client, companyId, d.customerId);
      await assertTemplateExists(client, companyId, d.templateId);
      const updated = await client.query(
        `UPDATE customer_orders
         SET order_no=COALESCE($3, order_no),
             order_date=$4::date,
             customer_id=$5,
             currency_code=$6,
             warehouse_label=$7,
             notes=$8,
             status=$9,
             template_id=$10,
             expected_date=$11::date,
             advance_payment=$12,
             updated_by_user_id=$13,
             updated_at=now()
         WHERE id=$1 AND company_id=$2
         RETURNING id`,
        [
          id,
          companyId,
          d.orderNumber?.trim() || null,
          d.date.slice(0, 10),
          d.customerId,
          d.currency,
          d.warehouse || null,
          d.notes || null,
          d.status,
          d.templateId || null,
          toDateOrNull(d.expectedDate),
          d.advancePayment,
          userId,
        ],
      );
      if (!updated.rows.length) throw Object.assign(new Error('Order not found'), { code: 'NOT_FOUND' });
      await client.query('DELETE FROM customer_order_lines WHERE order_id=$1 AND company_id=$2', [id, companyId]);
      await insertOrderLines(client, companyId, id, d.items);
      await client.query('COMMIT');
      return reply.send({ ok: true, data: await getOrderById(client, companyId, id) });
    } catch (e) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === '23505') return sendError(reply, 409, 'Duplicate order number', 'DUPLICATE');
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'Not found', 'NOT_FOUND');
      throw e;
    } finally {
      client.release();
    }
  });

  app.patch('/:id/status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = z.object({ status: statusSchema }).safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const row = await getPool().query(
      `UPDATE customer_orders
       SET status=$3, updated_by_user_id=$4, updated_at=now()
       WHERE id=$1 AND company_id=$2
       RETURNING id`,
      [id, companyId, parsed.data.status, userId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'Order not found', 'NOT_FOUND');
    return reply.send({ ok: true });
  });

  app.delete('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const row = await getPool().query(
      `DELETE FROM customer_orders WHERE id=$1 AND company_id=$2 RETURNING id`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'Order not found', 'NOT_FOUND');
    return reply.send({ ok: true });
  });
};
