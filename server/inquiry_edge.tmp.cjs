const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';

  // أصناف بلا أي أتواب (لن تظهر لو بحثنا بالأتواب فقط)
  const noRolls = await pool.query(`
    SELECT COUNT(*) FROM fabric_items fi
    WHERE fi.company_id=$1 AND NOT EXISTS (
      SELECT 1 FROM fabric_rolls fr WHERE fr.item_id=fi.id AND fr.company_id=fi.company_id)`, [companyId]);
  const totalItems = await pool.query(`SELECT COUNT(*) FROM fabric_items WHERE company_id=$1`, [companyId]);
  console.log('items with NO rolls:', noRolls.rows[0].count, '/ total items:', totalItems.rows[0].count);

  // هل اسم الكارتيلا (art_code) يطابق اسم صنف حقيقي؟ (لربط "هذا اللون تابع لهذه الخامة")
  const link = await pool.query(`
    SELECT cl.art_code,
           (SELECT COUNT(*) FROM fabric_items fi WHERE fi.company_id=cl.company_id AND fi.name ILIKE cl.art_code) AS items_by_name,
           (SELECT COUNT(*) FROM fabric_items fi WHERE fi.company_id=cl.company_id AND fi.internal_code ILIKE cl.art_code) AS items_by_code
    FROM cartela_labels cl WHERE cl.company_id=$1 GROUP BY cl.art_code, cl.company_id ORDER BY 2 DESC`, [companyId]);
  console.log('cartela art_code -> matching real items:');
  console.log(link.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
