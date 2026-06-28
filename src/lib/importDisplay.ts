const AUTO_INTERNAL_CODE_PREFIX = 'IMP-AUTO-';

/** يزيل بادئة L1_/L2_/L3_/L4_ الداخلية — لا تُعرض للمستخدم أبداً. */
export function stripImportLevelPrefix(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  const match = /^L[1-4]_/i.exec(trimmed);
  return match ? trimmed.slice(match[0].length).trim() : trimmed;
}

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
  let internal = stripImportLevelPrefix(roll.internal_code);
  if (internal && !internal.startsWith(AUTO_INTERNAL_CODE_PREFIX)) return internal;
  return stripImportLevelPrefix(roll.supplier_code_item);
}

/** كود الخامة على اللصاقة / DTO — نفس منطق المخزون (يتجنّب IMP-AUTO-*). */
export function displayLabelMaterialCode(input: {
  internalCode?: string | null;
  internal_code?: string | null;
  supplierCode?: string | null;
  supplier_code_item?: string | null;
}): string {
  return displayInventoryMaterialCode({
    internal_code: input.internalCode ?? input.internal_code,
    supplier_code_item: input.supplierCode ?? input.supplier_code_item,
  });
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
  return stripImportLevelPrefix(internal);
}

/** اللون — لا نعرض قيمة مكان الأخرى. */
export function displayImportedColorName(name?: string | null): string {
  return displayOptionalInventoryField(name);
}

const PLACEHOLDER_COLOR_CODES = new Set(['#000000', '#000', '000000']);

export function displayImportedColorCode(code?: string | null): string {
  const raw = String(code ?? '').trim();
  if (!raw || PLACEHOLDER_COLOR_CODES.has(raw.toLowerCase())) {
    return EMPTY_INVENTORY_FIELD;
  }
  if (/^L3_/i.test(raw)) return EMPTY_INVENTORY_FIELD;
  const trimmed = stripImportLevelPrefix(raw);
  if (!trimmed || trimmed === '0') return EMPTY_INVENTORY_FIELD;
  return trimmed;
}
