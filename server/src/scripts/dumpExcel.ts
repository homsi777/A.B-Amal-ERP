import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const file = process.argv[2] || 'COLOMBIA.xls';
const buf = readFileSync(resolve(process.cwd(), file));
const wb = XLSX.read(buf, { type: 'buffer' });
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];

console.log('rows', data.length, 'cols max', Math.max(...data.map((r) => (r as unknown[]).length)));
for (let i = 0; i < Math.min(15, data.length); i++) {
  const row = (data[i] ?? []).map((c) => (c == null ? '' : String(c).trim()));
  console.log(`R${i + 1}:`, row.slice(0, 24).join(' | '));
}
console.log('--- last 10 rows ---');
for (let i = Math.max(0, data.length - 10); i < data.length; i++) {
  const row = (data[i] ?? []).map((c) => (c == null ? '' : String(c).trim()));
  console.log(`R${i + 1}:`, row.join(' | '));
}
