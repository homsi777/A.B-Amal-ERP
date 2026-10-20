const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });

(async () => {
  const comp = await pool.query(`SELECT company_id, COUNT(*) c FROM sales_invoice_lines GROUP BY company_id ORDER BY c DESC LIMIT 1`);
  const companyId = comp.rows[0].company_id;
  const item = await pool.query(`
    SELECT fi.id, fi.internal_code, fi.name, COUNT(*) cnt
    FROM sales_invoice_lines sil
    JOIN sales_invoices si ON si.id = sil.invoice_id AND si.company_id = sil.company_id
    LEFT JOIN fabric_rolls fr ON fr.id = sil.fabric_roll_id AND fr.company_id = sil.company_id
    LEFT JOIN fabric_items fi ON fi.id = COALESCE(sil.fabric_item_id, fr.item_id) AND fi.company_id = sil.company_id
    WHERE sil.company_id = $1
    GROUP BY fi.id, fi.internal_code, fi.name
    ORDER BY cnt DESC
    LIMIT 3
  `, [companyId]);
  console.log('company', companyId);
  console.log(item.rows);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
