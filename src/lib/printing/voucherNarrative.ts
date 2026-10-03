import i18n from '../../i18n/config';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ns: 'terminology', ...options });

export type VoucherNarrativeInput = {
  voucherType: 'RECEIPT' | 'PAYMENT';
  partyName: string;
  amount: number;
  currencyCode: string;
  paymentMethod?: string | null;
  cashboxName?: string | null;
  referenceDocumentNo?: string | null;
  purpose?: string | null;
  description?: string | null;
};

function paymentMethodLabel(method?: string | null): string {
  const m = String(method ?? 'CASH').trim().toUpperCase();
  if (m === 'CASH') return t('voucherNarrative.cashOnly');
  if (m === 'BANK') return t('voucherNarrative.viaBankTransfer');
  if (m === 'TRANSFER') return t('voucherNarrative.viaTransfer');
  return '';
}

function formatAmountLabel(amount: number, currencyCode: string): string {
  const code = currencyCode.trim().toUpperCase() || 'USD';
  const value = Number.isFinite(amount) ? amount : 0;
  const formatted = value % 1 === 0 ? String(Math.round(value)) : value.toFixed(2);
  return `${formatted} ${code}`;
}

const HONORIFIC_PREFIX_RE: Record<string, RegExp> = {
  ar: /^(السيد|السيدة|الأستاذ|الأستاذة)\s/,
  tr: /^(Sayın|Bay|Bayan)\s/,
};

function partyWithHonorific(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '—';
  const lang = i18n.language === 'ar' ? 'ar' : 'tr';
  if (HONORIFIC_PREFIX_RE[lang].test(trimmed)) return trimmed;
  return t('voucherNarrative.honorificPrefix', { name: trimmed });
}

function purposeLabel(purpose?: string | null): string {
  const p = String(purpose ?? '').trim().toUpperCase();
  if (p === 'ADVANCE') return t('voucherNarrative.purposeAdvance');
  if (p === 'ADVANCE_REFUND') return t('voucherNarrative.purposeAdvanceRefund');
  if (p === 'COMPENSATION') return t('voucherNarrative.purposeCompensation');
  if (p === 'OTHER') return t('voucherNarrative.purposeOther');
  if (p === 'INVOICE_PAYMENT') return t('voucherNarrative.purposeInvoicePayment');
  return '';
}

/** البيان المختصر في بطاقة بيانات العميل/المستفيد */
export function buildVoucherMetaStatement(input: VoucherNarrativeInput): string {
  const desc = String(input.description ?? '').trim();
  if (desc) return desc;

  const purposeText = purposeLabel(input.purpose);
  const ref = String(input.referenceDocumentNo ?? '').trim();

  if (input.voucherType === 'RECEIPT' && ref) {
    return purposeText
      ? t('voucherNarrative.metaReceiptWithRefAndPurpose', { purpose: purposeText, ref })
      : t('voucherNarrative.metaReceiptWithRefNoPurpose', { ref });
  }
  if (input.voucherType === 'RECEIPT') {
    const party = input.partyName.trim();
    if (purposeText && party) return t('voucherNarrative.metaReceiptNoRefWithPurposeAndParty', { purpose: purposeText, party });
    if (party) return t('voucherNarrative.metaReceiptNoRefWithParty', { party });
    return purposeText || t('voucherNarrative.metaReceiptCashOnly');
  }
  const party = input.partyName.trim();
  if (purposeText && party) return t('voucherNarrative.metaPaymentWithPurposeAndParty', { purpose: purposeText, party });
  if (party) return t('voucherNarrative.metaPaymentWithParty', { party });
  return purposeText || t('voucherNarrative.metaPaymentCashOnly');
}

/**
 * الفقرة الكاملة أسفل السند — النص الذي يريد الاستاذ بشير مراجعته قبل التنفيذ.
 *
 * أمثلة:
 * - قبض: تم استلام مبلغ 110 USD نقداً مقابل كشف الفاتورة رقم FB000006.
 * - صرف: تم صرف مبلغ 350 USD إلى السيد نبيل حمصي من الصندوق الرئيسي.
 */
export function buildVoucherNarrativeParagraph(input: VoucherNarrativeInput): string {
  const amountLabel = formatAmountLabel(input.amount, input.currencyCode);
  const payMethod = paymentMethodLabel(input.paymentMethod);
  const paySuffix = payMethod ? ` ${payMethod}` : '';
  const party = partyWithHonorific(input.partyName);
  const cashbox = String(input.cashboxName ?? '').trim() || t('voucherNarrative.defaultCashbox');
  const ref = String(input.referenceDocumentNo ?? '').trim();
  const desc = String(input.description ?? '').trim();

  if (input.voucherType === 'RECEIPT') {
    if (ref) {
      return t('voucherNarrative.paragraphReceiptWithRef', { amount: amountLabel, method: paySuffix, ref });
    }
    if (desc) {
      return t('voucherNarrative.paragraphReceiptWithDesc', { amount: amountLabel, method: paySuffix, party, desc });
    }
    return t('voucherNarrative.paragraphReceiptPlain', { amount: amountLabel, method: paySuffix, party });
  }

  if (desc && !ref) {
    return t('voucherNarrative.paragraphPaymentWithDescNoRef', { amount: amountLabel, party, cashbox, desc });
  }
  if (ref) {
    return t('voucherNarrative.paragraphPaymentWithRef', { amount: amountLabel, party, cashbox, ref });
  }
  return t('voucherNarrative.paragraphPaymentPlain', { amount: amountLabel, party, cashbox });
}

/** أجزاء الفقرة للتمييز البصري (المبلغ والمرجع بخط عريض في القالب) */
export function buildVoucherNarrativeParts(input: VoucherNarrativeInput): {
  beforeAmount: string;
  amount: string;
  middle: string;
  highlight?: string;
  after: string;
} {
  const amountLabel = formatAmountLabel(input.amount, input.currencyCode);
  const paragraph = buildVoucherNarrativeParagraph(input);
  const idx = paragraph.indexOf(amountLabel);
  if (idx < 0) {
    return { beforeAmount: paragraph, amount: amountLabel, middle: '', after: '' };
  }
  const beforeAmount = paragraph.slice(0, idx);
  const afterAmount = paragraph.slice(idx + amountLabel.length);
  const ref = String(input.referenceDocumentNo ?? '').trim();
  if (ref && afterAmount.includes(ref)) {
    const refIdx = afterAmount.indexOf(ref);
    return {
      beforeAmount,
      amount: amountLabel,
      middle: afterAmount.slice(0, refIdx),
      highlight: ref,
      after: afterAmount.slice(refIdx + ref.length),
    };
  }
  return { beforeAmount, amount: amountLabel, middle: '', after: afterAmount };
}
