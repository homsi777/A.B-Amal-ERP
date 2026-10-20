const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';

  const items = await pool.query(
    `SELECT id, internal_code, name FROM fabric_items WHERE company_id=$1 AND internal_code ILIKE $2`,
    [companyId, '%oliva max%']
  );
  console.log('fabric_items matching "oliva max":', items.rows);

  const colors = await pool.query(
    `SELECT id, color_code, name_ar FROM fabric_colors WHERE company_id=$1 AND color_code ILIKE $2`,
    [companyId, '%C-01%']
  );
  console.log('fabric_colors matching "C-01":', colors.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
