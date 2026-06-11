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

export function groupInvoiceLinesByFabric(invoice: Invoice): StatementFabricGroup[] {
  if (!invoice.items || invoice.items.length === 0) return [];
  const groups = new Map<
    string,
    { rollsCount: number; totalQuantity: number; totalAmount: number; lastUnitPrice: number }
  >();
  for (const item of invoice.items) {
    const name = extractBaseFabricName(item.fabricName || item.materialName);
    const existing = groups.get(name) ?? { rollsCount: 0, totalQuantity: 0, totalAmount: 0, lastUnitPrice: 0 };
    const rollsCount =
      typeof item.rollsCount === 'number' && Number.isFinite(item.rollsCount) && item.rollsCount > 0
        ? item.rollsCount
        : 1;
    existing.rollsCount += rollsCount;
    existing.totalQuantity += Number(item.quantity || 0);
    const lineTotal = Number(item.total || 0) || Number(item.quantity || 0) * Number(item.unitPrice || 0);
    existing.totalAmount += lineTotal;
    existing.lastUnitPrice = Number(item.unitPrice || existing.lastUnitPrice || 0);
    groups.set(name, existing);
  }
  return Array.from(groups.entries()).map(([fabricName, g]) => ({
    fabricName,
    rollsCount: g.rollsCount,
    totalQuantity: g.totalQuantity,
    unitPrice: g.totalQuantity > 0 ? g.totalAmount / g.totalQuantity : g.lastUnitPrice,
    totalAmount: g.totalAmount,
  }));
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
    if (docNo) invoiceDetailsByDocumentNo[docNo] = groups;
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
  const rows = await fetchAllSalesInvoiceListRows({
    customerId,
    dateFrom: fromDate,
    dateTo: toDate,
    documentStatus: 'CONFIRMED',
  });

  const detailResults = await Promise.allSettled(
    rows.map((row) => getSalesInvoice(String((row as Record<string, unknown>).id))),
  );

  const invoices: Invoice[] = [];
  for (let i = 0; i < detailResults.length; i++) {
    const result = detailResults[i];
    const rowId = String((rows[i] as Record<string, unknown>).id ?? '');
    if (result.status === 'fulfilled') {
      try {
        invoices.push(mapSalesInvoiceDetailToInvoice(result.value.data));
      } catch (e) {
        console.warn('[customerStatement] Failed to map sales invoice detail', rowId, e);
      }
    } else {
      console.warn('[customerStatement] Failed to fetch sales invoice detail', rowId, result.reason);
    }
  }

  const { invoiceDetailsBySourceId, invoiceDetailsByDocumentNo } = buildInvoiceDetailsMaps(invoices);
  return { invoices, invoiceDetailsBySourceId, invoiceDetailsByDocumentNo };
}
