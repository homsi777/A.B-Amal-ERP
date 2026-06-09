import * as fs from 'fs';
import pg from 'pg';
import { parseStockWorkbook } from '../src/lib/stockExcelImport.ts';

const xlsxPath = fs.readdirSync('.').find((f) => f.endsWith('-15.xlsx')) || 'مستودعات حلب-15.xlsx';
const buf = fs.readFileSync(xlsxPath);
const preview = await parseStockWorkbook({
  name: xlsxPath,
  size: buf.length,
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
});
const incoming = preview.sheets.find((s) => s.kind === 'incoming');
const excelRows = incoming.rows.filter((r) => r.itemName);

const pool = new pg.Pool({
  connectionString: 'postgresql://erp_user:FabricERP_2026!@127.0.0.1:5433/fabric_erp?sslmode=disable',
});
const dbRolls = await pool.query(`
  SELECT r.barcode, r.length_m::float AS length_m,
         fi.name AS item_name, fi.internal_code AS item_code,
         COALESCE(fc.name_ar, fc.name_tr, '') AS color_name,
         COALESCE(fc.color_code, '') AS color_code
  FROM fabric_rolls r
  LEFT JOIN fabric_items fi ON fi.id = r.item_id
  LEFT JOIN fabric_colors fc ON fc.id = r.color_id
  WHERE r.status = 'AVAILABLE' AND r.length_m > 0
  ORDER BY fi.name, r.length_m
`);

function multiset(arr) {
  const m = new Map();
  for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
  return m;
}

const excelLens = excelRows.map((r) => Number(r.quantity.toFixed(2))).sort((a, b) => a - b);
const dbLens = dbRolls.rows.map((r) => Number(Number(r.length_m).toFixed(2))).sort((a, b) => a - b);

let lensMatch = excelLens.length === dbLens.length;
if (lensMatch) {
  for (let i = 0; i < excelLens.length; i++) {
    if (excelLens[i] !== dbLens[i]) { lensMatch = false; break; }
  }
}
console.log('Lengths multiset exact match:', lensMatch);

// Per item: compare roll counts and length multisets
const byItemExcel = new Map();
for (const r of excelRows) {
  const k = r.itemName.trim();
  const list = byItemExcel.get(k) || [];
  list.push({
    itemCode: r.itemCode,
    colorName: r.colorName,
    colorNameTr: r.colorNameTr,
    colorCode: r.colorCode,
    length: Number(r.quantity.toFixed(2)),
  });
  byItemExcel.set(k, list);
}
const byItemDb = new Map();
for (const r of dbRolls.rows) {
  const k = r.item_name.trim();
  const list = byItemDb.get(k) || [];
  list.push({
    itemCode: r.item_code,
    colorName: r.color_name,
    colorCode: r.color_code,
    length: Number(Number(r.length_m).toFixed(2)),
    barcode: r.barcode,
  });
  byItemDb.set(k, list);
}

console.log('\n=== PER ITEM (lengths match?) ===');
for (const item of [...new Set([...byItemExcel.keys(), ...byItemDb.keys()])].sort()) {
  const e = byItemExcel.get(item) || [];
  const d = byItemDb.get(item) || [];
  const eLens = e.map((x) => x.length).sort((a, b) => a - b);
  const dLens = d.map((x) => x.length).sort((a, b) => a - b);
  const lengthsOk = eLens.length === dLens.length && eLens.every((v, i) => v === dLens[i]);
  const em = eLens.reduce((s, v) => s + v, 0);
  const dm = dLens.reduce((s, v) => s + v, 0);
  console.log(`\n${item}: Excel ${e.length} rolls (${em.toFixed(1)}m) | DB ${d.length} rolls (${dm.toFixed(1)}m) | lengths ${lengthsOk ? 'MATCH' : 'DIFF'}`);
  if (!lengthsOk) {
    console.log('  Excel lengths:', eLens.join(', '));
    console.log('  DB lengths:   ', dLens.join(', '));
  }
  // color comparison
  const eColors = [...new Set(e.map((x) => x.colorName || x.colorNameTr || x.colorCode))];
  const dColors = [...new Set(d.map((x) => x.colorName))];
  const dCodes = [...new Set(d.map((x) => x.colorCode))];
  console.log('  Excel colors:', eColors.join(' | '));
  console.log('  DB colors:   ', dColors.join(' | '), '| codes:', dCodes.join(' | '));
  console.log('  Excel codes: ', [...new Set(e.map((x) => x.itemCode).filter(Boolean))].join(' | ') || '(empty)');
  console.log('  DB codes:    ', [...new Set(d.map((x) => x.itemCode).filter(Boolean))].join(' | ') || '(empty)');
}

console.log('\n=== EXCEL وارد sheet headers ===');
console.log(incoming.rawHeaders);

console.log('\n=== SAMPLE EXCEL ROWS (first 5) ===');
for (const r of excelRows.slice(0, 5)) {
  console.log(JSON.stringify({
    item: r.itemName, code: r.itemCode, color: r.colorName, colorTr: r.colorNameTr,
    colorCode: r.colorCode, qty: r.quantity, raw: r.raw,
  }));
}

console.log('\n=== SAMPLE DB ROWS (first 5) ===');
for (const r of dbRolls.rows.slice(0, 5)) {
  console.log(r);
}

await pool.end();
