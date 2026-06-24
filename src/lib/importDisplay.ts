const AUTO_INTERNAL_CODE_PREFIX = 'IMP-AUTO-';

/** يُعرض في المخزون بدل الحقول الفارغة (اللون، كود اللون، …). */
export const EMPTY_INVENTORY_FIELD = '0';

const EMPTY_INVENTORY_SENTINELS = new Set(['', 'بدون لون']);

export function displayOptionalInventoryField(value?: string | null): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || EMPTY_INVENTORY_SENTINELS.has(trimmed)) return EMPTY_INVENTORY_FIELD;
  return trimmed;
}

/** كود الخامة في المخزون — internal_code هو ما يختاره المستخدم (CLO3). */
export function displayInventoryMaterialCode(roll: {
  internal_code?: string | null;
  supplier_code_item?: string | null;
}): string {
  const internal = String(roll.internal_code ?? '').trim();
  if (internal && !internal.startsWith(AUTO_INTERNAL_CODE_PREFIX)) return internal;
  return String(roll.supplier_code_item ?? '').trim();
}

/** استخراج كود الخامة من QR المضغوط: barcode|materialName|materialCode|… */
export function parseCompactQrMaterialCode(payload?: string | null): string {
  const raw = String(payload ?? '').trim();
  if (!raw.includes('|')) return '';
  const parts = raw.split('|').map((part) => part.trim());
  return parts.length >= 3 ? parts[2] : '';
}

/** كود الخامة للعرض في كشف الفاتورة — يتجنّب IMP-AUTO-* ويُفضّل كود المورد. */
export function resolveDisplayMaterialCode(input: {
  internalCode?: string | null;
  supplierCode?: string | null;
  rawQrPayload?: string | null;
}): string {
  const internal = String(input.internalCode ?? '').trim();
  let supplier = String(input.supplierCode ?? '').trim();
  if (!supplier) {
    const fromQr = parseCompactQrMaterialCode(input.rawQrPayload);
    if (fromQr && fromQr !== internal && !fromQr.startsWith(AUTO_INTERNAL_CODE_PREFIX)) {
      supplier = fromQr;
    }
  }
  const shown = displayInventoryMaterialCode({
    internal_code: internal,
    supplier_code_item: supplier,
  });
  return shown || internal;
}

/** كود الخامة كما في Excel: يُفضَّل كود المورد عند الاستيراد. */
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
