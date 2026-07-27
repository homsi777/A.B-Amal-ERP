export type InvoicePaginationRow = {
  kind: 'line' | 'subtotal' | 'grand';
};

export type InvoicePaginationPage<T extends InvoicePaginationRow> = {
  rows: T[];
  includeSummary: boolean;
  includeFooter: boolean;
};

export function paginateInvoiceStatementRows<T extends InvoicePaginationRow>(
  detailRows: T[],
  summaryCost: number,
  isDraft: boolean,
): InvoicePaginationPage<T>[] {
  // Multi-page documents show the footer only on the final page, so detail-only
  // pages can use the reclaimed vertical space for two additional rows.
  const firstPageDetailCapacity = isDraft ? 23 : 25;
  const firstPageBudget = isDraft ? 22 : 24;
  const continuationDetailCapacity = isDraft ? 36 : 38;
  const finalPageBudget = isDraft ? 34 : 36;

  if (detailRows.length + summaryCost <= firstPageBudget) {
    return [{ rows: detailRows, includeSummary: true, includeFooter: true }];
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
  pages.push({ rows: firstPage.rows, includeSummary: false, includeFooter: false });
  index = firstPage.nextIndex;

  while (index < detailRows.length) {
    const remainingCount = detailRows.length - index;

    if (remainingCount + summaryCost <= finalPageBudget) {
      pages.push({ rows: detailRows.slice(index), includeSummary: true, includeFooter: false });
      index = detailRows.length;
      break;
    }

    const continuationPage = takeDetailChunk(index, continuationDetailCapacity);
    pages.push({ rows: continuationPage.rows, includeSummary: false, includeFooter: false });
    index = continuationPage.nextIndex;
  }

  if (!pages.at(-1)?.includeSummary) {
    pages.push({ rows: [], includeSummary: true, includeFooter: false });
  }

  return pages.map((page, pageIndex) => ({
    ...page,
    includeFooter: pageIndex === pages.length - 1,
  }));
}
