import type { PoolClient } from 'pg';

type CatSnapshot = {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
};

export type CategoryMasterSyncResult = {
  itemsUpdated: number;
  colorsUpdated: number;
};

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function materialCodeFromCategory(cat: CatSnapshot): string {
  return (cat.code.trim() || cat.name.trim());
}

async function loadCategoryPath(
  client: PoolClient,
  companyId: string,
  categoryId: string,
): Promise<CatSnapshot[]> {
  const rows = await client.query<CatSnapshot>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id, code, name, 0 AS depth
       FROM fabric_categories
       WHERE id = $1 AND company_id = $2
       UNION ALL
       SELECT c.id, c.parent_id, c.code, c.name, ancestors.depth + 1
       FROM fabric_categories c
       INNER JOIN ancestors ON c.id = ancestors.parent_id
     )
     SELECT id, parent_id, code, name
     FROM ancestors
     ORDER BY depth DESC`,
    [categoryId, companyId],
  );
  return rows.rows;
}

async function categoryDepth(client: PoolClient, companyId: string, categoryId: string): Promise<number> {
  const rows = await client.query<{ depth: number }>(
    `WITH RECURSIVE depth_cte AS (
       SELECT id, parent_id, 0 AS depth
       FROM fabric_categories
       WHERE id = $1 AND company_id = $2
       UNION ALL
       SELECT p.id, p.parent_id, depth_cte.depth + 1
       FROM fabric_categories p
       INNER JOIN depth_cte ON p.id = depth_cte.parent_id
     )
     SELECT MAX(depth)::int AS depth FROM depth_cte`,
    [categoryId, companyId],
  );
  return rows.rows[0]?.depth ?? 0;
}

/** Propagate fabric_categories edits to fabric_items / fabric_colors shown on rolls. */
export async function syncCategoryUpdateToMasterData(
  client: PoolClient,
  companyId: string,
  before: CatSnapshot,
  after: CatSnapshot,
): Promise<CategoryMasterSyncResult> {
  const depth = await categoryDepth(client, companyId, before.id);
  let itemsUpdated = 0;
  let colorsUpdated = 0;

  if (depth === 0 && norm(before.name) !== norm(after.name)) {
    const materialNameCatId = after.id;
    const res = await client.query(
      `UPDATE fabric_items fi
       SET name = $3, updated_at = now()
       WHERE fi.company_id = $1
         AND (
           fi.category_id = $2
           OR fi.id IN (
             SELECT DISTINCT fr.item_id
             FROM fabric_rolls fr
             INNER JOIN fabric_categories c2 ON c2.company_id = $1 AND c2.parent_id = $2
             INNER JOIN fabric_items fi2 ON fi2.id = fr.item_id AND fi2.company_id = fr.company_id
             WHERE fr.company_id = $1
               AND trim(lower(fi2.internal_code)) = trim(lower(COALESCE(NULLIF(c2.code, ''), c2.name)))
           )
         )`,
      [companyId, materialNameCatId, after.name.trim()],
    );
    itemsUpdated = res.rowCount ?? 0;
  }

  if (depth === 1 && before.parent_id && norm(before.code) !== norm(after.code)) {
    const oldCode = materialCodeFromCategory(before);
    const newCode = materialCodeFromCategory(after);
    const res = await client.query(
      `UPDATE fabric_items fi
       SET internal_code = $4, updated_at = now()
       WHERE fi.company_id = $1
         AND fi.category_id = $2
         AND trim(lower(fi.internal_code)) = trim(lower($3::text))`,
      [companyId, before.parent_id, oldCode, newCode],
    );
    itemsUpdated = res.rowCount ?? 0;
  }

  if (depth === 2) {
    const oldColorName = before.name.trim() || before.code.trim();
    const newColorName = after.name.trim() || after.code.trim();
    if (norm(oldColorName) !== norm(newColorName)) {
      const path = await loadCategoryPath(client, companyId, before.id);
      const materialName = path[0];
      const materialCode = path[1];
      if (materialName && materialCode) {
        const res = await client.query(
          `UPDATE fabric_colors fc
           SET name_ar = $4, updated_at = now()
           WHERE fc.company_id = $1
             AND trim(lower(coalesce(fc.name_ar, ''))) = trim(lower($3::text))
             AND fc.id IN (
               SELECT DISTINCT fr.color_id
               FROM fabric_rolls fr
               INNER JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
               WHERE fr.company_id = $1
                 AND fr.color_id IS NOT NULL
                 AND fi.category_id = $2
                 AND trim(lower(fi.internal_code)) = trim(lower($5::text))
             )`,
          [
            companyId,
            materialName.id,
            oldColorName,
            newColorName,
            materialCodeFromCategory(materialCode),
          ],
        );
        colorsUpdated = res.rowCount ?? 0;
      }
    }
  }

  if (depth === 3) {
    const oldColorCode = materialCodeFromCategory(before);
    const newColorCode = materialCodeFromCategory(after);
    if (norm(oldColorCode) !== norm(newColorCode)) {
    const path = await loadCategoryPath(client, companyId, before.id);
    const materialName = path[0];
    const materialCode = path[1];
    const colorName = path[2];
    if (materialName && materialCode && colorName) {
      const res = await client.query(
        `UPDATE fabric_colors fc
         SET color_code = $4, updated_at = now()
         WHERE fc.company_id = $1
           AND trim(lower(coalesce(fc.color_code, ''))) = trim(lower($3::text))
           AND trim(lower(coalesce(fc.name_ar, ''))) = trim(lower($5::text))
           AND fc.id IN (
             SELECT DISTINCT fr.color_id
             FROM fabric_rolls fr
             INNER JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
             WHERE fr.company_id = $1
               AND fr.color_id IS NOT NULL
               AND fi.category_id = $2
               AND trim(lower(fi.internal_code)) = trim(lower($6::text))
           )`,
        [
          companyId,
          materialName.id,
          oldColorCode,
          newColorCode,
          (colorName.name.trim() || colorName.code.trim()),
          materialCodeFromCategory(materialCode),
        ],
      );
      colorsUpdated = res.rowCount ?? 0;
    }
    }
  }

  return { itemsUpdated, colorsUpdated };
}

export type { CatSnapshot };
