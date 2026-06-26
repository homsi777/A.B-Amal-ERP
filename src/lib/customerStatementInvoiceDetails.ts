import { listSalesInvoices, getSalesInvoice } from './api/salesInvoicesApi';
import { mapSalesInvoiceDetailToInvoice } from './invoiceDbMappers';
import type { Invoice } from '../types';

/** Server caps pageSize at 100 in salesInvoiceService. */
const SERVER_MAX_PAGE_SIZE = 100;

export interface StatementFabricGroup {
  fabricName: string;
  rollsCount: number;
  totalQuantity: number;
  unitPrice: number;
  totalAmount: number;
  /** تاريخ البند الأصلي من استيراد كشف Excel */
  lineDate?: string;
}

export type StatementDisplayRow = {
  date: string;
  documentNo: string;
  typeLabel: string;
  fabric: StatementFabricGroup;
  debit: number;
  credit: number;
  balance: number;
};

export function isStatementImportInvoice(invoice: Invoice | null | undefined): boolean {
  if (!invoice?.items?.length) return false;
  return invoice.items.every((item) => item.statementImport === true);
}

export function shouldExpandStatementImportLines(
  invoice: Invoice | null | undefined,
  lineGroups: StatementFabricGroup[],
): boolean {
  return Boolean(invoice && isStatementImportInvoice(invoice) && lineGroups.length > 1);
}

export function buildStatementImportDisplayRows(args: {
  statementRow: { date: string; documentNo?: string; typeLabel?: string; description?: string };
  lineGroups: StatementFabricGroup[];
  invoiceRows: Array<{ debit?: number; credit?: number; balance?: number }>;
}): StatementDisplayRow[] {
  const sortedGroups = [...args.lineGroups].sort((a, b) => {
    const dateCmp = String(a.lineDate ?? '').localeCompare(String(b.lineDate ?? ''));
    if (dateCmp !== 0) return dateCmp;
    return a.fabricName.localeCompare(b.fabricName, 'ar');
  });

  const typeLabel = args.statementRow.typeLabel || args.statementRow.description || 'فاتورة بيع';
  const docNo = String(args.statementRow.documentNo ?? '');

  return sortedGroups.map((group) => ({
    date: group.lineDate || args.statementRow.date,
    documentNo: docNo,
    typeLabel,
    fabric: group,
    debit: Number(group.totalAmount || 0),
    credit: 0,
    balance: 0,
  }));
}

export type AccountStatementSourceRow = {
  date: string;
  typeLabel?: string;
  description?: string;
  documentNo?: string;
  debit?: number;
  credit?: number;
  balance?: number;
  sourceType?: string;
  type?: string;
  sourceId?: string;
  notes?: string | null;
};

export type AccountStatementDisplayRow = {
  date: string;
  documentNo: string;
  typeLabel: string;
  detailText?: string;
  fabric: StatementFabricGroup | null;
  debit: number;
  credit: number;
  balance: number;
  isCustomerDiscount?: boolean;
};

function invoiceRowKey(row: AccountStatementSourceRow): string {
  const sourceId = String(row.sourceId ?? '').trim();
  if (sourceId) return `id:${sourceId}`;
  return `doc:${String(row.documentNo ?? '').trim()}`;
}

/** Flatten API rows (expand imported invoice lines) then sort chronologically and recompute balance. */
export function flattenAccountStatementDisplayRows(args: {
  rows: AccountStatementSourceRow[];
  openingBalance: number;
  saleInvoices?: Invoice[];
  invoiceDetailsBySourceId?: InvoiceDetailsBySourceId;
  invoiceDetailsByDocumentNo?: InvoiceDetailsByDocumentNo;
}): AccountStatementDisplayRow[] {
  const pending: Array<AccountStatementDisplayRow & { sortDate: string; sortKey: string }> = [];
  const seenSalesKeys = new Set<string>();

  for (const row of args.rows) {
    if (isStatementSalesInvoiceRow(row)) {
      const key = invoiceRowKey(row);
      if (seenSalesKeys.has(key)) continue;
      seenSalesKeys.add(key);

      const invoiceRows = args.rows.filter((r) => isStatementSalesInvoiceRow(r) && invoiceRowKey(r) === key);
      const lineGroups = resolveInvoiceDetailRowsForStatementRow(row, args.saleInvoices ?? [], {
        invoiceDetailsBySourceId: args.invoiceDetailsBySourceId,
        invoiceDetailsByDocumentNo: args.invoiceDetailsByDocumentNo,
      });
      const relatedInvoice = findSaleInvoiceForStatementRow(row, args.saleInvoices ?? []);
      const expandImportedLines = shouldExpandStatementImportLines(relatedInvoice, lineGroups);

      if (expandImportedLines) {
        const expanded = buildStatementImportDisplayRows({
          statementRow: row,
          lineGroups,
          invoiceRows,
        });
        for (const line of expanded) {
          pending.push({
            ...line,
            balance: 0,
            sortDate: line.date,
            sortKey: `${line.documentNo}:${line.fabric.fabricName}`,
          });
        }
        continue;
      }

      const fabric = aggregateInvoiceFabricGroups(lineGroups);
      pending.push({
        date: row.date,
        documentNo: String(row.documentNo ?? ''),
        typeLabel: row.typeLabel || row.description || 'فاتورة بيع',
        fabric,
        debit: invoiceRows.reduce((sum, r) => sum + Number(r.debit || 0), 0),
        credit: invoiceRows.reduce((sum, r) => sum + Number(r.credit || 0), 0),
        balance: 0,
        sortDate: row.date,
        sortKey: String(row.documentNo ?? ''),
      });
      continue;
    }

    pending.push({
      date: row.date,
      documentNo: String(row.documentNo ?? ''),
      typeLabel:
        row.type === 'CUSTOMER_DISCOUNT'
          ? 'حسم عميل'
          : row.typeLabel || row.description || '',
      detailText: row.type === 'CUSTOMER_DISCOUNT' ? String(row.description || row.notes || '').trim() || undefined : undefined,
      fabric: null,
      debit: Number(row.debit || 0),
      credit: Number(row.credit || 0),
      balance: 0,
      isCustomerDiscount: row.type === 'CUSTOMER_DISCOUNT',
      sortDate: row.date,
      sortKey: String(row.documentNo ?? ''),
    });
  }

  pending.sort((a, b) => {
    const dateCmp = a.sortDate.localeCompare(b.sortDate);
    if (dateCmp !== 0) return dateCmp;
    const aDebit = a.debit > 0;
    const bDebit = b.debit > 0;
    if (aDebit !== bDebit) return aDebit ? -1 : 1;
    return a.sortKey.localeCompare(b.sortKey, 'ar');
  });

  let running = args.openingBalance;
  return pending.map((row) => {
    running = Math.round((running + row.debit - row.credit) * 100) / 100;
    const { sortDate: _sortDate, sortKey: _sortKey, ...display } = row;
    return { ...display, balance: running };
  });
}

export type InvoiceDetailsBySourceId = Record<string, StatementFabricGroup[]>;
export type InvoiceDetailsByDocumentNo = Record<string, StatementFabricGroup[]>;

export interface CustomerSaleInvoiceDetailsResult {
  invoices: Invoice[];
  invoiceDetailsBySourceId: InvoiceDetailsBySourceId;
  invoiceDetailsByDocumentNo: InvoiceDetailsByDocumentNo;
}

export function extractBaseFabricName(rawName: string | undefined): string {
  const value = String(rawName ?? '').trim();
  if (!value) return 'خامة غير محددة';
  const separators = ['·', '|', '،', ',', ' - ', ' — ', ' – '];
  for (const separator of separators) {
    if (!value.includes(separator)) continue;
    const base = value.split(separator)[0]?.trim();
    if (base) return base;
  }
  return value;
}

export function aggregateInvoiceFabricGroups(groups: StatementFabricGroup[]): StatementFabricGroup | null {
  if (!groups.length) return null;
  if (groups.length === 1) return groups[0];

  const fabricNames = [...new Set(groups.map((g) => g.fabricName.trim()).filter(Boolean))];
  const fabricName = fabricNames.length === 1 ? fabricNames[0] : fabricNames.join(' / ');

  const rollsCount = groups.reduce((sum, g) => sum + g.rollsCount, 0);
  const totalQuantity = groups.reduce((sum, g) => sum + g.totalQuantity, 0);
  const totalAmount = groups.reduce((sum, g) => sum + g.totalAmount, 0);
  const unitPrice =
    totalQuantity > 0
      ? totalAmount / totalQuantity
      : groups.reduce((sum, g) => sum + g.unitPrice, 0) / groups.length;

  return { fabricName, rollsCount, totalQuantity, unitPrice, totalAmount };
}

export function groupInvoiceLinesByFabric(invoice: Invoice): StatementFabricGroup[] {
  if (!invoice.items || invoice.items.length === 0) return [];
  return invoice.items.map((item) => {
    const name = String(item.fabricName || item.materialName || '').trim() || 'خامة غير محددة';
    const rollsCount =
      typeof item.rollsCount === 'number' && Number.isFinite(item.rollsCount) && item.rollsCount > 0
        ? item.rollsCount
        : 1;
    const quantity = Number(item.quantity || 0);
    const lineTotal = Number(item.total || 0) || quantity * Number(item.unitPrice || 0);
    const excelUnitPrice =
      typeof item.excelUnitPrice === 'number' && Number.isFinite(item.excelUnitPrice) && item.excelUnitPrice > 0
        ? item.excelUnitPrice
        : undefined;
    const unitPrice =
      excelUnitPrice ??
      Number(item.unitPrice || (quantity > 0 ? lineTotal / quantity : 0));
    return {
      fabricName: name,
      rollsCount,
      totalQuantity: quantity,
      unitPrice,
      totalAmount: lineTotal,
      lineDate: item.lineDate,
    };
  });
}

export function isStatementSalesInvoiceRow(row: {
  sourceType?: string;
  typeLabel?: string;
  type?: string;
}): boolean {
  return (
    row.sourceType === 'SALES_INVOICE' ||
    row.sourceType === 'INVOICE' ||
    row.typeLabel === 'فاتورة بيع' ||
    row.type === 'SALES_INVOICE'
  );
}

export function findSaleInvoiceForStatementRow(
  row: { sourceId?: string; documentNo?: string },
  invoices: Invoice[],
): Invoice | null {
  const sourceId = String(row.sourceId ?? '').trim();
  if (sourceId) {
    const byId = invoices.find((inv) => inv.id === sourceId);
    if (byId) return byId;
  }
  const docNo = String(row.documentNo ?? '').trim();
  if (!docNo) return null;
  const docUpper = docNo.toUpperCase();
  return (
    invoices.find((inv) => String(inv.invoiceNumber ?? '').trim() === docNo) ??
    invoices.find((inv) => String(inv.invoiceNumber ?? '').trim().toUpperCase() === docUpper) ??
    null
  );
}

export function resolveInvoiceDetailRowsForStatementRow(
  row: { sourceId?: string; documentNo?: string; sourceType?: string; typeLabel?: string; type?: string },
  invoices: Invoice[],
  maps?: {
    invoiceDetailsBySourceId?: InvoiceDetailsBySourceId;
    invoiceDetailsByDocumentNo?: InvoiceDetailsByDocumentNo;
  },
): StatementFabricGroup[] {
  if (!isStatementSalesInvoiceRow(row)) return [];

  const sourceId = String(row.sourceId ?? '').trim();
  const docNo = String(row.documentNo ?? '').trim();
  const fromMap =
    (sourceId ? maps?.invoiceDetailsBySourceId?.[sourceId] : undefined) ??
    (docNo ? maps?.invoiceDetailsByDocumentNo?.[docNo] : undefined) ??
    (docNo ? maps?.invoiceDetailsByDocumentNo?.[docNo.toUpperCase()] : undefined);
  if (fromMap?.length) {
    console.log('[pdfDetails] row', docNo, 'found', fromMap.length, 'details from map');
    return fromMap;
  }

  const invoice = findSaleInvoiceForStatementRow(row, invoices);
  if (invoice) {
    const groups = groupInvoiceLinesByFabric(invoice);
    console.log('[pdfDetails] row', docNo, 'found', groups.length, 'details from direct lookup');
    return groups;
  }

  console.warn('[pdfDetails] row', docNo, 'sourceId:', sourceId, 'sourceType:', row.sourceType, '→ NO details found. invoices count:', invoices.length, 'map keys:', Object.keys(maps?.invoiceDetailsBySourceId ?? {}).length);
  return [];
}

export function buildInvoiceDetailsMaps(invoices: Invoice[]): {
  invoiceDetailsBySourceId: InvoiceDetailsBySourceId;
  invoiceDetailsByDocumentNo: InvoiceDetailsByDocumentNo;
} {
  const invoiceDetailsBySourceId: InvoiceDetailsBySourceId = {};
  const invoiceDetailsByDocumentNo: InvoiceDetailsByDocumentNo = {};
  for (const invoice of invoices) {
    const groups = groupInvoiceLinesByFabric(invoice);
    invoiceDetailsBySourceId[invoice.id] = groups;
    const docNo = String(invoice.invoiceNumber ?? '').trim();
    if (docNo) {
      invoiceDetailsByDocumentNo[docNo] = groups;
      const docNoUpper = docNo.toUpperCase();
      if (docNoUpper !== docNo) invoiceDetailsByDocumentNo[docNoUpper] = groups;
    }
  }
  return { invoiceDetailsBySourceId, invoiceDetailsByDocumentNo };
}

async function fetchAllSalesInvoiceListRows(params: {
  customerId: string;
  dateFrom: string;
  dateTo: string;
  documentStatus: string;
}): Promise<Record<string, unknown>[]> {
  const acc: Record<string, unknown>[] = [];
  let page = 1;
  for (;;) {
    const list = await listSalesInvoices({
      customerId: params.customerId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      documentStatus: params.documentStatus,
      page,
      pageSize: SERVER_MAX_PAGE_SIZE,
    });
    acc.push(...list.rows);
    if (list.rows.length < SERVER_MAX_PAGE_SIZE || acc.length >= list.total) break;
    page += 1;
  }
  return acc;
}

export async function loadCustomerSaleInvoiceDetails(
  customerId: string,
  fromDate: string,
  toDate: string,
): Promise<CustomerSaleInvoiceDetailsResult> {
  console.log('[invoiceDetails] loading for customer', customerId, 'from', fromDate, 'to', toDate);
  const rows = await fetchAllSalesInvoiceListRows({
    customerId,
    dateFrom: fromDate,
    dateTo: toDate,
    documentStatus: 'CONFIRMED',
  });
  console.log('[invoiceDetails] listSalesInvoices returned', rows.length, 'rows');

  const detailResults = await Promise.allSettled(
    rows.map((row) => getSalesInvoice(String((row as Record<string, unknown>).id))),
  );

  const invoices: Invoice[] = [];
  for (let i = 0; i < detailResults.length; i++) {
    const result = detailResults[i];
    const rowId = String((rows[i] as Record<string, unknown>).id ?? '');
    if (result.status === 'fulfilled') {
      try {
        const inv = mapSalesInvoiceDetailToInvoice(result.value.data);
        console.log('[invoiceDetails] mapped invoice', inv.id, 'invoiceNo:', inv.invoiceNumber, 'items:', inv.items?.length ?? 0);
        invoices.push(inv);
      } catch (e) {
        console.warn('[invoiceDetails] Failed to map sales invoice detail', rowId, e);
      }
    } else {
      console.warn('[invoiceDetails] Failed to fetch sales invoice detail', rowId, result.reason);
    }
  }

  console.log('[invoiceDetails] total invoices loaded:', invoices.length, 'with items:', invoices.reduce((s, inv) => s + (inv.items?.length ?? 0), 0));
  const { invoiceDetailsBySourceId, invoiceDetailsByDocumentNo } = buildInvoiceDetailsMaps(invoices);
  return { invoices, invoiceDetailsBySourceId, invoiceDetailsByDocumentNo };
}
