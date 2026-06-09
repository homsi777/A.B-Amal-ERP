import assert from 'node:assert/strict';
import { availableMetersOnLine, assertQtyWithinAvailable, returnQtyToMeters } from './returnInvoiceQtyHelpers.js';
import { noFinancialEffectConflictsWithPhysicalLines } from './returnInvoiceDraftValidation.js';

assert.equal(returnQtyToMeters(10, 'meter'), 10);
assert.ok(Math.abs(returnQtyToMeters(1, 'yard') - 0.9144) < 1e-3);

assert.equal(availableMetersOnLine(5, 'meter', 2), 3);
assert.throws(() => assertQtyWithinAvailable(10, 5, 'سطر 1'));

const roll = '00000000-0000-4000-8000-000000000001';
assert.equal(noFinancialEffectConflictsWithPhysicalLines('CREDIT_BALANCE', [{ fabricRollId: roll, quantity: 1 }]), false);
assert.equal(noFinancialEffectConflictsWithPhysicalLines('NO_FINANCIAL_EFFECT', [{ fabricRollId: null, quantity: 1 }]), false);
assert.equal(noFinancialEffectConflictsWithPhysicalLines('NO_FINANCIAL_EFFECT', [{ fabricRollId: roll, quantity: 0 }]), false);
assert.equal(noFinancialEffectConflictsWithPhysicalLines('NO_FINANCIAL_EFFECT', [{ fabricRollId: roll, quantity: 0.01 }]), true);

console.log('returnInvoiceQtyHelpers.test.ts OK');
