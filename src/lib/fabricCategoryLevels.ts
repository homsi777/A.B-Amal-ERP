import type { ApiCategory } from './api/fabricCategoriesApi';

export function normalizeCategoryText(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export function stripImportLevelPrefix(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  const match = /^L[1-4]_/i.exec(trimmed);
  return match ? trimmed.slice(match[0].length).trim() : trimmed;
}

export function isBlankColorCodeValue(value: string | null | undefined): boolean {
  const trimmed = String(value ?? '').trim();
  return !trimmed || trimmed === '0';
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

export function isImportInternalSlug(value: string | null | undefined): boolean {
  return /^L[1-4]_/i.test(String(value ?? '').trim());
}

export function categoryDisplayLabel(cat: ApiCategory, level: 1 | 2 | 3 | 4): string {
  const name = stripImportLevelPrefix(cat.name);
  const code = stripImportLevelPrefix(cat.code);
  if (level === 1) return name || code || cat.name.trim() || cat.code.trim();
  if (level === 2) {
    const rawCode = cat.code.trim();
    if (rawCode && !isImportInternalSlug(rawCode)) return code || name;
    return name || code || rawCode;
  }
  if (level === 3) return name || code || cat.name.trim() || cat.code.trim();
  if (level === 4) {
    const rawCode = cat.code.trim();
    if (rawCode && !isImportInternalSlug(rawCode)) return code || name;
    return name || code || rawCode;
  }
  return name || code || cat.name.trim() || cat.code.trim();
}

/** العنوان في واجهة تصنيفات الأقمشة — بدون L1_/L2_/L3_/L4_. */
export function categoryUiTitle(cat: ApiCategory, level: 1 | 2 | 3 | 4): string {
  return categoryDisplayLabel(cat, level);
}

/** سطر ثانٍ — فقط عند وجود كود حقيقي يختلف عن الاسم (لا رموز استيراد). */
export function categoryUiSubtitle(cat: ApiCategory, level: 1 | 2 | 3 | 4): string | null {
  const rawCode = cat.code.trim();
  if (!rawCode || isImportInternalSlug(rawCode)) return null;
  const title = categoryUiTitle(cat, level);
  if (normalizeCategoryText(rawCode) === normalizeCategoryText(title)) return null;
  if (normalizeCategoryText(stripImportLevelPrefix(rawCode)) === normalizeCategoryText(title)) return null;
  return rawCode;
}

export function categoryMatchesValue(cat: ApiCategory, value: string | null | undefined): boolean {
  const q = normalizeCategoryText(value);
  if (!q) return false;
  const code = normalizeCategoryText(cat.code);
  const name = normalizeCategoryText(cat.name);
  const strippedCode = normalizeCategoryText(stripImportLevelPrefix(cat.code));
  const strippedName = normalizeCategoryText(stripImportLevelPrefix(cat.name));
  if (code === q || name === q || strippedCode === q || strippedName === q) return true;
  if (code.startsWith('l2_') && (code.slice(3) === q || name === q || strippedCode === q)) return true;
  if (code.startsWith('l3_') && (code.slice(3) === q || name === q || name === `l3_${q}`)) return true;
  if (code.startsWith('l4_') && (code.slice(3) === q || name === q)) return true;
  if (name.startsWith('l3_') && name.slice(3) === q) return true;
  return false;
}

export function colorCodeMatchesCategory(cat: ApiCategory, value: string | null | undefined): boolean {
  if (isBlankColorCodeValue(value)) return false;
  const normalized = normalizeCategoryText(value);
  if (/^l3_/i.test(normalized)) return false;
  return categoryMatchesValue(cat, value);
}

export function activeCategories(rows: ApiCategory[]): ApiCategory[] {
  return rows.filter((c) => c.is_active !== false);
}
