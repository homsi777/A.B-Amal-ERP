const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';
  const scan = '0038-C-01';
  const r = await pool.query(
    `SELECT to_jsonb(cl.*) AS cartela, to_jsonb(c.*) AS color
     FROM cartela_label_colors c
     JOIN cartela_labels cl ON cl.id = c.cartela_label_id AND cl.company_id = c.company_id
     WHERE c.company_id = $1 AND upper(c.barcode_code) = $2 LIMIT 1`,
    [companyId, scan.toUpperCase()]
  );
  console.log('rows found:', r.rows.length);
  console.log(r.rows[0] ? 'MATCHED' : 'NO MATCH');

  // Check how many companies exist and how many cartela records each has
  const byCompany = await pool.query(`SELECT company_id, COUNT(*) FROM cartela_labels GROUP BY company_id`);
  console.log('cartela_labels by company:', byCompany.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
