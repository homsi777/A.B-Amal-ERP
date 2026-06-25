import type { Customer, CustomerOrder } from '../types';
import { sendTelegramDocument } from './api/telegramApi';
import { buildCustomerOrderWhatsAppText } from './orderExport';
import { displayCustomerOrderNumber } from './orderDisplay';
import { buildCustomerOrderFileName } from './printing/documentFileNames';
import { renderReservationOrderA4Document } from './printing/renderReservationOrderA4';
import { ORDER_STATUS_LABELS } from '../pages/orders/orderStatusUi';

export async function sendTelegramCustomerOrder(
  order: CustomerOrder,
  customer: Customer,
  statusLabelAr?: string,
): Promise<void> {
  const statusLabel = statusLabelAr ?? ORDER_STATUS_LABELS[order.status];
  const message = buildCustomerOrderWhatsAppText(order, customer, statusLabel);
  const pdfHtml = renderReservationOrderA4Document(order, customer, statusLabel);
  const orderNo = displayCustomerOrderNumber(order.orderNumber);
  const fileName = `${buildCustomerOrderFileName(customer.name, orderNo)}.pdf`;

  await sendTelegramDocument({
    documentType: 'INVOICE',
    partyType: 'customer',
    partyId: order.customerId,
    targetType: 'CUSTOMER',
    targetId: order.customerId,
    message,
    pdfHtml,
    fileName,
    caption: 'طلبية حجز PDF',
    eventType: 'CUSTOMER_ORDER',
  });
}
