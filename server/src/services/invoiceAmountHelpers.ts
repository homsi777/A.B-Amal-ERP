export const INVOICE_AMOUNT_EPS = 1e-4;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type InvoiceLineAmountInput = {
  quantity: number;
  unitPrice: number;
  lineDiscount?: number;
  lineTax?: number;
  lineTotal: number;
};

export function grossLineTotal(quantity: number, unitPrice: number): number {
  return round2(quantity * unitPrice);
}

/** Proportionally allocate header discount_total to lines; line_total stored as NET (gross − line_discount). */
export function allocateHeaderDiscountToLines<T extends InvoiceLineAmountInput>(
  lines: T[],
  discountTotal: number,
): T[] {
  if (!lines.length) return lines;
  const subtotal = round2(lines.reduce((s, ln) => s + grossLineTotal(ln.quantity, ln.unitPrice), 0));
  const discount = round2(Math.max(0, discountTotal));
  if (discount <= INVOICE_AMOUNT_EPS || subtotal <= INVOICE_AMOUNT_EPS) {
    return lines.map((ln) => ({
      ...ln,
      lineDiscount: 0,
      lineTotal: grossLineTotal(ln.quantity, ln.unitPrice),
    }));
  }

  let allocated = 0;
  const result: T[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const gross = grossLineTotal(ln.quantity, ln.unitPrice);
    let lineDisc: number;
    if (i === lines.length - 1) {
      lineDisc = round2(Math.min(gross, discount - allocated));
    } else {
      lineDisc = round2(Math.min(gross, discount * (gross / subtotal)));
      allocated += lineDisc;
    }
    result.push({
      ...ln,
      lineDiscount: lineDisc,
      lineTotal: round2(gross - lineDisc),
    });
  }
  return result;
}

export function validateInvoiceLineAmounts(
  lines: InvoiceLineAmountInput[],
  subtotal: number,
  discountTotal: number,
  taxTotal: number,
  totalAmount: number,
): void {
  const computedSubtotal = round2(lines.reduce((s, ln) => s + grossLineTotal(ln.quantity, ln.unitPrice), 0));
  if (Math.abs(computedSubtotal - subtotal) > INVOICE_AMOUNT_EPS) {
    throw Object.assign(new Error('مجموع أسطر الفاتورة لا يطابق المجموع الفرعي'), { code: 'VALIDATION' });
  }
  const sumNet = round2(lines.reduce((s, ln) => s + ln.lineTotal, 0));
  const expectedNet = round2(subtotal - discountTotal);
  if (Math.abs(sumNet - expectedNet) > INVOICE_AMOUNT_EPS) {
    throw Object.assign(new Error('مجموع صافي أسطر الفاتورة لا يطابق (المجموع − الخصم)'), { code: 'VALIDATION' });
  }
  for (const ln of lines) {
    const gross = grossLineTotal(ln.quantity, ln.unitPrice);
    const disc = ln.lineDiscount ?? 0;
    const expectedLine = round2(gross - disc);
    if (Math.abs(expectedLine - ln.lineTotal) > INVOICE_AMOUNT_EPS) {
      throw Object.assign(new Error('إجمالي السطر لا يطابق (الكمية × السعر − خصم السطر)'), { code: 'VALIDATION' });
    }
  }
  if (Math.abs(subtotal - discountTotal + taxTotal - totalAmount) > INVOICE_AMOUNT_EPS) {
    throw Object.assign(new Error('إجمالي الفاتورة لا يطابق (المجموع − الخصم + الضريبة)'), { code: 'VALIDATION' });
  }
}

/** Pure payment delta for invoice-linked vouchers (purchase/sales). */
export function computePaymentApplication(
  totalAmount: number,
  paidAmount: number,
  remainingAmount: number,
  voucherAmount: number,
): { applyAmount: number; newPaid: number; newRemaining: number } | null {
  if (remainingAmount <= INVOICE_AMOUNT_EPS) return null;
  const applyAmount = round2(Math.min(voucherAmount, Math.max(0, remainingAmount)));
  if (applyAmount <= INVOICE_AMOUNT_EPS) return null;
  const newPaid = round2(paidAmount + applyAmount);
  const newRemaining = round2(Math.max(0, totalAmount - newPaid));
  return { applyAmount, newPaid, newRemaining };
}
