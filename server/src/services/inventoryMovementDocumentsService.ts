import { getPool } from '../db/pool.js';

/** مستند حركة مخزون واحد (= سطر واحد بشاشة "حركات المخزون") — يُجمَّع من
 * inventory_movements حسب (reference_type, reference_id)؛ التفاصيل الفردية
 * لكل توب تُعرَض عند الدخول للتفاصيل عبر GET /api/inventory-movements-log
 * بنفس المرجع (referenceType/referenceId) لا بشاشة منفصلة. */
export type DocKind = 'INTAKE_STOCK' | 'INTAKE_PURCHASE' | 'INTAKE_PROCESSING' | 'INTAKE_RETURN' | 'SALE';

export type InventoryMovementDocumentRow = {
  doc_kind: DocKind;
  reference_type: string;
  reference_id: string;
  doc_no: string;
  doc_date: string;
  /** يبقى فارغاً لمخزون عادي (بلا جهة مذكورة) — مورّد لشراء/مصنعية، عميل لمرتجع/بيع. */
  party_name: string | null;
  roll_count: number;
  total_length_m: string | number;
};

export type InventoryMovementDocumentsFilters = {
  docKind?: DocKind;
  warehouseId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

export async function listInventoryMovementDocuments(
  companyId: string,
  filters: InventoryMovementDocumentsFilters,
): Promise<{ rows: InventoryMovementDocumentRow[]; total: number; page: number; pageSize: number }> {
  const pool = getPool();
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 30));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = ['d.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;

  if (filters.docKind) {
    conditions.push(`d.doc_kind = $${p}`);
    params.push(filters.docKind);
    p++;
  }
  if (filters.warehouseId) {
    conditions.push(`d.warehouse_id = $${p}`);
    params.push(filters.warehouseId);
    p++;
  }
  if (filters.dateFrom) {
    conditions.push(`d.doc_date::date >= $${p}::date`);
    params.push(filters.dateFrom);
    p++;
  }
  if (filters.dateTo) {
    conditions.push(`d.doc_date::date <= $${p}::date`);
    params.push(filters.dateTo);
    p++;
  }
  if (filters.search) {
    conditions.push(`(d.doc_no ILIKE $${p} OR COALESCE(d.party_name,'') ILIKE $${p})`);
    params.push(`%${filters.search}%`);
    p++;
  }

  const where = conditions.join(' AND ');

  // CTE واحدة: كل مستند = (reference_type, reference_id) مُجمَّع من حركاته
  // الفعلية فقط — مستند بلا أي حركة مخزون حقيقية لا يظهر هنا إطلاقاً (مطابقة
  // تماماً لما حدث فعلاً بالمخزون، لا سجل عملية إدخال/بيع نظرياً فقط).
  const baseCte = `
    WITH doc_rolls AS (
      SELECT
        im.reference_type,
        im.reference_id,
        MIN(im.created_at) AS doc_date,
        COUNT(DISTINCT im.roll_id)::int AS roll_count,
        COALESCE(SUM(fr.length_m), 0) AS total_length_m,
        MAX(COALESCE(im.to_warehouse_id, im.from_warehouse_id)) AS warehouse_id
      FROM inventory_movements im
      JOIN fabric_rolls fr ON fr.id = im.roll_id AND fr.company_id = im.company_id
      WHERE im.company_id = $1 AND im.reference_type IN ('INTAKE_OPERATION', 'SALES_INVOICE')
      GROUP BY im.reference_type, im.reference_id
    ),
    d AS (
      SELECT
        dr.reference_type, dr.reference_id, dr.doc_date, dr.roll_count, dr.total_length_m,
        COALESCE(io.warehouse_id, dr.warehouse_id) AS warehouse_id,
        $1::uuid AS company_id,
        CASE
          WHEN dr.reference_type = 'INTAKE_OPERATION' THEN
            CASE io.action_type
              WHEN 'STOCK' THEN 'INTAKE_STOCK'
              WHEN 'PURCHASE' THEN 'INTAKE_PURCHASE'
              WHEN 'PROCESSING' THEN 'INTAKE_PROCESSING'
              WHEN 'RETURN' THEN 'INTAKE_RETURN'
            END
          ELSE 'SALE'
        END AS doc_kind,
        CASE WHEN dr.reference_type = 'INTAKE_OPERATION' THEN io.order_no ELSE si.invoice_no END AS doc_no,
        CASE
          WHEN dr.reference_type = 'INTAKE_OPERATION' AND io.action_type IN ('PURCHASE', 'PROCESSING') THEN sup.name
          WHEN dr.reference_type = 'INTAKE_OPERATION' AND io.action_type = 'RETURN' THEN cust_io.name
          WHEN dr.reference_type = 'SALES_INVOICE' THEN cust_si.name
          ELSE NULL
        END AS party_name
      FROM doc_rolls dr
      LEFT JOIN intake_operations io ON dr.reference_type = 'INTAKE_OPERATION' AND io.id = dr.reference_id
      LEFT JOIN suppliers sup ON sup.id = io.supplier_id
      LEFT JOIN customers cust_io ON cust_io.id = io.customer_id
      LEFT JOIN sales_invoices si ON dr.reference_type = 'SALES_INVOICE' AND si.id = dr.reference_id
      LEFT JOIN customers cust_si ON cust_si.id = si.customer_id
      WHERE (dr.reference_type = 'SALES_INVOICE' OR io.id IS NOT NULL)
        AND (dr.reference_type = 'INTAKE_OPERATION' OR si.id IS NOT NULL)
    )
  `;

  const countQ = await pool.query<{ c: string }>(
    `${baseCte} SELECT COUNT(*)::int AS c FROM d WHERE ${where}`,
    params,
  );

  const dataQ = await pool.query(
    `${baseCte}
     SELECT d.doc_kind, d.reference_type, d.reference_id, d.doc_no, d.doc_date, d.party_name,
            d.roll_count, d.total_length_m
     FROM d
     WHERE ${where}
     ORDER BY d.doc_date DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, pageSize, offset],
  );

  const rows = (dataQ.rows as Record<string, unknown>[]).map((r) => ({
    doc_kind: r.doc_kind as DocKind,
    reference_type: String(r.reference_type),
    reference_id: String(r.reference_id),
    doc_no: String(r.doc_no ?? ''),
    doc_date: String(r.doc_date),
    party_name: (r.party_name as string | null) ?? null,
    roll_count: Number(r.roll_count),
    total_length_m: r.total_length_m as string | number,
  } satisfies InventoryMovementDocumentRow));

  return { rows, total: Number(countQ.rows[0]?.c ?? 0), page, pageSize };
}
