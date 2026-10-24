import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { generateBarcode } from '../utils/rollHelpers.js';

const createReceiptSchema = z.object({
  returnedLengthM: z.coerce.number().nonnegative(),
  returnedWeightKg: z.coerce.number().nonnegative().optional().nullable(),
  destinationWarehouseId: z.string().uuid(),
  rollStatus: z.enum(['AVAILABLE', 'DAMAGED']).default('AVAILABLE'),
  notes: z.string().optional().nullable(),
});

export type ExternalJobReceiptRow = {
  id: string;
  company_id: string;
  job_id: string;
  returned_length_m: string;
  returned_weight_kg: string | null;
  destination_warehouse_id: string;
  destination_warehouse_name?: string;
  roll_status: 'AVAILABLE' | 'DAMAGED';
  result_roll_id: string | null;
  result_roll_barcode?: string | null;
  notes: string | null;
  received_by_user_id: string | null;
  received_at: string;
  shortage_approved_length_m: string;
  shortage_notes: string | null;
  shortage_approved_by_user_id: string | null;
  shortage_approved_at: string | null;
};

/**
 * استلام واحد فقط لكل مهمة مصنعية (job_id UNIQUE بقاعدة البيانات) — يسجّل
 * رجوع الخامة بالإجمالي، بدون استلام دفعات وبدون مطابقة باركودات الأتواب
 * الفردية المُرسلة. يُنشئ توباً واحداً جديداً بالمستودع والحالة المحدَّدين
 * يدوياً. متاح لموظف المستودع (لا تقييد صلاحية هنا) — التسعير غير مطروح
 * بهذا المسار إطلاقاً.
 */
export async function createExternalJobReceipt(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  jobId: string,
  raw: unknown,
): Promise<{ receipt: ExternalJobReceiptRow; sentLengthM: number; sentWeightKg: number }> {
  const input = createReceiptSchema.parse(raw);

  const jobRow = await client.query<{ supplier_id: string; job_no: string; document_status: string; job_kind: string }>(
    `SELECT supplier_id, job_no, document_status, job_kind FROM external_jobs WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [jobId, companyId],
  );
  if (!jobRow.rows.length) throw Object.assign(new Error('المهمة غير موجودة'), { code: 'NOT_FOUND' });
  const job = jobRow.rows[0];
  if (job.job_kind !== 'PROCESSING') {
    throw Object.assign(new Error('الاستلام الموحَّد متاح فقط لمهام المصنعية'), { code: 'VALIDATION' });
  }
  if (job.document_status !== 'CONFIRMED') {
    throw Object.assign(new Error('يجب تأكيد المهمة أولاً'), { code: 'INVALID_STATE' });
  }

  const existing = await client.query('SELECT id FROM external_job_receipts WHERE job_id=$1', [jobId]);
  if (existing.rows.length) {
    throw Object.assign(new Error('تم تسجيل استلام لهذه المهمة مسبقاً'), { code: 'INVALID_STATE' });
  }

  const whRow = await client.query<{ is_active: boolean }>(
    `SELECT is_active FROM warehouses WHERE id=$1 AND company_id=$2`,
    [input.destinationWarehouseId, companyId],
  );
  if (!whRow.rows.length) throw Object.assign(new Error('المستودع غير موجود'), { code: 'NOT_FOUND' });
  if (!whRow.rows[0].is_active) throw Object.assign(new Error('المستودع غير نشط'), { code: 'VALIDATION' });

  const linesRes = await client.query<{ sent_length_m: string | null; roll_weight_kg: string | null; item_id: string }>(
    `SELECT ejl.sent_length_m, COALESCE(fr.actual_weight_kg, fr.calculated_weight_kg) AS roll_weight_kg, fr.item_id
     FROM external_job_lines ejl
     JOIN fabric_rolls fr ON fr.id = ejl.roll_id AND fr.company_id = $2
     WHERE ejl.job_id = $1 AND ejl.line_status <> 'CANCELLED'`,
    [jobId, companyId],
  );
  if (!linesRes.rows.length) {
    throw Object.assign(new Error('لا توجد أتواب مُرسلة بهذه المهمة'), { code: 'VALIDATION' });
  }
  const sentLengthM = linesRes.rows.reduce((sum, l) => sum + (Number(l.sent_length_m) || 0), 0);
  const sentWeightKg = linesRes.rows.reduce((sum, l) => sum + (Number(l.roll_weight_kg) || 0), 0);
  // افتراض مُصرَّح به: الخامة الموحَّدة الناتجة تُصنَّف تحت خامة أول توب
  // مُرسَل — الحالة الشائعة أن كل أتواب مهمة واحدة من نفس الخامة؛ لا تُقسَّم
  // الكمية الراجعة على عدة خامات بهذا المسار المبسَّط.
  const itemId = linesRes.rows[0].item_id;

  const barcode = await generateBarcode(client, companyId);
  const rollIns = await client.query<{ id: string; barcode: string }>(
    `INSERT INTO fabric_rolls
       (company_id, barcode, item_id, supplier_id, warehouse_id, length_m,
        actual_weight_kg, notes, created_by_user_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, barcode`,
    [
      companyId, barcode, itemId, job.supplier_id, input.destinationWarehouseId, input.returnedLengthM,
      input.returnedWeightKg ?? null, `راجع من مهمة مصنعية ${job.job_no}`, userId, input.rollStatus,
    ],
  );
  const rollId = rollIns.rows[0].id;

  await client.query(
    `INSERT INTO inventory_movements (
       company_id, roll_id, movement_type, to_warehouse_id, new_status,
       length_delta_m, reference_type, reference_id, reference_no, notes, created_by_user_id
     ) VALUES ($1,$2,'EXTERNAL_JOB_RETURNED',$3,$4,$5,'EXTERNAL_JOB',$6,$7,$8,$9)`,
    [
      companyId, rollId, input.destinationWarehouseId, input.rollStatus,
      input.returnedLengthM, jobId, job.job_no, `استلام راجع من مهمة مصنعية ${job.job_no}`, userId,
    ],
  );

  const ins = await client.query<ExternalJobReceiptRow>(
    `INSERT INTO external_job_receipts (
       company_id, job_id, returned_length_m, returned_weight_kg, destination_warehouse_id,
       roll_status, result_roll_id, notes, received_by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      companyId, jobId, input.returnedLengthM, input.returnedWeightKg ?? null, input.destinationWarehouseId,
      input.rollStatus, rollId, input.notes ?? null, userId,
    ],
  );

  return { receipt: ins.rows[0], sentLengthM, sentWeightKg };
}

export async function getExternalJobReceipt(
  pool: Pool,
  companyId: string,
  jobId: string,
): Promise<{ receipt: ExternalJobReceiptRow | null; sentLengthM: number; sentWeightKg: number }> {
  const receiptRes = await pool.query<ExternalJobReceiptRow>(
    `SELECT r.*, w.name AS destination_warehouse_name, fr.barcode AS result_roll_barcode
     FROM external_job_receipts r
     LEFT JOIN warehouses w ON w.id = r.destination_warehouse_id
     LEFT JOIN fabric_rolls fr ON fr.id = r.result_roll_id
     WHERE r.job_id = $1 AND r.company_id = $2`,
    [jobId, companyId],
  );

  const linesRes = await pool.query<{ sent_length_m: string | null; roll_weight_kg: string | null }>(
    `SELECT ejl.sent_length_m, COALESCE(fr.actual_weight_kg, fr.calculated_weight_kg) AS roll_weight_kg
     FROM external_job_lines ejl
     JOIN fabric_rolls fr ON fr.id = ejl.roll_id AND fr.company_id = $2
     WHERE ejl.job_id = $1 AND ejl.line_status <> 'CANCELLED'`,
    [jobId, companyId],
  );
  const sentLengthM = linesRes.rows.reduce((sum, l) => sum + (Number(l.sent_length_m) || 0), 0);
  const sentWeightKg = linesRes.rows.reduce((sum, l) => sum + (Number(l.roll_weight_kg) || 0), 0);

  return { receipt: receiptRes.rows[0] ?? null, sentLengthM, sentWeightKg };
}

const approveShortageSchema = z.object({
  amountM: z.coerce.number().positive(),
  notes: z.string().optional().nullable(),
});

/** اعتماد الفرق (أو جزء منه) كفاقد — تسجيل/تقرير فقط، بلا أي أثر محاسبي أو حركة مخزون. */
export async function approveExternalJobReceiptShortage(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  jobId: string,
  raw: unknown,
): Promise<ExternalJobReceiptRow> {
  const input = approveShortageSchema.parse(raw);

  const receiptRes = await client.query<{ id: string; returned_length_m: string; shortage_approved_length_m: string }>(
    `SELECT id, returned_length_m, shortage_approved_length_m FROM external_job_receipts WHERE job_id=$1 AND company_id=$2 FOR UPDATE`,
    [jobId, companyId],
  );
  if (!receiptRes.rows.length) throw Object.assign(new Error('لا يوجد استلام مسجَّل لهذه المهمة'), { code: 'NOT_FOUND' });
  const receipt = receiptRes.rows[0];

  const linesRes = await client.query<{ sent_length_m: string | null }>(
    `SELECT ejl.sent_length_m FROM external_job_lines ejl WHERE ejl.job_id=$1 AND ejl.line_status <> 'CANCELLED'`,
    [jobId],
  );
  const sentLengthM = linesRes.rows.reduce((sum, l) => sum + (Number(l.sent_length_m) || 0), 0);
  const alreadyApproved = Number(receipt.shortage_approved_length_m) || 0;
  const openDifference = sentLengthM - Number(receipt.returned_length_m) - alreadyApproved;

  if (input.amountM > openDifference + 0.001) {
    throw Object.assign(
      new Error(`المبلغ المطلوب اعتماده (${input.amountM.toFixed(3)} م) أكبر من الفرق المفتوح فعلياً (${openDifference.toFixed(3)} م)`),
      { code: 'VALIDATION' },
    );
  }

  const upd = await client.query<ExternalJobReceiptRow>(
    `UPDATE external_job_receipts
     SET shortage_approved_length_m = shortage_approved_length_m + $3,
         shortage_notes = $4, shortage_approved_by_user_id = $5, shortage_approved_at = now(), updated_at = now()
     WHERE id = $1 AND company_id = $2
     RETURNING *`,
    [receipt.id, companyId, input.amountM, input.notes ?? null, userId],
  );
  return upd.rows[0];
}
