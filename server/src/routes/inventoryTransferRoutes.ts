import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { generateDocumentNo } from '../utils/documentNumbers.js';
import type { RollStatus } from '../utils/rollHelpers.js';

const lineSchema = z.object({
  fabricRollId: z.string().uuid(),
  quantity: z.coerce.number().positive().default(1),
  barcode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const createBody = z.object({
  fromWarehouseId: z.string().uuid(),
  fromLocationId: z.string().uuid().optional().nullable(),
  toWarehouseId: z.string().uuid(),
  toLocationId: z.string().uuid().optional().nullable(),
  transferDate: z.string().optional(),
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, 'يجب إضافة ثوب واحد على الأقل'),
});

const updateBody = createBody;

export const inventoryTransferRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';
    const status = q.status?.trim();
    const fromWarehouseId = q.fromWarehouseId?.trim();
    const toWarehouseId = q.toWarehouseId?.trim();
    const dateFrom = q.dateFrom?.trim();
    const dateTo = q.dateTo?.trim();
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['t.company_id = $1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (search) {
      conditions.push(`(t.transfer_no ILIKE $${p} OR t.notes ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }
    if (status && ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status)) {
      conditions.push(`t.status = $${p}`);
      params.push(status);
      p++;
    }
    if (fromWarehouseId) {
      conditions.push(`t.from_warehouse_id = $${p}`);
      params.push(fromWarehouseId);
      p++;
    }
    if (toWarehouseId) {
      conditions.push(`t.to_warehouse_id = $${p}`);
      params.push(toWarehouseId);
      p++;
    }
    if (dateFrom) {
      conditions.push(`t.transfer_date >= $${p}::date`);
      params.push(dateFrom);
      p++;
    }
    if (dateTo) {
      conditions.push(`t.transfer_date <= $${p}::date`);
      params.push(dateTo);
      p++;
    }

    const where = conditions.join(' AND ');
    const pool = getPool();

    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT t.*,
                fw.name AS from_warehouse_name,
                tw.name AS to_warehouse_name,
                (SELECT COUNT(*)::int FROM inventory_transfer_lines l WHERE l.transfer_id = t.id AND l.company_id = t.company_id) AS line_count
         FROM inventory_transfers t
         JOIN warehouses fw ON fw.id = t.from_warehouse_id AND fw.company_id = t.company_id
         JOIN warehouses tw ON tw.id = t.to_warehouse_id AND tw.company_id = t.company_id
         WHERE ${where}
         ORDER BY t.transfer_date DESC, t.created_at DESC
         LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM inventory_transfers t WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();

    const head = await pool.query(
      `SELECT t.*,
              fw.name AS from_warehouse_name,
              tw.name AS to_warehouse_name
       FROM inventory_transfers t
       JOIN warehouses fw ON fw.id = t.from_warehouse_id AND fw.company_id = t.company_id
       JOIN warehouses tw ON tw.id = t.to_warehouse_id AND tw.company_id = t.company_id
       WHERE t.id = $1 AND t.company_id = $2`,
      [id, companyId],
    );
    if (!head.rows.length) return sendError(reply, 404, 'المناقلة غير موجودة', 'NOT_FOUND');

    const lines = await pool.query(
      `SELECT l.id, l.company_id, l.transfer_id, l.fabric_roll_id, l.barcode AS line_barcode, l.quantity, l.notes,
              fr.roll_no, fr.barcode AS roll_barcode, fr.length_m, fr.status AS roll_status,
              fi.name AS item_name
       FROM inventory_transfer_lines l
       JOIN fabric_rolls fr ON fr.id = l.fabric_roll_id AND fr.company_id = l.company_id
       JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
       WHERE l.transfer_id = $1 AND l.company_id = $2
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

    if (d.fromWarehouseId === d.toWarehouseId && (d.fromLocationId ?? null) === (d.toLocationId ?? null)) {
      return sendError(reply, 400, 'يجب اختيار مستودع أو موقع وجهة مختلف عن المصدر', 'VALIDATION');
    }

    const pool = getPool();

    const wh = await pool.query(
      `SELECT id FROM warehouses WHERE company_id=$1 AND id IN ($2,$3)`,
      [companyId, d.fromWarehouseId, d.toWarehouseId],
    );
    if (wh.rows.length !== 2) return sendError(reply, 400, 'مستودع المصدر أو الوجهة غير صالح', 'VALIDATION');

    if (d.fromLocationId) {
      const loc = await pool.query(
        'SELECT id FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2 AND company_id=$3',
        [d.fromLocationId, d.fromWarehouseId, companyId],
      );
      if (!loc.rows.length) return sendError(reply, 400, 'موقع المصدر غير صالح', 'VALIDATION');
    }
    if (d.toLocationId) {
      const loc = await pool.query(
        'SELECT id FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2 AND company_id=$3',
        [d.toLocationId, d.toWarehouseId, companyId],
      );
      if (!loc.rows.length) return sendError(reply, 400, 'موقع الوجهة غير صالح', 'VALIDATION');
    }

    const transferNo = generateDocumentNo('TRF');
    const transferDate = d.transferDate ? d.transferDate.slice(0, 10) : new Date().toISOString().slice(0, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const ins = await client.query(
        `INSERT INTO inventory_transfers
           (company_id, transfer_no, transfer_date, from_warehouse_id, from_location_id,
            to_warehouse_id, to_location_id, status, notes, created_by_user_id)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,'DRAFT',$8,$9)
         RETURNING *`,
        [
          companyId,
          transferNo,
          transferDate,
          d.fromWarehouseId,
          d.fromLocationId ?? null,
          d.toWarehouseId,
          d.toLocationId ?? null,
          d.notes ?? null,
          userId,
        ],
      );

      const transfer = ins.rows[0];

      for (const line of d.lines) {
        if (line.quantity !== 1) {
          await client.query('ROLLBACK');
          return sendError(reply, 400, 'في هذا الإصدار يُسمح بنقل الثوب كاملاً فقط (الكمية = 1)', 'VALIDATION');
        }
        const roll = await client.query<{ id: string }>(
          'SELECT id FROM fabric_rolls WHERE id=$1 AND company_id=$2',
          [line.fabricRollId, companyId],
        );
        if (!roll.rows.length) {
          await client.query('ROLLBACK');
          return sendError(reply, 404, 'ثوب غير موجود في السطر', 'NOT_FOUND');
        }

        await client.query(
          `INSERT INTO inventory_transfer_lines
             (company_id, transfer_id, fabric_roll_id, barcode, quantity, notes)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            companyId,
            transfer.id,
            line.fabricRollId,
            line.barcode ?? null,
            line.quantity,
            line.notes ?? null,
          ],
        );
      }

      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: transfer });
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'تعارض في أرقام المناقلة أو تكرار ثوب في الطلب', 'DUPLICATE');
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

    if (d.fromWarehouseId === d.toWarehouseId && (d.fromLocationId ?? null) === (d.toLocationId ?? null)) {
      return sendError(reply, 400, 'يجب اختيار مستودع أو موقع وجهة مختلف عن المصدر', 'VALIDATION');
    }

    const pool = getPool();
    const cur = await pool.query<{ status: string }>(
      'SELECT status FROM inventory_transfers WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!cur.rows.length) return sendError(reply, 404, 'المناقلة غير موجودة', 'NOT_FOUND');
    if (cur.rows[0].status !== 'DRAFT') return sendError(reply, 400, 'لا يمكن التعديل إلا في حالة مسودة', 'INVALID_STATE');

    const wh = await pool.query(
      `SELECT id FROM warehouses WHERE company_id=$1 AND id IN ($2,$3)`,
      [companyId, d.fromWarehouseId, d.toWarehouseId],
    );
    if (wh.rows.length !== 2) return sendError(reply, 400, 'مستودع المصدر أو الوجهة غير صالح', 'VALIDATION');

    if (d.fromLocationId) {
      const loc = await pool.query(
        'SELECT id FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2 AND company_id=$3',
        [d.fromLocationId, d.fromWarehouseId, companyId],
      );
      if (!loc.rows.length) return sendError(reply, 400, 'موقع المصدر غير صالح', 'VALIDATION');
    }
    if (d.toLocationId) {
      const loc = await pool.query(
        'SELECT id FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2 AND company_id=$3',
        [d.toLocationId, d.toWarehouseId, companyId],
      );
      if (!loc.rows.length) return sendError(reply, 400, 'موقع الوجهة غير صالح', 'VALIDATION');
    }

    const transferDate = d.transferDate ? d.transferDate.slice(0, 10) : new Date().toISOString().slice(0, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE inventory_transfers SET
           transfer_date = $3::date,
           from_warehouse_id = $4,
           from_location_id = $5,
           to_warehouse_id = $6,
           to_location_id = $7,
           notes = $8,
           updated_at = now()
         WHERE id = $1 AND company_id = $2`,
        [
          id,
          companyId,
          transferDate,
          d.fromWarehouseId,
          d.fromLocationId ?? null,
          d.toWarehouseId,
          d.toLocationId ?? null,
          d.notes ?? null,
        ],
      );

      await client.query('DELETE FROM inventory_transfer_lines WHERE transfer_id=$1 AND company_id=$2', [
        id,
        companyId,
      ]);

      for (const line of d.lines) {
        if (line.quantity !== 1) {
          await client.query('ROLLBACK');
          return sendError(reply, 400, 'في هذا الإصدار يُسمح بنقل الثوب كاملاً فقط (الكمية = 1)', 'VALIDATION');
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
          `INSERT INTO inventory_transfer_lines
             (company_id, transfer_id, fabric_roll_id, barcode, quantity, notes)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [companyId, id, line.fabricRollId, line.barcode ?? null, line.quantity, line.notes ?? null],
        );
      }

      await client.query('COMMIT');
      const row = await pool.query(
        `SELECT t.*,
                fw.name AS from_warehouse_name,
                tw.name AS to_warehouse_name
         FROM inventory_transfers t
         JOIN warehouses fw ON fw.id = t.from_warehouse_id AND fw.company_id = t.company_id
         JOIN warehouses tw ON tw.id = t.to_warehouse_id AND tw.company_id = t.company_id
         WHERE t.id=$1 AND t.company_id=$2`,
        [id, companyId],
      );
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'تعارض أو تكرار ثوب في الطلب', 'DUPLICATE');
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
        `SELECT * FROM inventory_transfers WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!head.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'المناقلة غير موجودة', 'NOT_FOUND');
      }
      const t = head.rows[0] as {
        status: string;
        from_warehouse_id: string;
        from_location_id: string | null;
        to_warehouse_id: string;
        to_location_id: string | null;
        transfer_no: string;
      };

      if (t.status !== 'DRAFT') {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'المناقلة ليست في حالة مسودة', 'INVALID_STATE');
      }

      const lines = await client.query<{ fabric_roll_id: string }>(
        'SELECT fabric_roll_id FROM inventory_transfer_lines WHERE transfer_id=$1 AND company_id=$2',
        [id, companyId],
      );
      if (!lines.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'لا توجد أثواب في المناقلة', 'VALIDATION');
      }

      for (const ln of lines.rows) {
        const rollRow = await client.query<{
          warehouse_id: string;
          location_id: string | null;
          status: RollStatus;
        }>(
          `SELECT warehouse_id, location_id, status FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`,
          [ln.fabric_roll_id, companyId],
        );
        if (!rollRow.rows.length) {
          await client.query('ROLLBACK');
          return sendError(reply, 404, 'ثوب غير موجود', 'NOT_FOUND');
        }
        const cur = rollRow.rows[0];

        if (cur.warehouse_id !== t.from_warehouse_id) {
          await client.query('ROLLBACK');
          return sendError(reply, 400, 'ثوب لا يوجد في مستودع المصدر الحالي', 'VALIDATION');
        }
        if (t.from_location_id && cur.location_id !== t.from_location_id) {
          await client.query('ROLLBACK');
          return sendError(reply, 400, 'ثوب لا يطابق موقع المصدر المحدد', 'VALIDATION');
        }

        if (cur.status === 'SOLD' || cur.status === 'INACTIVE') {
          await client.query('ROLLBACK');
          return sendError(reply, 400, 'لا يمكن نقل ثوب مباع أو غير نشط', 'INVALID_STATUS');
        }

        const sameWarehouse = cur.warehouse_id === t.to_warehouse_id;
        const movType = sameWarehouse ? 'TRANSFER_IN' : 'TRANSFER_OUT';
        const newStatus: RollStatus =
          !sameWarehouse && cur.status === 'AVAILABLE' ? 'TRANSFERRED' : cur.status;

        await client.query(
          `UPDATE fabric_rolls SET warehouse_id=$3, location_id=$4, status=$5, updated_at=now()
           WHERE id=$1 AND company_id=$2`,
          [ln.fabric_roll_id, companyId, t.to_warehouse_id, t.to_location_id ?? null, newStatus],
        );

        await client.query(
          `INSERT INTO inventory_movements
             (company_id, roll_id, movement_type,
              from_warehouse_id, to_warehouse_id,
              from_location_id, to_location_id,
              old_status, new_status,
              reference_type, reference_id, reference_no,
              notes, created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            companyId,
            ln.fabric_roll_id,
            movType,
            cur.warehouse_id,
            t.to_warehouse_id,
            cur.location_id,
            t.to_location_id ?? null,
            cur.status,
            newStatus,
            'INVENTORY_TRANSFER',
            id,
            t.transfer_no,
            'مناقلة بين المستودعات',
            userId,
          ],
        );
      }

      await client.query(
        `UPDATE inventory_transfers SET status='CONFIRMED', confirmed_at=now(), updated_at=now()
         WHERE id=$1 AND company_id=$2`,
        [id, companyId],
      );

      await client.query('COMMIT');

      const row = await pool.query(
        `SELECT t.*,
                fw.name AS from_warehouse_name,
                tw.name AS to_warehouse_name
         FROM inventory_transfers t
         JOIN warehouses fw ON fw.id = t.from_warehouse_id AND fw.company_id = t.company_id
         JOIN warehouses tw ON tw.id = t.to_warehouse_id AND tw.company_id = t.company_id
         WHERE t.id=$1`,
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
      'SELECT status FROM inventory_transfers WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!cur.rows.length) return sendError(reply, 404, 'المناقلة غير موجودة', 'NOT_FOUND');
    if (cur.rows[0].status !== 'DRAFT') {
      return sendError(reply, 400, 'لا يمكن إلغاء مناقلة مؤكدة في هذا الإصدار', 'INVALID_STATE');
    }

    await pool.query(
      `UPDATE inventory_transfers SET status='CANCELLED', cancelled_at=now(), updated_at=now()
       WHERE id=$1 AND company_id=$2`,
      [id, companyId],
    );

    const row = await pool.query(
      `SELECT t.*,
              fw.name AS from_warehouse_name,
              tw.name AS to_warehouse_name
       FROM inventory_transfers t
       JOIN warehouses fw ON fw.id = t.from_warehouse_id AND fw.company_id = t.company_id
       JOIN warehouses tw ON tw.id = t.to_warehouse_id AND tw.company_id = t.company_id
       WHERE t.id=$1`,
      [id],
    );
    return reply.send({ ok: true, data: row.rows[0] });
  });
};
