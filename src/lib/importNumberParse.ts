/** Parse import preview numbers (supports Turkish comma decimals: 107,7). */
export function parseImportNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value)
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/\s/g, '');
  if (!s) return null;
  if (/,\d{1,4}$/.test(s) && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function formatImportNumber(value: unknown, decimals = 2): string {
  const n = parseImportNumber(value);
  if (n == null) return '—';
  return n.toFixed(decimals);
}
