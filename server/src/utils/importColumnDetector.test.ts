import assert from 'node:assert/strict';
import { cleanNumber, coerceNormalizedRowNumbers, detectColumnMap, normalizeRow } from './importColumnDetector.js';
import { isPlaceholderColorCode, resolveImportColorLabels } from './importColorResolver.js';
import { resolveImportMaterialCode } from './purchaseImportMaterialCodes.js';

function fieldForHeader(headers: string[], header: string): string | undefined {
  const colMap = detectColumnMap(headers);
  const idx = headers.indexOf(header);
  if (idx < 0) return undefined;
  return colMap.get(idx);
}

// Arabic / Turkish material code headers
assert.equal(fieldForHeader(['كود الخامة', 'اسم الخامة', 'اللون', 'الطول'], 'كود الخامة'), 'supplierMaterialCode');
assert.equal(fieldForHeader(['Stok Kodu', 'Stok Adı', 'Renk', 'Metre'], 'Stok Kodu'), 'supplierMaterialCode');
assert.equal(fieldForHeader(['DSAM', 'Material', 'Color', 'Length'], 'DSAM'), 'supplierMaterialCode');
assert.equal(fieldForHeader(['Design No', 'Fabric', 'Colour', 'Meters'], 'Design No'), 'supplierMaterialCode');
assert.equal(
  fieldForHeader(
    ['Barkod', 'Stok Adi', 'DesenAdi', 'VaryantNo', 'En', 'LotNo', 'ZeminRenk', 'Metre', 'Kg'],
    'DesenAdi',
  ),
  'supplierMaterialCode',
);

assert.equal(
  resolveImportMaterialCode({ internalMaterialCode: 'INT-1', supplierMaterialCode: 'SUP-2' }),
  'INT-1',
);
assert.equal(
  resolveImportMaterialCode({ supplierMaterialCode: 'SUP-2' }),
  'SUP-2',
);

// Turkish decimal comma (ahmet bereket.xls)
assert.equal(cleanNumber('107,7'), 107.7);
assert.equal(cleanNumber('35,54'), 35.54);
assert.equal(cleanNumber('1.234,56'), 1234.56);

const headers = ['Barkod', 'Stok Adi', 'DesenAdi', 'En', 'Metre', 'Kg'];
const colMap = detectColumnMap(headers);
const nd = normalizeRow(['3288611', 'PANTOLON -12', 'KL-199', '150', '107,7', '35,54'], colMap);
coerceNormalizedRowNumbers(nd);
assert.equal(nd.supplierMaterialCode, 'KL-199');
assert.equal(nd.lengthM, 107.7);
assert.equal(nd.actualWeightKg, 35.54);
assert.equal(nd.widthCm, 150);

assert.equal(isPlaceholderColorCode('#000000'), true);
assert.equal(isPlaceholderColorCode('GRI'), false);
assert.deepEqual(
  resolveImportColorLabels({ colorNameTr: 'BEJ', colorCode: '#000000' }),
  { nameAr: 'BEJ', nameTr: 'BEJ', colorCode: '', supplierColorCode: '' },
);

console.log('importColumnDetector.test.ts: OK');
