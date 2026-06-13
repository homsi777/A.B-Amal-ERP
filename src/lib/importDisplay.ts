const AUTO_INTERNAL_CODE_PREFIX = 'IMP-AUTO-';

/** يُعرض في المخزون بدل الحقول الفارغة (اللون، كود اللون، …). */
export const EMPTY_INVENTORY_FIELD = '0';

const EMPTY_INVENTORY_SENTINELS = new Set(['', 'بدون لون']);

export function displayOptionalInventoryField(value?: string | null): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || EMPTY_INVENTORY_SENTINELS.has(trimmed)) return EMPTY_INVENTORY_FIELD;
  return trimmed;
}

/** كود الخامة كما في Excel: فارغ إن لم يُذكر في الملف. */
export function displayImportedItemCode(roll: {
  internal_code?: string | null;
  supplier_code_item?: string | null;
}): string {
  const supplier = String(roll.supplier_code_item ?? '').trim();
  if (supplier) return supplier;
  const internal = String(roll.internal_code ?? '').trim();
  if (!internal || internal.startsWith(AUTO_INTERNAL_CODE_PREFIX)) return '';
  return internal;
}

/** اللون — لا نعرض قيمة مكان الأخرى. */
export function displayImportedColorName(name?: string | null): string {
  return displayOptionalInventoryField(name);
}

const PLACEHOLDER_COLOR_CODES = new Set(['#000000', '#000', '000000']);

export function displayImportedColorCode(code?: string | null): string {
  const trimmed = String(code ?? '').trim();
  if (!trimmed || PLACEHOLDER_COLOR_CODES.has(trimmed.toLowerCase())) {
    return EMPTY_INVENTORY_FIELD;
  }
  return trimmed;
}
