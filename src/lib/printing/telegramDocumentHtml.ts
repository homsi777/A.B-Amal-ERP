import type { Invoice } from '../../types';
import type { VoucherRow } from '../api/vouchersApi';
import { AR_INVOICE_STATEMENT } from '../i18n/arTerminology';
import { renderCustomerAccountStatementPdfHtml } from '../pdfExport';
import { renderInvoiceStatementA4Html } from './renderInvoiceStatementA4';
import { renderVoucherA5Html, voucherRowToPrintData, type VoucherRenderOptions } from './renderVoucherA5';

export type SaleInvoiceTelegramPayload = {
  invoice: Invoice;
  partyName: string;
};

export function buildTelegramSaleInvoiceHtml({ invoice, partyName }: SaleInvoiceTelegramPayload): string {
  return renderInvoiceStatementA4Html({
    invoice,
    partyName,
    title: AR_INVOICE_STATEMENT.printTitle,
    subtitle: AR_INVOICE_STATEMENT.printSubtitle,
  });
}

export function buildTelegramPurchaseInvoiceHtml({ invoice, partyName }: SaleInvoiceTelegramPayload): string {
  return buildTelegramSaleInvoiceHtml({ invoice, partyName });
}

export type CustomerAccountStatementHtmlInput = Parameters<typeof renderCustomerAccountStatementPdfHtml>[0];

/** نفس HTML كشف حساب العميل — للطباعة والتصدير وتيليغرام */
export function buildTelegramCustomerAccountStatementHtml(data: CustomerAccountStatementHtmlInput): string {
  return renderCustomerAccountStatementPdfHtml(data);
}

const VOUCHER_RENDER_OPTIONS: VoucherRenderOptions = { colorMode: 'color' };

export function buildTelegramVoucherHtml(voucher: VoucherRow): string {
  return renderVoucherA5Html(voucherRowToPrintData(voucher), VOUCHER_RENDER_OPTIONS);
}
