import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { parseStockWorkbook, pickDefaultSheet } from '../src/lib/stockExcelImport.ts';

const xlsxPath = process.argv[2] || 'مستودعات حلب للتنزيل.xlsx';
if (!fs.existsSync(xlsxPath)) {
  const hit = fs.readdirSync('.').find((f) => /حلب/i.test(f) && f.endsWith('.xlsx'));
  if (hit) xlsxPath = hit;
}
const buf = fs.readFileSync(xlsxPath);
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });

console.log('=== RAW SHEET NAMES ===');
console.log(wb.SheetNames);

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  console.log(`\n=== ${name} first 6 rows ===`);
  aoa.slice(0, 6).forEach((row, i) => console.log(i, JSON.stringify(row)));
}

const file = {
  name: xlsxPath,
  size: buf.length,
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
};
const preview = await parseStockWorkbook(file);
console.log('\n=== PARSED ===');
for (const s of preview.sheets) {
  console.log({
    sheetName: s.sheetName,
    kind: s.kind,
    headerRowIndex: s.headerRowIndex,
    totalRows: s.totalRows,
    totalQuantity: s.totalQuantity,
    distinctItems: s.distinctItemCount,
    distinctColors: s.distinctColorCount,
    warnings: s.warnings,
    headers: s.rawHeaders,
  });
  const bad = s.rows.filter((r) => !r.colorName && !r.colorCode && r.quantity > 0).slice(0, 3);
  const shifted = s.rows.filter((r) => r.itemName && r.quantity === 0).slice(0, 3);
  if (bad.length) console.log('  no color samples:', bad.map((r) => ({ row: r.rowIndex, item: r.itemName, raw: r.raw })));
  if (shifted.length) console.log('  zero qty samples:', shifted.map((r) => ({ row: r.rowIndex, item: r.itemName, raw: r.raw })));
}
console.log('\nDefault:', pickDefaultSheet(preview).sheetName, pickDefaultSheet(preview).kind);

const incoming = preview.sheets.find((s) => s.kind === 'incoming');
if (incoming) {
  const rows = incoming.rows.filter((r) => r.itemName);
  console.log('\n=== INCOMING IMPORT ANALYSIS ===');
  console.log('Importable rows:', rows.length);
  console.log('Zero qty (will fail backend):', rows.filter((r) => r.quantity <= 0).length);
  console.log('No color:', rows.filter((r) => !r.colorName && !r.colorNameTr && !r.colorCode).length);
  const codeToNames = new Map();
  for (const r of rows) {
    if (!r.itemCode) continue;
    const set = codeToNames.get(r.itemCode) ?? new Set();
    set.add(r.itemName);
    codeToNames.set(r.itemCode, set);
  }
  const collisions = [...codeToNames.entries()].filter(([, names]) => names.size > 1);
  console.log('itemCodes shared by multiple item names:', collisions.length);
  console.log('Examples:', collisions.slice(0, 8).map(([c, n]) => ({ code: c, items: [...n].slice(0, 4), count: n.size })));
}
