import * as fs from 'fs';
import pg from 'pg';
import { parseStockWorkbook } from '../src/lib/stockExcelImport.ts';

let xlsxPath = 'مستودعات حلب-15.xlsx';
if (!fs.existsSync(xlsxPath)) {
  const hit = fs.readdirSync('.').find((f) => /15\.xlsx$/i.test(f) && f.includes('حلب'));
  if (hit) xlsxPath = hit;
}
if (!fs.existsSync(xlsxPath)) {
  const hit2 = fs.readdirSync('.').find((f) => f.endsWith('-15.xlsx'));
  if (hit2) xlsxPath = hit2;
}
if (!fs.existsSync(xlsxPath)) {
  console.error('File not found');
  process.exit(1);
}
console.log('Using file:', xlsxPath);

const buf = fs.readFileSync(xlsxPath);
const file = {
  name: xlsxPath,
  size: buf.length,
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
};

const preview = await parseStockWorkbook(file);
console.log('Sheets:', preview.sheets.map((s) => ({
  name: s.sheetName,
  kind: s.kind,
  rows: s.totalRows,
  qty: s.totalQuantity,
  items: s.distinctItemCount,
  colors: s.distinctColorCount,
})));

const incoming = preview.sheets.find((s) => s.kind === 'incoming' && s.totalRows > 0)
  ?? preview.sheets.find((s) => s.totalRows > 0);
if (!incoming) {
  console.error('No data sheet found');
  process.exit(1);
}

const excelRows = incoming.rows.filter((r) => r.itemName);
console.log('\nExcel importable rows:', excelRows.length);
console.log('Excel total meters:', excelRows.reduce((s, r) => s + r.quantity, 0).toFixed(2));

const pool = new pg.Pool({
  connectionString: 'postgresql://erp_user:FabricERP_2026!@127.0.0.1:5433/fabric_erp?sslmode=disable',
});

const dbRolls = await pool.query(`
  SELECT r.barcode, r.length_m::float AS length_m,
         fi.name AS item_name, fi.internal_code AS item_code,
         COALESCE(fc.name_ar, fc.name_tr, '') AS color_name,
         COALESCE(fc.color_code, '') AS color_code,
         r.import_batch_id, r.created_at
  FROM fabric_rolls r
  LEFT JOIN fabric_items fi ON fi.id = r.item_id
  LEFT JOIN fabric_colors fc ON fc.id = r.color_id
  WHERE r.status = 'AVAILABLE' AND r.length_m > 0
  ORDER BY r.barcode
`);

console.log('\nDB available rolls:', dbRolls.rows.length);
console.log('DB total meters:', dbRolls.rows.reduce((s, r) => s + Number(r.length_m), 0).toFixed(2));

// Compare counts
const excelByKey = new Map();
for (const r of excelRows) {
  const color = (r.colorName || r.colorNameTr || '').trim();
  const key = `${r.itemName}|||${r.itemCode}|||${color}|||${r.quantity.toFixed(2)}`;
  excelByKey.set(key, (excelByKey.get(key) || 0) + 1);
}

const dbByKey = new Map();
for (const r of dbRolls.rows) {
  const key = `${r.item_name}|||${r.item_code}|||${(r.color_name || '').trim()}|||${Number(r.length_m).toFixed(2)}`;
  dbByKey.set(key, (dbByKey.get(key) || 0) + 1);
}

let matched = 0;
let excelOnly = 0;
let dbOnly = 0;
const mismatches = [];

const allKeys = new Set([...excelByKey.keys(), ...dbByKey.keys()]);
for (const key of allKeys) {
  const e = excelByKey.get(key) || 0;
  const d = dbByKey.get(key) || 0;
  if (e === d) matched += e;
  else {
    if (e > d) excelOnly += e - d;
    if (d > e) dbOnly += d - e;
    mismatches.push({ key, excel: e, db: d });
  }
}

console.log('\n=== MATCH SUMMARY (item+code+color+length) ===');
console.log('Matched roll instances:', matched);
console.log('In Excel only:', excelOnly);
console.log('In DB only:', dbOnly);
console.log('Mismatched keys:', mismatches.length);

if (mismatches.length > 0) {
  console.log('\nFirst 20 mismatches:');
  for (const m of mismatches.slice(0, 20)) {
    const [item, code, color, len] = m.key.split('|||');
    console.log(`  Excel=${m.excel} DB=${m.db} | ${item} | ${code} | ${color} | ${len}m`);
  }
}

// Item-level summary
const excelItems = new Map();
for (const r of excelRows) {
  const k = r.itemName;
  const cur = excelItems.get(k) || { rolls: 0, meters: 0 };
  cur.rolls += 1;
  cur.meters += r.quantity;
  excelItems.set(k, cur);
}
const dbItems = new Map();
for (const r of dbRolls.rows) {
  const k = r.item_name;
  const cur = dbItems.get(k) || { rolls: 0, meters: 0 };
  cur.rolls += 1;
  cur.meters += Number(r.length_m);
  dbItems.set(k, cur);
}

console.log('\n=== BY ITEM ===');
const itemKeys = new Set([...excelItems.keys(), ...dbItems.keys()]);
for (const k of [...itemKeys].sort()) {
  const e = excelItems.get(k);
  const d = dbItems.get(k);
  const er = e?.rolls ?? 0;
  const dr = d?.rolls ?? 0;
  const em = (e?.meters ?? 0).toFixed(1);
  const dm = (d?.meters ?? 0).toFixed(1);
  const flag = er === dr && em === dm ? 'OK' : 'DIFF';
  if (flag === 'DIFF' || er !== dr) {
    console.log(`[${flag}] ${k}: Excel ${er} rolls / ${em}m | DB ${dr} rolls / ${dm}m`);
  }
}

// Check if file name in import batches
const batches = await pool.query(`
  SELECT id, file_name, status, created_roll_count, row_count, imported_count, total_length_m
  FROM purchase_import_batches
  WHERE file_name ILIKE '%حلب-15%' OR file_name ILIKE '%halab%15%'
  ORDER BY created_at DESC
  LIMIT 5
`);
console.log('\n=== IMPORT BATCHES (حلب-15) ===');
console.log(JSON.stringify(batches.rows, null, 2));

await pool.end();
