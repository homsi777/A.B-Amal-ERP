/**
 * Roll back a CONFIRMED purchase Excel import:
 * 1) delete draft sales invoices that reserved rolls from the batch
 * 2) void linked purchase invoice
 * 3) purge voided purchase invoice (deactivate its rolls)
 * 4) delete any remaining AVAILABLE batch rolls
 * 5) mark import batch CANCELLED
 *
 * Usage on VPS:
 *   npx tsx server/src/scripts/rollbackConfirmedPurchaseImport.ts --batch-id=<uuid>
 *   npx tsx server/src/scripts/rollbackConfirmedPurchaseImport.ts --batch-id=<uuid> --apply
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from '../db/pool.js';
import {
  purgeVoidedPurchaseInvoice,
  voidPurchaseInvoice,
} from '../services/purchaseInvoiceService.js';
import { deleteSalesInvoiceDraft } from '../services/salesInvoiceService.js';
import { rollbackStockImportBatch } from '../services/repairStockImportItemsService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

function readArg(flag: string): string | undefined {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return undefined;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=').trim() || undefined;
  const idx = process.argv.indexOf(hit);
  return process.argv[idx + 1]?.trim() || undefined;
}

async function resolveCompanyId(pool: ReturnType<typeof getPool>): Promise<string> {
  const fromEnv = process.env.COMPANY_ID?.trim();
  if (fromEnv) return fromEnv;
  const c = await pool.query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
  if (!c.rows.length) throw new Error('لا توجد شركة');
  return c.rows[0].id;
}

async function main() {
  const batchId = readArg('--batch-id');
  const apply = process.argv.includes('--apply');
  if (!batchId) {
    console.error('Usage: --batch-id=<uuid> [--apply]');
    process.exit(1);
  }

  const pool = getPool();
  const companyId = await resolveCompanyId(pool);

  const batch = await pool.query<{
    id: string;
    file_name: string;
    status: string;
    created_purchase_invoice_id: string | null;
  }>(
    `SELECT id, file_name, status, created_purchase_invoice_id
     FROM purchase_import_batches WHERE id=$1 AND company_id=$2`,
    [batchId, companyId],
  );
  if (!batch.rows.length) throw new Error('دفعة الاستيراد غير موجودة');
  const b = batch.rows[0];
  if (b.status !== 'CONFIRMED') {
    throw new Error(`الدفعة ليست CONFIRMED (الحالية: ${b.status})`);
  }

  const draftSales = await pool.query<{ id: string; invoice_no: string; roll_count: string }>(
    `SELECT si.id, si.invoice_no, COUNT(DISTINCT fr.id)::text AS roll_count
     FROM sales_invoices si
     JOIN sales_invoice_lines sil ON sil.invoice_id = si.id AND sil.company_id = si.company_id
     JOIN fabric_rolls fr ON fr.id = sil.fabric_roll_id AND fr.company_id = sil.company_id
     WHERE si.company_id = $1
       AND si.document_status = 'DRAFT'
       AND fr.import_batch_id = $2
     GROUP BY si.id, si.invoice_no
     ORDER BY si.invoice_no`,
    [companyId, batchId],
  );

  const rollStats = await pool.query<{ status: string; cnt: string }>(
    `SELECT status, COUNT(*)::text AS cnt
     FROM fabric_rolls WHERE company_id=$1 AND import_batch_id=$2
     GROUP BY status ORDER BY status`,
    [companyId, batchId],
  );

  const purchaseInvoiceId = b.created_purchase_invoice_id;
  let purchaseInvoiceNo = '';
  if (purchaseInvoiceId) {
    const pi = await pool.query<{ invoice_no: string; document_status: string }>(
      `SELECT invoice_no, document_status FROM purchase_invoices WHERE id=$1 AND company_id=$2`,
      [purchaseInvoiceId, companyId],
    );
    purchaseInvoiceNo = pi.rows[0]?.invoice_no ?? '';
  }

  const report = {
    dryRun: !apply,
    batchId,
    fileName: b.file_name,
    purchaseInvoiceId,
    purchaseInvoiceNo,
    draftSalesToDelete: draftSales.rows,
    rollStats: rollStats.rows,
  };
  console.log(JSON.stringify(report, null, 2));

  if (!apply) {
    console.log('\n[rollback-purchase-import] DRY-RUN — add --apply to execute');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const si of draftSales.rows) {
      console.log(`[rollback] delete draft sales ${si.invoice_no}`);
      await deleteSalesInvoiceDraft(client, companyId, si.id);
    }

    if (purchaseInvoiceId) {
      console.log(`[rollback] void purchase ${purchaseInvoiceNo}`);
      await voidPurchaseInvoice(client, companyId, null, purchaseInvoiceId);
      console.log(`[rollback] purge voided purchase ${purchaseInvoiceNo}`);
      const purged = await purgeVoidedPurchaseInvoice(client, companyId, null, purchaseInvoiceId);
      console.log(`[rollback] rolls deactivated via purge: ${purged.rollsDeactivated}`);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const leftover = await rollbackStockImportBatch(pool, {
    companyId,
    batchId,
    dryRun: false,
  });
  console.log('[rollback] leftover AVAILABLE rolls deleted:', leftover);

  await pool.query(
    `UPDATE purchase_import_batches SET status='CANCELLED', updated_at=now() WHERE id=$1 AND company_id=$2`,
    [batchId, companyId],
  );

  console.log('[rollback-purchase-import] DONE');
  await pool.end();
}

main().catch((e) => {
  console.error('[rollback-purchase-import] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
