import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';

// ─── Types ─────────────────────────────────────────────────────────────────

interface RollLabelRow {
  id: string; barcode: string; roll_no: string | null;
  item_name: string | null; internal_code: string | null; supplier_code: string | null;
  color_name_ar: string | null; color_name_tr: string | null; color_code: string | null;
  supplier_color_code: string | null; variant_code: string | null;
  length_m: string | null; width_cm: string | null; gsm: string | null;
  calculated_weight_kg: string | null; actual_weight_kg: string | null;
  supplier_name: string | null; warehouse_name: string | null; location_name: string | null;
  batch_no: string | null; container_no: string | null;
  purchase_invoice_no: string | null; supplier_roll_ref: string | null;
  status: string; currency_code: string | null; unit_cost: string | null;
}

function toDto(row: RollLabelRow) {
  const toNum = (value: string | null): number | null => (value !== null ? parseFloat(value) : null);
  const lengthM = toNum(row.length_m);
  const weightKg = toNum(row.actual_weight_kg) ?? toNum(row.calculated_weight_kg);
  const widthCm = toNum(row.width_cm);
  const gsm = toNum(row.gsm);
  const compactQrValue = (value: unknown): string =>
    String(value ?? '')
      .replace(/[|\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const colorForQr = row.color_name_tr || row.color_code || row.supplier_color_code || row.color_name_ar;
  const qrPayload = [
    compactQrValue(row.barcode),
    compactQrValue(row.item_name),
    compactQrValue(row.internal_code || row.supplier_code),
    compactQrValue(colorForQr),
    compactQrValue(row.color_code || row.supplier_color_code),
    compactQrValue(lengthM),
    compactQrValue(weightKg),
  ].join('|');

  return {
    rollId: row.id,
    barcode: row.barcode,
    qrPayload,
    rollNo: row.roll_no,
    itemName: row.item_name,
    internalCode: row.internal_code,
    supplierCode: row.supplier_code,
    colorNameAr: row.color_name_ar,
    colorNameTr: row.color_name_tr,
    colorCode: row.color_code,
    supplierColorCode: row.supplier_color_code,
    variantCode: row.variant_code,
    lengthM,
    widthCm,
    gsm,
    calculatedWeightKg: toNum(row.calculated_weight_kg),
    actualWeightKg: toNum(row.actual_weight_kg),
    supplierName: row.supplier_name,
    warehouseName: row.warehouse_name,
    locationName: row.location_name,
    batchNo: row.batch_no,
    containerNo: row.container_no,
    purchaseInvoiceNo: row.purchase_invoice_no,
    supplierRollRef: row.supplier_roll_ref,
    status: row.status,
    currencyCode: row.currency_code,
    unitCost: row.unit_cost !== null ? parseFloat(row.unit_cost) : null,
  };
}

const ROLL_LABEL_SELECT = `
  SELECT
    fr.id, fr.barcode, fr.roll_no,
    fi.name          AS item_name,
    fi.internal_code,
    fi.supplier_code,
    fc.name_ar       AS color_name_ar,
    fc.name_tr       AS color_name_tr,
    fc.color_code,
    fc.supplier_color_code,
    fv.variant_code,
    fr.length_m, fr.width_cm, fr.gsm,
    fr.calculated_weight_kg, fr.actual_weight_kg,
    s.name           AS supplier_name,
    w.name           AS warehouse_name,
    wl.name          AS location_name,
    fr.batch_no, fr.container_no,
    fr.purchase_invoice_no, fr.supplier_roll_ref,
    fr.status, fr.currency_code, fr.unit_cost
  FROM fabric_rolls fr
  LEFT JOIN fabric_items fi          ON fi.id  = fr.item_id
  LEFT JOIN fabric_colors fc         ON fc.id  = fr.color_id
  LEFT JOIN fabric_item_variants fv  ON fv.id  = fr.variant_id
  LEFT JOIN suppliers s              ON s.id   = fr.supplier_id
  LEFT JOIN warehouses w             ON w.id   = fr.warehouse_id
  LEFT JOIN warehouse_locations wl   ON wl.id  = fr.location_id
`;

// ─── Plugin ─────────────────────────────────────────────────────────────────

export const labelPrintRoutes: FastifyPluginAsync = async (app) => {

  // ── A. List templates ───────────────────────────────────────────────────
  app.get('/templates', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const pool = getPool();
    const rows = await pool.query(
      `SELECT * FROM label_templates WHERE company_id=$1 AND is_active=true ORDER BY is_default DESC, name ASC`,
      [companyId],
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  // ── B. Default template ─────────────────────────────────────────────────
  app.get('/templates/default', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const pool = getPool();
    const row = await pool.query(
      `SELECT * FROM label_templates WHERE company_id=$1 AND is_default=true AND is_active=true LIMIT 1`,
      [companyId],
    );
    if (!row.rows.length) {
      return reply.send({ ok: true, data: null });
    }
    return reply.send({ ok: true, data: row.rows[0] });
  });

  // ── C. Preview rolls ────────────────────────────────────────────────────
  app.post('/rolls/preview', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const schema = z.object({
      rollIds: z.array(z.string().uuid()).min(1, 'rollIds مطلوب').max(1000, 'الحد الأقصى 1000 ثوب'),
      templateId: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, parsed.error.errors[0]?.message ?? ArabicErrors.validation, 'VALIDATION');
    }
    const { rollIds, templateId } = parsed.data;
    const pool = getPool();

    let template = null;
    if (templateId) {
      const tr = await pool.query('SELECT * FROM label_templates WHERE id=$1 AND company_id=$2', [templateId, companyId]);
      if (tr.rows.length) template = tr.rows[0];
    }
    if (!template) {
      const tr = await pool.query(
        'SELECT * FROM label_templates WHERE company_id=$1 AND is_default=true AND is_active=true LIMIT 1',
        [companyId],
      );
      if (tr.rows.length) template = tr.rows[0];
    }

    const rows = await pool.query<RollLabelRow>(
      `${ROLL_LABEL_SELECT} WHERE fr.id = ANY($1) AND fr.company_id=$2
         AND fr.status = 'AVAILABLE' AND fr.length_m > 0
         ORDER BY fr.created_at ASC`,
      [rollIds, companyId],
    );
    return reply.send({ ok: true, data: rows.rows.map(toDto), template });
  });

  // ── D. Preview by import batch ──────────────────────────────────────────
  app.post('/rolls/preview-by-batch', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const schema = z.object({
      batchId: z.string().uuid(),
      templateId: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    }
    const { batchId, templateId } = parsed.data;
    const pool = getPool();

    const batchCheck = await pool.query(
      'SELECT id FROM purchase_import_batches WHERE id=$1 AND company_id=$2',
      [batchId, companyId],
    );
    if (!batchCheck.rows.length) return sendError(reply, 404, 'الدفعة غير موجودة', 'NOT_FOUND');

    let template = null;
    if (templateId) {
      const tr = await pool.query('SELECT * FROM label_templates WHERE id=$1 AND company_id=$2', [templateId, companyId]);
      if (tr.rows.length) template = tr.rows[0];
    }
    if (!template) {
      const tr = await pool.query(
        'SELECT * FROM label_templates WHERE company_id=$1 AND is_default=true AND is_active=true LIMIT 1',
        [companyId],
      );
      if (tr.rows.length) template = tr.rows[0];
    }

    // Find rolls via import_rows.created_roll_id for this batch
    const rollIdsRes = await pool.query<{ created_roll_id: string }>(
      `SELECT DISTINCT created_roll_id FROM purchase_import_rows
       WHERE batch_id=$1 AND company_id=$2 AND created_roll_id IS NOT NULL`,
      [batchId, companyId],
    );
    const rollIds = rollIdsRes.rows.map(r => r.created_roll_id);
    if (rollIds.length === 0) {
      return reply.send({ ok: true, data: [], template, note: 'لا توجد أتواب مستوردة في هذه الدفعة' });
    }

    const rows = await pool.query<RollLabelRow>(
      `${ROLL_LABEL_SELECT} WHERE fr.id = ANY($1) AND fr.company_id=$2
         AND fr.status = 'AVAILABLE' AND fr.length_m > 0
         ORDER BY fr.created_at ASC`,
      [rollIds, companyId],
    );
    return reply.send({ ok: true, data: rows.rows.map(toDto), template });
  });

  // ── E. Create print job ─────────────────────────────────────────────────
  app.post('/print-jobs', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const schema = z.object({
      rollIds: z.array(z.string().uuid()).min(1).max(1000),
      templateId: z.string().uuid().optional(),
      sourceType: z.enum(['ROLL_SELECTION', 'IMPORT_BATCH', 'SINGLE_ROLL']).optional(),
      sourceId: z.string().uuid().optional(),
      printerName: z.string().optional(),
      pageSize: z.string().optional(),
      notes: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, parsed.error.errors[0]?.message ?? ArabicErrors.validation, 'VALIDATION');
    }
    const { rollIds, templateId, sourceType, sourceId, printerName, pageSize, notes } = parsed.data;
    const pool = getPool();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const jobRow = await client.query(
        `INSERT INTO print_jobs
           (company_id, job_type, status, template_id, source_type, source_id,
            roll_count, printer_name, page_size, notes, created_by_user_id)
         VALUES ($1,'ROLL_LABELS','CREATED',$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [companyId, templateId ?? null, sourceType ?? null, sourceId ?? null,
         rollIds.length, printerName ?? null, pageSize ?? null, notes ?? null, userId],
      );
      const job = jobRow.rows[0];

      // Upsert printed_labels per roll
      for (const rollId of rollIds) {
        // Check if roll exists and belongs to company
        const rollCheck = await client.query<{ barcode: string }>(
          'SELECT barcode FROM fabric_rolls WHERE id=$1 AND company_id=$2',
          [rollId, companyId],
        );
        if (!rollCheck.rows.length) continue;
        const { barcode } = rollCheck.rows[0];

        // Check existing printed label record for upsert
        const existing = await client.query(
          'SELECT id, print_count FROM printed_labels WHERE roll_id=$1 AND company_id=$2 LIMIT 1',
          [rollId, companyId],
        );
        if (existing.rows.length) {
          await client.query(
            `UPDATE printed_labels SET print_count=print_count+1, last_printed_at=now(),
             printed_by_user_id=$1, print_job_id=$2 WHERE id=$3`,
            [userId, job.id, existing.rows[0].id],
          );
        } else {
          await client.query(
            `INSERT INTO printed_labels (company_id, print_job_id, roll_id, barcode, print_count, printed_by_user_id)
             VALUES ($1,$2,$3,$4,1,$5)`,
            [companyId, job.id, rollId, barcode, userId],
          );
        }
      }

      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: { jobId: job.id, rollCount: rollIds.length } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ── F. Update print job status ──────────────────────────────────────────
  app.patch('/print-jobs/:id/status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const schema = z.object({
      status: z.enum(['PREVIEWED', 'PRINTED', 'FAILED', 'CANCELLED']),
      errorMessage: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const { status, errorMessage } = parsed.data;
    const pool = getPool();

    const check = await pool.query('SELECT id FROM print_jobs WHERE id=$1 AND company_id=$2', [id, companyId]);
    if (!check.rows.length) return sendError(reply, 404, 'مهمة الطباعة غير موجودة', 'NOT_FOUND');

    await pool.query(
      `UPDATE print_jobs SET status=$1, error_message=$2,
       printed_at=CASE WHEN $1='PRINTED' THEN now() ELSE printed_at END,
       printed_count=CASE WHEN $1='PRINTED' THEN roll_count ELSE printed_count END
       WHERE id=$3`,
      [status, errorMessage ?? null, id],
    );
    return reply.send({ ok: true });
  });

  // ── G. List print jobs ──────────────────────────────────────────────────
  app.get('/print-jobs', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const pool = getPool();

    const [rows, cnt] = await Promise.all([
      pool.query(
        `SELECT pj.*, lt.name AS template_name, lt.width_mm, lt.height_mm,
                u.full_name AS created_by_name
         FROM print_jobs pj
         LEFT JOIN label_templates lt ON lt.id = pj.template_id
         LEFT JOIN users u ON u.id = pj.created_by_user_id
         WHERE pj.company_id=$1
         ORDER BY pj.created_at DESC
         LIMIT $2 OFFSET $3`,
        [companyId, pageSize, offset],
      ),
      pool.query('SELECT COUNT(*)::int AS total FROM print_jobs WHERE company_id=$1', [companyId]),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: cnt.rows[0].total, page, pageSize });
  });

  // ── H. Get print job ────────────────────────────────────────────────────
  app.get('/print-jobs/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();

    const row = await pool.query(
      `SELECT pj.*, lt.name AS template_name, lt.width_mm, lt.height_mm
       FROM print_jobs pj
       LEFT JOIN label_templates lt ON lt.id = pj.template_id
       WHERE pj.id=$1 AND pj.company_id=$2`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'مهمة الطباعة غير موجودة', 'NOT_FOUND');

    // Also fetch printed label records
    const labels = await pool.query(
      `SELECT pl.*, fr.barcode AS roll_barcode, fi.name AS item_name
       FROM printed_labels pl
       LEFT JOIN fabric_rolls fr ON fr.id = pl.roll_id
       LEFT JOIN fabric_items fi ON fi.id = fr.item_id
       WHERE pl.print_job_id=$1 ORDER BY pl.last_printed_at ASC`,
      [id],
    );
    return reply.send({ ok: true, data: { ...row.rows[0], labels: labels.rows } });
  });
};
