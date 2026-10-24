import type { Pool } from 'pg';
import { z } from 'zod';

export type IntakeDispatchSlipRow = {
  id: string;
  company_id: string;
  intake_operation_id: string;
  slip_no: string;
  slip_type: 'STOCK' | 'PURCHASE';
  warehouse_id: string;
  supplier_id: string;
  created_at: string;
  updated_at: string;
  warehouse_name?: string;
  supplier_name?: string;
  order_no?: string;
  line_count?: number;
  priced_line_count?: number;
};

export type IntakeDispatchSlipLineRow = {
  id: string;
  slip_id: string;
  fabric_roll_id: string;
  unit_price: string | null;
  line_total: string | null;
  barcode: string;
  length_m: string;
  item_name: string;
  color_name_ar: string | null;
};

export async function listDispatchSlips(pool: Pool, companyId: string): Promise<IntakeDispatchSlipRow[]> {
  const res = await pool.query<IntakeDispatchSlipRow>(
    `SELECT s.*, w.name AS warehouse_name, sup.name AS supplier_name, io.order_no,
            (SELECT count(*) FROM intake_dispatch_slip_lines l WHERE l.slip_id = s.id) AS line_count,
            (SELECT count(*) FROM intake_dispatch_slip_lines l WHERE l.slip_id = s.id AND l.unit_price IS NOT NULL) AS priced_line_count
     FROM intake_dispatch_slips s
     JOIN warehouses w ON w.id = s.warehouse_id
     JOIN suppliers sup ON sup.id = s.supplier_id
     JOIN intake_operations io ON io.id = s.intake_operation_id
     WHERE s.company_id = $1
     ORDER BY s.created_at DESC`,
    [companyId],
  );
  return res.rows;
}

export async function getDispatchSlipWithLines(
  pool: Pool,
  companyId: string,
  id: string,
): Promise<{ slip: IntakeDispatchSlipRow; lines: IntakeDispatchSlipLineRow[] } | null> {
  const slipRes = await pool.query<IntakeDispatchSlipRow>(
    `SELECT s.*, w.name AS warehouse_name, sup.name AS supplier_name, io.order_no
     FROM intake_dispatch_slips s
     JOIN warehouses w ON w.id = s.warehouse_id
     JOIN suppliers sup ON sup.id = s.supplier_id
     JOIN intake_operations io ON io.id = s.intake_operation_id
     WHERE s.id = $1 AND s.company_id = $2`,
    [id, companyId],
  );
  const slip = slipRes.rows[0];
  if (!slip) return null;

  const linesRes = await pool.query<IntakeDispatchSlipLineRow>(
    `SELECT l.id, l.slip_id, l.fabric_roll_id, l.unit_price, l.line_total,
            fr.barcode, fr.length_m, fi.name AS item_name, fc.name_ar AS color_name_ar
     FROM intake_dispatch_slip_lines l
     JOIN fabric_rolls fr ON fr.id = l.fabric_roll_id
     JOIN fabric_items fi ON fi.id = fr.item_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     WHERE l.slip_id = $1
     ORDER BY fr.barcode`,
    [id],
  );
  return { slip, lines: linesRes.rows };
}

const priceLinesSchema = z.object({
  lines: z.array(z.object({
    lineId: z.string().uuid(),
    unitPrice: z.number().min(0),
  })).min(1),
});

export async function updateDispatchSlipLinePrices(
  pool: Pool,
  companyId: string,
  slipId: string,
  raw: unknown,
): Promise<void> {
  const parsed = priceLinesSchema.safeParse(raw);
  if (!parsed.success) throw Object.assign(new Error('بيانات غير صالحة'), { code: 'VALIDATION', issues: parsed.error.issues });

  const slipCheck = await pool.query('SELECT id FROM intake_dispatch_slips WHERE id=$1 AND company_id=$2', [slipId, companyId]);
  if (!slipCheck.rows.length) throw Object.assign(new Error('الإرسالية غير موجودة'), { code: 'NOT_FOUND' });

  for (const line of parsed.data.lines) {
    await pool.query(
      `UPDATE intake_dispatch_slip_lines l
       SET unit_price = $1, line_total = ROUND($1 * fr.length_m, 2), updated_at = now()
       FROM fabric_rolls fr
       WHERE l.id = $2 AND l.slip_id = $3 AND fr.id = l.fabric_roll_id`,
      [line.unitPrice, line.lineId, slipId],
    );
  }
}
