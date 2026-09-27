/**
 * دفعات الخيط/الغزل — مواز لـ fabricRollRoutes.ts لكن بالوزن (kg) كالكمية
 * الأساسية بدل الطول. لا علاقة له بجدول fabric_rolls ولا يعدّله بأي شكل.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';

const createYarnLotSchema = z.object({
  barcode: z.string().optional(),
  lotNo: z.string().optional(),
  itemId: z.string().uuid('معرّف الصنف غير صالح'),
  colorId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  warehouseId: z.string().uuid('معرّف المستودع غير صالح'),
  locationId: z.string().uuid().nullable().optional(),
  weightKg: z.number().min(0, 'الوزن يجب أن يكون رقماً موجباً أو صفراً'),
  unitCost: z.number().min(0).nullable().optional(),
  currencyCode: z.string().nullable().optional(),
  batchNo: z.string().nullable().optional(),
  containerNo: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const updateYarnLotSchema = z.object({
  itemId: z.string().uuid().optional(),
  colorId: z.string().uuid().nullable().optional(),
  lotNo: z.string().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  weightKg: z.number().min(0).optional(),
  unitCost: z.number().min(0).nullable().optional(),
  currencyCode: z.string().nullable().optional(),
  batchNo: z.string().nullable().optional(),
  containerNo: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const statusSchema = z.object({
  status: z.enum(['AVAILABLE', 'RESERVED', 'SOLD', 'DAMAGED', 'TRANSFERRED', 'INACTIVE']),
  notes: z.string().nullable().optional(),
});

function normalizeSevenDigitBarcode(value: string | undefined): string | undefined {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 7);
  return digits || undefined;
}

/** نفس أسلوب generateBarcode بـ rollHelpers.ts، على جدول yarn_lots بدل fabric_rolls. */
export async function generateYarnLotBarcode(companyId: string): Promise<string> {
  const pool = getPool();
  const maxExisting = await pool.query<{ max_barcode: string | null }>(
    `SELECT MAX(barcode)::text AS max_barcode FROM yarn_lots
     WHERE company_id=$1 AND barcode ~ '^[0-9]{7}$'`,
    [companyId],
  );
  const current = Number(maxExisting.rows[0]?.max_barcode ?? 999999);
  for (let offset = 1; offset <= 100; offset++) {
    const next = current + offset;
    if (next > 9999999) break;
    const barcode = String(next).padStart(7, '0');
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM yarn_lots WHERE company_id=$1 AND barcode=$2',
      [companyId, barcode],
    );
    if (!rows.length) return barcode;
  }
  throw new Error('تعذّر توليد باركود فريد لدفعة الخيط');
}

const YARN_LOT_COLUMNS = `
  yl.id, yl.company_id, yl.lot_no, yl.barcode, yl.item_id, yl.color_id,
  yl.supplier_id, yl.warehouse_id, yl.location_id, yl.weight_kg,
  yl.unit_cost, yl.currency_code, yl.batch_no, yl.container_no,
  yl.purchase_invoice_id, yl.purchase_invoice_line_id, yl.status, yl.notes,
  yl.created_at, yl.updated_at,
  fi.name AS item_name, fi.internal_code AS item_internal_code,
  fc.name_ar AS color_name_ar, s.name AS supplier_name, w.name AS warehouse_name
`;

const YARN_LOT_JOINS = `
  FROM yarn_lots yl
  LEFT JOIN fabric_items fi ON fi.id = yl.item_id
  LEFT JOIN fabric_colors fc ON fc.id = yl.color_id
  LEFT JOIN suppliers s ON s.id = yl.supplier_id
  LEFT JOIN warehouses w ON w.id = yl.warehouse_id
`;

export const yarnLotRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['yl.company_id=$1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (q.itemId) { conditions.push(`yl.item_id=$${p}`); params.push(q.itemId); p++; }
    if (q.status) { conditions.push(`yl.status=$${p}`); params.push(q.status); p++; }
    if (q.warehouseId) { conditions.push(`yl.warehouse_id=$${p}`); params.push(q.warehouseId); p++; }
    if (q.onlyAvailable === 'true') { conditions.push(`yl.status='AVAILABLE' AND yl.weight_kg > 0`); }
    if (q.search) {
      conditions.push(`(yl.barcode ILIKE $${p} OR yl.lot_no ILIKE $${p} OR fi.name ILIKE $${p})`);
      params.push(`%${q.search.trim()}%`); p++;
    }

    const where = conditions.join(' AND ');
    const pool = getPool();
    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT ${YARN_LOT_COLUMNS} ${YARN_LOT_JOINS}
         WHERE ${where} ORDER BY yl.created_at DESC LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total ${YARN_LOT_JOINS} WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `SELECT ${YARN_LOT_COLUMNS} ${YARN_LOT_JOINS} WHERE yl.id=$1 AND yl.company_id=$2`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'دفعة الخيط غير موجودة', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = createYarnLotSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();

    const itemCheck = await pool.query(
      `SELECT id, unit FROM fabric_items WHERE id=$1 AND company_id=$2`,
      [d.itemId, companyId],
    );
    if (!itemCheck.rows.length) return sendError(reply, 404, 'الصنف غير موجود', 'NOT_FOUND');
    if (itemCheck.rows[0].unit !== 'kg') {
      return sendError(reply, 400, 'هذا الصنف ليس من أصناف الوزن (kg)', 'VALIDATION');
    }

    const whCheck = await pool.query(
      'SELECT id FROM warehouses WHERE id=$1 AND company_id=$2',
      [d.warehouseId, companyId],
    );
    if (!whCheck.rows.length) return sendError(reply, 404, 'المستودع غير موجود', 'NOT_FOUND');

    if (d.locationId) {
      const locCheck = await pool.query(
        'SELECT id FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2 AND company_id=$3',
        [d.locationId, d.warehouseId, companyId],
      );
      if (!locCheck.rows.length)
        return sendError(reply, 400, 'الموقع المحدد لا يتبع هذا المستودع', 'VALIDATION');
    }

    if (d.colorId) {
      const colorCheck = await pool.query(
        'SELECT id FROM fabric_colors WHERE id=$1 AND (company_id=$2 OR company_id IS NULL)',
        [d.colorId, companyId],
      );
      if (!colorCheck.rows.length) return sendError(reply, 404, 'اللون غير موجود', 'NOT_FOUND');
    }

    if (d.supplierId) {
      const supCheck = await pool.query(
        'SELECT id FROM suppliers WHERE id=$1 AND company_id=$2',
        [d.supplierId, companyId],
      );
      if (!supCheck.rows.length) return sendError(reply, 404, 'المورد غير موجود', 'NOT_FOUND');
    }

    if (d.currencyCode) {
      const curCheck = await pool.query('SELECT code FROM currencies WHERE code=$1', [d.currencyCode]);
      if (!curCheck.rows.length) return sendError(reply, 404, 'العملة غير موجودة', 'NOT_FOUND');
    }

    let barcode = normalizeSevenDigitBarcode(d.barcode);
    if (!barcode) {
      barcode = await generateYarnLotBarcode(companyId);
    } else {
      const dupCheck = await pool.query(
        'SELECT id FROM yarn_lots WHERE company_id=$1 AND barcode=$2',
        [companyId, barcode],
      );
      if (dupCheck.rows.length) return sendError(reply, 409, 'باركود دفعة الخيط موجود مسبقاً', 'DUPLICATE');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lotRow = await client.query(
        `INSERT INTO yarn_lots
           (company_id, lot_no, barcode, item_id, color_id, supplier_id,
            warehouse_id, location_id, weight_kg, unit_cost, currency_code,
            batch_no, container_no, notes, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id`,
        [
          companyId, d.lotNo ?? null, barcode, d.itemId, d.colorId ?? null, d.supplierId ?? null,
          d.warehouseId, d.locationId ?? null, d.weightKg, d.unitCost ?? null,
          d.currencyCode ?? null, d.batchNo ?? null, d.containerNo ?? null, d.notes ?? null, userId,
        ],
      );
      const lotId = lotRow.rows[0].id;

      await client.query(
        `INSERT INTO yarn_lot_movements
           (company_id, yarn_lot_id, movement_type, weight_delta_kg, to_warehouse_id,
            reference_type, notes, created_by_user_id)
         VALUES ($1,$2,'RECEIVE',$3,$4,'MANUAL_RECEIVE',$5,$6)`,
        [companyId, lotId, d.weightKg, d.warehouseId, d.notes ?? null, userId],
      );

      await client.query('COMMIT');

      const full = await pool.query(
        `SELECT ${YARN_LOT_COLUMNS} ${YARN_LOT_JOINS} WHERE yl.id=$1`,
        [lotId],
      );
      return reply.status(201).send({ ok: true, data: full.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = updateYarnLotSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();

    const existing = await pool.query('SELECT id FROM yarn_lots WHERE id=$1 AND company_id=$2', [id, companyId]);
    if (!existing.rows.length) return sendError(reply, 404, 'دفعة الخيط غير موجودة', 'NOT_FOUND');

    const row = await pool.query(
      `UPDATE yarn_lots SET
         item_id=COALESCE($3,item_id), color_id=$4, lot_no=$5, supplier_id=$6,
         location_id=$7, weight_kg=COALESCE($8,weight_kg), unit_cost=$9,
         currency_code=$10, batch_no=$11, container_no=$12, notes=$13, updated_at=now()
       WHERE id=$1 AND company_id=$2 RETURNING id`,
      [
        id, companyId, d.itemId ?? null, d.colorId ?? null, d.lotNo ?? null, d.supplierId ?? null,
        d.locationId ?? null, d.weightKg ?? null, d.unitCost ?? null, d.currencyCode ?? null,
        d.batchNo ?? null, d.containerNo ?? null, d.notes ?? null,
      ],
    );

    const full = await pool.query(`SELECT ${YARN_LOT_COLUMNS} ${YARN_LOT_JOINS} WHERE yl.id=$1`, [row.rows[0].id]);
    return reply.send({ ok: true, data: full.rows[0] });
  });

  app.patch('/:id/status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const pool = getPool();

    const row = await pool.query(
      `UPDATE yarn_lots SET status=$3, notes=COALESCE($4, notes), updated_at=now()
       WHERE id=$1 AND company_id=$2 RETURNING id`,
      [id, companyId, parsed.data.status, parsed.data.notes ?? null],
    );
    if (!row.rows.length) return sendError(reply, 404, 'دفعة الخيط غير موجودة', 'NOT_FOUND');
    return reply.send({ ok: true, data: { id: row.rows[0].id, status: parsed.data.status } });
  });
};
