import assert from 'node:assert/strict';
import {
  buildCustomerStatementFileName,
  buildInvoiceStatementFileName,
  buildSupplierStatementFileName,
  buildVoucherFileName,
  sanitizeDocumentFilePart,
} from './documentFileNames.ts';

assert.equal(sanitizeDocumentFilePart('  a/b  '), 'a_b');
assert.equal(
  buildCustomerStatementFileName('محمود زفر', '2024-01-01', '2024-12-31'),
  'كشف_حساب_محمود زفر_2024-01-01_2024-12-31',
);
assert.equal(
  buildInvoiceStatementFileName('محمود زفر', 'INV-100'),
  'كشف_فاتورة_محمود زفر_INV-100',
);
assert.equal(
  buildSupplierStatementFileName('شركة الأقمشة', '2024-01-01', '2024-12-31'),
  'كشف_حساب_مورد_شركة الأقمشة_2024-01-01_2024-12-31',
);
assert.equal(buildVoucherFileName('RECEIPT', 'محمود', 'RC-55'), 'سند_قبض_محمود_RC-55');

console.log('documentFileNames.test.ts: OK');
