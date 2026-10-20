const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const companies = await pool.query(`SELECT id, name FROM companies ORDER BY created_at`);
  console.log('companies:', companies.rows);
  const users = await pool.query(`SELECT id, username, company_id, role FROM users ORDER BY created_at`);
  console.log('users:', users.rows);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
