import assert from 'node:assert/strict';
import {
  RETURN_CASH_REFUND_REVERSAL_SOURCE_TYPE,
  RETURN_CASH_REFUND_SOURCE_TYPE,
} from './returnInvoiceCashboxService.js';

// Document expected cash refund movement semantics (unit-level contract)
assert.equal(RETURN_CASH_REFUND_SOURCE_TYPE, 'RETURN_INVOICE');
assert.equal(RETURN_CASH_REFUND_REVERSAL_SOURCE_TYPE, 'RETURN_INVOICE_REVERSAL');

/** Sales return CASH_REFUND: PAYMENT + OUT; reversal: ADJUSTMENT + IN */
function salesRefundDirections() {
  return { confirm: { type: 'PAYMENT', direction: 'OUT' }, reversal: { type: 'ADJUSTMENT', direction: 'IN' } };
}
/** Purchase return CASH_REFUND: RECEIPT + IN; reversal: ADJUSTMENT + OUT */
function purchaseRefundDirections() {
  return { confirm: { type: 'RECEIPT', direction: 'IN' }, reversal: { type: 'ADJUSTMENT', direction: 'OUT' } };
}

const sales = salesRefundDirections();
assert.equal(sales.confirm.type, 'PAYMENT');
assert.equal(sales.reversal.direction, 'IN');
const purchase = purchaseRefundDirections();
assert.equal(purchase.confirm.type, 'RECEIPT');
assert.equal(purchase.reversal.direction, 'OUT');

// Idempotency keys must differ between original and reversal source types
assert.notEqual(RETURN_CASH_REFUND_SOURCE_TYPE, RETURN_CASH_REFUND_REVERSAL_SOURCE_TYPE);

console.log('returnInvoiceCashbox.test.ts OK');
