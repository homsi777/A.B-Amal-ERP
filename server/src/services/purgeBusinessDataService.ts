import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';

export type PurgeBusinessDataSummary = {
  purgedAt: string;
  tables: Record<string, number>;
};

async function deleteByCompany(
  client: PoolClient,
  companyId: string,
  sql: string,
  key: string,
  summary: Record<string, number>,
): Promise<void> {
  const result = await client.query(sql, [companyId]);
  summary[key] = result.rowCount ?? 0;
}

/**
 * حذف انتقائي لبيانات الأعمال مع الإبقاء على المستخدمين والمستودعات والإعدادات والرواتب.
 */
export async function purgeBusinessData(
  companyId: string,
  actorUserId: string,
): Promise<PurgeBusinessDataSummary> {
  const client = await getPool().connect();
  const summary: Record<string, number> = {};

  try {
    await client.query('BEGIN');

    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM printed_labels WHERE company_id = $1`,
      'printed_labels',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM print_jobs WHERE company_id = $1`,
      'print_jobs',
      summary,
    );

    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM return_invoice_lines WHERE company_id = $1`,
      'return_invoice_lines',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM return_invoices WHERE company_id = $1`,
      'return_invoices',
      summary,
    );

    await client.query(
      `UPDATE journal_entries SET reversed_entry_id = NULL WHERE company_id = $1`,
      [companyId],
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM journal_entries WHERE company_id = $1`,
      'journal_entries',
      summary,
    );

    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM payroll_employee_advances WHERE company_id = $1`,
      'payroll_employee_advances',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM cashbox_movements WHERE company_id = $1`,
      'cashbox_movements',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM cashbox_transfers WHERE company_id = $1`,
      'cashbox_transfers',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM vouchers WHERE company_id = $1`,
      'vouchers',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM party_activity_logs WHERE company_id = $1`,
      'party_activity_logs',
      summary,
    );

    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM customer_order_lines WHERE company_id = $1`,
      'customer_order_lines',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM customer_orders WHERE company_id = $1`,
      'customer_orders',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM customer_order_template_lines WHERE company_id = $1`,
      'customer_order_template_lines',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM customer_order_templates WHERE company_id = $1`,
      'customer_order_templates',
      summary,
    );

    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM sales_invoice_lines WHERE company_id = $1`,
      'sales_invoice_lines',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM sales_invoices WHERE company_id = $1`,
      'sales_invoices',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM purchase_invoice_lines WHERE company_id = $1`,
      'purchase_invoice_lines',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM purchase_invoices WHERE company_id = $1`,
      'purchase_invoices',
      summary,
    );

    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM telegram_delivery_logs
        WHERE company_id = $1
          AND party_type IN ('customer', 'supplier')`,
      'telegram_delivery_logs',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM telegram_chat_links
        WHERE company_id = $1
          AND target_type IN ('CUSTOMER', 'SUPPLIER')`,
      'telegram_chat_links',
      summary,
    );

    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM purchase_import_rows WHERE company_id = $1`,
      'purchase_import_rows',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM purchase_import_batches WHERE company_id = $1`,
      'purchase_import_batches',
      summary,
    );

    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM inventory_waste_lines WHERE company_id = $1`,
      'inventory_waste_lines',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM inventory_waste_records WHERE company_id = $1`,
      'inventory_waste_records',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM inventory_transfer_lines WHERE company_id = $1`,
      'inventory_transfer_lines',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM inventory_transfers WHERE company_id = $1`,
      'inventory_transfers',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM inventory_movements WHERE company_id = $1`,
      'inventory_movements',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM fabric_rolls WHERE company_id = $1`,
      'fabric_rolls',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM warehouse_locations WHERE company_id = $1`,
      'warehouse_locations',
      summary,
    );

    await client.query(
      `CREATE TEMP TABLE _purge_company_colors ON COMMIT DROP AS
       SELECT DISTINCT color_id FROM fabric_item_variants WHERE company_id = $1`,
      [companyId],
    );

    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM fabric_item_variants WHERE company_id = $1`,
      'fabric_item_variants',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM fabric_items WHERE company_id = $1`,
      'fabric_items',
      summary,
    );

    const colorsResult = await client.query(
      `DELETE FROM fabric_colors c
        WHERE c.id IN (SELECT color_id FROM _purge_company_colors)
          AND NOT EXISTS (
            SELECT 1 FROM fabric_item_variants v WHERE v.color_id = c.id
          )`,
    );
    summary.fabric_colors = colorsResult.rowCount ?? 0;

    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM fabric_categories WHERE company_id = $1`,
      'fabric_categories',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM customers WHERE company_id = $1`,
      'customers',
      summary,
    );
    await deleteByCompany(
      client,
      companyId,
      `DELETE FROM suppliers WHERE company_id = $1`,
      'suppliers',
      summary,
    );

    const cashboxReset = await client.query(
      `UPDATE cashboxes
          SET opening_balance = 0,
              current_balance = 0,
              updated_at = now()
        WHERE company_id = $1`,
      [companyId],
    );
    summary.cashboxes_reset = cashboxReset.rowCount ?? 0;

    await client.query(
      `INSERT INTO audit_logs (company_id, user_id, action, entity_type, details)
       VALUES ($1, $2, 'PURGE_BUSINESS_DATA', 'company', $3::jsonb)`,
      [
        companyId,
        actorUserId,
        JSON.stringify({ summary, purgedAt: new Date().toISOString() }),
      ],
    );

    await client.query('COMMIT');

    return {
      purgedAt: new Date().toISOString(),
      tables: summary,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
