const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';
  const a = await pool.query(`SELECT DISTINCT color_code FROM cartela_label_colors WHERE company_id=$1 ORDER BY 1`, [companyId]);
  console.log('cartela color_codes:', a.rows.map(r => r.color_code));
  const b = await pool.query(`SELECT color_code, name_ar FROM fabric_colors WHERE company_id=$1 ORDER BY 1 LIMIT 40`, [companyId]);
  console.log('fabric_colors (first 40):', b.rows);

  const items1 = await pool.query(`SELECT DISTINCT art_code FROM cartela_labels WHERE company_id=$1 ORDER BY 1`, [companyId]);
  console.log('cartela art_codes:', items1.rows.map(r=>r.art_code));
  const items2 = await pool.query(`SELECT internal_code, name FROM fabric_items WHERE company_id=$1 ORDER BY internal_code LIMIT 40`, [companyId]);
  console.log('fabric_items (first 40):', items2.rows);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
