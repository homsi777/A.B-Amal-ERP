import assert from 'node:assert/strict';
import {
  internalCodeLooksLikeImportedColorMistake,
  looksLikeLikelyColorCode,
  looksLikeUniqueDesignSku,
  materialCodeFieldsLookLikeColorMistake,
  reconcileImportMaterialAndColorCodes,
  sanitizeNormalizedImportRow,
  sanitizeStockImportRow,
} from './importMaterialCodeResolver.js';

assert.equal(looksLikeLikelyColorCode('8'), true);
assert.equal(looksLikeLikelyColorCode('12'), true);
assert.equal(looksLikeLikelyColorCode('V-1'), true);
assert.equal(looksLikeLikelyColorCode('5114'), false);
assert.equal(looksLikeLikelyColorCode('KL-199'), false);

assert.equal(looksLikeUniqueDesignSku('8'), false);
assert.equal(looksLikeUniqueDesignSku('V-1'), false);
assert.equal(looksLikeUniqueDesignSku('5114'), true);
assert.equal(looksLikeUniqueDesignSku('KL-199'), true);
assert.equal(looksLikeUniqueDesignSku('CLO-1'), true);
assert.equal(looksLikeUniqueDesignSku('Jakar'), false);

const swappedV = reconcileImportMaterialAndColorCodes({
  supplierMaterialCode: 'V-1',
  colorCode: '',
});
assert.equal(swappedV.materialCode, '');
assert.equal(swappedV.colorCode, 'V-1');
assert.equal(swappedV.swappedColorFromMaterial, true);

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

const supplierOnly = materialCodeFieldsLookLikeColorMistake({
  internalCode: 'IMP-AUTO-ROYAL-MAX-JAKAR',
  supplierCode: '8',
  itemName: 'ROYAL MAX JAKAR',
});
assert.equal(supplierOnly.needsFix, true);
assert.equal(supplierOnly.displayedCode, '8');

const legacyPrefix = materialCodeFieldsLookLikeColorMistake({
  internalCode: 'L2_8',
  supplierCode: null,
  itemName: 'ROYAL MAX JAKAR',
});
assert.equal(legacyPrefix.needsFix, true);
assert.equal(legacyPrefix.displayedCode, '8');

assert.equal(looksLikeUniqueDesignSku('38-A'), true);

const desenVariant = reconcileImportMaterialAndColorCodes({
  supplierMaterialCode: '38-A',
  internalMaterialCode: '8',
  colorCode: '',
});
assert.equal(desenVariant.materialCode, '38-A');
assert.equal(desenVariant.colorCode, '8');
assert.equal(desenVariant.swappedColorFromMaterial, true);

const royal3019 = reconcileImportMaterialAndColorCodes({
  supplierMaterialCode: '3019',
  internalMaterialCode: '',
});
assert.equal(royal3019.materialCode, '3019');

const ndVariant = {
  supplierMaterialCode: '38-A',
  internalMaterialCode: '8',
  materialName: 'ROYAL JAKAR',
  colorCode: null as string | null,
};
sanitizeNormalizedImportRow(ndVariant);
assert.equal(ndVariant.supplierMaterialCode, '38-A');
assert.equal(ndVariant.internalMaterialCode, null);
assert.equal(ndVariant.colorCode, '8');

console.log('importMaterialCodeResolver.test.ts: OK');
