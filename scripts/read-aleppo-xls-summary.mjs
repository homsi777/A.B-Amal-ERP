/** Read-only: parse مستودعات حلب-15.xlsx and list distinct name+code */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

const __dir = dirname(fileURLToPath(import.meta.url));
const file = resolve(__dir, '../مستودعات حلب-15.xlsx');
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 });

// find header row
let headerIdx = 0;
for (let i = 0; i < Math.min(5, rows.length); i++) {
  const line = (rows[i] || []).map((c) => String(c).trim()).join('|');
  if (/اسم|خامة|material|ürün|code|كود|رمز/i.test(line)) {
    headerIdx = i;
    break;
  }
}
const headers = (rows[headerIdx] || []).map((h) => String(h).trim());
const dataRows = rows.slice(headerIdx + 1);

function col(...patterns) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (patterns.some((p) => p.test(h))) return i;
  }
  return -1;
}

const nameCol = col(/اسم.*خام|material.*name|ürün|item.*name|اسم الصنف/);
const codeCol = col(/كود.*خام|رمز|material.*code|desen|item.*code|كود الصنف/);

const materials = new Map();
for (const row of dataRows) {
  if (!Array.isArray(row)) continue;
  const name = String(row[nameCol >= 0 ? nameCol : 1] ?? '').trim();
  const code = String(row[codeCol >= 0 ? codeCol : 2] ?? '').trim();
  if (!name) continue;
  const key = `${name}|${code || '—'}`;
  materials.set(key, (materials.get(key) ?? 0) + 1);
}

const list = [...materials.entries()].map(([k, c]) => {
  const [name, code] = k.split('|');
  return { name, code, rows: c };
}).sort((a, b) => a.name.localeCompare(b.name));

console.log(JSON.stringify({
  file: 'مستودعات حلب-15.xlsx',
  sheet: wb.SheetNames[0],
  headers,
  nameCol,
  codeCol,
  totalDataRows: dataRows.length,
  distinctMaterials: list.length,
  materials: list,
}, null, 2));
