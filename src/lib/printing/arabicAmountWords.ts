const ONES: Record<number, string> = {
  0: '',
  1: 'واحد',
  2: 'اثنان',
  3: 'ثلاثة',
  4: 'أربعة',
  5: 'خمسة',
  6: 'ستة',
  7: 'سبعة',
  8: 'ثمانية',
  9: 'تسعة',
  10: 'عشرة',
  11: 'أحد عشر',
  12: 'اثنا عشر',
  13: 'ثلاثة عشر',
  14: 'أربعة عشر',
  15: 'خمسة عشر',
  16: 'ستة عشر',
  17: 'سبعة عشر',
  18: 'ثمانية عشر',
  19: 'تسعة عشر',
};

const TENS: Record<number, string> = {
  2: 'عشرون',
  3: 'ثلاثون',
  4: 'أربعون',
  5: 'خمسون',
  6: 'ستون',
  7: 'سبعون',
  8: 'ثمانون',
  9: 'تسعون',
};

const HUNDREDS: Record<number, string> = {
  1: 'مئة',
  2: 'مئتان',
  3: 'ثلاثمائة',
  4: 'أربعمائة',
  5: 'خمسمائة',
  6: 'ستمائة',
  7: 'سبعمائة',
  8: 'ثمانمائة',
  9: 'تسعمائة',
};

function joinParts(parts: string[]): string {
  const filtered = parts.filter(Boolean);
  if (filtered.length === 0) return '';
  if (filtered.length === 1) return filtered[0];
  if (filtered.length === 2) return `${filtered[0]} و${filtered[1]}`;
  const last = filtered[filtered.length - 1];
  return `${filtered.slice(0, -1).join(' و')} و${last}`;
}

function integerToArabic(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return 'صفر';

  const parts: string[] = [];

  const millions = Math.floor(n / 1_000_000);
  if (millions > 0) {
    if (millions === 1) parts.push('مليون');
    else if (millions === 2) parts.push('مليونان');
    else if (millions <= 10) parts.push(`${integerToArabic(millions)} ملايين`);
    else parts.push(`${integerToArabic(millions)} مليون`);
  }

  let rest = n % 1_000_000;
  const thousands = Math.floor(rest / 1000);
  if (thousands > 0) {
    if (thousands === 1) parts.push('ألف');
    else if (thousands === 2) parts.push('ألفان');
    else if (thousands <= 10) parts.push(`${integerToArabic(thousands)} آلاف`);
    else parts.push(`${integerToArabic(thousands)} ألف`);
  }

  rest %= 1000;
  const hundreds = Math.floor(rest / 100);
  if (hundreds > 0) parts.push(HUNDREDS[hundreds]);

  rest %= 100;
  if (rest > 0) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const ones = rest % 10;
      const tens = Math.floor(rest / 10);
      if (ones > 0) parts.push(`${ONES[ones]} و${TENS[tens]}`);
      else parts.push(TENS[tens]);
    }
  }

  return joinParts(parts);
}

function currencyUnit(currencyCode: string, amount: number): string {
  const code = currencyCode.trim().toUpperCase() || 'USD';
  const whole = Math.floor(Math.abs(amount));
  const dual = whole === 2;
  const plural = whole > 2 && whole <= 10;
  if (code === 'USD') {
    if (dual) return 'دولاران أمريكيان';
    if (plural) return 'دولارات أمريكية';
    if (whole === 1) return 'دولار أمريكي';
    return 'دولار أمريكي';
  }
  if (code === 'SAR') {
    if (dual) return 'ريالان سعوديان';
    if (plural) return 'ريالات سعودية';
    if (whole === 1) return 'ريال سعودي';
    return 'ريال سعودي';
  }
  if (code === 'TRY') {
    if (dual) return 'ليرتان تركيتان';
    if (plural) return 'ليرات تركية';
    if (whole === 1) return 'ليرة تركية';
    return 'ليرة تركية';
  }
  return code;
}

/** تفقيط مبسّط للمبالغ — للعرض على سند القبض/الصرف */
export function amountToArabicWords(amount: number, currencyCode: string): string {
  const value = Math.abs(Number(amount));
  if (!Number.isFinite(value)) return '—';
  const whole = Math.floor(value);
  const fraction = Math.round((value - whole) * 100);
  const words = integerToArabic(whole) || 'صفر';
  const unit = currencyUnit(currencyCode, whole);
  if (fraction > 0) {
    return `${words} ${unit} و${integerToArabic(fraction)} فقط لا غير`;
  }
  return `${words} ${unit} فقط لا غير`;
}
