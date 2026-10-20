const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';

  const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='fabric_rolls' ORDER BY column_name`);
  console.log('fabric_rolls columns:', cols.rows.map(r=>r.column_name).join(', '));

  const oliva = await pool.query(`
    SELECT fr.id, fr.barcode, fr.item_id, fr.color_id, fi.name, fc.name_ar
    FROM fabric_rolls fr
    JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
    LEFT JOIN fabric_colors fc ON fc.id = fr.color_id AND fc.company_id = fr.company_id
    WHERE fr.company_id=$1 AND fi.name ILIKE '%oliva max%'
    LIMIT 10
  `, [companyId]);
  console.log('oliva max rolls sample:', oliva.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
