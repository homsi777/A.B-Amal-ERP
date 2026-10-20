const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';

  const cartelaColors = await pool.query(`
    SELECT c.color_code, c.name_ar, cl.art_code
    FROM cartela_label_colors c JOIN cartela_labels cl ON cl.id=c.cartela_label_id
    WHERE c.company_id=$1 AND cl.serial_no='222555'
  `, [companyId]);
  console.log('ROYAL JAKAR (222555) cartela colors:', cartelaColors.rows);

  const rolls = await pool.query(`
    SELECT fc.name_ar, COUNT(*) c
    FROM fabric_rolls fr
    JOIN fabric_items fi ON fi.id=fr.item_id AND fi.company_id=fr.company_id
    LEFT JOIN fabric_colors fc ON fc.id=fr.color_id AND fc.company_id=fr.company_id
    WHERE fr.company_id=$1 AND fi.name ILIKE '%ROYAL JAKAR%'
    GROUP BY fc.name_ar ORDER BY c DESC
  `, [companyId]);
  console.log('ROYAL JAKAR real roll colors:', rolls.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
