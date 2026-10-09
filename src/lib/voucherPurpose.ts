import i18n from '../i18n/config';

export const VOUCHER_PURPOSES = [
  'INVOICE_PAYMENT',
  'ADVANCE',
  'ADVANCE_REFUND',
  'COMPENSATION',
  'OTHER',
] as const;

export type VoucherPurpose = (typeof VOUCHER_PURPOSES)[number];

/** Used by print templates — follows the branch's current language, despite the name. */
export function voucherPurposeAr(purpose: string | null | undefined): string {
  const t = (key: string) => i18n.t(key, { ns: 'terminology' });
  switch (String(purpose ?? '').toUpperCase()) {
    case 'ADVANCE':
      return t('voucherNarrative.purposeAdvance');
    case 'ADVANCE_REFUND':
      return t('voucherNarrative.purposeAdvanceRefund');
    case 'COMPENSATION':
      return t('voucherNarrative.purposeCompensation');
    case 'OTHER':
      return t('voucherNarrative.purposeOther');
    case 'INVOICE_PAYMENT':
    default:
      return t('voucherNarrative.purposeInvoicePayment');
  }
}

/** Options for receipt (قبض) screen — re-evaluated on each call so they follow the current branch language. */
export function getReceiptPurposeOptions(): Array<{ value: VoucherPurpose; label: string; hint: string }> {
  const t = (key: string) => i18n.t(key, { ns: 'terminology' });
  return [
    { value: 'INVOICE_PAYMENT', label: t('purposeOptions.receipt.invoicePayment.label'), hint: t('purposeOptions.receipt.invoicePayment.hint') },
    { value: 'ADVANCE', label: t('purposeOptions.receipt.advance.label'), hint: t('purposeOptions.receipt.advance.hint') },
    { value: 'COMPENSATION', label: t('purposeOptions.receipt.compensation.label'), hint: t('purposeOptions.receipt.compensation.hint') },
    { value: 'OTHER', label: t('purposeOptions.other.label'), hint: t('purposeOptions.other.hint') },
  ];
}

/** Options for payment (صرف) screen — re-evaluated on each call so they follow the current branch language. */
export function getPaymentPurposeOptions(): Array<{ value: VoucherPurpose; label: string; hint: string }> {
  const t = (key: string) => i18n.t(key, { ns: 'terminology' });
  return [
    { value: 'INVOICE_PAYMENT', label: t('purposeOptions.payment.invoicePayment.label'), hint: t('purposeOptions.payment.invoicePayment.hint') },
    { value: 'ADVANCE', label: t('purposeOptions.payment.advance.label'), hint: t('purposeOptions.payment.advance.hint') },
    { value: 'ADVANCE_REFUND', label: t('purposeOptions.payment.advanceRefund.label'), hint: t('purposeOptions.payment.advanceRefund.hint') },
    { value: 'COMPENSATION', label: t('purposeOptions.payment.compensation.label'), hint: t('purposeOptions.payment.compensation.hint') },
    { value: 'OTHER', label: t('purposeOptions.other.label'), hint: t('purposeOptions.other.hint') },
  ];
}
