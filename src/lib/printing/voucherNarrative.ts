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

function paymentMethodAr(method?: string | null): string {
  const m = String(method ?? 'CASH').trim().toUpperCase();
  if (m === 'CASH') return 'نقداً';
  if (m === 'BANK') return 'عبر تحويل بنكي';
  if (m === 'TRANSFER') return 'عبر حوالة';
  return '';
}

function formatAmountLabel(amount: number, currencyCode: string): string {
  const code = currencyCode.trim().toUpperCase() || 'USD';
  const value = Number.isFinite(amount) ? amount : 0;
  const formatted = value % 1 === 0 ? String(Math.round(value)) : value.toFixed(2);
  return `${formatted} ${code}`;
}

function partyWithHonorific(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '—';
  if (/^(السيد|السيدة|الأستاذ|الأستاذة)\s/.test(trimmed)) return trimmed;
  return `السيد ${trimmed}`;
}

/** البيان المختصر في بطاقة بيانات العميل/المستفيد */
export function buildVoucherMetaStatement(input: VoucherNarrativeInput): string {
  const desc = String(input.description ?? '').trim();
  if (desc) return desc;

  const purpose = String(input.purpose ?? '').trim().toUpperCase();
  const purposeAr =
    purpose === 'ADVANCE'
      ? 'عربون'
      : purpose === 'ADVANCE_REFUND'
        ? 'رد عربون'
        : purpose === 'COMPENSATION'
          ? 'تعويض / عطل وضرر'
          : purpose === 'OTHER'
            ? 'أخرى'
            : purpose === 'INVOICE_PAYMENT'
              ? 'دفعة / تسوية فاتورة'
              : '';

  const ref = String(input.referenceDocumentNo ?? '').trim();
  if (input.voucherType === 'RECEIPT' && ref) {
    return purposeAr ? `${purposeAr} مقابل كشف فاتورة ${ref}` : `قبض مقابل كشف فاتورة ${ref}`;
  }
  if (input.voucherType === 'RECEIPT') {
    const party = input.partyName.trim();
    if (purposeAr && party) return `${purposeAr} — قبض من ${party}`;
    return party ? `قبض من ${party}` : purposeAr || 'قبض نقدي';
  }
  const party = input.partyName.trim();
  if (purposeAr && party) return `${purposeAr} — صرف إلى ${party}`;
  return party ? `صرف إلى ${party}` : purposeAr || 'صرف نقدي';
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
  const payMethod = paymentMethodAr(input.paymentMethod);
  const paySuffix = payMethod ? ` ${payMethod}` : '';
  const party = partyWithHonorific(input.partyName);
  const cashbox = String(input.cashboxName ?? '').trim() || 'الصندوق';
  const ref = String(input.referenceDocumentNo ?? '').trim();
  const desc = String(input.description ?? '').trim();

  if (input.voucherType === 'RECEIPT') {
    if (ref) {
      return `تم استلام مبلغ ${amountLabel}${paySuffix} مقابل كشف الفاتورة رقم ${ref}.`;
    }
    if (desc) {
      return `تم استلام مبلغ ${amountLabel}${paySuffix} من ${party} — ${desc}.`;
    }
    return `تم استلام مبلغ ${amountLabel}${paySuffix} من ${party}.`;
  }

  if (desc && !ref) {
    return `تم صرف مبلغ ${amountLabel} إلى ${party} من ${cashbox} — ${desc}.`;
  }
  if (ref) {
    return `تم صرف مبلغ ${amountLabel} إلى ${party} من ${cashbox} مقابل ${ref}.`;
  }
  return `تم صرف مبلغ ${amountLabel} إلى ${party} من ${cashbox}.`;
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
