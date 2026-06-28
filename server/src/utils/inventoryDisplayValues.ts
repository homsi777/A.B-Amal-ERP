import { stripImportLevelPrefix } from './categoryBusinessValues.js';

const AUTO_INTERNAL_CODE_PREFIX = 'IMP-AUTO-';

/** كود الخامة للعرض — بدون L1_/L2_/… */
export function sanitizeMaterialCodeForDisplay(
  internalCode: string | null | undefined,
  supplierCode: string | null | undefined,
): string {
  let internal = stripImportLevelPrefix(String(internalCode ?? ''));
  if (internal && !internal.startsWith(AUTO_INTERNAL_CODE_PREFIX)) return internal;
  return stripImportLevelPrefix(String(supplierCode ?? ''));
}

/** كود اللون للعرض — L3_* يعني «لا يوجد كود» (0 في الواجهة). */
export function sanitizeColorCodeForDisplay(code: string | null | undefined): string {
  const raw = String(code ?? '').trim();
  if (!raw || raw === '0') return '';
  if (/^L3_/i.test(raw)) return '';
  const stripped = stripImportLevelPrefix(raw);
  if (!stripped || stripped === '0') return '';
  return stripped;
}

export function sanitizeRollDtoRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  if ('internal_code' in out || 'supplier_code_item' in out) {
    out.internal_code = sanitizeMaterialCodeForDisplay(
      out.internal_code as string | null | undefined,
      out.supplier_code_item as string | null | undefined,
    );
  }
  if ('color_code' in out) {
    out.color_code = sanitizeColorCodeForDisplay(out.color_code as string | null | undefined);
  }
  return out;
}

export function sanitizeRollDtoRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => sanitizeRollDtoRow(row));
}
