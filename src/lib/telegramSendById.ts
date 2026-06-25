import { getSalesInvoice } from './api/salesInvoicesApi';
import { getPurchaseInvoice } from './api/purchaseInvoicesApi';
import { mapSalesInvoiceDetailToInvoice, mapPurchaseInvoiceDetailToInvoice } from './invoiceDbMappers';
import { sendTelegramInvoiceFromSavedInvoice } from './telegramInvoice';

export async function sendTelegramSalesInvoiceById(invoiceId: string, partyName: string): Promise<void> {
  const res = await getSalesInvoice(invoiceId);
  const invoice = mapSalesInvoiceDetailToInvoice(res.data);
  await sendTelegramInvoiceFromSavedInvoice(invoice, partyName);
}

export async function sendTelegramPurchaseInvoiceById(invoiceId: string, partyName: string): Promise<void> {
  const res = await getPurchaseInvoice(invoiceId);
  const invoice = mapPurchaseInvoiceDetailToInvoice(res.data);
  await sendTelegramInvoiceFromSavedInvoice(invoice, partyName);
}
