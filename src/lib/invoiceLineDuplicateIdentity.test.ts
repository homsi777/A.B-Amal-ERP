import assert from 'node:assert/strict';
import {
  buildInvoiceScanDuplicateKey,
  buildInvoiceSaveDuplicateKey,
  incomingStockConflictsWithLine,
} from './invoiceLineDuplicateIdentity';

function baseLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    materialName: 'Romeo',
    dsamNumber: '',
    colorCode: '',
    colorName: '',
    rollNo: '',
    length: '25.00',
    price: '10',
    supplierBarcode: '',
    rawBarcodePayload: '',
    printBarcode: '',
    internalRollId: '',
    ...overrides,
  };
}

// Same fabric + length but different barcodes must NOT collide at scan time.
{
  const a = buildInvoiceScanDuplicateKey(baseLine({ id: 1, supplierBarcode: '3220232' }));
  const b = buildInvoiceScanDuplicateKey(baseLine({ id: 2, supplierBarcode: '4216659' }));
  assert.notEqual(a, b, 'different barcodes should produce different scan keys');
}

// Material name + length alone must not block another line (per-line bucket).
{
  const a = buildInvoiceScanDuplicateKey(baseLine({ id: 10, materialName: 'Romeo', length: '30' }));
  const b = buildInvoiceScanDuplicateKey(baseLine({ id: 11, materialName: 'Romeo', length: '30' }));
  assert.notEqual(a, b, 'name+length only lines should stay unique');
  assert.match(a, /^i:/);
  assert.match(b, /^i:/);
}

// Same UUID without barcode should collide.
{
  const uuid = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
  const a = buildInvoiceScanDuplicateKey(baseLine({ internalRollId: uuid }));
  const b = buildInvoiceScanDuplicateKey(baseLine({ id: 2, internalRollId: uuid }));
  assert.equal(a, b);
}

// Same UUID but different scanned barcodes are distinct lines (barcode label identity).
{
  const uuid = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
  const a = buildInvoiceScanDuplicateKey(baseLine({ internalRollId: uuid, supplierBarcode: '3220232' }));
  const b = buildInvoiceScanDuplicateKey(baseLine({ id: 2, internalRollId: uuid, supplierBarcode: '8242978' }));
  assert.notEqual(a, b);
}

// Stock conflict: different roll barcodes should not conflict.
{
  const line = {
    id: 1,
    supplierBarcode: '3220232',
    rawBarcodePayload: '',
    printBarcode: '',
    internalRollId: '',
  };
  const stock = { id: 'b2c3d4e5-f6a7-4890-b123-456789abcdef', barcode: '5295098' };
  assert.equal(incomingStockConflictsWithLine(line, 2, stock), false);
}

// Stock conflict: same roll UUID should conflict.
{
  const uuid = 'b2c3d4e5-f6a7-4890-b123-456789abcdef';
  const line = {
    id: 1,
    supplierBarcode: '3220232',
    rawBarcodePayload: '',
    printBarcode: '',
    internalRollId: uuid,
  };
  const stock = { id: uuid, barcode: '5295098' };
  assert.equal(incomingStockConflictsWithLine(line, 2, stock), true);
}

// Save key still distinguishes composite rolls with different roll numbers.
{
  const a = buildInvoiceSaveDuplicateKey(
    baseLine({ id: 1, rollNo: 'R001', dsamNumber: 'D1' }),
    'main',
  );
  const b = buildInvoiceSaveDuplicateKey(
    baseLine({ id: 2, rollNo: 'R002', dsamNumber: 'D1' }),
    'main',
  );
  assert.notEqual(a, b);
}

console.log('invoiceLineDuplicateIdentity tests passed');
