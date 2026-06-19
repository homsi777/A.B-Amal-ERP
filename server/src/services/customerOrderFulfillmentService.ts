import type { PoolClient } from 'pg';

const EPS = 1e-3;

function metersFromQuantity(quantity: number, unit: string): number {
  return unit === 'yard' ? Math.round(quantity * 0.9144 * 1000) / 1000 : quantity;
}

export async function getOrderLineFulfilledMeters(
  client: PoolClient,
  companyId: string,
  orderLineId: string,
): Promise<number> {
  const row = await client.query<{ fulfilled: string }>(
    `SELECT COALESCE(SUM(
       CASE WHEN sil.unit = 'yard' THEN sil.quantity * 0.9144 ELSE sil.quantity END
     ), 0)::float AS fulfilled
     FROM sales_invoice_lines sil
     INNER JOIN sales_invoices si ON si.id = sil.invoice_id AND si.company_id = sil.company_id
     WHERE sil.company_id = $1
       AND sil.customer_order_line_id = $2::uuid
       AND si.document_status = 'CONFIRMED'`,
    [companyId, orderLineId],
  );
  return Number(row.rows[0]?.fulfilled ?? 0);
}

export async function getOrderLineOrderedMeters(
  client: PoolClient,
  companyId: string,
  orderLineId: string,
): Promise<number> {
  const row = await client.query<{ length: string; unit_type: string }>(
    `SELECT length, unit_type FROM customer_order_lines WHERE id = $1 AND company_id = $2`,
    [orderLineId, companyId],
  );
  if (!row.rows.length) return 0;
  const ln = row.rows[0];
  return metersFromQuantity(Number(ln.length), ln.unit_type || 'meter');
}

export async function syncCustomerOrderStatusFromFulfillment(
  client: PoolClient,
  companyId: string,
  orderId: string,
  userId: string | null,
): Promise<void> {
  const order = await client.query<{ status: string }>(
    `SELECT status FROM customer_orders WHERE id = $1 AND company_id = $2`,
    [orderId, companyId],
  );
  if (!order.rows.length) return;
  const currentStatus = order.rows[0].status;
  if (currentStatus === 'cancelled' || currentStatus === 'draft') return;

  const lines = await client.query<{ id: string; length: string; unit_type: string }>(
    `SELECT id, length, unit_type FROM customer_order_lines WHERE order_id = $1 AND company_id = $2 ORDER BY line_no`,
    [orderId, companyId],
  );
  if (!lines.rows.length) return;

  let anyFulfilled = false;
  let allFulfilled = true;

  for (const ln of lines.rows) {
    const ordered = metersFromQuantity(Number(ln.length), ln.unit_type || 'meter');
    const fulfilled = await getOrderLineFulfilledMeters(client, companyId, ln.id);
    if (fulfilled > EPS) anyFulfilled = true;
    if (ordered - fulfilled > EPS) allFulfilled = false;
  }

  let nextStatus = currentStatus;
  if (allFulfilled) {
    nextStatus = 'ready_pickup';
  } else if (anyFulfilled) {
    nextStatus = 'partial_ready';
  } else if (currentStatus === 'partial_ready' || currentStatus === 'ready_pickup' || currentStatus === 'completed') {
    nextStatus = 'pending_supply';
  }

  if (nextStatus !== currentStatus) {
    await client.query(
      `UPDATE customer_orders
       SET status = $3, updated_by_user_id = $4, updated_at = now()
       WHERE id = $1 AND company_id = $2`,
      [orderId, companyId, nextStatus, userId],
    );
  }
}

export async function syncCustomerOrderFulfillmentForInvoice(
  client: PoolClient,
  companyId: string,
  invoiceId: string,
  userId: string | null,
): Promise<void> {
  const row = await client.query<{ customer_order_id: string | null }>(
    `SELECT customer_order_id FROM sales_invoices WHERE id = $1 AND company_id = $2`,
    [invoiceId, companyId],
  );
  const orderId = row.rows[0]?.customer_order_id;
  if (!orderId) return;
  await syncCustomerOrderStatusFromFulfillment(client, companyId, orderId, userId);
}

export async function assertSalesInvoiceCustomerMatchesOrder(
  client: PoolClient,
  companyId: string,
  customerOrderId: string,
  customerId: string,
): Promise<void> {
  const row = await client.query<{ customer_id: string; status: string; order_no: string }>(
    `SELECT customer_id, status, order_no FROM customer_orders WHERE id = $1 AND company_id = $2`,
    [customerOrderId, companyId],
  );
  if (!row.rows.length) {
    throw Object.assign(new Error('طلبية العميل غير موجودة'), { code: 'NOT_FOUND' });
  }
  const order = row.rows[0];
  if (order.status === 'cancelled') {
    throw Object.assign(new Error('لا يمكن ربط فاتورة بطلبية ملغاة'), { code: 'VALIDATION' });
  }
  if (order.customer_id !== customerId) {
    throw Object.assign(new Error('العميل في الفاتورة لا يطابق عميل الطلبية'), { code: 'VALIDATION' });
  }
}
