import { cleanString, type NormalizedField } from './importColumnDetector.js';
import { stripImportLevelPrefix } from './categoryBusinessValues.js';

const AUTO_INTERNAL_PREFIX = 'IMP-AUTO-';

export type ImportRowFields = Partial<Record<NormalizedField, string | number | null>> & {
  itemName?: string | null;
  itemCode?: string | null;
};

/**
 * True when a value is likely a color reference (8, 12, kl-8) rather than a fabric/design SKU.
 */
export function looksLikeLikelyColorCode(code: string): boolean {
  const s = cleanString(code);
  if (!s) return false;
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return true;
  if (/^\d{1,2}$/.test(s)) return true;
  if (/[a-z]/i.test(s)) return false;
  if (/^\d{3}$/.test(s)) return true;
  return false;
}

/**
 * True when Excel code looks like a specific design/SKU (nw-48142, kl-33, 5114),
 * not a weave label (Jakar, Düz) or a short color reference (8).
 */
export function looksLikeUniqueDesignSku(code: string): boolean {
  const s = cleanString(code);
  if (!s) return false;
  if (looksLikeLikelyColorCode(s)) return false;
  if (/[a-z]/i.test(s) && /\d/.test(s)) return true;
  if (/[-_]/.test(s)) return true;
  if (/^\d{4,}$/.test(s)) return true;
  return /^(nw|kl|clo|v|t)[-\s]?[\da-z]+$/i.test(s);
}

export interface SanitizedImportMaterialFields {
  materialCode: string;
  colorCode: string;
  swappedColorFromMaterial: boolean;
}

/** Read material/color codes from purchase-normalized or stock-import row payloads. */
export function readImportRowMaterialAndColor(row: ImportRowFields): {
  materialName: string;
  internalMaterialCode: string;
  supplierMaterialCode: string;
  colorCode: string;
  colorName: string;
  colorNameTr: string;
} {
  const materialName =
    cleanString(row.materialName) || cleanString(row.itemName);
  const internalMaterialCode = cleanString(row.internalMaterialCode);
  const supplierMaterialCode =
    cleanString(row.supplierMaterialCode) || cleanString(row.itemCode);
  const colorCode = cleanString(row.colorCode);
  const colorName = cleanString(row.colorName);
  const colorNameTr = cleanString(row.colorNameTr);
  return {
    materialName,
    internalMaterialCode,
    supplierMaterialCode,
    colorCode,
    colorName,
    colorNameTr,
  };
}

/**
 * When Excel mapped color code into material code, move it back to colorCode
 * and clear the mistaken material code.
 */
export function reconcileImportMaterialAndColorCodes(input: {
  internalMaterialCode?: string;
  supplierMaterialCode?: string;
  colorCode?: string;
}): SanitizedImportMaterialFields {
  let materialCode = normalizedCodeForColorHeuristic(
    cleanString(input.internalMaterialCode) || cleanString(input.supplierMaterialCode),
  );
  let colorCode = cleanString(input.colorCode);
  let swappedColorFromMaterial = false;

  if (materialCode && looksLikeLikelyColorCode(materialCode) && !looksLikeUniqueDesignSku(materialCode)) {
    if (!colorCode || colorCode === materialCode) {
      colorCode = materialCode;
      swappedColorFromMaterial = true;
    }
    materialCode = '';
  }

  if (materialCode && colorCode && materialCode === colorCode && looksLikeLikelyColorCode(materialCode)) {
    materialCode = '';
    swappedColorFromMaterial = true;
  }

  return { materialCode, colorCode, swappedColorFromMaterial };
}

/** Apply reconciliation onto a normalized purchase-import row (mutates in place). */
export function sanitizeNormalizedImportRow(
  nd: ImportRowFields,
): { swappedColorFromMaterial: boolean } {
  const internal = cleanString(nd.internalMaterialCode);
  const supplier = cleanString(nd.supplierMaterialCode);
  const reconciled = reconcileImportMaterialAndColorCodes({
    internalMaterialCode: internal,
    supplierMaterialCode: supplier,
    colorCode: cleanString(nd.colorCode),
  });

  if (reconciled.swappedColorFromMaterial) {
    if (internal && !supplier) {
      nd.internalMaterialCode = null;
    } else if (supplier) {
      nd.supplierMaterialCode = null;
    } else {
      nd.supplierMaterialCode = null;
      nd.internalMaterialCode = null;
    }
    if (reconciled.colorCode) {
      nd.colorCode = reconciled.colorCode;
    }
  }

  return { swappedColorFromMaterial: reconciled.swappedColorFromMaterial };
}

/** Apply reconciliation onto stock-import row shape (mutates in place). */
export function sanitizeStockImportRow(row: {
  itemCode?: string;
  colorCode?: string;
}): { swappedColorFromMaterial: boolean } {
  const reconciled = reconcileImportMaterialAndColorCodes({
    supplierMaterialCode: cleanString(row.itemCode),
    colorCode: cleanString(row.colorCode),
  });
  if (reconciled.swappedColorFromMaterial) {
    row.itemCode = '';
    if (reconciled.colorCode) row.colorCode = reconciled.colorCode;
  }
  return { swappedColorFromMaterial: reconciled.swappedColorFromMaterial };
}

/** Same rule as inventory UI: what the user sees in «كود خامة». */
export function resolveDisplayedMaterialCode(
  internalCode: string | null | undefined,
  supplierCode: string | null | undefined,
): string {
  const internal = stripImportLevelPrefix(cleanString(internalCode));
  if (internal && !internal.startsWith(AUTO_INTERNAL_PREFIX)) return internal;
  return stripImportLevelPrefix(cleanString(supplierCode));
}

function normalizedCodeForColorHeuristic(code: string): string {
  return stripImportLevelPrefix(cleanString(code));
}

/** True when a stored fabric item internal_code was likely imported as a color code by mistake. */
export function internalCodeLooksLikeImportedColorMistake(
  internalCode: string,
  itemName: string,
): boolean {
  const code = normalizedCodeForColorHeuristic(internalCode);
  const name = cleanString(itemName);
  if (!code || !name) return false;
  if (code.trim().toLowerCase() === name.trim().toLowerCase()) return false;
  return looksLikeLikelyColorCode(code) && !looksLikeUniqueDesignSku(code);
}

export function materialCodeFieldsLookLikeColorMistake(input: {
  internalCode?: string | null;
  supplierCode?: string | null;
  itemName: string;
}): { needsFix: boolean; displayedCode: string; colorCodeCandidate: string; displayedBad: boolean } {
  const name = cleanString(input.itemName);
  const internal = normalizedCodeForColorHeuristic(String(input.internalCode ?? ''));
  const supplier = normalizedCodeForColorHeuristic(String(input.supplierCode ?? ''));
  const rawInternal = cleanString(input.internalCode);
  const rawSupplier = cleanString(input.supplierCode);
  const displayed = resolveDisplayedMaterialCode(rawInternal, rawSupplier);

  const internalBad = internalCodeLooksLikeImportedColorMistake(rawInternal, name)
    || internalCodeLooksLikeImportedColorMistake(internal, name);
  const supplierBad =
    !!supplier
    && looksLikeLikelyColorCode(supplier)
    && !looksLikeUniqueDesignSku(supplier);
  const displayedBad =
    !!displayed
    && looksLikeLikelyColorCode(displayed)
    && !looksLikeUniqueDesignSku(displayed)
    && displayed.toLowerCase() !== name.toLowerCase();

  const needsFix = internalBad || supplierBad || displayedBad;
  const colorCodeCandidate = supplierBad
    ? supplier || rawSupplier
    : internalBad
      ? internal || rawInternal
      : displayedBad
        ? displayed
        : '';

  return { needsFix, displayedCode: displayed, colorCodeCandidate, displayedBad };
}
