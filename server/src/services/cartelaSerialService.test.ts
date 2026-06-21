import assert from 'node:assert/strict';
import {
  formatAutoCartelaSerial,
  isAutoRangeCartelaSerial,
  validateManualCartelaSerialNo,
} from './cartelaSerialService.js';

assert.equal(formatAutoCartelaSerial(1), '0001');
assert.equal(formatAutoCartelaSerial(42), '0042');
assert.equal(formatAutoCartelaSerial(9999), '9999');

assert.equal(isAutoRangeCartelaSerial('0001'), true);
assert.equal(isAutoRangeCartelaSerial('2005234'), false);

assert.equal(validateManualCartelaSerialNo(''), null);
assert.equal(validateManualCartelaSerialNo('1234567890'), null);
assert.ok(validateManualCartelaSerialNo('12345678901'));

console.log('cartelaSerialService.test: ok');
