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

/** Options for receipt (قبض) screen */
export const RECEIPT_PURPOSE_OPTIONS: Array<{ value: VoucherPurpose; label: string; hint: string }> = [
  { value: 'INVOICE_PAYMENT', label: 'دفعة / تسوية فاتورة', hint: 'يقلّل مديونية الطرف أو يزيد رصيده الدائن' },
  { value: 'ADVANCE', label: 'عربون / دفعة مقدمة', hint: 'يظهر كرصيد دائن للعميل (أو يقلّل ذمة المورد) ويمكن رده لاحقاً' },
  { value: 'COMPENSATION', label: 'تعويض وارد / عطل وضرر', hint: 'قبض تعويض من العميل أو المورد' },
  { value: 'OTHER', label: 'أخرى', hint: 'غرض حر يُوضَّح في البيان' },
];

/** Options for payment (صرف) screen */
export const PAYMENT_PURPOSE_OPTIONS: Array<{ value: VoucherPurpose; label: string; hint: string }> = [
  { value: 'INVOICE_PAYMENT', label: 'دفعة / تسوية فاتورة', hint: 'صرف للمورد أو للعميل لتسوية ذمة' },
  { value: 'ADVANCE', label: 'عربون / دفعة مقدمة', hint: 'دفعة مقدمة لمورد (أو سلفة لعميل ضمن الذمم)' },
  { value: 'ADVANCE_REFUND', label: 'رد عربون', hint: 'يقلّل الرصيد الدائن للطرف (مثل رد عربون عميل)' },
  { value: 'COMPENSATION', label: 'تعويض صادر / عطل وضرر', hint: 'صرف تعويض للعميل أو للمورد' },
  { value: 'OTHER', label: 'أخرى', hint: 'غرض حر يُوضَّح في البيان' },
];
