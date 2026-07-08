export const VOUCHER_PURPOSES = [
  'INVOICE_PAYMENT',
  'ADVANCE',
  'ADVANCE_REFUND',
  'COMPENSATION',
  'OTHER',
] as const;

export type VoucherPurpose = (typeof VOUCHER_PURPOSES)[number];

export function voucherPurposeAr(purpose: string | null | undefined): string {
  switch (String(purpose ?? '').toUpperCase()) {
    case 'ADVANCE':
      return 'عربون';
    case 'ADVANCE_REFUND':
      return 'رد عربون';
    case 'COMPENSATION':
      return 'تعويض / عطل وضرر';
    case 'OTHER':
      return 'أخرى';
    case 'INVOICE_PAYMENT':
    default:
      return 'دفعة / تسوية فاتورة';
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
