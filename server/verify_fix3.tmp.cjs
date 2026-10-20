const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';

  const byName = await pool.query(`SELECT id, color_code, name_ar FROM fabric_colors WHERE company_id=$1 AND name_ar = 'بني'`, [companyId]);
  console.log('fabric_colors matching بني:', byName.rows);
  const colorIds = byName.rows.map(r => r.id);

  const rolls = await pool.query(
    `SELECT fr.id, fr.barcode, fr.length_m
     FROM fabric_rolls fr
     LEFT JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     WHERE fr.company_id=$1
       AND (fi.name ILIKE $2 OR fi.internal_code ILIKE $2)
       AND fr.color_id = ANY($3::uuid[])
     LIMIT 10`,
    [companyId, '%ROYAL JAKAR%', colorIds]
  );
  console.log('matched rolls count:', rolls.rows.length);
  console.log(rolls.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
