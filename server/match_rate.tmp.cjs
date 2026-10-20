const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';
  const cartelas = await pool.query(`SELECT DISTINCT art_code FROM cartela_labels WHERE company_id=$1`, [companyId]);
  console.log('total distinct art_codes in cartela:', cartelas.rows.length);

  let matched = 0;
  for (const row of cartelas.rows) {
    const code = row.art_code.trim();
    if (!code) continue;
    const r = await pool.query(
      `SELECT 1 FROM fabric_items WHERE company_id=$1 AND (internal_code ILIKE $2 OR name ILIKE $2) LIMIT 1`,
      [companyId, `%${code}%`]
    );
    if (r.rows.length > 0) matched++;
  }
  console.log('matched against fabric_items (internal_code or name ILIKE):', matched, '/', cartelas.rows.length);

  const colorsC = await pool.query(`SELECT DISTINCT color_code FROM cartela_label_colors WHERE company_id=$1`, [companyId]);
  console.log('total distinct color_codes in cartela:', colorsC.rows.length);
  let colorMatched = 0;
  for (const row of colorsC.rows) {
    const code = row.color_code.trim();
    if (!code) continue;
    const r = await pool.query(
      `SELECT 1 FROM fabric_colors WHERE company_id=$1 AND color_code ILIKE $2 LIMIT 1`,
      [companyId, code]
    );
    if (r.rows.length > 0) colorMatched++;
  }
  console.log('matched against fabric_colors (exact color_code):', colorMatched, '/', colorsC.rows.length);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
