/**
 * generateBarcode() — تسلسلي يبدأ من 0000001، لا عشوائي (بناءً على ملاحظة
 * المدير: "توليد الباركود عشوائي جداً"). النطاق الجديد (0xxxxxx) لا يتقاطع
 * أبداً مع الباركودات العشوائية القديمة (كانت تُولَّد دوماً بين 1000000
 * و9999999)، فـ"مراعاة الأرقام الموجودة حالياً" مضمونة بنيوياً بلا أي فحص
 * إضافي. بلا قاعدة بيانات حقيقية — عميل مزيّف بنفس نمط fake-db المعتمد
 * بالمشروع.
 */
import assert from 'node:assert/strict';
import { generateBarcode } from './rollHelpers.js';

type Row = Record<string, unknown>;

function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function createFakeDb(existingBarcodes: string[]) {
  const rolls: Row[] = existingBarcodes.map((barcode, i) => ({ id: `roll-${i}`, company_id: 'co-1', barcode }));
  const query = async (text: string, params: unknown[] = []): Promise<{ rows: Row[] }> => {
    const sql = norm(text);
    if (sql.includes('select max(barcode)::text as max_barcode') && sql.includes("barcode ~ '^0[0-9]{6}$'")) {
      const [companyId] = params as [string];
      const matching = rolls
        .filter((r) => r.company_id === companyId && /^0[0-9]{6}$/.test(String(r.barcode)))
        .map((r) => String(r.barcode));
      return { rows: [{ max_barcode: matching.length ? matching.sort().slice(-1)[0] : null }] };
    }
    if (sql.includes('select id from fabric_rolls where company_id=$1 and barcode=$2')) {
      const [companyId, barcode] = params as [string, string];
      const exists = rolls.some((r) => r.company_id === companyId && r.barcode === barcode);
      return { rows: exists ? [{ id: 'x' }] : [] };
    }
    throw new Error(`Unhandled fake query: ${sql}`);
  };
  return { query } as unknown as import('pg').Pool;
}

async function run() {
  // شركة جديدة بلا أي أتواب — أول باركود يجب أن يكون 0000001 بالضبط، لا رقم عشوائي.
  {
    const db = createFakeDb([]);
    const barcode = await generateBarcode(db, 'co-1');
    assert.equal(barcode, '0000001');
  }

  // استمرار تسلسلي بعد آخر رقم مُستخدَم بالنطاق الجديد فقط.
  {
    const db = createFakeDb(['0000001', '0000002', '0000005']);
    const barcode = await generateBarcode(db, 'co-1');
    assert.equal(barcode, '0000006');
  }

  // وجود باركودات عشوائية قديمة (بالنطاق 1000000+) لا يُزيح نقطة البداية
  // الجديدة إطلاقاً — تبقى 0000001 رغم وجود أرقام عشوائية ضخمة سابقاً.
  {
    const db = createFakeDb(['5234567', '9999998']);
    const barcode = await generateBarcode(db, 'co-1');
    assert.equal(barcode, '0000001');
  }

  // عزل بين الشركات — شركة أخرى لا تتأثر بتسلسل شركة غيرها.
  {
    const db = createFakeDb(['0000001', '0000002']);
    const barcode = await generateBarcode(db, 'co-2');
    assert.equal(barcode, '0000001');
  }

  console.log('  ✓ first barcode for a fresh company is exactly 0000001');
  console.log('  ✓ continues sequentially from the last used number in the new range');
  console.log('  ✓ legacy random (1000000+) barcodes never shift the new starting point');
  console.log('  ✓ sequence is isolated per company');
  console.log('generateBarcode.test.ts OK');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
