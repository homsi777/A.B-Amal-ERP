import assert from 'node:assert/strict';
import {
  buildFabricItemInternalCode,
} from './fabricItemIdentity.js';

assert.equal(buildFabricItemInternalCode('WİNTER SARDONLU', 'CLO-2'), 'CLO-2');
assert.equal(buildFabricItemInternalCode('ASTRLI EKOSE', 'CLO-2'), 'CLO-2');
assert.equal(buildFabricItemInternalCode('ROYAL JAKAR', '3019'), '3019');

console.log('fabricItemIdentity.test.ts OK');
