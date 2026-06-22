import assert from 'node:assert/strict';
import {
  getRollLengthMeters,
  isRollApplicableToSalesInvoice,
  isRollAvailableForSale,
  rollNeedsLengthCompletionFromInvoice,
} from './rollAvailability';

const availableWithLength = { status: 'AVAILABLE', length_m: 25.5 };
const availableZeroLength = { status: 'AVAILABLE', length_m: 0 };
const soldRoll = { status: 'SOLD', length_m: 10 };

assert.equal(isRollAvailableForSale(availableWithLength), true);
assert.equal(isRollAvailableForSale(availableZeroLength), false);
assert.equal(isRollApplicableToSalesInvoice(availableWithLength), true);
assert.equal(isRollApplicableToSalesInvoice(availableZeroLength), true);
assert.equal(isRollApplicableToSalesInvoice(soldRoll), false);
assert.equal(rollNeedsLengthCompletionFromInvoice(availableZeroLength), true);
assert.equal(rollNeedsLengthCompletionFromInvoice(availableWithLength), false);
assert.equal(getRollLengthMeters({ meters: '12.5' }), 12.5);

console.log('rollAvailability tests passed');
