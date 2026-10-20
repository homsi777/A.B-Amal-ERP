const { Pool } = require('pg');
const { randomUUID } = require('crypto');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });

const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';
const warehouseId = '6a934572-f61f-47c0-99d9-cc0a0fd50e81'; // المستودع الرئيسي (MAIN)

(async () => {
  // find next unused 7-digit barcode
  const maxRes = await pool.query("SELECT barcode FROM fabric_rolls WHERE barcode ~ '^[0-9]{7}$' ORDER BY barcode DESC LIMIT 1");
  let nextBarcode = String(Number(maxRes.rows[0]?.barcode ?? 3290663) + 1);

  const itemId = randomUUID();
  await pool.query(
    `INSERT INTO fabric_items (id, company_id, internal_code, name, fabric_type, unit, is_active, default_selling_price, default_selling_currency_code, notes)
     VALUES ($1,$2,$3,$4,$5,$6,true,$7,'USD',$8)`,
    [
      itemId,
      companyId,
      'IMP-AYLUL-FLAM-014',
      'أيلول فلام',
      'عام',
      'meter',
      2.70,
      'أُضيف يدوياً لإعادة ثوب مرتجع من فاتورة FB0000014 (لم يكن مرتبطاً بالمخزون أصلاً - استيراد كشف حساب)',
    ],
  );

  const rollId = randomUUID();
  await pool.query(
    `INSERT INTO fabric_rolls (id, company_id, barcode, item_id, warehouse_id, length_m, unit_cost, currency_code, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'USD','AVAILABLE',$8)`,
    [
      rollId,
      companyId,
      nextBarcode,
      itemId,
      warehouseId,
      91.000,
      2.70,
      'ثوب مُعاد إدخاله يدوياً حسب بيانات مرتجع RTN-MUZGVHJ6-428983 على فاتورة FB0000014 — الفاتورة الأصلية كانت استيراد كشف حساب بدون ربط مخزون',
    ],
  );

  console.log('Created fabric_item:', itemId, '(أيلول فلام / IMP-AYLUL-FLAM-014)');
  console.log('Created fabric_roll:', rollId, 'barcode:', nextBarcode, 'warehouse: المستودع الرئيسي (MAIN), length_m: 91.000, status: AVAILABLE');

  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
