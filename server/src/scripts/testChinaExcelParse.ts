import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { expandChinaPackingListIfNeeded } from '../utils/chinaPackingListExpand.js';

const file = process.argv[2] || 'ROLL LIST FOR 331 COLOMBIA.xls';
const buf = readFileSync(resolve(process.cwd(), file));
const wb = XLSX.read(buf, { type: 'buffer' });
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];

let headerIdx = 0;
for (let i = 0; i < Math.min(30, data.length); i++) {
  const joined = (data[i] ?? []).map((c) => String(c ?? '')).join('|');
  if (/roll/i.test(joined) && /length/i.test(joined)) {
    headerIdx = i;
    break;
  }
}

const headers = (data[headerIdx] ?? []).map((h) => String(h ?? ''));
const body = data.slice(headerIdx + 1);
const expanded = expandChinaPackingListIfNeeded(headers, body, {
  declaredRollCount: body.length,
  materialName: 'COLOMBIA-331',
});

console.log('file:', file);
console.log('sheet rows:', data.length, 'headerIdx:', headerIdx);
console.log('headers:', headers.filter(Boolean).slice(0, 15).join(' | '));
console.log(
  'expanded:',
  expanded
    ? { rows: expanded.rows.length, sourceType: expanded.sourceType, sample: expanded.rows.slice(0, 3) }
    : null,
);
