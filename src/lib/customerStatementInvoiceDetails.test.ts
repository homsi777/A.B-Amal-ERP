import assert from 'node:assert/strict';
import {
  aggregateInvoiceFabricGroups,
  buildStatementImportDisplayRows,
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
      lineDate: '2026-01-15',
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
assert.equal(groups[0].lineDate, '2026-01-15');
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
assert.equal(expanded[0].date, '2026-01-15');
assert.equal(expanded[1].date, '2026-02-20');
assert.equal(expanded[0].debit, 1170.12);
assert.equal(expanded[1].balance, 5000);

console.log('customerStatementInvoiceDetails.test.ts OK');
