export const VOUCHER_PURPOSES = [
  'INVOICE_PAYMENT',
  'ADVANCE',
  'ADVANCE_REFUND',
  'COMPENSATION',
  'OTHER',
] as const;

export type VoucherPurpose = (typeof VOUCHER_PURPOSES)[number];

export function isVoucherPurpose(value: unknown): value is VoucherPurpose {
  return typeof value === 'string' && (VOUCHER_PURPOSES as readonly string[]).includes(value);
}

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

/** Label for party statement type column */
export function voucherStatementTypeLabel(
  voucherType: 'RECEIPT' | 'PAYMENT',
  partyType: 'CUSTOMER' | 'SUPPLIER' | string,
  purpose: string | null | undefined,
): string {
  const purposeLabel = voucherPurposeAr(purpose);
  if (voucherType === 'RECEIPT') {
    if (partyType === 'SUPPLIER') return `سند قبض من المورد — ${purposeLabel}`;
    return `سند قبض — ${purposeLabel}`;
  }
  if (partyType === 'CUSTOMER') return `سند دفع للعميل — ${purposeLabel}`;
  return `سند دفع — ${purposeLabel}`;
}

/** Prefixed description so purpose appears even when user left description empty */
export function mergeVoucherDescription(
  purpose: VoucherPurpose | string | null | undefined,
  description: string | null | undefined,
): string | null {
  const purposeLabel = voucherPurposeAr(purpose);
  const desc = String(description ?? '').trim();
  if (!desc) return purposeLabel;
  if (desc.includes(purposeLabel)) return desc;
  return `${purposeLabel} — ${desc}`;
}
