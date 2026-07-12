/** One-off read-only: count rows/materials in AHMET BARAKAT SURYA 1.xls */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

const __dir = dirname(fileURLToPath(import.meta.url));
const file = resolve(__dir, '../AHMET BARAKAT SURYA 1.xls');
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

const materials = new Map();
for (const row of rows) {
  const vals = Object.values(row).map((v) => String(v ?? '').trim()).filter(Boolean);
  if (vals.length < 2) continue;
  const name = String(row['اسم الخامة'] ?? row['Material'] ?? row['Ürün Adı'] ?? vals[1] ?? '').trim();
  const code = String(row['DesenAdi'] ?? row['Desen'] ?? row['كود الخامة'] ?? vals[2] ?? '').trim();
  if (!name || name.toLowerCase().includes('name') || name.includes('اسم')) continue;
  const key = `${name}|${code || '—'}`;
  materials.set(key, (materials.get(key) ?? 0) + 1);
}

const list = [...materials.entries()].map(([k, c]) => {
  const [name, code] = k.split('|');
  return { name, code, rows: c };
}).sort((a, b) => a.name.localeCompare(b.name));

console.log(JSON.stringify({
  file: 'AHMET BARAKAT SURYA 1.xls',
  sheet: wb.SheetNames[0],
  totalRows: rows.length,
  distinctMaterials: list.length,
  materials: list,
}, null, 2));
