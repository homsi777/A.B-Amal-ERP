import assert from 'node:assert/strict';
import {
  fitImportedSaleLineAmounts,
  grossLineTotal,
  INVOICE_AMOUNT_EPS,
  normalizeStatementImportSaleLines,
} from './statementImportSaleLines.js';
import { validateInvoiceLineAmounts } from './invoiceAmountHelpers.js';

// Mahmoud Zafer file: 425.5 m × 2.75 USD/m shown as 1170.12 in Excel
const fitted = fitImportedSaleLineAmounts(425.5, 1170.12);
assert.equal(fitted.lineTotal, 1170.12);
assert.ok(Math.abs(grossLineTotal(fitted.quantity, fitted.unitPrice) - 1170.12) <= INVOICE_AMOUNT_EPS);

const { lines, subtotal } = normalizeStatementImportSaleLines([
  { quantity: 425.5, total: 1170.12, materialName: 'test' },
  { quantity: 100, total: 275, materialName: 'test2' },
]);
assert.equal(lines.length, 2);
assert.equal(subtotal, 1445.12);
for (const line of lines) {
  assert.ok(Math.abs(grossLineTotal(line.quantity, line.unitPrice) - line.total) <= INVOICE_AMOUNT_EPS);
}

validateInvoiceLineAmounts(
  lines.map((ln) => ({
    quantity: ln.quantity,
    unitPrice: ln.unitPrice,
    lineDiscount: 0,
    lineTotal: ln.total,
  })),
  subtotal,
  0,
  0,
  subtotal,
);

console.log('statementImportSaleLines.test.ts OK');
