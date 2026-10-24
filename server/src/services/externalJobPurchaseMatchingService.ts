import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

/**
 * مطابقة كمية سطر فاتورة شراء (بالمتر) مع ما هو مفتوح من سطور إرسال
 * "مصنعية" لنفس المورد ونفس الخامة (بصرف النظر عن اللون)، بالأقدم أولاً
 * (FIFO). افتراضياً عبر كل مهام المصنعية المفتوحة لهذا المورد؛ إن مُرِّر
 * `jobId` (ربط اختياري برقم إرسالية محدد من المستخدم) تُحصَر المطابقة بهذه
 * المهمة فقط. تُستدعى من داخل transaction تأكيد فاتورة الشراء نفسها، لكل
 * سطر فاتورة بالمتر مرتبط بخامة. تسجيل/تقرير فقط — لا حركة مخزون ولا قيد
 * محاسبي ينشأ من هنا؛ fee_amount ومنطق GL الحالي غير مُلامَسين إطلاقاً.
 */
export async function matchPurchaseLineAgainstProcessingDispatches(
  client: PoolClient,
  companyId: string,
  supplierId: string,
  fabricItemId: string,
  purchaseInvoiceId: string,
  purchaseInvoiceLineId: string,
  quantityM: number,
  userId: string | null,
  jobId?: string | null,
): Promise<{ matchedM: number; remainingUnmatchedM: number }> {
  if (!Number.isFinite(quantityM) || quantityM <= 0) return { matchedM: 0, remainingUnmatchedM: 0 };

  const jobFilter = jobId ? 'AND ej.id = $4' : '';
  const openLines = await client.query<{ id: string; remaining: string }>(
    `SELECT ejl.id, (ejl.sent_length_m - ejl.matched_length_m) AS remaining
     FROM external_job_lines ejl
     JOIN external_jobs ej ON ej.id = ejl.job_id AND ej.company_id = $1
     JOIN fabric_rolls fr ON fr.id = ejl.roll_id AND fr.company_id = $1
     WHERE ej.job_kind = 'PROCESSING'
       AND ej.supplier_id = $2
       AND fr.item_id = $3
       AND ejl.line_status <> 'CANCELLED'
       AND ejl.sent_length_m IS NOT NULL
       AND (ejl.sent_length_m - ejl.matched_length_m) > 0.001
       ${jobFilter}
     ORDER BY ej.sent_date ASC, ejl.created_at ASC
     FOR UPDATE OF ejl`,
    jobId ? [companyId, supplierId, fabricItemId, jobId] : [companyId, supplierId, fabricItemId],
  );

  let remainingToMatch = quantityM;
  let matchedTotal = 0;
  for (const line of openLines.rows) {
    if (remainingToMatch <= 0.001) break;
    const available = Number(line.remaining);
    const take = Math.min(available, remainingToMatch);
    if (take <= 0.001) continue;
    await client.query(
      `INSERT INTO external_job_line_matches
         (company_id, external_job_line_id, match_type, purchase_invoice_id, purchase_invoice_line_id, matched_length_m, created_by_user_id)
       VALUES ($1,$2,'PURCHASE_INVOICE',$3,$4,$5,$6)`,
      [companyId, line.id, purchaseInvoiceId, purchaseInvoiceLineId, take, userId],
    );
    await client.query(
      `UPDATE external_job_lines SET matched_length_m = matched_length_m + $2 WHERE id = $1`,
      [line.id, take],
    );
    matchedTotal += take;
    remainingToMatch -= take;
  }

  return { matchedM: matchedTotal, remainingUnmatchedM: Math.max(0, remainingToMatch) };
}

export type OpenDispatchBalanceRow = {
  supplier_id: string;
  supplier_name: string;
  fabric_item_id: string;
  item_name: string;
  total_sent_m: string;
  total_matched_m: string;
  remaining_m: string;
  oldest_open_date: string;
};

/** ملخص الفرق المتبقي (مرسل - معتمد بفاتورة شراء - معتمد كنقص) لكل زوج مورّد/خامة له سطر مفتوح. */
export async function listOpenDispatchBalances(pool: Pool, companyId: string): Promise<OpenDispatchBalanceRow[]> {
  const res = await pool.query<OpenDispatchBalanceRow>(
    `SELECT s.id AS supplier_id, s.name AS supplier_name,
            fr.item_id AS fabric_item_id, fi.name AS item_name,
            SUM(ejl.sent_length_m) AS total_sent_m,
            SUM(ejl.matched_length_m) AS total_matched_m,
            SUM(ejl.sent_length_m - ejl.matched_length_m) AS remaining_m,
            MIN(ej.sent_date)::text AS oldest_open_date
     FROM external_job_lines ejl
     JOIN external_jobs ej ON ej.id = ejl.job_id AND ej.company_id = $1
     JOIN suppliers s ON s.id = ej.supplier_id AND s.company_id = $1
     JOIN fabric_rolls fr ON fr.id = ejl.roll_id AND fr.company_id = $1
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = $1
     WHERE ej.job_kind = 'PROCESSING'
       AND ejl.line_status <> 'CANCELLED'
       AND ejl.sent_length_m IS NOT NULL
     GROUP BY s.id, s.name, fr.item_id, fi.name
     HAVING SUM(ejl.sent_length_m - ejl.matched_length_m) > 0.001
     ORDER BY MIN(ej.sent_date) ASC`,
    [companyId],
  );
  return res.rows;
}

export type OpenDispatchLineRow = {
  id: string;
  job_no: string;
  sent_date: string;
  barcode: string;
  sent_length_m: string;
  matched_length_m: string;
  remaining_m: string;
};

export async function listOpenDispatchLines(
  pool: Pool,
  companyId: string,
  supplierId: string,
  fabricItemId: string,
): Promise<OpenDispatchLineRow[]> {
  const res = await pool.query<OpenDispatchLineRow>(
    `SELECT ejl.id, ej.job_no, ej.sent_date::text,
            COALESCE(ejl.sent_barcode, fr.barcode) AS barcode,
            ejl.sent_length_m, ejl.matched_length_m,
            (ejl.sent_length_m - ejl.matched_length_m) AS remaining_m
     FROM external_job_lines ejl
     JOIN external_jobs ej ON ej.id = ejl.job_id AND ej.company_id = $1
     JOIN fabric_rolls fr ON fr.id = ejl.roll_id AND fr.company_id = $1
     WHERE ej.job_kind = 'PROCESSING'
       AND ej.supplier_id = $2
       AND fr.item_id = $3
       AND ejl.line_status <> 'CANCELLED'
       AND ejl.sent_length_m IS NOT NULL
       AND (ejl.sent_length_m - ejl.matched_length_m) > 0.001
     ORDER BY ej.sent_date ASC, ejl.created_at ASC`,
    [companyId, supplierId, fabricItemId],
  );
  return res.rows;
}

const approveShortageSchema = z.object({
  supplierId: z.string().uuid(),
  fabricItemId: z.string().uuid(),
  amountM: z.coerce.number().positive(),
  notes: z.string().optional().nullable(),
});

/**
 * اعتماد الفرق المتبقي (أو جزء منه) كفاقد/نقص — تسجيل وتقرير فقط، بلا أي
 * أثر محاسبي أو حركة مخزون (كما طُلب صريحاً). يستهلك FIFO من نفس سطور
 * الإرسال المفتوحة تماماً كما تفعل مطابقة فاتورة الشراء، فقط بنوع مختلف
 * (SHORTAGE_APPROVED) حتى لا يبقى يظهر كفرق مفتوح لاحقاً.
 */
export async function approveShortage(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  raw: unknown,
): Promise<{ approvedM: number }> {
  const input = approveShortageSchema.parse(raw);

  const openLines = await client.query<{ id: string; remaining: string }>(
    `SELECT ejl.id, (ejl.sent_length_m - ejl.matched_length_m) AS remaining
     FROM external_job_lines ejl
     JOIN external_jobs ej ON ej.id = ejl.job_id AND ej.company_id = $1
     JOIN fabric_rolls fr ON fr.id = ejl.roll_id AND fr.company_id = $1
     WHERE ej.job_kind = 'PROCESSING'
       AND ej.supplier_id = $2
       AND fr.item_id = $3
       AND ejl.line_status <> 'CANCELLED'
       AND ejl.sent_length_m IS NOT NULL
       AND (ejl.sent_length_m - ejl.matched_length_m) > 0.001
     ORDER BY ej.sent_date ASC, ejl.created_at ASC
     FOR UPDATE OF ejl`,
    [companyId, input.supplierId, input.fabricItemId],
  );

  const totalOpen = openLines.rows.reduce((sum, l) => sum + Number(l.remaining), 0);
  if (input.amountM > totalOpen + 0.001) {
    throw Object.assign(
      new Error(`المبلغ المطلوب اعتماده (${input.amountM.toFixed(3)} م) أكبر من الفرق المفتوح فعلياً (${totalOpen.toFixed(3)} م)`),
      { code: 'VALIDATION' },
    );
  }

  let remainingToApprove = input.amountM;
  let approvedTotal = 0;
  for (const line of openLines.rows) {
    if (remainingToApprove <= 0.001) break;
    const available = Number(line.remaining);
    const take = Math.min(available, remainingToApprove);
    if (take <= 0.001) continue;
    await client.query(
      `INSERT INTO external_job_line_matches
         (company_id, external_job_line_id, match_type, matched_length_m, notes, created_by_user_id)
       VALUES ($1,$2,'SHORTAGE_APPROVED',$3,$4,$5)`,
      [companyId, line.id, take, input.notes ?? null, userId],
    );
    await client.query(
      `UPDATE external_job_lines SET matched_length_m = matched_length_m + $2 WHERE id = $1`,
      [line.id, take],
    );
    approvedTotal += take;
    remainingToApprove -= take;
  }

  return { approvedM: approvedTotal };
}
