const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const r = await pool.query(`
    SELECT si.invoice_no, c.name, c.phone, c.address
    FROM sales_invoices si
    JOIN customers c ON c.id = si.customer_id AND c.company_id = si.company_id
    WHERE c.phone IS NOT NULL AND c.phone <> '' AND c.address IS NOT NULL AND c.address <> ''
    LIMIT 3
  `);
  console.log(r.rows);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
