import assert from 'node:assert/strict';
import {
  sanitizeMaterialCodeForDisplay,
  sanitizeRollDtoRow,
} from './inventoryDisplayValues';

assert.equal(
  sanitizeMaterialCodeForDisplay('IMP-PASTEL-WAFFLE-CLO-1', 'CLO-1'),
  'CLO-1',
);
assert.equal(
  sanitizeMaterialCodeForDisplay('IMP-ASTRLI-EKOSE-CLO-2', 'CLO-2'),
  'CLO-2',
);
assert.equal(sanitizeMaterialCodeForDisplay('L2_CLO-3', null), 'CLO-3');
assert.equal(sanitizeMaterialCodeForDisplay('IMP-AUTO-WAFFL', null), '');

const sanitized = sanitizeRollDtoRow({
  internal_code: 'IMP-PASTEL-WAFFLE-CLO-1',
  supplier_code_item: 'CLO-1',
  color_code: 'L3_بني',
});
assert.equal(sanitized.internal_code, 'CLO-1');
assert.equal(sanitized.color_code, '');

console.log('inventoryDisplayValues tests passed');
