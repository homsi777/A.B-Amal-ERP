type CatLike = { id?: string; code: string; name: string };

function norm(value: string): string {
  return value.trim().toLowerCase();
}

/** يزيل بادئة L1_/L2_/L3_/L4_ المستخدمة داخلياً عند الاستيراد. */
export function stripImportLevelPrefix(value: string): string {
  const trimmed = value.trim();
  const match = /^L[1-4]_/i.exec(trimmed);
  return match ? trimmed.slice(match[0].length).trim() : trimmed;
}

function isImportLevelCode(code: string, level: 1 | 2 | 3 | 4): boolean {
  return new RegExp(`^L${level}_`, 'i').test(code.trim());
}

function isBlankColorCode(value: string): boolean {
  const trimmed = value.trim();
  return !trimmed || trimmed === '0';
}

/** كود الخامة كما يظهر في المخزون (clo1) — وليس L2_clo1. */
export function materialCodeFromCategory(cat: CatLike): string {
  const name = cat.name.trim();
  const code = cat.code.trim();
  if (isImportLevelCode(code, 2)) return name || stripImportLevelPrefix(code);
  if (isImportLevelCode(code, 3) || isImportLevelCode(code, 4)) return name;
  return code || name;
}

/** اسم الخامة للعرض. */
export function materialNameFromCategory(cat: CatLike): string {
  const name = cat.name.trim();
  const code = cat.code.trim();
  if (isImportLevelCode(code, 1)) return name || stripImportLevelPrefix(code);
  return name || stripImportLevelPrefix(code);
}

/** اسم اللون (اخضر) — وليس L3_اخضر. */
export function colorNameFromCategory(cat: CatLike): string {
  const name = cat.name.trim();
  const code = cat.code.trim();
  if (/^L3_/i.test(name)) return stripImportLevelPrefix(name);
  if (/^L3_/i.test(code)) return name || stripImportLevelPrefix(code);
  return name || stripImportLevelPrefix(code);
}

/** كود اللون — فارغ عندما لا يوجد (يعرض 0 في الواجهة). */
export function colorCodeFromCategories(c3: CatLike & { id: string }, c4: CatLike & { id: string }): string {
  if (c3.id === c4.id) return '';

  const c4code = c4.code.trim();
  const c4name = c4.name.trim();

  if (isImportLevelCode(c4code, 3) || isImportLevelCode(c4name, 3)) return '';

  let resolved = '';
  if (isImportLevelCode(c4code, 4)) {
    resolved = c4name || stripImportLevelPrefix(c4code);
  } else {
    resolved = c4code || c4name;
  }

  if (isBlankColorCode(resolved)) return '';
  if (norm(resolved) === norm(colorNameFromCategory(c3))) return '';
  if (isImportLevelCode(resolved, 3) || isImportLevelCode(resolved, 4)) return '';

  return resolved;
}

/** قيم محتملة لمطابقة fabric_items.internal_code القديمة. */
export function materialCodeLookupValues(cat: CatLike): string[] {
  const values = new Set<string>();
  const primary = materialCodeFromCategory(cat);
  const rawCode = cat.code.trim();
  const rawName = cat.name.trim();
  if (primary) values.add(primary);
  if (rawCode) values.add(rawCode);
  if (rawName) values.add(rawName);
  const stripped = stripImportLevelPrefix(rawCode);
  if (stripped) values.add(stripped);
  return [...values];
}

/** كود اللون من عقدة مستوى 4 فقط. */
export function colorCodeFromCategoryOnly(cat: CatLike): string {
  const code = cat.code.trim();
  const name = cat.name.trim();
  if (isImportLevelCode(code, 3)) return '';
  if (isImportLevelCode(code, 4)) {
    const value = name || stripImportLevelPrefix(code);
    return isBlankColorCode(value) ? '' : value;
  }
  const resolved = code || name;
  if (isBlankColorCode(resolved)) return '';
  return resolved;
}

export type { CatLike };
