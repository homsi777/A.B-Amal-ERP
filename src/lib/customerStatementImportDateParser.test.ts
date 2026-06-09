import assert from 'node:assert/strict';
import { parseCustomerStatementImportDate } from './customerStatementImportDateParser';

function expectDate(input: unknown, expected: string) {
  const result = parseCustomerStatementImportDate(input);
  assert.equal(result.ok, true, `expected ${String(input)} to parse`);
  if (result.ok) assert.equal(result.date, expected);
}

function expectInvalid(input: unknown) {
  const result = parseCustomerStatementImportDate(input);
  assert.equal(result.ok, false, `expected ${String(input)} to be invalid`);
}

expectDate(46142, '2026-04-30');
expectDate('10/05/2026', '2026-05-10');
expectDate('2026-05-10', '2026-05-10');
expectDate('4/30/26', '2026-04-30');
expectDate('7\\4\\2026', '2026-04-07');
expectDate('مرتجع 4/30/26', '2026-04-30');
expectDate(new Date(2026, 4, 10), '2026-05-10');
expectInvalid('');
expectInvalid(null);
expectInvalid('35/14/2026');
expectInvalid('random text');

console.log('customerStatementImportDateParser tests passed');

