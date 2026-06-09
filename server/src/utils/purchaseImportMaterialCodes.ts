import type { PoolClient } from 'pg';
import { cleanString, type NormalizedField } from './importColumnDetector.js';

type NormalizedRowData = Partial<Record<NormalizedField, string | number | null>>;

function slugCode(s: string): string {
  const v = s.trim().toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/gi, '-').replace(/^-+|-+$/g, '');
  return v || 'item';
}

async function ensureCategoryNode(
  client: PoolClient,
  companyId: string,
  parentId: string | null,
  code: string,
  name: string,
  _level: number,
): Promise<{ id: string; created: boolean }> {
  const byCode = await client.query<{ id: string }>(
    `SELECT id FROM fabric_categories
     WHERE company_id=$1 AND lower(trim(code))=lower(trim($2))
     LIMIT 1`,
    [companyId, code],
  );
  if (byCode.rows.length) return { id: byCode.rows[0].id, created: false };

  try {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO fabric_categories (company_id, parent_id, code, name, is_active)
       VALUES ($1,$2,$3,$4,true)
       RETURNING id`,
      [companyId, parentId, code, name],
    );
    return { id: ins.rows[0].id, created: true };
  } catch (e: unknown) {
    if ((e as { code?: string }).code !== '23505') throw e;
    const again = await client.query<{ id: string }>(
      `SELECT id FROM fabric_categories
       WHERE company_id=$1 AND lower(trim(code))=lower(trim($2))
       LIMIT 1`,
      [companyId, code],
    );
    if (!again.rows.length) throw e;
    return { id: again.rows[0].id, created: false };
  }
}

/** Build design / material code from normalized import row. */
export function resolveImportMaterialCode(nd: NormalizedRowData): string {
  return (
    cleanString(nd.internalMaterialCode) ||
    cleanString(nd.supplierMaterialCode) ||
    ''
  );
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
  const intCode = cleanString(nd.internalMaterialCode);
  const supCode = cleanString(nd.supplierMaterialCode);
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
  } else if (supCode && internalLooksPlaceholder) {
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

  await client.query(
    `UPDATE fabric_items SET
       name = COALESCE(NULLIF($3,''), name),
       internal_code = COALESCE($4, internal_code),
       supplier_code = COALESCE(NULLIF($5,''), supplier_code),
       updated_at = now()
     WHERE id=$1 AND company_id=$2`,
    [itemId, companyId, matName || null, nextInternal, supCode || null],
  );
}

/** Keep category tree level-2 (كود الخامة) in sync with import row. */
export async function ensureFabricCategoryChainFromImport(
  client: PoolClient,
  companyId: string,
  nd: NormalizedRowData,
): Promise<number> {
  const materialName = cleanString(nd.materialName);
  const designCode = resolveImportMaterialCode(nd);
  const colorName = cleanString(nd.colorName) || cleanString(nd.colorNameTr);
  const colorCode = cleanString(nd.colorCode) || cleanString(nd.supplierColorCode);

  if (!materialName && !designCode) return 0;

  let created = 0;
  const l1Label = materialName || designCode;
  const l1 = await ensureCategoryNode(client, companyId, null, `L1_${slugCode(l1Label)}`, l1Label, 1);
  if (l1.created) created += 1;

  let parentId = l1.id;
  if (designCode) {
    const l2 = await ensureCategoryNode(client, companyId, l1.id, `L2_${slugCode(designCode)}`, designCode, 2);
    if (l2.created) created += 1;
    parentId = l2.id;
  }

  if (colorName) {
    const l3 = await ensureCategoryNode(client, companyId, parentId, `L3_${slugCode(colorName)}`, colorName, 3);
    if (l3.created) created += 1;
    if (colorCode) {
      const l4 = await ensureCategoryNode(client, companyId, l3.id, `L4_${slugCode(colorCode)}`, colorCode, 4);
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
