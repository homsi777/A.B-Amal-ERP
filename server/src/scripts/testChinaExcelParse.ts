import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { expandChinaPackingListIfNeeded } from '../utils/chinaPackingListExpand.js';
import { mergeSheetTotalsMetadata } from '../utils/importSheetMetadata.js';
import { parseImportFileName } from '../utils/importFileName.js';

const file = process.argv[2] || 'COLOMBIA.xls';
const buf = readFileSync(resolve(process.cwd(), file));
const wb = XLSX.read(buf, { type: 'buffer' });
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];

let headerIdx = 0;
for (let i = 0; i < Math.min(25, data.length); i++) {
  const values = (data[i] ?? []).map((c) => String(c ?? '').trim().toLowerCase().replace(/\s+/g, ''));
  const rollCount = values.filter((v) => v.includes('rollno') || v === 'roll').length;
  if (rollCount >= 2) {
    headerIdx = i;
    break;
  }
}

const headers = (data[headerIdx] ?? []).map((h) => String(h ?? ''));
const preTableRows = data.slice(0, headerIdx);
const body = data.slice(headerIdx + 1);
const totals = mergeSheetTotalsMetadata(preTableRows, body);
const fileParsed = parseImportFileName(file);
const expanded = expandChinaPackingListIfNeeded(headers, body, totals, { preTableRows });

const totalLength = expanded?.rows.reduce((s, r) => s + (Number(r[1]) || 0), 0) ?? 0;

console.log('file:', file);
console.log('parsed name:', fileParsed);
console.log('headerIdx:', headerIdx, 'headers:', headers.filter(Boolean).join(' | '));
console.log('footer totals:', totals);
console.log(
  'expanded:',
  expanded
    ? {
        rows: expanded.rows.length,
        sourceType: expanded.sourceType,
        totalLengthM: Math.round(totalLength * 10) / 10,
        sample: expanded.rows.slice(0, 3),
        last: expanded.rows.slice(-3),
      }
    : null,
);
