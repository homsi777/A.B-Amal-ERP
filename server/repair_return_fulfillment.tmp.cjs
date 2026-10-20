const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });

const EPS = 1e-4;
const invoiceNos = ['FB0000014', 'FB0000038', 'FB0000140', 'FB0000146', 'FB0000161', 'FB0000200'];

function toMeters(qty, unit) {
  return unit === 'yard' ? qty * 0.9144 : qty;
}

(async () => {
  for (const invoiceNo of invoiceNos) {
    const invRes = await pool.query(
      `SELECT id, company_id, return_fulfillment_status FROM sales_invoices WHERE invoice_no = $1`,
      [invoiceNo],
    );
    const inv = invRes.rows[0];
    if (!inv) { console.log(invoiceNo, 'NOT FOUND'); continue; }

    const lines = await pool.query(
      `SELECT id, quantity, unit FROM sales_invoice_lines WHERE company_id=$1 AND invoice_id=$2`,
      [inv.company_id, inv.id],
    );

    let anyReturn = false;
    let allFully = true;
    for (const ln of lines.rows) {
      const origM = toMeters(Number(ln.quantity), ln.unit === 'yard' ? 'yard' : 'meter');
      if (origM <= EPS) continue;
      const sumRes = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN ril.unit = 'yard' THEN ril.quantity * 0.9144 ELSE ril.quantity END), 0)::numeric AS s
         FROM return_invoice_lines ril
         INNER JOIN return_invoices ri ON ri.id = ril.return_invoice_id AND ri.company_id = ril.company_id
         WHERE ril.company_id = $1 AND ri.status = 'CONFIRMED' AND ril.original_sales_invoice_line_id = $2`,
        [inv.company_id, ln.id],
      );
      const retM = Number(sumRes.rows[0]?.s ?? 0);
      if (retM > EPS) anyReturn = true;
      if (retM < origM - EPS) allFully = false;
    }

    const status = !anyReturn ? 'NOT_RETURNED' : allFully ? 'FULLY_RETURNED' : 'PARTIALLY_RETURNED';
    console.log(invoiceNo, 'current:', inv.return_fulfillment_status, '-> computed:', status);

    if (status !== inv.return_fulfillment_status) {
      await pool.query(
        `UPDATE sales_invoices SET return_fulfillment_status=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
        [inv.id, inv.company_id, status],
      );
      console.log('  -> UPDATED');
    } else {
      console.log('  -> no change needed');
    }
  }
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
