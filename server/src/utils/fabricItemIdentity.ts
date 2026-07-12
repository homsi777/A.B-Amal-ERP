import type { PoolClient } from 'pg';
import { looksLikeUniqueDesignSku } from './importMaterialCodeResolver.js';

function norm(value: string): string {
  return value.trim().toLowerCase();
}

/** Safe identity: material name + design code (CLO-2 under WİNTER ≠ CLO-2 under ASTRLI). */
export async function findFabricItemByNameAndCode(
  db: Pick<PoolClient, 'query'>,
  companyId: string,
  materialName: string,
  designCode: string,
): Promise<{ id: string; internal_code: string } | null> {
  const name = materialName.trim();
  const code = designCode.trim();
  if (!name || !code) return null;

  const r = await db.query<{ id: string; internal_code: string }>(
    `SELECT id, internal_code FROM fabric_items
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
  return r.rows[0] ?? null;
}

/** Item that owns this design code under a different material name. */
export async function findFabricItemCodeCollision(
  db: Pick<PoolClient, 'query'>,
  companyId: string,
  materialName: string,
  designCode: string,
): Promise<{ id: string; name: string } | null> {
  const name = materialName.trim();
  const code = designCode.trim();
  if (!name || !code) return null;

  const r = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM fabric_items
     WHERE company_id=$1 AND is_active=true
       AND lower(trim(name))<>lower(trim($2))
       AND (
         lower(trim(internal_code))=lower(trim($3))
         OR lower(trim(coalesce(supplier_code, '')))=lower(trim($3))
       )
     LIMIT 1`,
    [companyId, name, code],
  );
  return r.rows[0] ?? null;
}

/** Unique internal_code for fabric_items — avoids cross-name CLO-2 collisions. */
export function buildFabricItemInternalCode(materialName: string, designCode: string): string {
  const name = materialName.trim() || 'ITEM';
  const code = designCode.trim();
  if (!code) return name;
  if (looksLikeUniqueDesignSku(code)) return code;
  return `${name}::${code}`;
}

/** When plain code is taken by another name, use IMP-prefixed code. */
export async function resolveFabricItemInternalCode(
  db: Pick<PoolClient, 'query'>,
  companyId: string,
  materialName: string,
  designCode: string,
): Promise<string> {
  const preferred = buildFabricItemInternalCode(materialName, designCode);
  const collision = await findFabricItemCodeCollision(db, companyId, materialName, designCode);
  if (!collision) return preferred;

  const slug = materialName.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 32).toUpperCase();
  return `IMP-${slug}-${designCode.trim().toUpperCase()}`;
}
