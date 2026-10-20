const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const r = await pool.query(`
    SELECT DISTINCT fi.internal_code, fi.name, sil.company_id
    FROM sales_invoices si
    JOIN sales_invoice_lines sil ON sil.invoice_id = si.id
    LEFT JOIN fabric_rolls fr ON fr.id = sil.fabric_roll_id
    LEFT JOIN fabric_items fi ON fi.id = COALESCE(sil.fabric_item_id, fr.item_id)
    WHERE si.invoice_no = 'FB0000188'
    LIMIT 5
  `);
  console.log(r.rows);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
