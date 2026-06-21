/** تنظيف إدخال السعر — يقبل 2.3 و 2,3 و 2.3$ */
export function normalizePriceInput(raw: string): string {
  let v = raw
    .replace(/\s/g, '')
    .replace(/[$€£]/g, '')
    .replace(/ر\.?\s*س/gi, '')
    .replace(/,/g, '.');
  v = v.replace(/[^\d.]/g, '');
  const dot = v.indexOf('.');
  if (dot >= 0) {
    v = `${v.slice(0, dot + 1)}${v.slice(dot + 1).replace(/\./g, '')}`;
  }
  return v;
}

export function isValidPriceInput(value: string): boolean {
  if (value === '') return true;
  return /^\d*\.?\d{0,4}$/.test(normalizePriceInput(value));
}
