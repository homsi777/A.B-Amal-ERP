const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';

  // Simulate goAuditColor logic for oliva max / C-01 / أحمر
  const byCode = await pool.query(`SELECT id, color_code FROM fabric_colors WHERE company_id=$1 AND color_code ILIKE $2`, [companyId, '%C-01%']);
  console.log('byCode candidates:', byCode.rows);

  const byName = await pool.query(`SELECT id, color_code, name_ar FROM fabric_colors WHERE company_id=$1 AND (name_ar ILIKE $2 OR name_tr ILIKE $2 OR color_code ILIKE $2)`, [companyId, '%احمر%']);
  const exactName = byName.rows.filter(r => r.name_ar.trim() === 'احمر');
  console.log('byName candidates (exact):', exactName);

  const colorIds = exactName.map(r => r.id);
  // Now simulate the roll query with search=oliva max AND color_id = ANY(colorIds)
  const rolls = await pool.query(
    `SELECT fr.id, fr.barcode, fr.length_m, fr.color_id, fi.name AS item_name, fi.internal_code
     FROM fabric_rolls fr
     LEFT JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     WHERE fr.company_id=$1
       AND (fr.barcode ILIKE $2 OR fi.name ILIKE $2 OR fi.internal_code ILIKE $2)
       AND fr.color_id = ANY($3::uuid[])
     LIMIT 20`,
    [companyId, '%oliva max%', colorIds]
  );
  console.log('matched rolls count:', rolls.rows.length);
  console.log(rolls.rows.slice(0, 10));

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
