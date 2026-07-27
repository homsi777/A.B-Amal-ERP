export type InvoicePaginationRow = {
  kind: 'line' | 'subtotal' | 'grand';
};

export type InvoicePaginationPage<T extends InvoicePaginationRow> = {
  rows: T[];
  includeSummary: boolean;
};

export function paginateInvoiceStatementRows<T extends InvoicePaginationRow>(
  detailRows: T[],
  summaryCost: number,
  isDraft: boolean,
): InvoicePaginationPage<T>[] {
  const firstPageDetailCapacity = isDraft ? 21 : 23;
  const firstPageBudget = isDraft ? 22 : 24;
  const continuationPageBudget = isDraft ? 34 : 36;

  if (detailRows.length + summaryCost <= firstPageBudget) {
    return [{ rows: detailRows, includeSummary: true }];
  }

  const takeDetailChunk = (start: number, capacity: number) => {
    let index = start;
    const rows = detailRows.slice(index, index + capacity);
    index += rows.length;

    // Keep a subtotal with its preceding line instead of orphaning it at the
    // start of the next page.
    while (rows.length > 1 && index < detailRows.length && detailRows[index]?.kind !== 'line') {
      rows.pop();
      index -= 1;
    }

    return { rows, nextIndex: index };
  };

  const pages: InvoicePaginationPage<T>[] = [];
  let index = 0;
  const firstPage = takeDetailChunk(index, firstPageDetailCapacity);
  pages.push({ rows: firstPage.rows, includeSummary: false });
  index = firstPage.nextIndex;

  while (index < detailRows.length) {
    const remainingCount = detailRows.length - index;

    if (remainingCount + summaryCost <= continuationPageBudget) {
      pages.push({ rows: detailRows.slice(index), includeSummary: true });
      index = detailRows.length;
      break;
    }

    const continuationPage = takeDetailChunk(index, continuationPageBudget);
    pages.push({ rows: continuationPage.rows, includeSummary: false });
    index = continuationPage.nextIndex;
  }

  if (!pages.at(-1)?.includeSummary) pages.push({ rows: [], includeSummary: true });
  return pages;
}
