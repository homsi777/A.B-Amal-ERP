const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';

  // 1) اسم خامة: "oliva max" -> كم كود ولون وأتواب
  const byName = await pool.query(`
    SELECT fi.name, fi.internal_code, COUNT(fr.id) rolls,
           ROUND(SUM(CASE WHEN fr.status IN ('AVAILABLE','RESERVED') THEN fr.length_m ELSE 0 END),2) meters
    FROM fabric_items fi
    LEFT JOIN fabric_rolls fr ON fr.item_id = fi.id AND fr.company_id = fi.company_id
    WHERE fi.company_id=$1 AND fi.name ILIKE $2
    GROUP BY fi.name, fi.internal_code ORDER BY fi.internal_code`, [companyId, '%oliva max%']);
  console.log('=== search by NAME "oliva max" -> codes:', byName.rows.length);
  console.log(byName.rows.slice(0, 6));

  // 2) كود خامة محدد
  const byCode = await pool.query(`
    SELECT fi.name, fi.internal_code, fc.name_ar color, COUNT(fr.id) rolls
    FROM fabric_items fi
    LEFT JOIN fabric_rolls fr ON fr.item_id = fi.id AND fr.company_id = fi.company_id
    LEFT JOIN fabric_colors fc ON fc.id = fr.color_id AND fc.company_id = fi.company_id
    WHERE fi.company_id=$1 AND fi.internal_code = $2
    GROUP BY fi.name, fi.internal_code, fc.name_ar`, [companyId, '1008']);
  console.log('=== search by CODE "1008":');
  console.log(byCode.rows);

  // 3) باركود توب موجود
  const byBarcode = await pool.query(`
    SELECT fr.barcode, fi.name, fi.internal_code, fc.name_ar color, fr.length_m, fr.status, w.name warehouse
    FROM fabric_rolls fr
    LEFT JOIN fabric_items fi ON fi.id=fr.item_id AND fi.company_id=fr.company_id
    LEFT JOIN fabric_colors fc ON fc.id=fr.color_id AND fc.company_id=fr.company_id
    LEFT JOIN warehouses w ON w.id=fr.warehouse_id AND w.company_id=fr.company_id
    WHERE fr.company_id=$1 AND fr.status IN ('AVAILABLE','RESERVED') AND fr.length_m>0
    LIMIT 3`, [companyId]);
  console.log('=== sample ROLL barcodes (what a roll-barcode search returns):');
  console.log(byBarcode.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
