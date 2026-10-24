import type { PoolClient } from 'pg';
import { z } from 'zod';
import { findOrCreateColor } from './purchaseInvoiceService.js';
import { getExchangeRateToUsdTx } from './exchangeRateService.js';
import { generateSequentialDocumentNo, generateSupplierOrderNo } from '../utils/documentNumbers.js';
import { postExternalJobFeeToGl, reverseExternalJobFeeGl } from './glPostingService.js';
import { verifyCurrentUserPassword } from '../utils/reauthGuard.js';

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

/**
 * ينقل توباً واحداً إلى حالة "مهمة خارجية" ويكتب حركة المخزون المقابلة —
 * نفس الشكل المستخدَم بالضبط بـconfirmExternalJob، مُستخرَج كدالة واحدة
 * ليُستدعى أيضاً من إنشاء مهمة "مصنعية" (CONFIRMED مباشرة) دون تكرار الاستعلامات.
 */
async function sendRollToExternalJob(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  rollId: string,
  jobId: string,
  jobNo: string,
): Promise<void> {
  await client.query(
    `UPDATE fabric_rolls SET status='AT_EXTERNAL_JOB', updated_at=now() WHERE id=$1 AND company_id=$2`,
    [rollId, companyId],
  );
  await client.query(
    `INSERT INTO inventory_movements (
       company_id, roll_id, movement_type, old_status, new_status,
       reference_type, reference_id, reference_no, notes, created_by_user_id
     ) VALUES ($1,$2,'EXTERNAL_JOB_SENT','AVAILABLE','AT_EXTERNAL_JOB',$3,$4,$5,$6,$7)`,
    [companyId, rollId, 'EXTERNAL_JOB', jobId, jobNo, `إرسال لمهمة خارجية ${jobNo}`, userId],
  );
}

async function insertAuditLog(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  action: string,
  entityId: string,
  details: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, 'external_job', $4, $5::jsonb)`,
    [companyId, userId, action, entityId, JSON.stringify(details)],
  );
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
  opts: { search?: string; supplierId?: string; documentStatus?: string; dateFrom?: string; dateTo?: string; jobKind?: string; page?: number; pageSize?: number },
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
  if (opts.jobKind && ['GENERAL', 'PROCESSING'].includes(opts.jobKind)) {
    conds.push(`ej.job_kind = $${p}`);
    params.push(opts.jobKind);
    p++;
  }

  const where = conds.join(' AND ');
  const [rows, countRow] = await Promise.all([
    db.query(
      `SELECT ej.*, s.name AS supplier_name,
              pt.name AS preparation_type_name, w.name AS source_warehouse_name,
              (SELECT COUNT(*)::int FROM external_job_lines l WHERE l.job_id = ej.id) AS line_count,
              (SELECT COUNT(*)::int FROM external_job_lines l WHERE l.job_id = ej.id AND l.line_status = 'RECEIVED') AS received_count
       FROM external_jobs ej
       INNER JOIN suppliers s ON s.id = ej.supplier_id AND s.company_id = ej.company_id
       LEFT JOIN external_job_preparation_types pt ON pt.id = ej.preparation_type_id AND pt.company_id = ej.company_id
       LEFT JOIN warehouses w ON w.id = ej.source_warehouse_id AND w.company_id = ej.company_id
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
  fr.width_cm AS roll_width_cm, fr.gsm AS roll_gsm,
  COALESCE(fr.actual_weight_kg, fr.calculated_weight_kg) AS roll_weight_kg,
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
    `SELECT ej.*, s.name AS supplier_name, s.phone AS supplier_phone,
            pt.name AS preparation_type_name, pt.default_waste_pct AS preparation_type_default_waste_pct,
            w.name AS source_warehouse_name
     FROM external_jobs ej
     INNER JOIN suppliers s ON s.id = ej.supplier_id AND s.company_id = ej.company_id
     LEFT JOIN external_job_preparation_types pt ON pt.id = ej.preparation_type_id AND pt.company_id = ej.company_id
     LEFT JOIN warehouses w ON w.id = ej.source_warehouse_id AND w.company_id = ej.company_id
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
    await sendRollToExternalJob(client, companyId, userId, ln.roll_id, jobId, String(job.job_no));
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

/**
 * تسعير مهمة "مصنعية" بالكيلو أو بالمتر — الإجمالي (fee_amount) يُحسَب هنا
 * من الكمية المعتمدة للحساب × سعر الوحدة (لا من كمية الأتواب المرسلة
 * فعلياً، التي تبقى بسطور المهمة دون أي تغيير). ترحيل الأجرة محاسبياً
 * (postExternalJobFee) يستمر يقرأ fee_amount كما هو بلا أي تعديل.
 */
export async function setExternalJobProcessingPricing(
  client: PoolClient,
  companyId: string,
  jobId: string,
  raw: unknown,
): Promise<void> {
  const schema = z.object({
    pricingMethod: z.enum(['BY_KG', 'BY_METER']),
    approvedQuantity: z.coerce.number().nonnegative(),
    unitPrice: z.coerce.number().nonnegative(),
    feeCurrencyCode: z.string().min(1),
  });
  const input = schema.parse(raw);

  const jobRow = await client.query(
    `SELECT job_kind, fee_posted_at FROM external_jobs WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [jobId, companyId],
  );
  if (!jobRow.rows.length) throw Object.assign(new Error('المهمة غير موجودة'), { code: 'NOT_FOUND' });
  if (jobRow.rows[0].job_kind !== 'PROCESSING') {
    throw Object.assign(new Error('التسعير بالكمية متاح فقط لمهام المصنعية'), { code: 'VALIDATION' });
  }
  if (jobRow.rows[0].fee_posted_at) {
    throw Object.assign(new Error('تم ترحيل الأجرة محاسبياً — لا يمكن تعديلها الآن'), { code: 'INVALID_STATE' });
  }

  const currencyCode = input.feeCurrencyCode.trim().toUpperCase();
  const exchangeRateToUsd = currencyCode === 'USD' ? 1 : await getExchangeRateToUsdTx(client, companyId, currencyCode);
  if (!exchangeRateToUsd || exchangeRateToUsd <= 0) {
    throw Object.assign(new Error('سعر صرف غير صالح لعملة الأجرة'), { code: 'VALIDATION' });
  }

  const feeAmount = round2(input.approvedQuantity * input.unitPrice);

  await client.query(
    `UPDATE external_jobs
     SET pricing_method=$3, approved_quantity=$4, unit_price=$5,
         fee_amount=$6, fee_currency_code=$7, fee_exchange_rate_to_usd=$8, updated_at=now()
     WHERE id=$1 AND company_id=$2`,
    [jobId, companyId, input.pricingMethod, input.approvedQuantity, input.unitPrice, feeAmount, currencyCode, exchangeRateToUsd],
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

// ─── "مصنعية" (Processing) — نفس جدول external_jobs، job_kind='PROCESSING' ─────

const prepTypeCreateSchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  defaultWastePct: z.coerce.number().min(0).max(100).optional().nullable(),
});

const prepTypeUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  defaultWastePct: z.coerce.number().min(0).max(100).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function listPreparationTypes(
  db: DbQuery,
  companyId: string,
  includeInactive: boolean,
): Promise<Record<string, unknown>[]> {
  const where = includeInactive ? 'company_id=$1' : 'company_id=$1 AND is_active=true';
  const rows = await db.query(
    `SELECT id, name, default_waste_pct, is_active, created_at, updated_at
     FROM external_job_preparation_types WHERE ${where} ORDER BY name ASC`,
    [companyId],
  );
  return rows.rows as Record<string, unknown>[];
}

export async function createPreparationType(
  db: DbQuery,
  companyId: string,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = prepTypeCreateSchema.parse(raw);
  const name = input.name.trim();
  const dup = await db.query(
    `SELECT id FROM external_job_preparation_types WHERE company_id=$1 AND lower(name)=lower($2)`,
    [companyId, name],
  );
  if (dup.rows.length) {
    throw Object.assign(new Error('يوجد نوع تجهيز بنفس الاسم مسبقاً'), { code: 'DUPLICATE' });
  }
  const row = await db.query(
    `INSERT INTO external_job_preparation_types (company_id, name, default_waste_pct)
     VALUES ($1,$2,$3)
     RETURNING id, name, default_waste_pct, is_active, created_at, updated_at`,
    [companyId, name, input.defaultWastePct ?? null],
  );
  return row.rows[0];
}

export async function updatePreparationType(
  db: DbQuery,
  companyId: string,
  id: string,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = prepTypeUpdateSchema.parse(raw);
  const existing = await db.query(
    `SELECT id, name, default_waste_pct, is_active FROM external_job_preparation_types WHERE id=$1 AND company_id=$2`,
    [id, companyId],
  );
  if (!existing.rows.length) throw Object.assign(new Error('نوع التجهيز غير موجود'), { code: 'NOT_FOUND' });

  const nextName = input.name !== undefined ? input.name.trim() : existing.rows[0].name;
  if (!nextName) throw Object.assign(new Error('الاسم مطلوب'), { code: 'VALIDATION' });
  if (input.name !== undefined) {
    const dup = await db.query(
      `SELECT id FROM external_job_preparation_types WHERE company_id=$1 AND lower(name)=lower($2) AND id<>$3`,
      [companyId, nextName, id],
    );
    if (dup.rows.length) {
      throw Object.assign(new Error('يوجد نوع تجهيز بنفس الاسم مسبقاً'), { code: 'DUPLICATE' });
    }
  }
  const nextWaste = input.defaultWastePct !== undefined ? input.defaultWastePct : existing.rows[0].default_waste_pct;
  const nextActive = input.isActive !== undefined ? input.isActive : existing.rows[0].is_active;

  const row = await db.query(
    `UPDATE external_job_preparation_types
     SET name=$3, default_waste_pct=$4, is_active=$5, updated_at=now()
     WHERE id=$1 AND company_id=$2
     RETURNING id, name, default_waste_pct, is_active, created_at, updated_at`,
    [id, companyId, nextName, nextWaste, nextActive],
  );
  return row.rows[0];
}

const processingCreateSchema = z.object({
  supplierId: z.string().uuid(),
  fabricStage: z.enum(['RAW', 'FINISHED']),
  preparationTypeId: z.string().uuid(),
  sourceWarehouseId: z.string().uuid(),
  processDescription: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  rollIds: z.array(z.string().uuid()).min(1),
});

export async function createProcessingExternalJob(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  raw: unknown,
): Promise<{
  id: string;
  jobNo: string;
  supplierOrderNo: number;
  totalRolls: number;
  totalM: number;
  totalKg: number;
}> {
  const input = processingCreateSchema.parse(raw);
  const rollIds = [...new Set(input.rollIds)];

  const supplierRow = await client.query<{ is_processing_party: boolean; is_active: boolean }>(
    `SELECT is_processing_party, is_active FROM suppliers WHERE id=$1 AND company_id=$2`,
    [input.supplierId, companyId],
  );
  if (!supplierRow.rows.length) throw Object.assign(new Error('المورد غير موجود'), { code: 'NOT_FOUND' });
  if (!supplierRow.rows[0].is_processing_party) {
    throw Object.assign(new Error('هذا المورد ليس جهة تجهيز (مصبغة/مطبعة)'), { code: 'VALIDATION' });
  }
  if (!supplierRow.rows[0].is_active) {
    throw Object.assign(new Error('هذا المورد غير نشط'), { code: 'VALIDATION' });
  }

  const prepRow = await client.query<{ is_active: boolean }>(
    `SELECT is_active FROM external_job_preparation_types WHERE id=$1 AND company_id=$2`,
    [input.preparationTypeId, companyId],
  );
  if (!prepRow.rows.length) throw Object.assign(new Error('نوع التجهيز غير موجود'), { code: 'NOT_FOUND' });
  if (!prepRow.rows[0].is_active) {
    throw Object.assign(new Error('نوع التجهيز غير فعّال'), { code: 'VALIDATION' });
  }

  const whRow = await client.query<{ is_active: boolean; fabric_stage: string | null }>(
    `SELECT is_active, fabric_stage FROM warehouses WHERE id=$1 AND company_id=$2`,
    [input.sourceWarehouseId, companyId],
  );
  if (!whRow.rows.length) throw Object.assign(new Error('المستودع غير موجود'), { code: 'NOT_FOUND' });
  if (!whRow.rows[0].is_active) {
    throw Object.assign(new Error('المستودع غير نشط'), { code: 'VALIDATION' });
  }
  if (whRow.rows[0].fabric_stage !== input.fabricStage) {
    const current = whRow.rows[0].fabric_stage;
    throw Object.assign(
      new Error(
        current == null
          ? 'هذا المستودع غير مُصنَّف (خام/جاهز) بعد — صنّفه أولاً من إعدادات المستودعات'
          : `هذا المستودع مُصنَّف "${current === 'RAW' ? 'خام' : 'جاهز'}" ولا يطابق مرحلة المهمة المختارة`,
      ),
      { code: 'VALIDATION' },
    );
  }

  const rollsRes = await client.query<{
    id: string;
    barcode: string;
    status: string;
    warehouse_id: string;
    length_m: string;
    color_id: string | null;
    actual_weight_kg: string | null;
    calculated_weight_kg: string | null;
  }>(
    `SELECT id, barcode, status, warehouse_id, length_m, color_id, actual_weight_kg, calculated_weight_kg
     FROM fabric_rolls WHERE company_id=$1 AND id = ANY($2::uuid[]) FOR UPDATE`,
    [companyId, rollIds],
  );
  const rollsById = new Map(rollsRes.rows.map((r) => [r.id, r]));

  for (const rollId of rollIds) {
    const roll = rollsById.get(rollId);
    if (!roll) {
      throw Object.assign(new Error('أحد الأتواب المختارة غير موجود بهذه الشركة'), { code: 'NOT_FOUND' });
    }
    if (roll.warehouse_id !== input.sourceWarehouseId) {
      throw Object.assign(new Error(`الثوب ${roll.barcode} ليس بالمستودع المصدر المحدَّد`), { code: 'INVALID_STOCK' });
    }
    if (roll.status !== 'AVAILABLE') {
      throw Object.assign(
        new Error(`الثوب ${roll.barcode} غير متاح حالياً (الحالة: ${roll.status})`),
        { code: 'INVALID_STOCK' },
      );
    }
    if (Number(roll.length_m) <= 0) {
      throw Object.assign(new Error(`الثوب ${roll.barcode} بطول صفر — لا يمكن إرساله`), { code: 'INVALID_STOCK' });
    }
    const openLine = await client.query(
      `SELECT 1 FROM external_job_lines WHERE company_id=$1 AND roll_id=$2 AND line_status='SENT'`,
      [companyId, rollId],
    );
    if (openLine.rows.length) {
      throw Object.assign(
        new Error(`الثوب ${roll.barcode} مرتبط بمهمة خارجية مفتوحة أخرى`),
        { code: 'INVALID_STOCK' },
      );
    }
  }

  const jobNo = await generateSequentialDocumentNo(client, companyId, 'EXTERNAL_JOB');
  const supplierOrderNo = await generateSupplierOrderNo(client, companyId, input.supplierId);

  const ins = await client.query<{ id: string }>(
    `INSERT INTO external_jobs (
       company_id, job_no, supplier_id, sent_date, notes, document_status,
       job_kind, fabric_stage, preparation_type_id, source_warehouse_id,
       supplier_order_no, process_description, created_by_user_id
     ) VALUES ($1,$2,$3,current_date,$4,'CONFIRMED','PROCESSING',$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      companyId,
      jobNo,
      input.supplierId,
      cleanText(input.notes) || null,
      input.fabricStage,
      input.preparationTypeId,
      input.sourceWarehouseId,
      supplierOrderNo,
      cleanText(input.processDescription) || null,
      userId,
    ],
  );
  const jobId = ins.rows[0].id;

  let totalM = 0;
  let totalKg = 0;
  for (const rollId of rollIds) {
    const roll = rollsById.get(rollId)!;
    totalM += Number(roll.length_m);
    totalKg += Number(roll.actual_weight_kg ?? roll.calculated_weight_kg ?? 0);

    await client.query(
      `INSERT INTO external_job_lines (job_id, company_id, roll_id, sent_color_id, sent_length_m, sent_barcode, line_status)
       VALUES ($1,$2,$3,$4,$5,$6,'SENT')`,
      [jobId, companyId, rollId, roll.color_id, roll.length_m, roll.barcode],
    );
    await sendRollToExternalJob(client, companyId, userId, rollId, jobId, jobNo);
  }

  return {
    id: jobId,
    jobNo,
    supplierOrderNo,
    totalRolls: rollIds.length,
    totalM: round2(totalM),
    totalKg: round2(totalKg),
  };
}

const processingEditSchema = z.object({
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
  processDescription: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  preparationTypeId: z.string().uuid().optional(),
});

export async function editProcessingExternalJob(
  client: PoolClient,
  companyId: string,
  userId: string,
  jobId: string,
  raw: unknown,
): Promise<void> {
  const input = processingEditSchema.parse(raw);
  await verifyCurrentUserPassword(client, userId, input.password);

  const jobRow = await client.query(
    `SELECT * FROM external_jobs WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [jobId, companyId],
  );
  if (!jobRow.rows.length) throw Object.assign(new Error('المهمة غير موجودة'), { code: 'NOT_FOUND' });
  const job = jobRow.rows[0];
  if (job.job_kind !== 'PROCESSING') {
    throw Object.assign(new Error('هذا الإجراء خاص بمهام المصنعية فقط'), { code: 'VALIDATION' });
  }
  const anyNotSent = await client.query(
    `SELECT 1 FROM external_job_lines WHERE job_id=$1 AND company_id=$2 AND line_status<>'SENT' LIMIT 1`,
    [jobId, companyId],
  );
  if (anyNotSent.rows.length) {
    throw Object.assign(new Error('لا يمكن تعديل مهمة بدأ استلام أتوابها'), { code: 'INVALID_STATE' });
  }

  if (input.preparationTypeId) {
    const prepRow = await client.query<{ is_active: boolean }>(
      `SELECT is_active FROM external_job_preparation_types WHERE id=$1 AND company_id=$2`,
      [input.preparationTypeId, companyId],
    );
    if (!prepRow.rows.length) throw Object.assign(new Error('نوع التجهيز غير موجود'), { code: 'NOT_FOUND' });
    if (!prepRow.rows[0].is_active) throw Object.assign(new Error('نوع التجهيز غير فعّال'), { code: 'VALIDATION' });
  }

  const before = {
    processDescription: job.process_description,
    notes: job.notes,
    preparationTypeId: job.preparation_type_id,
  };

  await client.query(
    `UPDATE external_jobs
     SET process_description = COALESCE($3, process_description),
         notes = COALESCE($4, notes),
         preparation_type_id = COALESCE($5, preparation_type_id),
         updated_at = now()
     WHERE id=$1 AND company_id=$2`,
    [
      jobId,
      companyId,
      input.processDescription !== undefined ? cleanText(input.processDescription) || null : null,
      input.notes !== undefined ? cleanText(input.notes) || null : null,
      input.preparationTypeId ?? null,
    ],
  );

  await insertAuditLog(client, companyId, userId, 'EXTERNAL_JOB_PROCESSING_EDIT', jobId, {
    before,
    after: {
      processDescription: input.processDescription ?? before.processDescription,
      notes: input.notes ?? before.notes,
      preparationTypeId: input.preparationTypeId ?? before.preparationTypeId,
    },
  });
}

const processingVoidSchema = z.object({
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
  reason: z.string().optional().nullable(),
});

export async function voidProcessingExternalJob(
  client: PoolClient,
  companyId: string,
  userId: string,
  jobId: string,
  raw: unknown,
): Promise<void> {
  const input = processingVoidSchema.parse(raw);
  await verifyCurrentUserPassword(client, userId, input.password);

  const jobRow = await client.query(
    `SELECT job_kind FROM external_jobs WHERE id=$1 AND company_id=$2`,
    [jobId, companyId],
  );
  if (!jobRow.rows.length) throw Object.assign(new Error('المهمة غير موجودة'), { code: 'NOT_FOUND' });
  if (jobRow.rows[0].job_kind !== 'PROCESSING') {
    throw Object.assign(new Error('هذا الإجراء خاص بمهام المصنعية فقط'), { code: 'VALIDATION' });
  }

  const linesBefore = await client.query<{ roll_id: string }>(
    `SELECT roll_id FROM external_job_lines WHERE job_id=$1 AND company_id=$2`,
    [jobId, companyId],
  );

  await voidExternalJob(client, companyId, userId, jobId, input.reason ?? null);

  await insertAuditLog(client, companyId, userId, 'EXTERNAL_JOB_PROCESSING_VOID', jobId, {
    rollIds: linesBefore.rows.map((r) => r.roll_id),
    reason: input.reason ?? null,
  });
}
