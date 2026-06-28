import type { ApiCategory } from './api/fabricCategoriesApi';

export function normalizeCategoryText(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

/** مستوى 2 — كود خامة فقط (استبعاد ألوان L3_* المُدرجة خطأً تحت اسم الخامة). */
export function isMaterialCodeLevelCategory(cat: ApiCategory): boolean {
  const code = cat.code.trim();
  const name = cat.name.trim();
  if (code.startsWith('L3_') || code.startsWith('L4_')) return false;
  if (name.startsWith('L3_') || name.startsWith('L4_')) return false;
  return true;
}

/** مستوى 3 — اسم اللون. */
export function isColorNameLevelCategory(cat: ApiCategory): boolean {
  const code = cat.code.trim();
  if (code.startsWith('L4_')) return false;
  if (code.startsWith('L2_')) return false;
  return true;
}

export function categoryDisplayLabel(cat: ApiCategory, level: 1 | 2 | 3 | 4): string {
  if (level === 2 || level === 4) {
    const code = cat.code.trim();
    if (code && !code.startsWith('L2_') && !code.startsWith('L3_') && !code.startsWith('L4_')) return code;
    if (code.startsWith('L2_')) return cat.name.trim() || code.slice(3);
    if (code.startsWith('L4_')) return cat.name.trim() || code.slice(3);
    return cat.name.trim() || code;
  }
  if (level === 3 && cat.name.trim().startsWith('L3_')) {
    return cat.name.trim().slice(3) || cat.name.trim();
  }
  return cat.name.trim() || cat.code.trim();
}

export function categoryMatchesValue(cat: ApiCategory, value: string | null | undefined): boolean {
  const q = normalizeCategoryText(value);
  if (!q) return false;
  const code = normalizeCategoryText(cat.code);
  const name = normalizeCategoryText(cat.name);
  if (code === q || name === q) return true;
  if (code.startsWith('l2_') && (code.slice(3) === q || name === q)) return true;
  if (code.startsWith('l3_') && (code.slice(3) === q || name === q || name === `l3_${q}`)) return true;
  if (code.startsWith('l4_') && (code.slice(3) === q || name === q)) return true;
  if (name.startsWith('l3_') && name.slice(3) === q) return true;
  return false;
}

export function activeCategories(rows: ApiCategory[]): ApiCategory[] {
  return rows.filter((c) => c.is_active !== false);
}
