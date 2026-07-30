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
assert.equal(shortPages[0]?.includeFooter, true);

// Representative manager invoice: 11 detail lines, three group subtotals and
// one grand subtotal, plus a two-row summary/totals block (cost 11).
// It must not create an almost-empty second page just for the summary.
const compactManagerRows = makeGroupedRows(11, 4);
const compactManagerPages = paginateInvoiceStatementRows(compactManagerRows, 11, false);
assert.equal(compactManagerRows.length + 11, 26);
assert.equal(compactManagerPages.length, 1, 'compact manager invoice should fit one A4 page');
assert.equal(compactManagerPages[0]?.includeSummary, true);
assert.equal(compactManagerPages[0]?.includeFooter, true);

const longRows = makeGroupedRows(64);
const longPages = paginateInvoiceStatementRows(longRows, 17, false);
assert.equal(longPages.length, 3, 'long invoice should use continuation space instead of five pages');
assert.equal(longPages.filter((page) => page.includeSummary).length, 1);
assert.equal(longPages.filter((page) => page.includeFooter).length, 1);
assert.ok(longPages.at(-1)?.rows.length, 'last page should contain detail rows');
assert.equal(longPages.at(-1)?.includeSummary, true, 'last page should also contain the summary');
assert.equal(longPages.at(-1)?.includeFooter, true, 'footer should appear only on the final page');
assert.equal(longPages[0]?.rows.length, 25, 'first detail-only page should use the reclaimed footer space');

for (const page of longPages.slice(1)) {
  assert.notEqual(page.rows[0]?.kind, 'subtotal', 'a subtotal must not be orphaned at the top of a page');
}

const preservedIds = longPages.flatMap((page) => page.rows.map((row) => row.id));
assert.deepEqual(preservedIds, longRows.map((row) => row.id), 'pagination must preserve every detail row exactly once');

console.log('renderInvoiceStatementA4 pagination tests passed');
