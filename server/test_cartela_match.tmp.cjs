const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });
(async () => {
  const cc = await pool.query(`
    SELECT cl.serial_no, c.color_code, c.barcode_code
    FROM cartela_label_colors c
    JOIN cartela_labels cl ON cl.id = c.cartela_label_id
    WHERE c.barcode_code IS NOT NULL AND c.barcode_code <> ''
    LIMIT 5
  `);
  console.log('cartela_label_colors sample:', cc.rows);

  const fc = await pool.query(`
    SELECT id, color_code, name_ar FROM fabric_colors LIMIT 5
  `).catch(e => ({ error: e.message, rows: [] }));
  console.log('fabric_colors sample:', fc.rows, fc.error || '');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
