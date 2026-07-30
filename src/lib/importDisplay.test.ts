import assert from 'node:assert/strict';
import {
  displayImportedItemCode,
  displayInventoryMaterialCode,
  displayLabelMaterialCode,
  resolveDisplayMaterialCode,
} from './importDisplay';

const pastel = {
  internal_code: 'IMP-PASTEL-WAFFLE-CLO-1',
  supplier_code_item: 'CLO-1',
};
const astrli = {
  internal_code: 'IMP-ASTRLI-EKOSE-CLO-2',
  supplier_code_item: 'CLO-2',
};

assert.equal(displayInventoryMaterialCode(pastel), 'CLO-1');
assert.equal(displayInventoryMaterialCode(astrli), 'CLO-2');
assert.equal(displayLabelMaterialCode({
  internalCode: pastel.internal_code,
  supplierCode: pastel.supplier_code_item,
}), 'CLO-1');
assert.equal(resolveDisplayMaterialCode({
  internalCode: astrli.internal_code,
  supplierCode: astrli.supplier_code_item,
}), 'CLO-2');
assert.equal(displayImportedItemCode(pastel), 'CLO-1');

assert.equal(
  displayInventoryMaterialCode({ internal_code: 'L2_CLO-3', supplier_code_item: null }),
  'CLO-3',
);
assert.equal(
  displayInventoryMaterialCode({ internal_code: 'IMP-AUTO-WAFFL', supplier_code_item: null }),
  '',
);

console.log('importDisplay tests passed');
