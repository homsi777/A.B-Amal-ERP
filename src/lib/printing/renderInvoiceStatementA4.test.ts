import assert from 'node:assert/strict';
import {
  paginateInvoiceStatementRows,
  type InvoicePaginationRow,
} from './invoiceStatementPagination';

type TestRow = InvoicePaginationRow & { id: number };

function makeGroupedRows(lineCount: number, groupSize = 8): TestRow[] {
  const rows: TestRow[] = [];
  let id = 0;

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    rows.push({ id: id += 1, kind: 'line' });
    const isGroupEnd = (lineIndex + 1) % groupSize === 0 || lineIndex === lineCount - 1;
    if (isGroupEnd) rows.push({ id: id += 1, kind: 'subtotal' });
  }

  if (lineCount > groupSize) rows.push({ id: id += 1, kind: 'grand' });
  return rows;
}

const shortRows = makeGroupedRows(3);
const shortPages = paginateInvoiceStatementRows(shortRows, 10, false);
assert.equal(shortPages.length, 1, 'short invoices should remain on one page');
assert.equal(shortPages[0]?.includeSummary, true);

const longRows = makeGroupedRows(64);
const longPages = paginateInvoiceStatementRows(longRows, 17, false);
assert.equal(longPages.length, 3, 'long invoice should use continuation space instead of five pages');
assert.equal(longPages.filter((page) => page.includeSummary).length, 1);
assert.ok(longPages.at(-1)?.rows.length, 'last page should contain detail rows');
assert.equal(longPages.at(-1)?.includeSummary, true, 'last page should also contain the summary');

for (const page of longPages.slice(1)) {
  assert.notEqual(page.rows[0]?.kind, 'subtotal', 'a subtotal must not be orphaned at the top of a page');
}

const preservedIds = longPages.flatMap((page) => page.rows.map((row) => row.id));
assert.deepEqual(preservedIds, longRows.map((row) => row.id), 'pagination must preserve every detail row exactly once');

console.log('renderInvoiceStatementA4 pagination tests passed');
