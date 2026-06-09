import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { generateDocumentNo } from '../utils/documentNumbers.js';
import { calcWeight, type RollStatus } from '../utils/rollHelpers.js';

const wasteTypeSchema = z.enum([
  'DAMAGE',
  'SHORTAGE',
  'CUTTING_WASTE',
  'QUALITY_REJECT',
  'LOST',
  'OTHER',
]);

const lineSchema = z.object({
  fabricRollId: z.string().uuid(),
  quantity: z.coerce.number().positive().default(1),
  barcode: z.string().optional().nullable(),
  wasteLengthM: z.coerce.number().positive().optional().nullable(),
  wasteWeightKg: z.coerce.number().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const createBody = z.object({
  wasteType: wasteTypeSchema.default('DAMAGE'),
  warehouseId: z.string().uuid().optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  wasteDate: z.string().optional(),
  reason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, 'يجب إضافة ثوب واحد على الأقل'),
});

const updateBody = createBody;

export const inventoryWasteRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';
    const status = q.status?.trim();
    const wasteType = q.wasteType?.trim();
    const warehouseId = q.warehouseId?.trim();
    const dateFrom = q.dateFrom?.trim();
    const dateTo = q.dateTo?.trim();
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['w.company_id = $1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (search) {
      conditions.push(`(w.waste_no ILIKE $${p} OR w.reason ILIKE $${p} OR w.notes ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }
    if (status && ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status)) {
      conditions.push(`w.status = $${p}`);
      params.push(status);
      p++;
    }
    if (wasteType && wasteTypeSchema.safeParse(wasteType).success) {
      conditions.push(`w.waste_type = $${p}`);
      params.push(wasteType);
      p++;
    }
    if (warehouseId) {
      conditions.push(`w.warehouse_id = $${p}`);
      params.push(warehouseId);
      p++;
    }
    if (dateFrom) {
      conditions.push(`w.waste_date >= $${p}::date`);
      params.push(dateFrom);
      p++;
    }
    if (dateTo) {
      conditions.push(`w.waste_date <= $${p}::date`);
      params.push(dateTo);
      p++;
    }

    const where = conditions.join(' AND ');
    const pool = getPool();

    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT w.*,
                wh.name AS warehouse_name,
                (SELECT COUNT(*)::int FROM inventory_waste_lines l WHERE l.waste_id = w.id AND l.company_id = w.company_id) AS line_count
         FROM inventory_waste_records w
         LEFT JOIN warehouses wh ON wh.id = w.warehouse_id AND wh.company_id = w.company_id
         WHERE ${where}
         ORDER BY w.waste_date DESC, w.created_at DESC
         LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM inventory_waste_records w WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();

    const head = await pool.query(
      `SELECT w.*, wh.name AS warehouse_name
       FROM inventory_waste_records w
       LEFT JOIN warehouses wh ON wh.id = w.warehouse_id AND wh.company_id = w.company_id
       WHERE w.id = $1 AND w.company_id = $2`,
      [id, companyId],
    );
    if (!head.rows.length) return sendError(reply, 404, 'سجل التوالف غير موجود', 'NOT_FOUND');

    const lines = await pool.query(
      `SELECT l.id, l.company_id, l.waste_id, l.fabric_roll_id, l.barcode AS line_barcode, l.quantity,
              l.waste_length_m, l.waste_weight_kg, l.notes,
              fr.roll_no, fr.barcode AS roll_barcode, fr.length_m, fr.status AS roll_status,
              fi.name AS item_name
       FROM inventory_waste_lines l
       JOIN fabric_rolls fr ON fr.id = l.fabric_roll_id AND fr.company_id = l.company_id
       JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
       WHERE l.waste_id = $1 AND l.company_id = $2
       ORDER BY l.id ASC`,
      [id, companyId],
    );

    return reply.send({ ok: true, data: { ...head.rows[0], lines: lines.rows } });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();

    if (d.warehouseId) {
      const wh = await pool.query('SELECT id FROM warehouses WHERE id=$1 AND company_id=$2', [
        d.warehouseId,
        companyId,
      ]);
      if (!wh.rows.length) return sendError(reply, 404, 'المستودع غير موجود', 'NOT_FOUND');
    }

    if (d.locationId && d.warehouseId) {
      const loc = await pool.query(
        'SELECT id FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2 AND company_id=$3',
        [d.locationId, d.warehouseId, companyId],
      );
      if (!loc.rows.length) return sendError(reply, 400, 'الموقع غير صالح لهذا المستودع', 'VALIDATION');
    }

    const wasteNo = generateDocumentNo('WST');
    const wasteDate = d.wasteDate ? d.wasteDate.slice(0, 10) : new Date().toISOString().slice(0, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const ins = await client.query(
        `INSERT INTO inventory_waste_records
           (company_id, waste_no, waste_date, waste_type, warehouse_id, location_id,
            status, reason, notes, created_by_user_id)
         VALUES ($1,$2,$3::date,$4,$5,$6,'DRAFT',$7,$8,$9)
         RETURNING *`,
        [
          companyId,
          wasteNo,
          wasteDate,
          d.wasteType,
          d.warehouseId ?? null,
          d.locationId ?? null,
          d.reason ?? null,
          d.notes ?? null,
          userId,
        ],
      );

      const waste = ins.rows[0];

      for (const line of d.lines) {
        if (line.quantity !== 1) {
          await client.query('ROLLBACK');
          return sendError(reply, 400, 'في هذا الإصدار يُسجّل ثوب واحد لكل سطر (الكمية = 1)', 'VALIDATION');
        }
        const roll = await client.query(
          'SELECT id FROM fabric_rolls WHERE id=$1 AND company_id=$2',
          [line.fabricRollId, companyId],
        );
        if (!roll.rows.length) {
          await client.query('ROLLBACK');
          return sendError(reply, 404, 'ثوب غير موجود في السطر', 'NOT_FOUND');
        }

        await client.query(
          `INSERT INTO inventory_waste_lines
             (company_id, waste_id, fabric_roll_id, barcode, quantity,
              waste_length_m, waste_weight_kg, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            companyId,
            waste.id,
            line.fabricRollId,
            line.barcode ?? null,
            line.quantity,
            line.wasteLengthM ?? null,
            line.wasteWeightKg ?? null,
            line.notes ?? null,
          ],
        );
      }

      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: waste });
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'تعارض في أرقام السجلات أو تكرار ثوب', 'DUPLICATE');
      throw e;
    } finally {
      client.release();
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();

    const cur = await pool.query<{ status: string }>(
      'SELECT status FROM inventory_waste_records WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!cur.rows.length) return sendError(reply, 404, 'سجل التوالف غير موجود', 'NOT_FOUND');
    if (cur.rows[0].status !== 'DRAFT') return sendError(reply, 400, 'لا يمكن التعديل إلا في حالة مسودة', 'INVALID_STATE');

    if (d.warehouseId) {
      const wh = await pool.query('SELECT id FROM warehouses WHERE id=$1 AND company_id=$2', [
        d.warehouseId,
        companyId,
      ]);
      if (!wh.rows.length) return sendError(reply, 404, 'المستودع غير موجود', 'NOT_FOUND');
    }

    if (d.locationId && d.warehouseId) {
      const loc = await pool.query(
        'SELECT id FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2 AND company_id=$3',
        [d.locationId, d.warehouseId, companyId],
      );
      if (!loc.rows.length) return sendError(reply, 400, 'الموقع غير صالح لهذا المستودع', 'VALIDATION');
    }

    const wasteDate = d.wasteDate ? d.wasteDate.slice(0, 10) : new Date().toISOString().slice(0, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE inventory_waste_records SET
           waste_date = $3::date,
           waste_type = $4,
           warehouse_id = $5,
           location_id = $6,
           reason = $7,
           notes = $8,
           updated_at = now()
         WHERE id = $1 AND company_id = $2`,
        [
          id,
          companyId,
          wasteDate,
          d.wasteType,
          d.warehouseId ?? null,
          d.locationId ?? null,
          d.reason ?? null,
          d.notes ?? null,
        ],
      );

      await client.query('DELETE FROM inventory_waste_lines WHERE waste_id=$1 AND company_id=$2', [id, companyId]);

      for (const line of d.lines) {
        if (line.quantity !== 1) {
          await client.query('ROLLBACK');
          return sendError(reply, 400, 'في هذا الإصدار يُسجّل ثوب واحد لكل سطر (الكمية = 1)', 'VALIDATION');
        }
        const roll = await client.query(
          'SELECT id FROM fabric_rolls WHERE id=$1 AND company_id=$2',
          [line.fabricRollId, companyId],
        );
        if (!roll.rows.length) {
          await client.query('ROLLBACK');
          return sendError(reply, 404, 'ثوب غير موجود في السطر', 'NOT_FOUND');
        }

        await client.query(
          `INSERT INTO inventory_waste_lines
             (company_id, waste_id, fabric_roll_id, barcode, quantity,
              waste_length_m, waste_weight_kg, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            companyId,
            id,
            line.fabricRollId,
            line.barcode ?? null,
            line.quantity,
            line.wasteLengthM ?? null,
            line.wasteWeightKg ?? null,
            line.notes ?? null,
          ],
        );
      }

      await client.query('COMMIT');
      const row = await pool.query(
        `SELECT w.*, wh.name AS warehouse_name
         FROM inventory_waste_records w
         LEFT JOIN warehouses wh ON wh.id = w.warehouse_id AND wh.company_id = w.company_id
         WHERE w.id=$1 AND w.company_id=$2`,
        [id, companyId],
      );
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'تعارض أو تكرار ثوب في السجل', 'DUPLICATE');
      throw e;
    } finally {
      client.release();
    }
  });

  app.patch('/:id/confirm', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const head = await client.query(
        `SELECT * FROM inventory_waste_records WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!head.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'سجل التوالف غير موجود', 'NOT_FOUND');
      }
      const w = head.rows[0] as {
        status: string;
        warehouse_id: string | null;
        location_id: string | null;
        waste_no: string;
      };

      if (w.status !== 'DRAFT') {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'السجل ليس في حالة مسودة', 'INVALID_STATE');
      }

      const lines = await client.query(
        `SELECT * FROM inventory_waste_lines WHERE waste_id=$1 AND company_id=$2`,
        [id, companyId],
      );
      if (!lines.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'لا توجد أثواب في السجل', 'VALIDATION');
      }

      for (const ln of lines.rows) {
        const rollRow = await client.query<{
          id: string;
          warehouse_id: string;
          location_id: string | null;
          status: RollStatus;
          length_m: string;
          width_cm: string | null;
          gsm: string | null;
        }>(
          `SELECT id, warehouse_id, location_id, status, length_m, width_cm, gsm
           FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`,
          [ln.fabric_roll_id, companyId],
        );
        if (!rollRow.rows.length) {
          await client.query('ROLLBACK');
          return sendError(reply, 404, 'ثوب غير موجود', 'NOT_FOUND');
        }
        const cur = rollRow.rows[0];

        if (w.warehouse_id && cur.warehouse_id !== w.warehouse_id) {
          await client.query('ROLLBACK');
          return sendError(reply, 400, 'ثوب لا يوجد في المستودع المحدد للتوالف', 'VALIDATION');
        }
        if (w.location_id && cur.location_id !== w.location_id) {
          await client.query('ROLLBACK');
          return sendError(reply, 400, 'ثوب لا يطابق الموقع المحدد', 'VALIDATION');
        }

        if (cur.status === 'SOLD' || cur.status === 'INACTIVE') {
          await client.query('ROLLBACK');
          return sendError(reply, 400, 'لا يمكن تسجيل توالف لثوب مباع أو غير نشط', 'INVALID_STATUS');
        }

        const len = parseFloat(cur.length_m);
        const wasteLen =
          ln.waste_length_m != null ? parseFloat(String(ln.waste_length_m)) : null;
        const fullWaste = wasteLen == null || wasteLen >= len || wasteLen <= 0;

        const notesAr = 'توالف / إهلاك مادة';

        if (fullWaste) {
          await client.query(
            `UPDATE fabric_rolls SET status='DAMAGED', updated_at=now()
             WHERE id=$1 AND company_id=$2`,
            [cur.id, companyId],
          );

          await client.query(
            `INSERT INTO inventory_movements
               (company_id, roll_id, movement_type,
                from_warehouse_id, to_warehouse_id,
                old_status, new_status,
                reference_type, reference_id, reference_no,
                notes, created_by_user_id)
             VALUES ($1,$2,'DAMAGE',$3,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              companyId,
              cur.id,
              cur.warehouse_id,
              cur.status,
              'DAMAGED',
              'INVENTORY_WASTE',
              id,
              w.waste_no,
              notesAr,
              userId,
            ],
          );
        } else {
          const newLen = Math.max(0, len - wasteLen);
          const calcWt = calcWeight(
            newLen,
            cur.width_cm != null ? parseFloat(cur.width_cm) : null,
            cur.gsm != null ? parseFloat(cur.gsm) : null,
          );

          await client.query(
            `UPDATE fabric_rolls SET
               length_m = $3,
               calculated_weight_kg = $4,
               status = CASE WHEN $3::numeric <= 0 THEN 'DAMAGED'::text ELSE status END,
               updated_at = now()
             WHERE id=$1 AND company_id=$2`,
            [cur.id, companyId, newLen, calcWt],
          );

          const newStatus = newLen <= 0 ? 'DAMAGED' : cur.status;

          await client.query(
            `INSERT INTO inventory_movements
               (company_id, roll_id, movement_type,
                from_warehouse_id, to_warehouse_id,
                old_status, new_status,
                length_delta_m,
                reference_type, reference_id, reference_no,
                notes, created_by_user_id)
             VALUES ($1,$2,'DAMAGE',$3,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              companyId,
              cur.id,
              cur.warehouse_id,
              cur.status,
              newStatus,
              -wasteLen,
              'INVENTORY_WASTE',
              id,
              w.waste_no,
              notesAr,
              userId,
            ],
          );
        }
      }

      await client.query(
        `UPDATE inventory_waste_records SET status='CONFIRMED', confirmed_at=now(), updated_at=now()
         WHERE id=$1 AND company_id=$2`,
        [id, companyId],
      );

      await client.query('COMMIT');

      const row = await pool.query(
        `SELECT w.*, wh.name AS warehouse_name
         FROM inventory_waste_records w
         LEFT JOIN warehouses wh ON wh.id = w.warehouse_id AND wh.company_id = w.company_id
         WHERE w.id=$1`,
        [id],
      );
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.patch('/:id/cancel', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();

    const cur = await pool.query<{ status: string }>(
      'SELECT status FROM inventory_waste_records WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!cur.rows.length) return sendError(reply, 404, 'سجل التوالف غير موجود', 'NOT_FOUND');
    if (cur.rows[0].status !== 'DRAFT') {
      return sendError(reply, 400, 'لا يمكن إلغاء سجل مؤكد في هذا الإصدار', 'INVALID_STATE');
    }

    await pool.query(
      `UPDATE inventory_waste_records SET status='CANCELLED', cancelled_at=now(), updated_at=now()
       WHERE id=$1 AND company_id=$2`,
      [id, companyId],
    );

    const row = await pool.query(
      `SELECT w.*, wh.name AS warehouse_name
       FROM inventory_waste_records w
       LEFT JOIN warehouses wh ON wh.id = w.warehouse_id AND wh.company_id = w.company_id
       WHERE w.id=$1`,
      [id],
    );
    return reply.send({ ok: true, data: row.rows[0] });
  });
};
