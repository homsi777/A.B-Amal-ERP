import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {
  detectImportLayout,
  parseStockWorkbook,
  pickDefaultSheet,
  stockRowColorLabel,
} from './stockExcelImport.ts';

const minimalHeaders = ['', 'اسم الصنف', 'رمز الصنف', 'اللون', 'الكمية'];
assert.equal(detectImportLayout('incoming', minimalHeaders), 'aleppo_incoming_minimal');
assert.equal(detectImportLayout('balance', ['رمز اللون', 'اسم الصنف', 'المخزن']), 'aleppo_balance');

const xlsxPath = 'مستودعات حلب للتنزيل.xlsx';
if (fs.existsSync(xlsxPath)) {
  const buf = fs.readFileSync(xlsxPath);
  const file = {
    name: xlsxPath,
    size: buf.length,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
  const preview = await parseStockWorkbook(file as unknown as File);
  const incoming = pickDefaultSheet(preview);
  assert.equal(incoming.sheetName, 'وارد');
  assert.equal(incoming.kind, 'incoming');
  assert.equal(incoming.importLayout, 'aleppo_incoming_minimal');
  assert.equal(incoming.totalRows, 1317);
  assert.ok(incoming.totalQuantity > 80_000);

  const alexandra = incoming.rows.find((r) => r.itemName === 'Alexandra' && r.colorName === 'فضي');
  assert.ok(alexandra);
  assert.equal(alexandra.itemCode, 'Jakar');
  assert.equal(alexandra.quantity, 54);

  const balance = preview.sheets.find((s) => s.kind === 'balance');
  assert.ok(balance);
  assert.equal(balance.importLayout, 'aleppo_balance');
  const elizaRows = balance.rows.filter((r) => r.itemName === 'Eliza');
  assert.ok(elizaRows.length > 0);
  assert.ok(elizaRows.some((r) => r.quantity === 132));

  const noColorRows = incoming.rows.filter((r) => r.itemName && !stockRowColorLabel(r));
  assert.equal(noColorRows.length, 19);
}

const halab15 = 'مستودعات حلب-15.xlsx';
if (fs.existsSync(halab15)) {
  const buf = fs.readFileSync(halab15);
  const file = {
    name: halab15,
    size: buf.length,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
  const preview = await parseStockWorkbook(file as unknown as File);
  const incoming = pickDefaultSheet(preview);
  assert.equal(incoming.sheetName, 'وارد');
  assert.equal(incoming.importLayout, 'aleppo_incoming_minimal');
  assert.equal(incoming.distinctItemCount, 13);
  assert.equal(incoming.totalRows, 211);

  const itemNames = new Set(incoming.rows.map((r) => r.itemName).filter(Boolean));
  assert.equal(itemNames.size, 13);
}

console.log('stockExcelImport.test.ts: OK');
