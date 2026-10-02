import type { PoolClient } from 'pg';
import { z } from 'zod';
import { findOrCreateColor } from './purchaseInvoiceService.js';
import { getExchangeRateToUsdTx } from './exchangeRateService.js';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';
import { postExternalJobFeeToGl, reverseExternalJobFeeGl } from './glPostingService.js';

type DbQuery = Pick<PoolClient, 'query'>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function cleanText(v: unknown): string {
  return String(v ?? '').trim();
}

const lineCreateSchema = z.object({
  rollId: z.string().uuid(),
});

const externalJobCreateSchema = z.object({
  supplierId: z.string().uuid(),
  sentDate: z.string().min(1).optional(),
  notes: z.string().optional().nullable(),
  feeAmount: z.coerce.number().nonnegative().optional().nullable(),
  feeCurrencyCode: z.string().min(1).optional().nullable(),
  lines: z.array(lineCreateSchema).min(1),
});

const receiveLineSchema = z.object({
  newColorName: z.string().optional().nullable(),
  newColorCode: z.string().optional().nullable(),
  newBarcode: z.string().optional().nullable(),
  newLengthM: z.coerce.number().nonnegative().optional().nullable(),
  receiptNotes: z.string().optional().nullable(),
});

async function assertSupplier(client: PoolClient, companyId: string, supplierId: string): Promise<void> {
  const r = await client.query(`SELECT id FROM suppliers WHERE id=$1 AND company_id=$2`, [supplierId, companyId]);
  if (!r.rows.length) throw Object.assign(new Error('المورد غير موجود'), { code: 'NOT_FOUND' });
}

export async function createExternalJob(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  raw: unknown,
): Promise<{ id: string; jobNo: string }> {
  const input = externalJobCreateSchema.parse(raw);
  await assertSupplier(client, companyId, input.supplierId);

  // Validate each roll belongs to this company and is currently available —
  // final enforcement happens again at confirm() since time may pass between
  // creating the draft and sending it.
  for (const ln of input.lines) {
    const r = await client.query<{ status: string }>(
      `SELECT status FROM fabric_rolls WHERE id=$1 AND company_id=$2`,
      [ln.rollId, companyId],
    );
    if (!r.rows.length) {
      throw Object.assign(new Error('الثوب غير موجود'), { code: 'NOT_FOUND' });
    }
    if (r.rows[0].status !== 'AVAILABLE') {
      throw Object.assign(new Error('أحد الأتواب المختارة غير متاح حالياً'), { code: 'INVALID_STOCK' });
    }
  }

  const jobNo = await generateSequentialDocumentNo(client, companyId, 'EXTERNAL_JOB');

  let feeExchangeRateToUsd: number | null = null;
  const feeCurrencyCode = input.feeCurrencyCode ? input.feeCurrencyCode.trim().toUpperCase() : null;
  if (input.feeAmount != null && feeCurrencyCode) {
    feeExchangeRateToUsd = feeCurrencyCode === 'USD' ? 1 : await getExchangeRateToUsdTx(client, companyId, feeCurrencyCode);
    if (!feeExchangeRateToUsd || feeExchangeRateToUsd <= 0) {
      throw Object.assign(new Error('سعر صرف غير صالح لعملة الأجرة'), { code: 'VALIDATION' });
    }
  }

  const ins = await client.query<{ id: string }>(
    `INSERT INTO external_jobs (
       company_id, job_no, supplier_id, sent_date, notes,
       fee_amount, fee_currency_code, fee_exchange_rate_to_usd, created_by_user_id
     ) VALUES ($1,$2,$3,COALESCE($4::date, current_date),$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      companyId,
      jobNo,
      input.supplierId,
      input.sentDate ?? null,
      cleanText(input.notes) || null,
      input.feeAmount ?? null,
      feeCurrencyCode,
      feeExchangeRateToUsd,
      userId,
    ],
  );
  const jobId = ins.rows[0].id;

  for (const ln of input.lines) {
    await client.query(
      `INSERT INTO external_job_lines (job_id, company_id, roll_id) VALUES ($1,$2,$3)`,
      [jobId, companyId, ln.rollId],
    );
  }

  return { id: jobId, jobNo };
}

export async function listExternalJobs(
  db: DbQuery,
  companyId: string,
  opts: { search?: string; supplierId?: string; documentStatus?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number },
): Promise<{ rows: unknown[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const conds: string[] = ['ej.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;

  if (opts.search?.trim()) {
    conds.push(`(ej.job_no ILIKE $${p} OR s.name ILIKE $${p})`);
    params.push(`%${opts.search.trim()}%`);
    p++;
  }
  if (opts.supplierId) {
    conds.push(`ej.supplier_id = $${p}::uuid`);
    params.push(opts.supplierId);
    p++;
  }
  if (opts.documentStatus === 'ALL') {
    /* no filter */
  } else if (opts.documentStatus && ['DRAFT', 'CONFIRMED', 'VOIDED'].includes(opts.documentStatus)) {
    conds.push(`ej.document_status = $${p}`);
    params.push(opts.documentStatus);
    p++;
  } else {
    conds.push(`ej.document_status <> 'VOIDED'`);
  }
  if (opts.dateFrom) {
    conds.push(`ej.sent_date >= $${p}::date`);
    params.push(opts.dateFrom);
    p++;
  }
  if (opts.dateTo) {
    conds.push(`ej.sent_date <= $${p}::date`);
    params.push(opts.dateTo);
    p++;
  }

  const where = conds.join(' AND ');
  const [rows, countRow] = await Promise.all([
    db.query(
      `SELECT ej.*, s.name AS supplier_name,
              (SELECT COUNT(*)::int FROM external_job_lines l WHERE l.job_id = ej.id) AS line_count,
              (SELECT COUNT(*)::int FROM external_job_lines l WHERE l.job_id = ej.id AND l.line_status = 'RECEIVED') AS received_count
       FROM external_jobs ej
       INNER JOIN suppliers s ON s.id = ej.supplier_id AND s.company_id = ej.company_id
       WHERE ${where}
       ORDER BY ej.sent_date DESC, ej.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, pageSize, offset],
    ),
    db.query(
      `SELECT COUNT(*)::int AS total
       FROM external_jobs ej
       INNER JOIN suppliers s ON s.id = ej.supplier_id AND s.company_id = ej.company_id
       WHERE ${where}`,
      params,
    ),
  ]);

  return { rows: rows.rows, total: countRow.rows[0].total, page, pageSize };
}

const LINE_SELECT = `
  l.id, l.job_id, l.roll_id, l.line_status,
  l.sent_color_id, l.sent_length_m, l.sent_barcode,
  l.received_at, l.received_by_user_id,
  l.new_color_id, l.new_barcode, l.new_length_m, l.receipt_notes,
  fr.barcode AS current_barcode, fr.status AS roll_status, fr.length_m AS current_length_m,
  fi.name AS item_name, fi.internal_code AS item_internal_code,
  fc.name_ar AS current_color_name_ar, fc.color_code AS current_color_code,
  nc.name_ar AS new_color_name_ar, nc.color_code AS new_color_code,
  sc.name_ar AS sent_color_name_ar, sc.color_code AS sent_color_code
`;

export async function getExternalJobById(
  db: DbQuery,
  companyId: string,
  id: string,
): Promise<{ header: Record<string, unknown>; lines: Record<string, unknown>[] } | null> {
  const h = await db.query(
    `SELECT ej.*, s.name AS supplier_name
     FROM external_jobs ej
     INNER JOIN suppliers s ON s.id = ej.supplier_id AND s.company_id = ej.company_id
     WHERE ej.id=$1 AND ej.company_id=$2`,
    [id, companyId],
  );
  if (!h.rows.length) return null;

  const lines = await db.query(
    `SELECT ${LINE_SELECT}
     FROM external_job_lines l
     LEFT JOIN fabric_rolls fr ON fr.id = l.roll_id AND fr.company_id = l.company_id
     LEFT JOIN fabric_items fi ON fi.id = fr.item_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     LEFT JOIN fabric_colors nc ON nc.id = l.new_color_id
     LEFT JOIN fabric_colors sc ON sc.id = l.sent_color_id
     WHERE l.job_id=$1 AND l.company_id=$2
     ORDER BY l.created_at`,
    [id, companyId],
  );

  return { header: h.rows[0] as Record<string, unknown>, lines: lines.rows as Record<string, unknown>[] };
}

export async function confirmExternalJob(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  jobId: string,
): Promise<void> {
  const jobRow = await client.query(
    `SELECT * FROM external_jobs WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [jobId, companyId],
  );
  if (!jobRow.rows.length) throw Object.assign(new Error('المهمة غير موجودة'), { code: 'NOT_FOUND' });
  const job = jobRow.rows[0];
  if (job.document_status !== 'DRAFT') {
    throw Object.assign(new Error('المهمة مؤكدة أو ملغاة مسبقاً'), { code: 'INVALID_STATE' });
  }

  const lines = await client.query(
    `SELECT l.id, l.roll_id, fr.barcode, fr.status, fr.color_id, fr.length_m
     FROM external_job_lines l
     INNER JOIN fabric_rolls fr ON fr.id = l.roll_id AND fr.company_id = l.company_id
     WHERE l.job_id=$1 AND l.company_id=$2
     FOR UPDATE OF fr`,
    [jobId, companyId],
  );

  for (const ln of lines.rows) {
    if (ln.status !== 'AVAILABLE') {
      throw Object.assign(
        new Error(`الثوب ${ln.barcode} غير متاح حالياً (الحالة: ${ln.status}) — لا يمكن إرساله.`),
        { code: 'INVALID_STOCK' },
      );
    }
  }

  for (const ln of lines.rows) {
    await client.query(
      `UPDATE external_job_lines
       SET sent_color_id=$3, sent_length_m=$4, sent_barcode=$5
       WHERE id=$1 AND company_id=$2`,
      [ln.id, companyId, ln.color_id, ln.length_m, ln.barcode],
    );
    await client.query(
      `UPDATE fabric_rolls SET status='AT_EXTERNAL_JOB', updated_at=now() WHERE id=$1 AND company_id=$2`,
      [ln.roll_id, companyId],
    );
    await client.query(
      `INSERT INTO inventory_movements (
         company_id, roll_id, movement_type, old_status, new_status,
         reference_type, reference_id, reference_no, notes, created_by_user_id
       ) VALUES ($1,$2,'EXTERNAL_JOB_SENT','AVAILABLE','AT_EXTERNAL_JOB',$3,$4,$5,$6,$7)`,
      [companyId, ln.roll_id, 'EXTERNAL_JOB', jobId, String(job.job_no), `إرسال لمهمة خارجية ${job.job_no}`, userId],
    );
  }

  await client.query(
    `UPDATE external_jobs SET document_status='CONFIRMED', updated_at=now() WHERE id=$1 AND company_id=$2`,
    [jobId, companyId],
  );
}

export async function receiveExternalJobLine(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  lineId: string,
  raw: unknown,
): Promise<void> {
  const input = receiveLineSchema.parse(raw);

  const lineRow = await client.query(
    `SELECT l.*, ej.document_status AS job_status, ej.job_no
     FROM external_job_lines l
     INNER JOIN external_jobs ej ON ej.id = l.job_id AND ej.company_id = l.company_id
     WHERE l.id=$1 AND l.company_id=$2 FOR UPDATE OF l`,
    [lineId, companyId],
  );
  if (!lineRow.rows.length) throw Object.assign(new Error('سطر المهمة غير موجود'), { code: 'NOT_FOUND' });
  const line = lineRow.rows[0];
  if (line.job_status !== 'CONFIRMED') {
    throw Object.assign(new Error('المهمة ليست مؤكدة بعد'), { code: 'INVALID_STATE' });
  }
  if (line.line_status !== 'SENT') {
    throw Object.assign(new Error('تم استلام هذا السطر مسبقاً'), { code: 'INVALID_STATE' });
  }

  const rollRow = await client.query(
    `SELECT id, barcode, status, length_m FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [line.roll_id, companyId],
  );
  if (!rollRow.rows.length) throw Object.assign(new Error('الثوب غير موجود'), { code: 'NOT_FOUND' });
  const roll = rollRow.rows[0];
  if (roll.status !== 'AT_EXTERNAL_JOB') {
    throw Object.assign(new Error('الثوب ليس بحالة "مهمة خارجية" حالياً'), { code: 'INVALID_STATE' });
  }

  const newColorId = await findOrCreateColor(
    client,
    companyId,
    cleanText(input.newColorName),
    cleanText(input.newColorCode),
  );

  let newBarcode: string | null = null;
  const requestedBarcode = cleanText(input.newBarcode);
  if (requestedBarcode && requestedBarcode !== roll.barcode) {
    const dup = await client.query(
      `SELECT id FROM fabric_rolls WHERE company_id=$1 AND barcode=$2 AND id<>$3`,
      [companyId, requestedBarcode, roll.id],
    );
    if (dup.rows.length) {
      throw Object.assign(new Error('هذا الباركود مستخدم بثوب آخر'), { code: 'VALIDATION' });
    }
    newBarcode = requestedBarcode;
  }

  const newLengthM = input.newLengthM != null ? input.newLengthM : null;

  await client.query(
    `UPDATE fabric_rolls
     SET color_id = COALESCE($3, color_id),
         barcode = COALESCE($4, barcode),
         length_m = COALESCE($5, length_m),
         status = 'AVAILABLE',
         updated_at = now()
     WHERE id=$1 AND company_id=$2`,
    [roll.id, companyId, newColorId, newBarcode, newLengthM],
  );

  await client.query(
    `INSERT INTO inventory_movements (
       company_id, roll_id, movement_type, old_status, new_status,
       length_delta_m, reference_type, reference_id, reference_no, notes, created_by_user_id
     ) VALUES ($1,$2,'EXTERNAL_JOB_RETURNED','AT_EXTERNAL_JOB','AVAILABLE',$3,$4,$5,$6,$7,$8)`,
    [
      companyId,
      roll.id,
      newLengthM != null ? round2(newLengthM - Number(roll.length_m || 0)) : null,
      'EXTERNAL_JOB',
      line.job_id,
      String(line.job_no),
      `استلام من مهمة خارجية ${line.job_no}`,
      userId,
    ],
  );

  await client.query(
    `UPDATE external_job_lines
     SET line_status='RECEIVED', received_at=now(), received_by_user_id=$3,
         new_color_id=$4, new_barcode=$5, new_length_m=$6, receipt_notes=$7
     WHERE id=$1 AND company_id=$2`,
    [lineId, companyId, userId, newColorId, newBarcode, newLengthM, cleanText(input.receiptNotes) || null],
  );
}

export async function setExternalJobFee(
  client: PoolClient,
  companyId: string,
  jobId: string,
  raw: unknown,
): Promise<void> {
  const schema = z.object({
    feeAmount: z.coerce.number().nonnegative(),
    feeCurrencyCode: z.string().min(1),
  });
  const input = schema.parse(raw);

  const jobRow = await client.query(
    `SELECT fee_posted_at FROM external_jobs WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [jobId, companyId],
  );
  if (!jobRow.rows.length) throw Object.assign(new Error('المهمة غير موجودة'), { code: 'NOT_FOUND' });
  if (jobRow.rows[0].fee_posted_at) {
    throw Object.assign(new Error('تم ترحيل الأجرة محاسبياً — لا يمكن تعديلها الآن'), { code: 'INVALID_STATE' });
  }

  const currencyCode = input.feeCurrencyCode.trim().toUpperCase();
  const exchangeRateToUsd = currencyCode === 'USD' ? 1 : await getExchangeRateToUsdTx(client, companyId, currencyCode);
  if (!exchangeRateToUsd || exchangeRateToUsd <= 0) {
    throw Object.assign(new Error('سعر صرف غير صالح لعملة الأجرة'), { code: 'VALIDATION' });
  }

  await client.query(
    `UPDATE external_jobs
     SET fee_amount=$3, fee_currency_code=$4, fee_exchange_rate_to_usd=$5, updated_at=now()
     WHERE id=$1 AND company_id=$2`,
    [jobId, companyId, input.feeAmount, currencyCode, exchangeRateToUsd],
  );
}

export async function postExternalJobFee(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  jobId: string,
): Promise<void> {
  const jobRow = await client.query(
    `SELECT * FROM external_jobs WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [jobId, companyId],
  );
  if (!jobRow.rows.length) throw Object.assign(new Error('المهمة غير موجودة'), { code: 'NOT_FOUND' });
  const job = jobRow.rows[0];
  if (job.document_status !== 'CONFIRMED') {
    throw Object.assign(new Error('يجب تأكيد المهمة أولاً'), { code: 'INVALID_STATE' });
  }
  if (job.fee_amount == null || job.fee_currency_code == null) {
    throw Object.assign(new Error('أدخل الأجرة وعملتها أولاً'), { code: 'VALIDATION' });
  }
  if (job.fee_posted_at) {
    throw Object.assign(new Error('تم ترحيل الأجرة مسبقاً'), { code: 'INVALID_STATE' });
  }

  const feeAmountUsd = round2(Number(job.fee_amount) / Number(job.fee_exchange_rate_to_usd || 1));

  await postExternalJobFeeToGl(client, {
    companyId,
    jobId,
    jobNo: String(job.job_no),
    feeDate: String(job.sent_date),
    supplierId: String(job.supplier_id),
    feeAmountUsd,
    userId,
  });

  await client.query(
    `UPDATE external_jobs SET fee_posted_at=now(), updated_at=now() WHERE id=$1 AND company_id=$2`,
    [jobId, companyId],
  );
}

export async function voidExternalJob(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  jobId: string,
  reason: string | null,
): Promise<void> {
  const jobRow = await client.query(
    `SELECT * FROM external_jobs WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [jobId, companyId],
  );
  if (!jobRow.rows.length) throw Object.assign(new Error('المهمة غير موجودة'), { code: 'NOT_FOUND' });
  const job = jobRow.rows[0];
  if (job.document_status === 'VOIDED') {
    throw Object.assign(new Error('المهمة ملغاة مسبقاً'), { code: 'INVALID_STATE' });
  }

  if (job.document_status === 'DRAFT') {
    await client.query(`DELETE FROM external_job_lines WHERE job_id=$1 AND company_id=$2`, [jobId, companyId]);
    await client.query(`DELETE FROM external_jobs WHERE id=$1 AND company_id=$2`, [jobId, companyId]);
    return;
  }

  const lines = await client.query(
    `SELECT l.id, l.roll_id, l.line_status, fr.status AS roll_status
     FROM external_job_lines l
     INNER JOIN fabric_rolls fr ON fr.id = l.roll_id AND fr.company_id = l.company_id
     WHERE l.job_id=$1 AND l.company_id=$2 FOR UPDATE OF fr`,
    [jobId, companyId],
  );
  const anyReceived = lines.rows.some((r) => r.line_status !== 'SENT');
  if (anyReceived) {
    throw Object.assign(
      new Error('لا يمكن إلغاء مهمة استُلم منها سطر واحد على الأقل'),
      { code: 'INVALID_STATE' },
    );
  }

  for (const ln of lines.rows) {
    await client.query(
      `UPDATE fabric_rolls SET status='AVAILABLE', updated_at=now() WHERE id=$1 AND company_id=$2`,
      [ln.roll_id, companyId],
    );
    await client.query(
      `INSERT INTO inventory_movements (
         company_id, roll_id, movement_type, old_status, new_status,
         reference_type, reference_id, reference_no, notes, created_by_user_id
       ) VALUES ($1,$2,'STATUS_CHANGE','AT_EXTERNAL_JOB','AVAILABLE',$3,$4,$5,$6,$7)`,
      [companyId, ln.roll_id, 'EXTERNAL_JOB_VOID', jobId, String(job.job_no), `إلغاء مهمة خارجية ${job.job_no}`, userId],
    );
  }

  if (job.fee_posted_at) {
    await reverseExternalJobFeeGl(client, {
      companyId,
      jobId,
      jobNo: String(job.job_no),
      userId,
    });
  }

  await client.query(
    `UPDATE external_jobs SET document_status='VOIDED', notes=COALESCE($3, notes), updated_at=now() WHERE id=$1 AND company_id=$2`,
    [jobId, companyId, reason ? `ملغاة: ${reason}` : null],
  );
}
