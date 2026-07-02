import type { Pool, PoolClient } from 'pg';
import { INVOICE_AMOUNT_EPS } from './invoiceAmountHelpers.js';
import {
  backfillSalesInvoiceLineRollLinks,
  quantityToMeters,
  resolveSalesInvoiceLineRollId,
  syncDraftSalesInvoiceRollReservations,
} from './salesInvoiceService.js';

const EPS = INVOICE_AMOUNT_EPS;

export type RepairSalesInvoiceRollLinksReport = {
  draftInvoicesScanned: number;
  draftLinesLinked: number;
  draftRollsReserved: number;
  confirmedInvoicesScanned: number;
  confirmedLinesLinked: number;
  confirmedStockFixed: number;
  confirmedStockSkipped: number;
  confirmedStatusFixed: number;
  details: string[];
};

function parseMetadata(raw: unknown): Record<string, unknown> {
  try {
    return typeof raw === 'string'
      ? (JSON.parse(raw) as Record<string, unknown>)
      : ((raw as Record<string, unknown>) ?? {});
  } catch {
    return {};
  }
}

async function hasSalesMovement(
  client: PoolClient,
  companyId: string,
  rollId: string,
  invoiceId: string,
): Promise<boolean> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM inventory_movements
     WHERE company_id = $1 AND roll_id = $2
       AND reference_type = 'SALES_INVOICE' AND reference_id = $3::uuid
     LIMIT 1`,
    [companyId, rollId, invoiceId],
  );
  return r.rows.length > 0;
}

async function repairConfirmedInvoiceStock(
  client: PoolClient,
  companyId: string,
  invoiceId: string,
  invoiceNo: string,
  dryRun: boolean,
): Promise<{ fixed: number; skipped: number; details: string[] }> {
  const lines = await client.query<{
    id: string;
    fabric_roll_id: string | null;
    metadata: unknown;
    quantity: string;
    unit: string;
  }>(
    `SELECT id, fabric_roll_id, metadata, quantity, unit
     FROM sales_invoice_lines
     WHERE invoice_id = $1 AND company_id = $2
     ORDER BY line_no`,
    [invoiceId, companyId],
  );

  let fixed = 0;
  let skipped = 0;
  const details: string[] = [];

  for (const ln of lines.rows) {
    const qtyM = quantityToMeters(Number(ln.quantity), ln.unit as 'meter' | 'yard');
    if (qtyM <= EPS) {
      skipped += 1;
      continue;
    }

    let rollId = ln.fabric_roll_id;
    if (!rollId) {
      rollId = await resolveSalesInvoiceLineRollId(client, companyId, ln, { requireAvailable: false });
      if (rollId && !dryRun) {
        await client.query(
          `UPDATE sales_invoice_lines SET fabric_roll_id=$3 WHERE id=$1 AND company_id=$2`,
          [ln.id, companyId, rollId],
        );
      }
    }
    if (!rollId) {
      skipped += 1;
      details.push(`SKIP stock invoice=${invoiceNo} line=${ln.id}: no roll link`);
      continue;
    }

    if (await hasSalesMovement(client, companyId, rollId, invoiceId)) {
      skipped += 1;
      continue;
    }

    const rollRow = await client.query<{ id: string; length_m: string; status: string }>(
      `SELECT id, length_m, status FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`,
      [rollId, companyId],
    );
    if (!rollRow.rows.length) {
      skipped += 1;
      details.push(`SKIP stock invoice=${invoiceNo} roll=${rollId}: missing roll`);
      continue;
    }

    const roll = rollRow.rows[0];
    if (roll.status !== 'AVAILABLE' && roll.status !== 'RESERVED') {
      skipped += 1;
      continue;
    }

    const len = Number(roll.length_m);
    const soldQty = Math.min(qtyM, len);
    if (soldQty <= EPS) {
      skipped += 1;
      continue;
    }

    const newLen = Math.round((len - soldQty) * 100) / 100;
    const fullSale = soldQty >= len - EPS || newLen <= EPS;
    const note = fullSale ? `بيع — ${invoiceNo}` : `بيع جزئي — ${invoiceNo}`;

    if (dryRun) {
      fixed += 1;
      details.push(
        `DRY stock invoice=${invoiceNo} roll=${rollId}: ${fullSale ? 'SOLD' : `len ${len}→${newLen}`}`,
      );
      continue;
    }

    if (fullSale) {
      await client.query(
        `UPDATE fabric_rolls SET length_m=0, status='SOLD', updated_at=now() WHERE id=$1 AND company_id=$2`,
        [rollId, companyId],
      );
      await client.query(
        `INSERT INTO inventory_movements (
           company_id, roll_id, movement_type, old_status, new_status,
           length_delta_m, reference_type, reference_id, reference_no, notes
         ) VALUES ($1,$2,'SALE',$3,$4,$5,$6,$7,$8,$9)`,
        [companyId, rollId, roll.status, 'SOLD', -len, 'SALES_INVOICE', invoiceId, invoiceNo, note],
      );
    } else {
      await client.query(
        `UPDATE fabric_rolls SET length_m=$3, status='AVAILABLE', updated_at=now() WHERE id=$1 AND company_id=$2`,
        [rollId, companyId, newLen],
      );
      await client.query(
        `INSERT INTO inventory_movements (
           company_id, roll_id, movement_type, old_status, new_status,
           length_delta_m, reference_type, reference_id, reference_no, notes
         ) VALUES ($1,$2,'SALE',$3,$4,$5,$6,$7,$8,$9)`,
        [companyId, rollId, roll.status, 'AVAILABLE', -soldQty, 'SALES_INVOICE', invoiceId, invoiceNo, note],
      );
    }

    const meta = parseMetadata(ln.metadata);
    meta.inventory = {
      ...(typeof meta.inventory === 'object' && meta.inventory ? (meta.inventory as Record<string, unknown>) : {}),
      fabric_roll_id: rollId,
      prev_length_m: len,
      prev_status: roll.status,
      qty_sold_m: soldQty,
      final_length_m: fullSale ? 0 : newLen,
      final_status: fullSale ? 'SOLD' : 'AVAILABLE',
      repaired_at: new Date().toISOString(),
    };
    await client.query(
      `UPDATE sales_invoice_lines SET metadata=$3::jsonb WHERE id=$1 AND company_id=$2`,
      [ln.id, companyId, JSON.stringify(meta)],
    );

    fixed += 1;
    details.push(`FIX stock invoice=${invoiceNo} roll=${rollId}: ${fullSale ? 'SOLD' : `len ${len}→${newLen}`}`);
  }

  return { fixed, skipped, details };
}

/** أتواب بيع جزئي مؤكّد: الطول خُصم لكن الحالة بقيت RESERVED بدل AVAILABLE. */
async function repairStuckReservedAfterPartialSale(
  client: PoolClient,
  companyId: string,
  dryRun: boolean,
): Promise<{ fixed: number; details: string[] }> {
  const rows = await client.query<{ id: string; length_m: string; barcode: string | null }>(
    `SELECT fr.id, fr.length_m, fr.barcode
     FROM fabric_rolls fr
     WHERE fr.company_id = $1
       AND fr.status = 'RESERVED'
       AND fr.length_m > $2
       AND EXISTS (
         SELECT 1
         FROM sales_invoice_lines sil
         INNER JOIN sales_invoices si ON si.id = sil.invoice_id AND si.company_id = sil.company_id
         INNER JOIN inventory_movements im
           ON im.company_id = fr.company_id
          AND im.roll_id = fr.id
          AND im.reference_type = 'SALES_INVOICE'
          AND im.reference_id = si.id
          AND im.movement_type = 'SALE'
         WHERE sil.fabric_roll_id = fr.id
           AND sil.company_id = fr.company_id
           AND si.document_status = 'CONFIRMED'
       )`,
    [companyId, EPS],
  );

  let fixed = 0;
  const details: string[] = [];

  for (const row of rows.rows) {
    const label = row.barcode?.trim() || row.id;
    if (dryRun) {
      fixed += 1;
      details.push(`DRY status roll=${label}: RESERVED→AVAILABLE (len=${row.length_m})`);
      continue;
    }

    await client.query(
      `UPDATE fabric_rolls SET status='AVAILABLE', updated_at=now() WHERE id=$1 AND company_id=$2`,
      [row.id, companyId],
    );
    fixed += 1;
    details.push(`FIX status roll=${label}: RESERVED→AVAILABLE (len=${row.length_m})`);
  }

  return { fixed, details };
}

export async function repairSalesInvoiceRollLinks(
  pool: Pool,
  opts: { companyId: string; dryRun: boolean; invoiceId?: string | null },
): Promise<RepairSalesInvoiceRollLinksReport> {
  const client = await pool.connect();
  const report: RepairSalesInvoiceRollLinksReport = {
    draftInvoicesScanned: 0,
    draftLinesLinked: 0,
    draftRollsReserved: 0,
    confirmedInvoicesScanned: 0,
    confirmedLinesLinked: 0,
    confirmedStockFixed: 0,
    confirmedStockSkipped: 0,
    confirmedStatusFixed: 0,
    details: [],
  };

  try {
    if (!opts.dryRun) await client.query('BEGIN');

    const draftInvoices = await client.query<{ id: string; invoice_no: string }>(
      `SELECT id, invoice_no FROM sales_invoices
       WHERE company_id = $1 AND document_status = 'DRAFT'
         ${opts.invoiceId ? 'AND id = $2::uuid' : ''}
       ORDER BY updated_at DESC NULLS LAST, created_at DESC`,
      opts.invoiceId ? [opts.companyId, opts.invoiceId] : [opts.companyId],
    );

    for (const inv of draftInvoices.rows) {
      report.draftInvoicesScanned += 1;
      const linked = opts.dryRun
        ? await countLinkableDraftLines(client, opts.companyId, inv.id)
        : await backfillSalesInvoiceLineRollLinks(client, opts.companyId, inv.id);
      report.draftLinesLinked += linked;
      if (linked > 0) {
        report.details.push(`LINK draft invoice=${inv.invoice_no}: ${linked} line(s)`);
      }
      if (!opts.dryRun) {
        await syncDraftSalesInvoiceRollReservations(client, opts.companyId, null, inv.id);
        report.draftRollsReserved += 1;
        report.details.push(`RESERVE draft invoice=${inv.invoice_no}`);
      }
    }

    const confirmedInvoices = await client.query<{ id: string; invoice_no: string }>(
      `SELECT id, invoice_no FROM sales_invoices
       WHERE company_id = $1 AND document_status = 'CONFIRMED'
         ${opts.invoiceId ? 'AND id = $2::uuid' : ''}
       ORDER BY confirmed_at DESC NULLS LAST, updated_at DESC`,
      opts.invoiceId ? [opts.companyId, opts.invoiceId] : [opts.companyId],
    );

    for (const inv of confirmedInvoices.rows) {
      report.confirmedInvoicesScanned += 1;
      if (!opts.dryRun) {
        report.confirmedLinesLinked += await backfillSalesInvoiceLineRollLinks(client, opts.companyId, inv.id);
      }
      const stock = await repairConfirmedInvoiceStock(
        client,
        opts.companyId,
        inv.id,
        inv.invoice_no,
        opts.dryRun,
      );
      report.confirmedStockFixed += stock.fixed;
      report.confirmedStockSkipped += stock.skipped;
      report.details.push(...stock.details);
    }

    const statusRepair = await repairStuckReservedAfterPartialSale(client, opts.companyId, opts.dryRun);
    report.confirmedStatusFixed = statusRepair.fixed;
    report.details.push(...statusRepair.details);

    if (!opts.dryRun) await client.query('COMMIT');
  } catch (err) {
    if (!opts.dryRun) await client.query('ROLLBACK').catch(() => { /* ignore */ });
    throw err;
  } finally {
    client.release();
  }

  return report;
}

async function countLinkableDraftLines(
  client: PoolClient,
  companyId: string,
  invoiceId: string,
): Promise<number> {
  const lines = await client.query<{ id: string; fabric_roll_id: string | null; metadata: unknown }>(
    `SELECT id, fabric_roll_id, metadata FROM sales_invoice_lines WHERE invoice_id=$1 AND company_id=$2`,
    [invoiceId, companyId],
  );
  let count = 0;
  for (const ln of lines.rows) {
    if (ln.fabric_roll_id) continue;
    const rollId = await resolveSalesInvoiceLineRollId(client, companyId, ln);
    if (rollId) count += 1;
  }
  return count;
}
