import * as XLSX from 'xlsx';
import * as fs from 'fs';
import { coerceNormalizedRowNumbers, detectColumnMap, normalizeRow } from '../server/src/utils/importColumnDetector.ts';

const path = process.argv[2] || 'ahmet bereket.xls';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
console.log('File:', path);
console.log('Sheets:', wb.SheetNames);

function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 20);
  let bestIndex = 0;
  let bestScore = 0;
  const keywords = ['material', 'fabric', 'stok', 'kod', 'code', 'renk', 'color', 'barcode', 'barkod', 'metre', 'meter', 'miktar', 'الخامة', 'اللون', 'الباركود', 'كود'];
  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? [];
    const values = row.map((c) => String(c ?? '').trim().toLowerCase().replace(/\s+/g, ''));
    const score = values.reduce((sum, value) => sum + (keywords.some((k) => value.includes(k.replace(/\s+/g, ''))) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; bestIndex = i; }
  }
  return bestScore >= 2 ? bestIndex : 0;
}

for (const sheetName of wb.SheetNames.slice(0, 2)) {
  const sheet = wb.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });
  console.log('\n===', sheetName, 'rows:', rawRows.length, '===');
  const headerRowIndex = findHeaderRow(rawRows);
  for (let i = 0; i < Math.min(headerRowIndex + 3, 12); i++) {
    console.log('R' + i + ':', JSON.stringify(rawRows[i]));
  }
  const headers = (rawRows[headerRowIndex] ?? []).map((h) => (h == null ? '' : String(h).trim()));
  console.log('Header row index:', headerRowIndex);
  console.log('Headers:', headers);
  const colMap = detectColumnMap(headers);
  console.log('Detected:', [...colMap.entries()].map(([i, f]) => `${headers[i]} -> ${f}`).join(' | '));
  const rows = rawRows.slice(headerRowIndex + 1);
  for (let r = 0; r < Math.min(3, rows.length); r++) {
    const nd = normalizeRow(rows[r], colMap);
    coerceNormalizedRowNumbers(nd);
    console.log('Data', r + 1, ':', JSON.stringify(nd));
  }
}
