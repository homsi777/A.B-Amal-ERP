import { buildAutoInternalCode } from './importItemCodes.js';

export type StockImportLayout =
  | 'aleppo_incoming_minimal'
  | 'aleppo_movement'
  | 'aleppo_balance'
  | 'supplier_invoice'
  | 'unknown';

/** True when Excel code looks like a specific design/SKU (nw-48142, kl-33, v-12), not a weave label (Jakar, Düz). */
export function looksLikeUniqueDesignSku(code: string): boolean {
  const s = code.trim();
  if (!s) return false;
  if (/\d/.test(s)) return true;
  return /^(nw|kl|clo|v|t)[-\s]?[\da-z]+$/i.test(s);
}

export interface ResolvedStockItemCodes {
  /** Safe DB lookup by internal/supplier code — empty for shared weave-type labels. */
  matchByCode: string;
  internalCode: string;
  supplierCode: string | null;
  designLabel: string | null;
}

/**
 * «رمز الصنف» in Aleppo workbooks is either:
 * - a real material code (5114, nw-48142) → inventory identity is THIS code
 *   (same name «asya» may appear with 5114, 5011, 5111 — each is a separate item)
 * - a shared weave label (Jakar, Düz) → identity is «اسم الصنف», not this column
 */
export function resolveStockImportItemCodes(
  materialName: string,
  rawItemCode: string,
  _importLayout: StockImportLayout | string = 'unknown',
): ResolvedStockItemCodes {
  const name = materialName.trim();
  const code = rawItemCode.trim();

  if (!code) {
    return {
      matchByCode: '',
      internalCode: buildAutoInternalCode(name),
      supplierCode: null,
      designLabel: null,
    };
  }

  if (looksLikeUniqueDesignSku(code)) {
    return {
      matchByCode: code,
      internalCode: code,
      supplierCode: code,
      designLabel: code,
    };
  }

  return {
    matchByCode: '',
    internalCode: buildAutoInternalCode(name),
    supplierCode: null,
    designLabel: code,
  };
}

export function fabricItemMatchesMaterialCode(
  item: { internal_code: string; supplier_code: string | null },
  materialCode: string,
): boolean {
  const target = materialCode.trim().toLowerCase();
  if (!target) return true;
  const internal = String(item.internal_code ?? '').trim().toLowerCase();
  const supplier = String(item.supplier_code ?? '').trim().toLowerCase();
  return internal === target || supplier === target;
}
