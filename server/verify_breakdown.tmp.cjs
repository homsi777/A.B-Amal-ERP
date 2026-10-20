const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';
  const rolls = await pool.query(
    `SELECT fr.length_m, fc.name_ar AS color_name_ar
     FROM fabric_rolls fr
     LEFT JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id AND fc.company_id = fr.company_id
     WHERE fr.company_id=$1 AND (fi.name ILIKE $2 OR fi.internal_code ILIKE $2)
       AND fr.status IN ('AVAILABLE','RESERVED') AND fr.length_m > 0`,
    [companyId, '%ROYAL JAKAR%']
  );
  const groups = new Map();
  for (const r of rolls.rows) {
    const name = (r.color_name_ar || '').trim() || 'بدون لون مُسجَّل';
    const g = groups.get(name) || { name, rollCount: 0, totalMeters: 0 };
    g.rollCount += 1;
    g.totalMeters += parseFloat(r.length_m || '0');
    groups.set(name, g);
  }
  const sorted = [...groups.values()].sort((a,b)=>b.totalMeters-a.totalMeters);
  console.log('total rolls:', rolls.rows.length);
  console.log(sorted.slice(0, 10));
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
