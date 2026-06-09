import assert from 'node:assert/strict';
import {
  allocateHeaderDiscountToLines,
  computePaymentApplication,
  grossLineTotal,
  INVOICE_AMOUNT_EPS,
  type InvoiceLineAmountInput,
  validateInvoiceLineAmounts,
} from './invoiceAmountHelpers.js';

// Header discount 10 USD across 3 lines — rounding on last line
const lines3 = allocateHeaderDiscountToLines(
  [
    { quantity: 10, unitPrice: 5, lineTotal: 0 },
    { quantity: 10, unitPrice: 5, lineTotal: 0 },
    { quantity: 10, unitPrice: 5, lineTotal: 0 },
  ] satisfies InvoiceLineAmountInput[],
  10,
);
assert.equal(lines3.length, 3);
const sumDisc = lines3.reduce((s, l) => s + (l.lineDiscount ?? 0), 0);
assert.ok(Math.abs(sumDisc - 10) <= INVOICE_AMOUNT_EPS, `discount sum ${sumDisc}`);
const sumNet = lines3.reduce((s, l) => s + l.lineTotal, 0);
assert.ok(Math.abs(sumNet - 140) <= INVOICE_AMOUNT_EPS, `net sum ${sumNet}`);
for (const ln of lines3) {
  const gross = grossLineTotal(ln.quantity, ln.unitPrice);
  assert.ok((ln.lineDiscount ?? 0) <= gross + INVOICE_AMOUNT_EPS);
}

validateInvoiceLineAmounts(lines3, 150, 10, 0, 140);

// Zero discount
const lines0 = allocateHeaderDiscountToLines(
  [{ quantity: 2, unitPrice: 25, lineTotal: 0 }] satisfies InvoiceLineAmountInput[],
  0,
);
assert.equal(lines0[0].lineDiscount, 0);
assert.equal(lines0[0].lineTotal, 50);
validateInvoiceLineAmounts(lines0, 50, 0, 0, 50);

// Full discount edge
const linesFull = allocateHeaderDiscountToLines(
  [{ quantity: 1, unitPrice: 100, lineTotal: 0 }] satisfies InvoiceLineAmountInput[],
  100,
);
assert.equal(linesFull[0].lineTotal, 0);
assert.equal(linesFull[0].lineDiscount, 100);

// Payment application
const pay1 = computePaymentApplication(100, 0, 100, 40);
assert.ok(pay1);
assert.equal(pay1.applyAmount, 40);
assert.equal(pay1.newPaid, 40);
assert.equal(pay1.newRemaining, 60);

const payOver = computePaymentApplication(100, 60, 40, 50);
assert.ok(payOver);
assert.equal(payOver.applyAmount, 40);
assert.equal(payOver.newPaid, 100);
assert.equal(payOver.newRemaining, 0);

assert.equal(computePaymentApplication(100, 100, 0, 10), null);
assert.equal(computePaymentApplication(100, 0, 100, 0), null);

assert.throws(() =>
  validateInvoiceLineAmounts(
    [{ quantity: 1, unitPrice: 10, lineDiscount: 0, lineTotal: 9 }],
    10,
    0,
    0,
    10,
  ),
);

console.log('invoiceAmountHelpers.test.ts OK');
