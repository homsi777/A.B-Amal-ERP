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
  if (code === 'SYP') {
    if (dual) return 'ليرتان سوريتان';
    if (plural) return 'ليرات سورية';
    if (whole === 1) return 'ليرة سورية';
    return 'ليرة سورية';
  }
  if (code === 'EGP') {
    if (dual) return 'جنيهان مصريان';
    if (plural) return 'جنيهات مصرية';
    if (whole === 1) return 'جنيه مصري';
    return 'جنيه مصري';
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

const TR_ONES: Record<number, string> = {
  1: 'bir', 2: 'iki', 3: 'üç', 4: 'dört', 5: 'beş',
  6: 'altı', 7: 'yedi', 8: 'sekiz', 9: 'dokuz',
};

const TR_TENS: Record<number, string> = {
  1: 'on', 2: 'yirmi', 3: 'otuz', 4: 'kırk', 5: 'elli',
  6: 'altmış', 7: 'yetmiş', 8: 'seksen', 9: 'doksan',
};

function threeDigitToTurkish(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const ones = n % 10;
  if (hundreds > 0) parts.push(hundreds === 1 ? 'yüz' : `${TR_ONES[hundreds]} yüz`);
  if (tens > 0) parts.push(TR_TENS[tens]);
  if (ones > 0) parts.push(TR_ONES[ones]);
  return parts.join(' ');
}

function integerToTurkish(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return 'sıfır';

  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  if (millions > 0) parts.push(`${threeDigitToTurkish(millions)} milyon`);

  let rest = n % 1_000_000;
  const thousands = Math.floor(rest / 1000);
  if (thousands > 0) parts.push(thousands === 1 ? 'bin' : `${threeDigitToTurkish(thousands)} bin`);

  rest %= 1000;
  if (rest > 0) parts.push(threeDigitToTurkish(rest));

  return parts.join(' ').trim();
}

function currencyUnitTurkish(currencyCode: string): string {
  const code = currencyCode.trim().toUpperCase() || 'USD';
  if (code === 'USD') return 'Amerikan Doları';
  if (code === 'SAR') return 'Suudi Riyali';
  if (code === 'TRY') return 'Türk Lirası';
  if (code === 'SYP') return 'Suriye Lirası';
  if (code === 'EGP') return 'Mısır Lirası';
  return code;
}

/** Simplified amount-in-words for Turkish — mirrors amountToArabicWords. */
export function amountToTurkishWords(amount: number, currencyCode: string): string {
  const value = Math.abs(Number(amount));
  if (!Number.isFinite(value)) return '—';
  const whole = Math.floor(value);
  const fraction = Math.round((value - whole) * 100);
  const words = integerToTurkish(whole) || 'sıfır';
  const unit = currencyUnitTurkish(currencyCode);
  if (fraction > 0) {
    return `${words} ${unit} ve ${integerToTurkish(fraction)} kuruş yalnız`;
  }
  return `${words} ${unit} yalnız`;
}
