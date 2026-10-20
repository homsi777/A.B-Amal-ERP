const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';
  const byName = await pool.query(`SELECT id FROM fabric_colors WHERE company_id=$1 AND name_ar = 'بني'`, [companyId]);
  const colorIds = byName.rows.map(r => r.id);

  const rolls = await pool.query(
    `SELECT fr.length_m
     FROM fabric_rolls fr
     LEFT JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     WHERE fr.company_id=$1
       AND (fi.name ILIKE $2 OR fi.internal_code ILIKE $2)
       AND fr.color_id = ANY($3::uuid[])
       AND fr.status IN ('AVAILABLE','RESERVED') AND fr.length_m > 0`,
    [companyId, '%ROYAL JAKAR%', colorIds]
  );
  const total = rolls.rows.reduce((s, r) => s + parseFloat(r.length_m || '0'), 0);
  console.log('ROYAL JAKAR + بني -> rollCount:', rolls.rows.length, 'totalMeters:', total.toFixed(2));
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
