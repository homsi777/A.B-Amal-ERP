const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable', connectionTimeoutMillis: 3000 });
pool.query('SELECT 1').then(() => { console.log('TUNNEL_OK'); process.exit(0); }).catch(e => { console.log('TUNNEL_DOWN', e.message); process.exit(1); });
