import { buildAutoInternalCode } from './importItemCodes.js';
import {
  looksLikeUniqueDesignSku,
  reconcileImportMaterialAndColorCodes,
} from './importMaterialCodeResolver.js';

export type StockImportLayout =
  | 'aleppo_incoming_minimal'
  | 'aleppo_movement'
  | 'aleppo_balance'
  | 'supplier_invoice'
  | 'unknown';

export { looksLikeUniqueDesignSku };

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
  const reconciled = reconcileImportMaterialAndColorCodes({
    supplierMaterialCode: rawItemCode.trim(),
  });
  const code = reconciled.materialCode;

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
