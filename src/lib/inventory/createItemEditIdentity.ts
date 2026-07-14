/**
 * Safe identity resolution for CreateItem edit mode.
 * Prefer fabricItemId when available; otherwise match ORIGINAL name+code exactly once.
 */

export type EditableFabricItemIdentity = {
  /** API fabric_items.id when known */
  fabricItemId?: string | null;
  /** Original (pre-edit) material name */
  originalName: string;
  /** Original (pre-edit) material / design code */
  originalCode: string;
};

export type FabricItemCandidate = {
  id: string;
  name: string;
  internal_code: string;
  supplier_code?: string | null;
};

export type ResolveEditFabricItemResult =
  | { ok: true; item: FabricItemCandidate; source: 'id' | 'name_code' }
  | { ok: false; reason: 'missing_identity' | 'not_found' | 'ambiguous'; count: number };

function sameText(a: string | null | undefined, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
}

export function resolveFabricItemForCreateItemEdit(
  identity: EditableFabricItemIdentity,
  candidates: FabricItemCandidate[],
): ResolveEditFabricItemResult {
  const directId = identity.fabricItemId?.trim();
  if (directId) {
    const byId = candidates.filter((c) => c.id === directId);
    if (byId.length === 1) return { ok: true, item: byId[0], source: 'id' };
    if (byId.length > 1) return { ok: false, reason: 'ambiguous', count: byId.length };
    return { ok: false, reason: 'not_found', count: 0 };
  }

  const originalName = identity.originalName.trim();
  const originalCode = identity.originalCode.trim();
  if (!originalName && !originalCode) {
    return { ok: false, reason: 'missing_identity', count: 0 };
  }

  const matches = candidates.filter((item) => {
    const nameOk = !originalName || sameText(item.name, originalName);
    if (!originalCode) return nameOk && sameText(item.name, originalName);
    const codeOk =
      sameText(item.internal_code, originalCode)
      || sameText(item.supplier_code, originalCode);
    return nameOk && codeOk;
  });

  if (matches.length === 1) return { ok: true, item: matches[0], source: 'name_code' };
  if (matches.length === 0) return { ok: false, reason: 'not_found', count: 0 };
  return { ok: false, reason: 'ambiguous', count: matches.length };
}

export function createItemEditFailureMessage(result: Extract<ResolveEditFabricItemResult, { ok: false }>): string {
  if (result.reason === 'missing_identity') {
    return 'تعذر تحديد الخامة المراد تعديلها (لا يوجد اسم أو كود أصلي).';
  }
  if (result.reason === 'not_found') {
    return 'لم يُعثر على سجل خامة مطابق للهوية الأصلية. أوقِف الحفظ لتجنب تعديل سجل خاطئ.';
  }
  return `وُجد أكثر من سجل خامة مطابق للهوية الأصلية (${result.count}). أوقِف الحفظ لتجنب التعديل الغامض.`;
}
