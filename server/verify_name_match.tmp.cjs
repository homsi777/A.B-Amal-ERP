const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';

  // Does "oliva max" actually match by NAME (my earlier narrow test only checked internal_code)
  const itemsByName = await pool.query(
    `SELECT id, internal_code, name FROM fabric_items WHERE company_id=$1 AND name ILIKE $2`,
    [companyId, '%oliva max%']
  );
  console.log('fabric_items matching NAME "oliva max":', itemsByName.rows.length, itemsByName.rows.slice(0,3));

  // color_code empty-rate
  const emptyCount = await pool.query(`SELECT COUNT(*) FILTER (WHERE color_code = '' OR color_code IS NULL) AS empty, COUNT(*) AS total FROM fabric_colors WHERE company_id=$1`, [companyId]);
  console.log('fabric_colors color_code empty vs total:', emptyCount.rows[0]);

  // name_ar match for "أحمر"
  const colorsByName = await pool.query(
    `SELECT id, color_code, name_ar FROM fabric_colors WHERE company_id=$1 AND name_ar = $2`,
    [companyId, 'احمر']
  );
  console.log('fabric_colors exact name_ar = "احمر":', colorsByName.rows);

  // overall match rate using cartela_label_colors.name_ar vs fabric_colors.name_ar
  const cartelaColorNames = await pool.query(`SELECT DISTINCT name_ar FROM cartela_label_colors WHERE company_id=$1 AND name_ar <> ''`, [companyId]);
  console.log('distinct cartela color name_ar values:', cartelaColorNames.rows.map(r=>r.name_ar));
  let nameMatched = 0;
  for (const row of cartelaColorNames.rows) {
    const r = await pool.query(`SELECT 1 FROM fabric_colors WHERE company_id=$1 AND name_ar = $2`, [companyId, row.name_ar.trim()]);
    if (r.rows.length > 0) nameMatched++;
  }
  console.log('matched by exact name_ar:', nameMatched, '/', cartelaColorNames.rows.length);

  // material name match rate (name ILIKE, not internal_code)
  const cartelaArtCodes = await pool.query(`SELECT DISTINCT art_code FROM cartela_labels WHERE company_id=$1`, [companyId]);
  let nameMatchedItems = 0;
  for (const row of cartelaArtCodes.rows) {
    const r = await pool.query(`SELECT 1 FROM fabric_items WHERE company_id=$1 AND name ILIKE $2 LIMIT 1`, [companyId, row.art_code.trim()]);
    if (r.rows.length > 0) nameMatchedItems++;
  }
  console.log('material matched by exact name ILIKE:', nameMatchedItems, '/', cartelaArtCodes.rows.length);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
