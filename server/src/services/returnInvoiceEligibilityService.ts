import type { Pool, PoolClient } from 'pg';
import { availableMetersOnLine } from './returnInvoiceQtyHelpers.js';

export type EligibleSalesInvoiceRow = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  customer_id: string;
  customer_name: string | null;
  currency_code: string;
  total_amount: string;
  paid_amount: string;
  remaining_amount: string;
  document_status: string;
  return_fulfillment_status: string;
  eligible: boolean;
};

export type EligiblePurchaseInvoiceRow = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  supplier_id: string;
  supplier_name: string | null;
  currency_code: string;
  total_amount: string;
  paid_amount: string;
  remaining_amount: string;
  document_status: string;
  return_fulfillment_status: string;
  eligible: boolean;
};

export type SourceInvoiceLineRow = {
  id: string;
  line_no: number;
  description: string;
  quantity: string;
  unit: string;
  quantity_meters: number;
  unit_price: string;
  line_total: string;
  fabric_roll_id: string | null;
  fabric_item_id: string | null;
  barcode: string | null;
  item_name: string | null;
  internal_code: string | null;
  color_name_ar: string | null;
  returned_meters: number;
  available_meters: number;
};

export async function listEligibleSalesInvoices(
  db: Pool | PoolClient,
  input: {
    companyId: string;
    search?: string;
    customerId?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    page: number;
    pageSize: number;
  },
): Promise<{ rows: EligibleSalesInvoiceRow[]; total: number }> {
  const conditions: string[] = ['si.company_id = $1', "si.document_status = 'CONFIRMED'"];
  const params: unknown[] = [input.companyId];
  let p = 2;
  if (input.customerId) {
    conditions.push(`si.customer_id = $${p++}`);
    params.push(input.customerId);
  }
  if (input.search?.trim()) {
    conditions.push(`si.invoice_no ILIKE $${p++}`);
    params.push(`%${input.search.trim()}%`);
  }
  if (input.dateFrom) {
    conditions.push(`si.invoice_date >= $${p++}::date`);
    params.push(input.dateFrom);
  }
  if (input.dateTo) {
    conditions.push(`si.invoice_date <= $${p++}::date`);
    params.push(input.dateTo);
  }
  const where = conditions.join(' AND ');
  const offset = (input.page - 1) * input.pageSize;
  const countQ = await db.query<{ c: string }>(`SELECT COUNT(*)::int AS c FROM sales_invoices si WHERE ${where}`, params);
  const total = Number(countQ.rows[0]?.c ?? 0);
  const rows = await db.query<EligibleSalesInvoiceRow>(
    `SELECT si.id, si.invoice_no, si.invoice_date::text AS invoice_date, si.customer_id,
            c.name AS customer_name, si.currency_code,
            si.total_amount::text, si.paid_amount::text, si.remaining_amount::text,
            si.document_status, si.return_fulfillment_status,
            true AS eligible
     FROM sales_invoices si
     LEFT JOIN customers c ON c.id = si.customer_id AND c.company_id = si.company_id
     WHERE ${where}
     ORDER BY si.invoice_date DESC, si.created_at DESC
     LIMIT $${p++} OFFSET $${p++}`,
    [...params, input.pageSize, offset],
  );
  return { rows: rows.rows, total };
}

export async function listEligiblePurchaseInvoices(
  db: Pool | PoolClient,
  input: {
    companyId: string;
    search?: string;
    supplierId?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    page: number;
    pageSize: number;
  },
): Promise<{ rows: EligiblePurchaseInvoiceRow[]; total: number }> {
  const conditions: string[] = ['pi.company_id = $1', "pi.document_status = 'CONFIRMED'"];
  const params: unknown[] = [input.companyId];
  let p = 2;
  if (input.supplierId) {
    conditions.push(`pi.supplier_id = $${p++}`);
    params.push(input.supplierId);
  }
  if (input.search?.trim()) {
    conditions.push(`pi.invoice_no ILIKE $${p++}`);
    params.push(`%${input.search.trim()}%`);
  }
  if (input.dateFrom) {
    conditions.push(`pi.invoice_date >= $${p++}::date`);
    params.push(input.dateFrom);
  }
  if (input.dateTo) {
    conditions.push(`pi.invoice_date <= $${p++}::date`);
    params.push(input.dateTo);
  }
  const where = conditions.join(' AND ');
  const offset = (input.page - 1) * input.pageSize;
  const countQ = await db.query<{ c: string }>(`SELECT COUNT(*)::int AS c FROM purchase_invoices pi WHERE ${where}`, params);
  const total = Number(countQ.rows[0]?.c ?? 0);
  const rows = await db.query<EligiblePurchaseInvoiceRow>(
    `SELECT pi.id, pi.invoice_no, pi.invoice_date::text AS invoice_date, pi.supplier_id,
            s.name AS supplier_name, pi.currency_code,
            pi.total_amount::text, pi.paid_amount::text, pi.remaining_amount::text,
            pi.document_status, pi.return_fulfillment_status,
            true AS eligible
     FROM purchase_invoices pi
     LEFT JOIN suppliers s ON s.id = pi.supplier_id AND s.company_id = pi.company_id
     WHERE ${where}
     ORDER BY pi.invoice_date DESC, pi.created_at DESC
     LIMIT $${p++} OFFSET $${p++}`,
    [...params, input.pageSize, offset],
  );
  return { rows: rows.rows, total };
}

export async function getSourceSalesInvoiceForReturn(
  client: PoolClient,
  companyId: string,
  invoiceId: string,
  excludeReturnId: string | null,
): Promise<{
  header: Record<string, unknown>;
  lines: SourceInvoiceLineRow[];
} | null> {
  const head = await client.query(
    `SELECT si.*, c.name AS customer_name
     FROM sales_invoices si
     LEFT JOIN customers c ON c.id = si.customer_id AND c.company_id = si.company_id
     WHERE si.id=$1 AND si.company_id=$2 AND si.document_status='CONFIRMED'`,
    [invoiceId, companyId],
  );
  if (!head.rows.length) return null;

  const lines = await client.query<{
    id: string;
    line_no: number;
    description: string;
    quantity: string;
    unit: string;
    unit_price: string;
    line_total: string;
    fabric_roll_id: string | null;
    fabric_item_id: string | null;
    barcode: string | null;
    item_name: string | null;
    internal_code: string | null;
    color_name_ar: string | null;
  }>(
    `SELECT sil.id, sil.line_no, sil.description, sil.quantity::text, sil.unit,
            sil.unit_price::text, sil.line_total::text,
            sil.fabric_roll_id, sil.fabric_item_id,
            fr.barcode,
            fi.name AS item_name, fi.internal_code,
            fc.name_ar AS color_name_ar
     FROM sales_invoice_lines sil
     LEFT JOIN fabric_rolls fr ON fr.id = sil.fabric_roll_id AND fr.company_id = sil.company_id
     LEFT JOIN fabric_items fi ON fi.id = sil.fabric_item_id AND fi.company_id = sil.company_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     WHERE sil.company_id=$1 AND sil.invoice_id=$2
     ORDER BY sil.line_no ASC`,
    [companyId, invoiceId],
  );

  const outLines: SourceInvoiceLineRow[] = [];
  for (const ln of lines.rows) {
    const u = ln.unit === 'yard' ? 'yard' : 'meter';
    const qtyM = u === 'yard' ? Number(ln.quantity) * 0.9144 : Number(ln.quantity);
    const ret = await client.query<{ s: string }>(
      `SELECT COALESCE(SUM(
           CASE WHEN ril.unit = 'yard' THEN ril.quantity * 0.9144 ELSE ril.quantity END
         ), 0)::numeric AS s
       FROM return_invoice_lines ril
       INNER JOIN return_invoices ri ON ri.id = ril.return_invoice_id AND ri.company_id = ril.company_id
       WHERE ril.company_id = $1 AND ri.status = 'CONFIRMED' AND ril.original_sales_invoice_line_id = $2
         AND ($3::uuid IS NULL OR ri.id <> $3::uuid)`,
      [companyId, ln.id, excludeReturnId],
    );
    const returnedMeters = Number(ret.rows[0]?.s ?? 0);
    const available = availableMetersOnLine(Number(ln.quantity), u, returnedMeters);
    outLines.push({
      id: ln.id,
      line_no: ln.line_no,
      description: ln.description,
      quantity: ln.quantity,
      unit: ln.unit,
      quantity_meters: Math.round(qtyM * 1000) / 1000,
      unit_price: ln.unit_price,
      line_total: ln.line_total,
      fabric_roll_id: ln.fabric_roll_id,
      fabric_item_id: ln.fabric_item_id,
      barcode: ln.barcode,
      item_name: ln.item_name,
      internal_code: ln.internal_code,
      color_name_ar: ln.color_name_ar,
      returned_meters: Math.round(returnedMeters * 1000) / 1000,
      available_meters: available,
    });
  }

  return { header: head.rows[0] as Record<string, unknown>, lines: outLines };
}

export async function getSourcePurchaseInvoiceForReturn(
  client: PoolClient,
  companyId: string,
  invoiceId: string,
  excludeReturnId: string | null,
): Promise<{
  header: Record<string, unknown>;
  lines: SourceInvoiceLineRow[];
} | null> {
  const head = await client.query(
    `SELECT pi.*, s.name AS supplier_name
     FROM purchase_invoices pi
     LEFT JOIN suppliers s ON s.id = pi.supplier_id AND s.company_id = pi.company_id
     WHERE pi.id=$1 AND pi.company_id=$2 AND pi.document_status='CONFIRMED'`,
    [invoiceId, companyId],
  );
  if (!head.rows.length) return null;

  const lines = await client.query<{
    id: string;
    line_no: number;
    description: string;
    quantity: string;
    unit: string;
    unit_price: string;
    line_total: string;
    fabric_roll_id: string | null;
    fabric_item_id: string | null;
    barcode: string | null;
    item_name: string | null;
    internal_code: string | null;
    color_name_ar: string | null;
  }>(
    `SELECT pil.id, pil.line_no, pil.description, pil.quantity::text, pil.unit,
            pil.unit_cost::text AS unit_price, pil.line_total::text,
            pil.fabric_roll_id, pil.fabric_item_id,
            fr.barcode,
            fi.name AS item_name, fi.internal_code,
            fc.name_ar AS color_name_ar
     FROM purchase_invoice_lines pil
     LEFT JOIN fabric_rolls fr ON fr.id = pil.fabric_roll_id AND fr.company_id = pil.company_id
     LEFT JOIN fabric_items fi ON fi.id = pil.fabric_item_id AND fi.company_id = pil.company_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     WHERE pil.company_id=$1 AND pil.invoice_id=$2
     ORDER BY pil.line_no ASC`,
    [companyId, invoiceId],
  );

  const outLines: SourceInvoiceLineRow[] = [];
  for (const ln of lines.rows) {
    const u = ln.unit === 'yard' ? 'yard' : 'meter';
    const qtyM = u === 'yard' ? Number(ln.quantity) * 0.9144 : Number(ln.quantity);
    const ret = await client.query<{ s: string }>(
      `SELECT COALESCE(SUM(
           CASE WHEN ril.unit = 'yard' THEN ril.quantity * 0.9144 ELSE ril.quantity END
         ), 0)::numeric AS s
       FROM return_invoice_lines ril
       INNER JOIN return_invoices ri ON ri.id = ril.return_invoice_id AND ri.company_id = ril.company_id
       WHERE ril.company_id = $1 AND ri.status = 'CONFIRMED' AND ril.original_purchase_invoice_line_id = $2
         AND ($3::uuid IS NULL OR ri.id <> $3::uuid)`,
      [companyId, ln.id, excludeReturnId],
    );
    const returnedMeters = Number(ret.rows[0]?.s ?? 0);
    const available = availableMetersOnLine(Number(ln.quantity), u, returnedMeters);
    outLines.push({
      id: ln.id,
      line_no: ln.line_no,
      description: ln.description,
      quantity: ln.quantity,
      unit: ln.unit,
      quantity_meters: Math.round(qtyM * 1000) / 1000,
      unit_price: ln.unit_price,
      line_total: ln.line_total,
      fabric_roll_id: ln.fabric_roll_id,
      fabric_item_id: ln.fabric_item_id,
      barcode: ln.barcode,
      item_name: ln.item_name,
      internal_code: ln.internal_code,
      color_name_ar: ln.color_name_ar,
      returned_meters: Math.round(returnedMeters * 1000) / 1000,
      available_meters: available,
    });
  }

  return { header: head.rows[0] as Record<string, unknown>, lines: outLines };
}
