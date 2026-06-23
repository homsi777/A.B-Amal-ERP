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
 * Aleppo «وارد» sheets put weave/design type in «رمز الصنف» (Jakar, Düz, …).
 * That column must NOT merge distinct fabric names into one inventory item.
 */
export function resolveStockImportItemCodes(
  materialName: string,
  rawItemCode: string,
  importLayout: StockImportLayout | string = 'unknown',
): ResolvedStockItemCodes {
  const name = materialName.trim();
  const code = rawItemCode.trim();
  const layoutMinimal = importLayout === 'aleppo_incoming_minimal';

  if (!code) {
    return {
      matchByCode: '',
      internalCode: buildAutoInternalCode(name),
      supplierCode: null,
      designLabel: null,
    };
  }

  const unique = looksLikeUniqueDesignSku(code);
  if (layoutMinimal || !unique) {
    return {
      matchByCode: '',
      internalCode: unique ? code : buildAutoInternalCode(name),
      supplierCode: code,
      designLabel: code,
    };
  }

  return {
    matchByCode: code,
    internalCode: code,
    supplierCode: code,
    designLabel: code,
  };
}
