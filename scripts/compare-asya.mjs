import * as fs from 'fs';
import pg from 'pg';
import { parseStockWorkbook } from '../src/lib/stockExcelImport.ts';

const xlsxPath = fs.readdirSync('.').find((f) => f.endsWith('-15.xlsx'));
const buf = fs.readFileSync(xlsxPath);
const preview = await parseStockWorkbook({
  name: xlsxPath,
  size: buf.length,
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
});
const incoming = preview.sheets.find((s) => s.kind === 'incoming');
const excelAsya = incoming.rows.filter((r) => r.itemName?.trim().toLowerCase() === 'asya');

const pool = new pg.Pool({
  connectionString: 'postgresql://erp_user:FabricERP_2026!@127.0.0.1:5433/fabric_erp?sslmode=disable',
});
const dbAsya = await pool.query(`
  SELECT r.barcode, r.length_m::float AS length_m, fi.internal_code,
         fc.name_ar AS color_name, fc.color_code
  FROM fabric_rolls r
  JOIN fabric_items fi ON fi.id = r.item_id
  LEFT JOIN fabric_colors fc ON fc.id = r.color_id
  WHERE lower(fi.name) = 'asya' AND r.status = 'AVAILABLE'
  ORDER BY r.length_m
`);

console.log('EXCEL asya rows:');
for (const r of excelAsya.sort((a, b) => a.quantity - b.quantity)) {
  console.log(`  ${r.quantity.toFixed(2)}m | code=${r.itemCode} | color=${r.colorName} | colorCode=${r.colorCode}`);
}
console.log('\nDB asya rows:');
for (const r of dbAsya.rows) {
  console.log(`  ${Number(r.length_m).toFixed(2)}m | code=${r.internal_code} | color=${r.color_name} | colorCode=${r.color_code} | ${r.barcode}`);
}

// Ayaz yikama and Balksriti
for (const item of ['Ayaz yikama', 'Balksriti', 'Ayaz top boya']) {
  const ex = incoming.rows.filter((r) => r.itemName?.trim() === item);
  const db = await pool.query(`
    SELECT r.length_m::float AS length_m, fc.name_ar, fc.color_code
    FROM fabric_rolls r JOIN fabric_items fi ON fi.id=r.item_id
    LEFT JOIN fabric_colors fc ON fc.id=r.color_id
    WHERE fi.name=$1 AND r.status='AVAILABLE' ORDER BY r.length_m`, [item]);
  console.log(`\n${item}:`);
  console.log('  Excel:', ex.map((r) => `${r.quantity.toFixed(1)}@${r.colorName || r.colorNameTr}`).join(', '));
  console.log('  DB:   ', db.rows.map((r) => `${Number(r.length_m).toFixed(1)}@${r.name_ar}`).join(', '));
}

await pool.end();
