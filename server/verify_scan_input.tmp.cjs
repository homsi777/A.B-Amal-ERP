const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';
  const baseSql = `SELECT c.barcode_code
     FROM cartela_label_colors c
     JOIN cartela_labels cl ON cl.id = c.cartela_label_id AND cl.company_id = c.company_id
    WHERE c.company_id = $1 AND upper(c.barcode_code) = $2 LIMIT 1`;

  const r1 = await pool.query(baseSql, [companyId, 'ROYAL JAKAR']);
  console.log('scan="ROYAL JAKAR" ->', r1.rows.length, 'matches (expected 0, that is a name not a barcode)');

  const r2 = await pool.query(baseSql, [companyId, '222555-V-4']);
  console.log('scan="222555-V-4" ->', r2.rows.length, 'matches (expected 1, this is an actual barcode)');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
