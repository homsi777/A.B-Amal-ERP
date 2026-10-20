const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const cartelas = await pool.query(`SELECT id, company_id, art_code, design_no, serial_no FROM cartela_labels ORDER BY updated_at DESC LIMIT 5`);
  console.log('=== recent cartela_labels ===');
  console.log(cartelas.rows);

  const colors = await pool.query(`
    SELECT c.id, c.cartela_label_id, c.color_no, c.color_code, c.barcode_code, cl.art_code, cl.serial_no
    FROM cartela_label_colors c
    JOIN cartela_labels cl ON cl.id = c.cartela_label_id
    ORDER BY c.updated_at DESC LIMIT 10
  `);
  console.log('=== recent cartela_label_colors ===');
  console.log(colors.rows);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
