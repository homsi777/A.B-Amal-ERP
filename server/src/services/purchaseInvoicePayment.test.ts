import assert from 'node:assert/strict';
import { computePaymentApplication, INVOICE_AMOUNT_EPS } from './invoiceAmountHelpers.js';

// Simulate purchase invoice payment voucher confirm math
function simulateVoucherConfirm(
  total: number,
  paid: number,
  voucherAmount: number,
): { paid: number; remaining: number } | null {
  const remaining = total - paid;
  const delta = computePaymentApplication(total, paid, remaining, voucherAmount);
  if (!delta) return null;
  return { paid: delta.newPaid, remaining: delta.newRemaining };
}

let inv = { total: 500, paid: 0 };
let r1 = simulateVoucherConfirm(inv.total, inv.paid, 200);
assert.ok(r1);
inv = { total: 500, paid: r1.paid };
assert.equal(inv.paid, 200);
assert.equal(r1.remaining, 300);

let r2 = simulateVoucherConfirm(inv.total, inv.paid, 200);
assert.ok(r2);
inv = { total: 500, paid: r2.paid };
assert.equal(inv.paid, 400);
assert.equal(r2.remaining, 100);

// Overpayment capped to remaining
let r3 = simulateVoucherConfirm(inv.total, inv.paid, 250);
assert.ok(r3);
assert.equal(r3.paid, 500);
assert.equal(r3.remaining, 0);

// Duplicate confirm on fully paid — no-op
assert.equal(simulateVoucherConfirm(500, 500, 100), null);

// Partial precision
const partial = computePaymentApplication(99.99, 0, 99.99, 33.33);
assert.ok(partial);
assert.ok(Math.abs(partial.newPaid - 33.33) <= INVOICE_AMOUNT_EPS);

console.log('purchaseInvoicePayment.test.ts OK');
