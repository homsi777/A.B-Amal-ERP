import type { PoolClient } from 'pg';
import { stripImportLevelPrefix } from './categoryBusinessValues.js';
import { cleanString, type NormalizedField } from './importColumnDetector.js';
import {
  looksLikeLikelyColorCode,
  looksLikeUniqueDesignSku,
  reconcileImportMaterialAndColorCodes,
} from './importMaterialCodeResolver.js';

type NormalizedRowData = Partial<Record<NormalizedField, string | number | null>>;

/**
 * Find or create a category node under the same parent.
 * Match order: exact name → exact code → legacy L1_/L2_/… code/name (stripped).
 * New rows store code = name exactly as written (no L1_/L2_ prefixes).
 */
async function ensureCategoryNode(
  client: PoolClient,
  companyId: string,
  parentId: string | null,
  label: string,
): Promise<{ id: string; created: boolean }> {
  const name = label.trim();
  if (!name) {
    throw new Error('category label is required');
  }

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM fabric_categories
     WHERE company_id=$1
       AND parent_id IS NOT DISTINCT FROM $2
       AND (
         lower(trim(name)) = lower(trim($3))
         OR lower(trim(code)) = lower(trim($3))
         OR lower(trim(regexp_replace(code, '^L[1-4]_', '', 'i'))) = lower(trim($3))
         OR lower(trim(regexp_replace(name, '^L[1-4]_', '', 'i'))) = lower(trim($3))
       )
     ORDER BY
       CASE
         WHEN lower(trim(name)) = lower(trim($3)) THEN 0
         WHEN lower(trim(code)) = lower(trim($3)) THEN 1
         ELSE 2
       END,
       created_at ASC
     LIMIT 1`,
    [companyId, parentId, name],
  );
  if (existing.rows.length) return { id: existing.rows[0].id, created: false };

  // Prefer plain business label; never persist L1_/L2_/… prefixes on new rows.
  const storeLabel = stripImportLevelPrefix(name) || name;

  try {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO fabric_categories (company_id, parent_id, code, name, is_active)
       VALUES ($1,$2,$3,$3,true)
       RETURNING id`,
      [companyId, parentId, storeLabel],
    );
    return { id: ins.rows[0].id, created: true };
  } catch (e: unknown) {
    if ((e as { code?: string }).code !== '23505') throw e;
    const again = await client.query<{ id: string }>(
      `SELECT id FROM fabric_categories
       WHERE company_id=$1
         AND parent_id IS NOT DISTINCT FROM $2
         AND (
           lower(trim(name)) = lower(trim($3))
           OR lower(trim(code)) = lower(trim($3))
           OR lower(trim(regexp_replace(code, '^L[1-4]_', '', 'i'))) = lower(trim($3))
           OR lower(trim(regexp_replace(name, '^L[1-4]_', '', 'i'))) = lower(trim($3))
         )
       ORDER BY created_at ASC
       LIMIT 1`,
      [companyId, parentId, storeLabel],
    );
    if (!again.rows.length) throw e;
    return { id: again.rows[0].id, created: false };
  }
}

/** Item that already owns this design code but under a different material name. */
export async function findImportMaterialCodeCollision(
  db: Pick<PoolClient, 'query'>,
  companyId: string,
  materialName: string,
  designCode: string,
): Promise<{ id: string; name: string } | null> {
  const name = cleanString(materialName);
  const code = cleanString(designCode);
  if (!name || !code) return null;

  const hitId = await findFabricItemByImportDesignCode(db, companyId, code);
  if (!hitId) return null;

  const hit = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM fabric_items WHERE id=$1 AND company_id=$2 AND is_active=true`,
    [hitId, companyId],
  );
  const row = hit.rows[0];
  if (!row) return null;
  if (row.name.trim().toLowerCase() === name.trim().toLowerCase()) return null;
  return row;
}

/** Match fabric item by design code stored in internal_code or supplier_code. */
export async function findFabricItemByImportDesignCode(
  db: Pick<PoolClient, 'query'>,
  companyId: string,
  designCode: string,
): Promise<string | null> {
  const code = cleanString(designCode);
  if (!code) return null;
  const r = await db.query<{ id: string }>(
    `SELECT id FROM fabric_items
     WHERE company_id=$1 AND is_active=true
       AND (
         lower(trim(internal_code))=lower(trim($2))
         OR lower(trim(supplier_code))=lower(trim($2))
       )
     LIMIT 1`,
    [companyId, code],
  );
  return r.rows[0]?.id ?? null;
}

/**
 * Safe purchase-import match: name + design code together.
 * Never matches HONEYCOMB/CLO-3 when importing ASTRLI EKOSE/CLO-3.
 */
export async function findFabricItemForPurchaseImport(
  db: Pick<PoolClient, 'query'>,
  companyId: string,
  materialName: string,
  designCode: string,
): Promise<string | null> {
  const name = cleanString(materialName);
  const code = cleanString(designCode);
  if (!name && !code) return null;

  if (name && code) {
    const byPair = await db.query<{ id: string }>(
      `SELECT id FROM fabric_items
       WHERE company_id=$1 AND is_active=true
         AND lower(trim(name))=lower(trim($2))
         AND (
           lower(trim(internal_code))=lower(trim($3))
           OR lower(trim(coalesce(supplier_code, '')))=lower(trim($3))
         )
       ORDER BY created_at ASC
       LIMIT 1`,
      [companyId, name, code],
    );
    if (byPair.rows[0]?.id) return byPair.rows[0].id;
    return null;
  }

  if (name) {
    const byName = await db.query<{ id: string }>(
      `SELECT id FROM fabric_items
       WHERE company_id=$1 AND lower(trim(name))=lower(trim($2)) AND is_active=true
       ORDER BY created_at ASC LIMIT 1`,
      [companyId, name],
    );
    return byName.rows[0]?.id ?? null;
  }

  return findFabricItemByImportDesignCode(db, companyId, code);
}

function purchaseImportInternalCode(materialName: string, designCode: string): string {
  const name = cleanString(materialName) || 'ITEM-IMPORT';
  const code = cleanString(designCode);
  if (!code) return name;
  if (looksLikeUniqueDesignSku(code)) return code;
  return `${name}::${code}`;
}

/**
 * One fabric item per design code (3019, 7020, 38-A…).
 * Do not collapse multiple desen under the same material name (ROYAL JAKAR).
 */
export async function findOrCreateImportFabricItem(
  client: PoolClient,
  companyId: string,
  materialName: string,
  designCode: string,
): Promise<{ id: string; created: boolean }> {
  const name = cleanString(materialName) || cleanString(designCode) || 'ITEM-IMPORT';
  const code = cleanString(designCode);

  const existingId = await findFabricItemForPurchaseImport(client, companyId, name, code);
  if (existingId) return { id: existingId, created: false };

  let internalCode = purchaseImportInternalCode(name, code);
  const supplierCode = code && looksLikeUniqueDesignSku(code) ? code : code || null;

  if (code) {
    const codeTaken = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM fabric_items
       WHERE company_id=$1 AND is_active=true
         AND (
           lower(trim(internal_code))=lower(trim($2))
           OR lower(trim(coalesce(supplier_code, '')))=lower(trim($2))
         )
       LIMIT 1`,
      [companyId, code],
    );
    if (codeTaken.rows.length && codeTaken.rows[0].name.trim().toLowerCase() !== name.trim().toLowerCase()) {
      internalCode = `IMP-${name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 32)}-${code}`.toUpperCase();
    }
  }

  const ins = await client.query<{ id: string }>(
    `INSERT INTO fabric_items (company_id, name, internal_code, supplier_code, is_active)
     VALUES ($1,$2,$3,$4,true)
     ON CONFLICT (company_id, internal_code) DO UPDATE SET
       supplier_code=COALESCE(EXCLUDED.supplier_code, fabric_items.supplier_code),
       updated_at=now()
     RETURNING id`,
    [companyId, name, internalCode, supplierCode],
  );
  return { id: ins.rows[0].id, created: true };
}

/** Build design / material code from normalized import row. */
export function resolveImportMaterialCode(nd: NormalizedRowData): string {
  const reconciled = reconcileImportMaterialAndColorCodes({
    internalMaterialCode: cleanString(nd.internalMaterialCode),
    supplierMaterialCode: cleanString(nd.supplierMaterialCode),
    colorCode: cleanString(nd.colorCode),
  });
  return reconciled.materialCode;
}

/**
 * Persist كود الخامة from Excel onto fabric_items.
 * Runs for matched and newly created items — previously codes were dropped when the item already existed by name.
 */
export async function applyPurchaseImportMaterialCodes(
  client: PoolClient,
  companyId: string,
  itemId: string,
  nd: NormalizedRowData,
): Promise<void> {
  const matName = cleanString(nd.materialName);
  const reconciled = reconcileImportMaterialAndColorCodes({
    internalMaterialCode: cleanString(nd.internalMaterialCode),
    supplierMaterialCode: cleanString(nd.supplierMaterialCode),
    colorCode: cleanString(nd.colorCode),
  });
  const intRaw = cleanString(nd.internalMaterialCode);
  const supRaw = cleanString(nd.supplierMaterialCode);
  const materialCode = reconciled.materialCode;
  let intCode = '';
  let supCode = '';
  if (materialCode) {
    if (intRaw === materialCode) intCode = materialCode;
    if (supRaw === materialCode) supCode = materialCode;
    if (!intCode && !supCode && looksLikeUniqueDesignSku(materialCode)) {
      supCode = materialCode;
    }
  }
  if (!matName && !intCode && !supCode) return;

  const cur = await client.query<{ internal_code: string; supplier_code: string | null; name: string }>(
    `SELECT internal_code, supplier_code, name FROM fabric_items WHERE id=$1 AND company_id=$2`,
    [itemId, companyId],
  );
  if (!cur.rows.length) return;

  const row = cur.rows[0];
  const internalLooksPlaceholder =
    !row.internal_code?.trim() ||
    row.internal_code.startsWith('AUTO-') ||
    row.internal_code.startsWith('IMP-') ||
    row.internal_code.trim().toLowerCase() === row.name.trim().toLowerCase();

  let nextInternal: string | null = null;
  if (intCode) {
    nextInternal = intCode;
  } else if (supCode && internalLooksPlaceholder && looksLikeUniqueDesignSku(supCode)) {
    nextInternal = supCode;
  }

  if (nextInternal && nextInternal !== row.internal_code) {
    const dup = await client.query<{ id: string }>(
      `SELECT id FROM fabric_items
       WHERE company_id=$1 AND lower(trim(internal_code))=lower(trim($2)) AND id<>$3
       LIMIT 1`,
      [companyId, nextInternal, itemId],
    );
    if (dup.rows.length) {
      nextInternal = null;
    }
  }

  if (
    supCode
    && looksLikeLikelyColorCode(supCode)
    && !looksLikeUniqueDesignSku(supCode)
  ) {
    supCode = '';
  }

  let nextName: string | null = matName || null;
  if (
    matName
    && row.name.trim().toLowerCase() !== matName.trim().toLowerCase()
  ) {
    const live = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fabric_rolls
       WHERE company_id=$1 AND item_id=$2 AND status IN ('AVAILABLE', 'RESERVED')`,
      [companyId, itemId],
    );
    if (parseInt(live.rows[0]?.n ?? '0', 10) > 0) {
      nextName = null;
    }
  }

  await client.query(
    `UPDATE fabric_items SET
       name = COALESCE(NULLIF($3,''), name),
       internal_code = COALESCE($4, internal_code),
       supplier_code = COALESCE(NULLIF($5,''), supplier_code),
       updated_at = now()
     WHERE id=$1 AND company_id=$2`,
    [itemId, companyId, nextName, nextInternal, supCode || null],
  );
}

/** Keep category tree in sync with import row — reuse existing nodes by name; create only if missing. */
export async function ensureFabricCategoryChainFromImport(
  client: PoolClient,
  companyId: string,
  nd: NormalizedRowData,
): Promise<number> {
  const materialName = cleanString(nd.materialName);
  const rawDesignCode = resolveImportMaterialCode(nd);
  const designCode = rawDesignCode && looksLikeUniqueDesignSku(rawDesignCode) ? rawDesignCode : '';
  const colorName = cleanString(nd.colorName) || cleanString(nd.colorNameTr);
  const colorCode = cleanString(nd.colorCode) || cleanString(nd.supplierColorCode);

  if (!materialName && !designCode) return 0;

  let created = 0;
  const l1Label = materialName || designCode;
  const l1 = await ensureCategoryNode(client, companyId, null, l1Label);
  if (l1.created) created += 1;

  let parentId = l1.id;
  if (designCode) {
    const l2 = await ensureCategoryNode(client, companyId, l1.id, designCode);
    if (l2.created) created += 1;
    parentId = l2.id;
  }

  if (colorName) {
    const l3 = await ensureCategoryNode(client, companyId, parentId, colorName);
    if (l3.created) created += 1;
    if (colorCode) {
      const l4 = await ensureCategoryNode(client, companyId, l3.id, colorCode);
      if (l4.created) created += 1;
    }
  }

  return created;
}

export function buildPurchaseLineMetadataFromImport(
  batchId: string,
  row: { id: string; row_no: number },
  nd: NormalizedRowData,
  barcode: string,
): Record<string, unknown> {
  const designCode = resolveImportMaterialCode(nd);
  return {
    importBatchId: batchId,
    importRowId: row.id,
    rowNo: row.row_no,
    barcode,
    materialName: cleanString(nd.materialName) || null,
    fabricName: cleanString(nd.materialName) || null,
    designCode: designCode || null,
    articleCode: designCode || null,
    dsamNumber: designCode || null,
    internalMaterialCode: cleanString(nd.internalMaterialCode) || null,
    supplierMaterialCode: cleanString(nd.supplierMaterialCode) || null,
    colorName: cleanString(nd.colorName) || cleanString(nd.colorNameTr) || null,
    fabricColor: cleanString(nd.colorName) || cleanString(nd.colorNameTr) || null,
    colorCode:
      cleanString(nd.colorCode) ||
      cleanString(nd.supplierColorCode) ||
      cleanString(nd.colorNameTr) ||
      null,
    widthCm: nd.widthCm ?? null,
    gsm: nd.gsm ?? null,
    weightKg: nd.actualWeightKg ?? null,
    rollNo: cleanString(nd.rollNo) || null,
  };
}
