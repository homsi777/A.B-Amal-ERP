import assert from 'node:assert/strict';
import {
  aggregateInvoiceFabricGroups,
  buildStatementImportDisplayRows,
  flattenAccountStatementDisplayRows,
  groupInvoiceLinesByFabric,
  isStatementImportInvoice,
  shouldExpandStatementImportLines,
} from './customerStatementInvoiceDetails.js';
import type { Invoice } from '../types';

const importedInvoice = {
  id: 'inv-1',
  invoiceNumber: 'FB0000006',
  items: [
    {
      fabricId: 'l1',
      quantity: 425.5,
      unitType: 'meter',
      unitPrice: 2.7499,
      total: 1170.12,
      fabricName: 'جوبيتر sr2',
      materialName: 'جوبيتر sr2',
      rollsCount: 4,
      lineDate: '2026-03-28',
      excelUnitPrice: 2.75,
      statementImport: true,
    },
    {
      fabricId: 'l2',
      quantity: 100,
      unitType: 'meter',
      unitPrice: 2.75,
      total: 275,
      fabricName: 'باموك فلام 5',
      materialName: 'باموك فلام 5',
      rollsCount: 2,
      lineDate: '2026-02-20',
      excelUnitPrice: 2.75,
      statementImport: true,
    },
  ],
} as Invoice;

assert.equal(isStatementImportInvoice(importedInvoice), true);
const groups = groupInvoiceLinesByFabric(importedInvoice);
assert.equal(groups.length, 2);
assert.equal(groups[0].lineDate, '2026-03-28');
assert.equal(groups[0].unitPrice, 2.75);
assert.equal(shouldExpandStatementImportLines(importedInvoice, groups), true);
assert.equal(aggregateInvoiceFabricGroups(groups)?.fabricName.includes('/'), true);

const expanded = buildStatementImportDisplayRows({
  statementRow: {
    date: '2026-05-26',
    documentNo: 'FB0000006',
    typeLabel: 'فاتورة بيع',
  },
  lineGroups: groups,
  invoiceRows: [{ debit: 1445.12, credit: 0, balance: 5000 }],
});
assert.equal(expanded.length, 2);
assert.equal(expanded[0].date, '2026-02-20');
assert.equal(expanded[1].date, '2026-03-28');
assert.equal(expanded[0].debit, 275);

const chronological = flattenAccountStatementDisplayRows({
  openingBalance: 0,
  rows: [
    {
      date: '2026-05-26',
      documentNo: 'SQ000012',
      typeLabel: 'سند قبض',
      debit: 0,
      credit: 500,
      sourceType: 'RECEIPT_VOUCHER',
    },
    {
      date: '2026-05-26',
      documentNo: 'FB0000006',
      typeLabel: 'فاتورة بيع',
      debit: 1445.12,
      credit: 0,
      sourceType: 'SALES_INVOICE',
      sourceId: 'inv-1',
    },
    {
      date: '2026-02-19',
      documentNo: 'SQ000005',
      typeLabel: 'سند قبض',
      debit: 0,
      credit: 100,
      sourceType: 'RECEIPT_VOUCHER',
    },
  ],
  saleInvoices: [importedInvoice],
});
assert.equal(chronological[0].documentNo, 'SQ000005');
assert.equal(chronological[1].date, '2026-02-20');
assert.equal(chronological[1].fabric?.fabricName, 'باموك فلام 5');
assert.equal(chronological[2].date, '2026-03-28');
assert.equal(chronological[chronological.length - 1].documentNo, 'SQ000012');
assert.equal(chronological[chronological.length - 1].balance, 845.12);

console.log('customerStatementInvoiceDetails.test.ts OK');
