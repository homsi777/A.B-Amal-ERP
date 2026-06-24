const AUTO_INTERNAL_CODE_PREFIX = 'IMP-AUTO-';

/** كود الخامة للعرض — يتجنّب الرموز التلقائية IMP-AUTO-* ويُفضّل كود المورد. */
export function displayMaterialCode(input: {
  internalCode?: string | null;
  supplierCode?: string | null;
}): string {
  const internal = String(input.internalCode ?? '').trim();
  if (internal && !internal.startsWith(AUTO_INTERNAL_CODE_PREFIX)) return internal;
  return String(input.supplierCode ?? '').trim();
}
