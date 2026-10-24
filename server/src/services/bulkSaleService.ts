import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

const bulkSaleBodySchema = z.object({
  customerId: z.string().uuid('العميل مطلوب'),
  invoiceId: z.string().uuid('الفاتورة المرتبطة مطلوبة'),
  saleDate: z.string().min(1, 'تاريخ البيع الجماعي مطلوب'),
  notes: z.string().optional().nullable(),
});

export type BulkSaleRow = {
  id: string;
  company_id: string;
  customer_id: string;
  invoice_id: string;
  sale_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  customer_name?: string;
  invoice_no?: string;
  is_used?: boolean;
};

const LIST_SELECT = `
  SELECT bs.*, c.name AS customer_name, si.invoice_no,
         (io.id IS NOT NULL) AS is_used
  FROM bulk_sales bs
  JOIN customers c ON c.id = bs.customer_id
  JOIN sales_invoices si ON si.id = bs.invoice_id
  LEFT JOIN intake_operations io ON io.bulk_sale_id = bs.id
  WHERE bs.company_id = $1
`;

export async function listBulkSales(
  pool: Pool,
  companyId: string,
  opts: { onlyUnused?: boolean } = {},
): Promise<BulkSaleRow[]> {
  const where = opts.onlyUnused ? `${LIST_SELECT} AND io.id IS NULL` : LIST_SELECT;
  const res = await pool.query<BulkSaleRow>(`${where} ORDER BY bs.created_at DESC`, [companyId]);
  return res.rows;
}

export async function createBulkSale(
  pool: Pool,
  companyId: string,
  userId: string | null,
  raw: unknown,
): Promise<BulkSaleRow> {
  const parsed = bulkSaleBodySchema.safeParse(raw);
  if (!parsed.success) throw Object.assign(new Error('بيانات غير صالحة'), { code: 'VALIDATION', issues: parsed.error.issues });
  const d = parsed.data;

  const customerCheck = await pool.query('SELECT id FROM customers WHERE id=$1 AND company_id=$2', [d.customerId, companyId]);
  if (!customerCheck.rows.length) throw Object.assign(new Error('العميل غير موجود'), { code: 'NOT_FOUND' });

  const invoiceCheck = await pool.query('SELECT id FROM sales_invoices WHERE id=$1 AND company_id=$2', [d.invoiceId, companyId]);
  if (!invoiceCheck.rows.length) throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });

  const ins = await pool.query<BulkSaleRow>(
    `INSERT INTO bulk_sales (company_id, customer_id, invoice_id, sale_date, notes, created_by_user_id)
     VALUES ($1,$2,$3,$4::date,$5,$6)
     RETURNING *`,
    [companyId, d.customerId, d.invoiceId, d.saleDate, d.notes ?? null, userId],
  );
  return ins.rows[0];
}

export async function updateBulkSale(
  pool: Pool,
  companyId: string,
  id: string,
  raw: unknown,
): Promise<BulkSaleRow> {
  const parsed = bulkSaleBodySchema.safeParse(raw);
  if (!parsed.success) throw Object.assign(new Error('بيانات غير صالحة'), { code: 'VALIDATION', issues: parsed.error.issues });
  const d = parsed.data;

  const existing = await pool.query('SELECT id FROM bulk_sales WHERE id=$1 AND company_id=$2', [id, companyId]);
  if (!existing.rows.length) throw Object.assign(new Error('البيع الجماعي غير موجود'), { code: 'NOT_FOUND' });

  const customerCheck = await pool.query('SELECT id FROM customers WHERE id=$1 AND company_id=$2', [d.customerId, companyId]);
  if (!customerCheck.rows.length) throw Object.assign(new Error('العميل غير موجود'), { code: 'NOT_FOUND' });

  const invoiceCheck = await pool.query('SELECT id FROM sales_invoices WHERE id=$1 AND company_id=$2', [d.invoiceId, companyId]);
  if (!invoiceCheck.rows.length) throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });

  const upd = await pool.query<BulkSaleRow>(
    `UPDATE bulk_sales SET customer_id=$1, invoice_id=$2, sale_date=$3::date, notes=$4, updated_at=now()
     WHERE id=$5 AND company_id=$6
     RETURNING *`,
    [d.customerId, d.invoiceId, d.saleDate, d.notes ?? null, id, companyId],
  );
  return upd.rows[0];
}

/** يُستخدَم من intakeOperationService لجلب البيع الجماعي داخل transaction مفتوحة (قفل مانع للاستخدام المزدوج). */
export async function lockBulkSaleForIntake(
  client: PoolClient,
  companyId: string,
  bulkSaleId: string,
): Promise<{ id: string } | null> {
  const res = await client.query<{ id: string }>(
    `SELECT bs.id FROM bulk_sales bs
     LEFT JOIN intake_operations io ON io.bulk_sale_id = bs.id
     WHERE bs.id=$1 AND bs.company_id=$2 AND io.id IS NULL
     FOR UPDATE OF bs`,
    [bulkSaleId, companyId],
  );
  return res.rows[0] ?? null;
}
