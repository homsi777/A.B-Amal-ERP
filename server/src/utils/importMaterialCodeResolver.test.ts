import assert from 'node:assert/strict';
import {
  internalCodeLooksLikeImportedColorMistake,
  looksLikeLikelyColorCode,
  looksLikeUniqueDesignSku,
  reconcileImportMaterialAndColorCodes,
  sanitizeNormalizedImportRow,
  sanitizeStockImportRow,
} from './importMaterialCodeResolver.js';

assert.equal(looksLikeLikelyColorCode('8'), true);
assert.equal(looksLikeLikelyColorCode('12'), true);
assert.equal(looksLikeLikelyColorCode('5114'), false);
assert.equal(looksLikeLikelyColorCode('KL-199'), false);

assert.equal(looksLikeUniqueDesignSku('8'), false);
assert.equal(looksLikeUniqueDesignSku('5114'), true);
assert.equal(looksLikeUniqueDesignSku('KL-199'), true);
assert.equal(looksLikeUniqueDesignSku('CLO-1'), true);
assert.equal(looksLikeUniqueDesignSku('Jakar'), false);

const swapped = reconcileImportMaterialAndColorCodes({
  supplierMaterialCode: '8',
  colorCode: '',
});
assert.equal(swapped.materialCode, '');
assert.equal(swapped.colorCode, '8');
assert.equal(swapped.swappedColorFromMaterial, true);

const nd = { supplierMaterialCode: '8', materialName: 'ROYAL MAX JAKAR', colorCode: null };
const { swappedColorFromMaterial } = sanitizeNormalizedImportRow(nd);
assert.equal(swappedColorFromMaterial, true);
assert.equal(nd.supplierMaterialCode, null);
assert.equal(nd.colorCode, '8');

const stockRow = { itemCode: '8', colorCode: '' };
sanitizeStockImportRow(stockRow);
assert.equal(stockRow.itemCode, '');
assert.equal(stockRow.colorCode, '8');

assert.equal(internalCodeLooksLikeImportedColorMistake('8', 'ROYAL MAX JAKAR'), true);
assert.equal(internalCodeLooksLikeImportedColorMistake('KL-199', 'ROYAL MAX JAKAR'), false);
assert.equal(internalCodeLooksLikeImportedColorMistake('5114', 'asya'), false);

console.log('importMaterialCodeResolver.test.ts: OK');
