const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });

// يحاكي شرط search الخادمي بالضبط (fabricRollRoutes) + onlyAvailable
const SEARCH_SQL = `
  SELECT fr.barcode, fr.length_m, fi.name AS item_name, fi.internal_code, fc.name_ar AS color_name_ar
  FROM fabric_rolls fr
  LEFT JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
  LEFT JOIN fabric_colors fc ON fc.id = fr.color_id AND fc.company_id = fr.company_id
  WHERE fr.company_id = $1
    AND (fr.barcode ILIKE $2 OR fr.roll_no ILIKE $2 OR fi.name ILIKE $2 OR fi.internal_code ILIKE $2
         OR fi.supplier_code ILIKE $2 OR fc.name_ar ILIKE $2 OR fc.color_code ILIKE $2
         OR fr.batch_no ILIKE $2 OR fr.container_no ILIKE $2)
    AND fr.status IN ('AVAILABLE','RESERVED') AND fr.length_m > 0`;

(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';
  for (const q of ['oliva max', '1008', '1000148', 'بني']) {
    const r = await pool.query(SEARCH_SQL, [companyId, `%${q}%`]);
    const byName = new Map();
    for (const row of r.rows) {
      const n = (row.item_name || '').trim() || '—';
      const g = byName.get(n) || { rolls: 0, meters: 0, codes: new Set(), colors: new Set() };
      g.rolls++; g.meters += parseFloat(row.length_m || '0');
      g.codes.add((row.internal_code || '').trim()); g.colors.add((row.color_name_ar || '').trim() || 'بدون لون');
      byName.set(n, g);
    }
    console.log(`\n>>> query "${q}" → ${r.rows.length} rolls, ${byName.size} material group(s)`);
    for (const [name, g] of [...byName.entries()].slice(0, 3)) {
      console.log(`   ${name}: ${g.rolls} أتواب / ${g.meters.toFixed(2)} م | أكواد: ${g.codes.size} | ألوان: ${g.colors.size}`);
    }
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
