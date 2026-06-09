import type { PoolClient } from 'pg';
import { returnQtyToMeters } from './returnInvoiceQtyHelpers.js';

const EPS = 1e-4;

async function sumReturnedMetersForSalesLine(
  client: PoolClient,
  companyId: string,
  lineId: string,
  excludeReturnId: string | null,
): Promise<number> {
  const r = await client.query<{ s: string }>(
    `SELECT COALESCE(SUM(
         CASE WHEN ril.unit = 'yard' THEN ril.quantity * 0.9144 ELSE ril.quantity END
       ), 0)::numeric AS s
     FROM return_invoice_lines ril
     INNER JOIN return_invoices ri ON ri.id = ril.return_invoice_id AND ri.company_id = ril.company_id
     WHERE ril.company_id = $1
       AND ri.status = 'CONFIRMED'
       AND ril.original_sales_invoice_line_id = $2
       AND ($3::uuid IS NULL OR ri.id <> $3::uuid)`,
    [companyId, lineId, excludeReturnId],
  );
  return Number(r.rows[0]?.s ?? 0);
}

async function sumReturnedMetersForPurchaseLine(
  client: PoolClient,
  companyId: string,
  lineId: string,
  excludeReturnId: string | null,
): Promise<number> {
  const r = await client.query<{ s: string }>(
    `SELECT COALESCE(SUM(
         CASE WHEN ril.unit = 'yard' THEN ril.quantity * 0.9144 ELSE ril.quantity END
       ), 0)::numeric AS s
     FROM return_invoice_lines ril
     INNER JOIN return_invoices ri ON ri.id = ril.return_invoice_id AND ri.company_id = ril.company_id
     WHERE ril.company_id = $1
       AND ri.status = 'CONFIRMED'
       AND ril.original_purchase_invoice_line_id = $2
       AND ($3::uuid IS NULL OR ri.id <> $3::uuid)`,
    [companyId, lineId, excludeReturnId],
  );
  return Number(r.rows[0]?.s ?? 0);
}

export async function refreshSalesInvoiceReturnFulfillment(
  client: PoolClient,
  companyId: string,
  salesInvoiceId: string,
): Promise<void> {
  const lines = await client.query<{ id: string; quantity: string; unit: string }>(
    `SELECT id, quantity, unit FROM sales_invoice_lines WHERE company_id=$1 AND invoice_id=$2`,
    [companyId, salesInvoiceId],
  );
  if (!lines.rows.length) {
    await client.query(
      `UPDATE sales_invoices SET return_fulfillment_status='NOT_RETURNED', updated_at=now() WHERE id=$1 AND company_id=$2`,
      [salesInvoiceId, companyId],
    );
    return;
  }

  let anyReturn = false;
  let allFully = true;
  for (const ln of lines.rows) {
    const origM = returnQtyToMeters(Number(ln.quantity), ln.unit === 'yard' ? 'yard' : 'meter');
    if (origM <= EPS) continue;
    const retM = await sumReturnedMetersForSalesLine(client, companyId, ln.id, null);
    if (retM > EPS) anyReturn = true;
    if (retM < origM - EPS) allFully = false;
  }

  const status = !anyReturn ? 'NOT_RETURNED' : allFully ? 'FULLY_RETURNED' : 'PARTIALLY_RETURNED';
  await client.query(
    `UPDATE sales_invoices SET return_fulfillment_status=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
    [salesInvoiceId, companyId, status],
  );
}

export async function refreshPurchaseInvoiceReturnFulfillment(
  client: PoolClient,
  companyId: string,
  purchaseInvoiceId: string,
): Promise<void> {
  const lines = await client.query<{ id: string; quantity: string; unit: string }>(
    `SELECT id, quantity, unit FROM purchase_invoice_lines WHERE company_id=$1 AND invoice_id=$2`,
    [companyId, purchaseInvoiceId],
  );
  if (!lines.rows.length) {
    await client.query(
      `UPDATE purchase_invoices SET return_fulfillment_status='NOT_RETURNED', updated_at=now() WHERE id=$1 AND company_id=$2`,
      [purchaseInvoiceId, companyId],
    );
    return;
  }

  let anyReturn = false;
  let allFully = true;
  for (const ln of lines.rows) {
    const origM = returnQtyToMeters(Number(ln.quantity), ln.unit === 'yard' ? 'yard' : 'meter');
    if (origM <= EPS) continue;
    const retM = await sumReturnedMetersForPurchaseLine(client, companyId, ln.id, null);
    if (retM > EPS) anyReturn = true;
    if (retM < origM - EPS) allFully = false;
  }

  const status = !anyReturn ? 'NOT_RETURNED' : allFully ? 'FULLY_RETURNED' : 'PARTIALLY_RETURNED';
  await client.query(
    `UPDATE purchase_invoices SET return_fulfillment_status=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
    [purchaseInvoiceId, companyId, status],
  );
}
