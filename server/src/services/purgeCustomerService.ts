import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { getCustomerStatement } from './partyStatementService.js';
import { voidSalesInvoice, deleteSalesInvoiceDraft } from './salesInvoiceService.js';
import { cancelConfirmedVoucher } from './voucherCashboxService.js';
import { reverseReturnInvoiceGl } from './glPostingService.js';
import { reverseReturnCashRefundCashbox } from './returnInvoiceCashboxService.js';
import { reverseReturnInvoiceInventory } from './returnInvoiceStockService.js';
import { refreshSalesInvoiceReturnFulfillment } from './returnInvoiceLifecycleService.js';

export type CustomerPurgePreview = {
  customer: { id: string; code: string; name: string };
  counts: {
    salesInvoicesDraft: number;
    salesInvoicesConfirmed: number;
    salesInvoicesVoided: number;
    vouchersActive: number;
    returnInvoicesActive: number;
    customerOrders: number;
  };
  closingBalance: number;
  warnings: string[];
};

export type CustomerPurgeSummary = {
  voidedSalesInvoices: number;
  deletedDraftSalesInvoices: number;
  cancelledVouchers: number;
  cancelledReturnInvoices: number;
  deletedSalesInvoices: number;
  deletedVouchers: number;
  deletedReturnInvoices: number;
  deletedCustomerOrders: number;
  deletedJournalEntries: number;
  deletedCashboxMovements: number;
};

async function loadCustomerRow(client: PoolClient, companyId: string, customerId: string) {
  const row = await client.query<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM customers WHERE id=$1 AND company_id=$2`,
    [customerId, companyId],
  );
  if (!row.rows.length) {
    throw Object.assign(new Error('العميل غير موجود'), { code: 'NOT_FOUND' });
  }
  return row.rows[0];
}

export async function previewCustomerPurge(companyId: string, customerId: string): Promise<CustomerPurgePreview> {
  const pool = getPool();
  const exists = await pool.query<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM customers WHERE id=$1 AND company_id=$2`,
    [customerId, companyId],
  );
  if (!exists.rows.length) {
    throw Object.assign(new Error('العميل غير موجود'), { code: 'NOT_FOUND' });
  }
  const customer = exists.rows[0];

  const [inv, vouchers, returns, orders, statement] = await Promise.all([
    pool.query<{ document_status: string; c: string }>(
      `SELECT document_status, COUNT(*)::text AS c
       FROM sales_invoices
       WHERE company_id=$1 AND customer_id=$2
       GROUP BY document_status`,
      [companyId, customerId],
    ),
    pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM vouchers
       WHERE company_id=$1 AND party_type='CUSTOMER' AND party_id=$2 AND status IN ('DRAFT','CONFIRMED')`,
      [companyId, customerId],
    ),
    pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM return_invoices
       WHERE company_id=$1 AND customer_id=$2 AND status IN ('DRAFT','CONFIRMED')`,
      [companyId, customerId],
    ),
    pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM customer_orders WHERE company_id=$1 AND customer_id=$2`,
      [companyId, customerId],
    ),
    getCustomerStatement(companyId, customerId, {}),
  ]);

  const counts = {
    salesInvoicesDraft: 0,
    salesInvoicesConfirmed: 0,
    salesInvoicesVoided: 0,
    vouchersActive: Number(vouchers.rows[0]?.c ?? 0),
    returnInvoicesActive: Number(returns.rows[0]?.c ?? 0),
    customerOrders: Number(orders.rows[0]?.c ?? 0),
  };
  for (const row of inv.rows) {
    const n = Number(row.c ?? 0);
    if (row.document_status === 'DRAFT') counts.salesInvoicesDraft = n;
    else if (row.document_status === 'CONFIRMED') counts.salesInvoicesConfirmed = n;
    else if (row.document_status === 'VOIDED') counts.salesInvoicesVoided = n;
  }

  const closingBalance = Number(statement.totals.closingBalance ?? 0);
  const warnings: string[] = [];
  if (counts.salesInvoicesConfirmed > 0) {
    warnings.push(`سيتم إلغاء ${counts.salesInvoicesConfirmed} فاتورة بيع مؤكدة وعكس أثرها على المخزون والقيود.`);
  }
  if (counts.vouchersActive > 0) {
    warnings.push(`سيتم إلغاء ${counts.vouchersActive} سند قبض/صرف مرتبط بالعميل.`);
  }
  if (counts.returnInvoicesActive > 0) {
    warnings.push(`سيتم إلغاء ${counts.returnInvoicesActive} مرتجع مبيعات مرتبط بالعميل.`);
  }
  if (Math.abs(closingBalance) > 0.01) {
    warnings.push(`الرصيد الحالي ${closingBalance.toFixed(2)} — سيُصفَّر بعد عكس المستندات ثم يُحذف السجل بالكامل.`);
  }
  warnings.push('هذا إجراء نهائي: سيُحذف العميل وجميع مستنداته من النظام بعد العكس المحاسبي.');

  return { customer, counts, closingBalance, warnings };
}

async function cancelConfirmedReturnInvoice(
  client: PoolClient,
  companyId: string,
  returnId: string,
  userId: string | null,
): Promise<void> {
  const cur = await client.query<{
    status: string;
    return_no: string;
    return_type: string;
    settlement_type: string | null;
    original_sales_invoice_id: string | null;
    customer_id: string | null;
    cname: string | null;
  }>(
    `SELECT ri.status, ri.return_no, ri.return_type, ri.settlement_type,
            ri.original_sales_invoice_id, ri.customer_id, c.name AS cname
     FROM return_invoices ri
     LEFT JOIN customers c ON c.id = ri.customer_id AND c.company_id = ri.company_id
     WHERE ri.id=$1 AND ri.company_id=$2
     FOR UPDATE OF ri`,
    [returnId, companyId],
  );
  const inv = cur.rows[0];
  if (!inv || inv.status === 'CANCELLED' || inv.status !== 'CONFIRMED') return;

  await reverseReturnInvoiceInventory(client, {
    companyId,
    returnInvoiceId: returnId,
    returnNo: inv.return_no,
    userId,
  });
  await reverseReturnInvoiceGl(client, {
    companyId,
    returnInvoiceId: returnId,
    returnNo: inv.return_no,
    userId,
  });
  if (String(inv.settlement_type ?? '') === 'CASH_REFUND') {
    await reverseReturnCashRefundCashbox(client, {
      companyId,
      returnInvoiceId: returnId,
      returnNo: inv.return_no,
      returnType: inv.return_type as 'SALES_RETURN' | 'PURCHASE_RETURN',
      partyType: 'CUSTOMER',
      partyId: inv.customer_id,
      partyName: String(inv.cname ?? 'عميل'),
      userId,
    });
  }
  await client.query(
    `UPDATE return_invoices SET status='CANCELLED', cancelled_at=now(), cancellation_reason=$3, updated_at=now()
     WHERE id=$1 AND company_id=$2`,
    [returnId, companyId, 'حذف حساب العميل — إلغاء محاسبي'],
  );
  if (inv.original_sales_invoice_id) {
    await refreshSalesInvoiceReturnFulfillment(client, companyId, inv.original_sales_invoice_id);
  }
}

async function deleteJournalEntriesForSourceIds(
  client: PoolClient,
  companyId: string,
  sourceIds: string[],
): Promise<number> {
  if (!sourceIds.length) return 0;
  const idsRes = await client.query<{ id: string }>(
    `SELECT id FROM journal_entries
     WHERE company_id=$1 AND source_id = ANY($2::uuid[])`,
    [companyId, sourceIds],
  );
  const entryIds = idsRes.rows.map((r) => r.id);
  if (!entryIds.length) return 0;
  await client.query(
    `UPDATE journal_entries SET reversed_entry_id = NULL
     WHERE company_id=$1 AND (id = ANY($2::uuid[]) OR reversed_entry_id = ANY($2::uuid[]))`,
    [companyId, entryIds],
  );
  const del = await client.query(`DELETE FROM journal_entries WHERE company_id=$1 AND id = ANY($2::uuid[])`, [
    companyId,
    entryIds,
  ]);
  return del.rowCount ?? 0;
}

async function deleteCashboxMovementsForSourceIds(
  client: PoolClient,
  companyId: string,
  sourceIds: string[],
): Promise<number> {
  if (!sourceIds.length) return 0;
  const del = await client.query(
    `DELETE FROM cashbox_movements WHERE company_id=$1 AND source_id = ANY($2::uuid[])`,
    [companyId, sourceIds],
  );
  return del.rowCount ?? 0;
}

export async function purgeCustomerAccount(
  companyId: string,
  customerId: string,
  userId: string | null,
): Promise<CustomerPurgeSummary> {
  const pool = getPool();
  const client = await pool.connect();
  const summary: CustomerPurgeSummary = {
    voidedSalesInvoices: 0,
    deletedDraftSalesInvoices: 0,
    cancelledVouchers: 0,
    cancelledReturnInvoices: 0,
    deletedSalesInvoices: 0,
    deletedVouchers: 0,
    deletedReturnInvoices: 0,
    deletedCustomerOrders: 0,
    deletedJournalEntries: 0,
    deletedCashboxMovements: 0,
  };

  try {
    await client.query('BEGIN');
    await loadCustomerRow(client, companyId, customerId);
    await client.query(`SELECT id FROM customers WHERE id=$1 AND company_id=$2 FOR UPDATE`, [
      customerId,
      companyId,
    ]);

    const confirmedInvoices = await client.query<{ id: string }>(
      `SELECT id FROM sales_invoices
       WHERE company_id=$1 AND customer_id=$2 AND document_status='CONFIRMED'
       ORDER BY invoice_date ASC, created_at ASC`,
      [companyId, customerId],
    );
    for (const row of confirmedInvoices.rows) {
      await voidSalesInvoice(client, companyId, userId, row.id);
      summary.voidedSalesInvoices += 1;
    }

    const draftInvoices = await client.query<{ id: string }>(
      `SELECT id FROM sales_invoices
       WHERE company_id=$1 AND customer_id=$2 AND document_status='DRAFT'`,
      [companyId, customerId],
    );
    for (const row of draftInvoices.rows) {
      await deleteSalesInvoiceDraft(client, companyId, row.id);
      summary.deletedDraftSalesInvoices += 1;
    }

    const activeReturns = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM return_invoices WHERE company_id=$1 AND customer_id=$2`,
      [companyId, customerId],
    );
    for (const row of activeReturns.rows) {
      if (row.status === 'CONFIRMED') {
        await cancelConfirmedReturnInvoice(client, companyId, row.id, userId);
        summary.cancelledReturnInvoices += 1;
      }
    }

    const vouchers = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM vouchers
       WHERE company_id=$1 AND party_type='CUSTOMER' AND party_id=$2`,
      [companyId, customerId],
    );
    for (const row of vouchers.rows) {
      if (row.status === 'CONFIRMED') {
        await cancelConfirmedVoucher(client, { companyId, voucherId: row.id, userId });
        summary.cancelledVouchers += 1;
      }
    }

    const allInvoiceIds = (
      await client.query<{ id: string }>(`SELECT id FROM sales_invoices WHERE company_id=$1 AND customer_id=$2`, [
        companyId,
        customerId,
      ])
    ).rows.map((r) => r.id);
    const allVoucherIds = vouchers.rows.map((r) => r.id);
    const allReturnIds = activeReturns.rows.map((r) => r.id);
    const sourceIds = [...allInvoiceIds, ...allVoucherIds, ...allReturnIds];

    summary.deletedJournalEntries += await deleteJournalEntriesForSourceIds(client, companyId, sourceIds);
    summary.deletedCashboxMovements += await deleteCashboxMovementsForSourceIds(client, companyId, sourceIds);

    if (allInvoiceIds.length) {
      await client.query(
        `DELETE FROM inventory_movements
         WHERE company_id=$1 AND reference_id = ANY($2::uuid[])`,
        [companyId, allInvoiceIds],
      );
    }

    await client.query(`UPDATE sales_invoices SET payment_voucher_id=NULL WHERE company_id=$1 AND customer_id=$2`, [
      companyId,
      customerId,
    ]);

    const delInv = await client.query(`DELETE FROM sales_invoices WHERE company_id=$1 AND customer_id=$2`, [
      companyId,
      customerId,
    ]);
    summary.deletedSalesInvoices = delInv.rowCount ?? 0;

    const delRet = await client.query(`DELETE FROM return_invoices WHERE company_id=$1 AND customer_id=$2`, [
      companyId,
      customerId,
    ]);
    summary.deletedReturnInvoices = delRet.rowCount ?? 0;

    const delVou = await client.query(
      `DELETE FROM vouchers WHERE company_id=$1 AND party_type='CUSTOMER' AND party_id=$2`,
      [companyId, customerId],
    );
    summary.deletedVouchers = delVou.rowCount ?? 0;

    const delOrders = await client.query(`DELETE FROM customer_orders WHERE company_id=$1 AND customer_id=$2`, [
      companyId,
      customerId,
    ]);
    summary.deletedCustomerOrders = delOrders.rowCount ?? 0;

    await client.query(`DELETE FROM party_activity_logs WHERE company_id=$1 AND party_type='CUSTOMER' AND party_id=$2`, [
      companyId,
      customerId,
    ]);
    await client.query(
      `DELETE FROM telegram_chat_links WHERE company_id=$1 AND target_type='CUSTOMER' AND target_id=$2`,
      [companyId, customerId],
    );
    await client.query(
      `DELETE FROM telegram_delivery_logs
       WHERE company_id=$1 AND party_type='customer' AND party_id=$2`,
      [companyId, customerId],
    );

    const delCustomer = await client.query(`DELETE FROM customers WHERE id=$1 AND company_id=$2 RETURNING id`, [
      customerId,
      companyId,
    ]);
    if (!delCustomer.rows.length) {
      throw Object.assign(new Error('تعذر حذف العميل'), { code: 'NOT_FOUND' });
    }

    await client.query('COMMIT');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
