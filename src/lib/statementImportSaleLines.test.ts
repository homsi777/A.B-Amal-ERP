import assert from 'node:assert/strict';
import {
  fitImportedSaleLineAmounts,
  grossLineTotal,
  INVOICE_AMOUNT_EPS,
  normalizeStatementImportSaleLines,
  scanStatementSheetTotals,
} from './statementImportSaleLines.js';

const fitted = fitImportedSaleLineAmounts(425.5, 1170.12);
assert.equal(fitted.lineTotal, 1170.12);
assert.ok(Math.abs(grossLineTotal(fitted.quantity, fitted.unitPrice) - 1170.12) <= INVOICE_AMOUNT_EPS);

const scanned = scanStatementSheetTotals([
  [],
  [],
  [],
  [null, null, 'اجمالي الأمتار', null, null, 'توب', null, null, 'الإجمالي'],
  [null, null, 3678, null, null, 36, null, null, 9054.04],
  [null, null, null, null, 'الإجمالي'],
  [null, null, null, null, 9054.04],
  [null, null, null, null, 1654],
]);
assert.equal(scanned.sheetSalesTotal, 9054.04);
assert.equal(scanned.sheetMetersTotal, 3678);
assert.equal(scanned.sheetRollsTotal, 36);
assert.equal(scanned.sheetBalance, 1654);

const { subtotal } = normalizeStatementImportSaleLines([{ quantity: 425.5, total: 1170.12 }]);
assert.equal(subtotal, 1170.12);

console.log('statementImportSaleLines.client.test.ts OK');
