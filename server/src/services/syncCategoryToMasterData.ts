import type { PoolClient } from 'pg';
import {
  buildColorBarcodeCode,
  normalizeColorCode,
} from './cartelaColorService.js';
import {
  colorCodeFromCategoryOnly,
  colorNameFromCategory,
  materialCodeFromCategory,
} from '../utils/categoryBusinessValues.js';

type CatSnapshot = {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
};

export type CategoryMasterSyncResult = {
  itemsUpdated: number;
  colorsUpdated: number;
  cartelaColorsUpdated: number;
};

function norm(value: string): string {
  return value.trim().toLowerCase();
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
  let cartelaColorsUpdated = 0;

  if (depth === 0 && norm(before.name) !== norm(after.name)) {
    const materialNameCatId = after.id;
    // Only items explicitly linked to this L1 category — never by design code alone.
    const res = await client.query(
      `UPDATE fabric_items fi
       SET name = $3, updated_at = now()
       WHERE fi.company_id = $1
         AND fi.category_id = $2`,
      [companyId, materialNameCatId, after.name.trim()],
    );
    itemsUpdated = res.rowCount ?? 0;
  }

  if (depth === 1 && before.parent_id && norm(before.code) !== norm(after.code)) {
    const oldCode = materialCodeFromCategory(before);
    const newCode = materialCodeFromCategory(after);
    const l1 = await client.query<{ name: string }>(
      `SELECT name FROM fabric_categories WHERE id=$1 AND company_id=$2`,
      [before.parent_id, companyId],
    );
    const l1Name = l1.rows[0]?.name?.trim() ?? '';
    if (!l1Name) {
      return { itemsUpdated, colorsUpdated, cartelaColorsUpdated };
    }
    const res = await client.query(
      `UPDATE fabric_items fi
       SET internal_code = $5, updated_at = now()
       WHERE fi.company_id = $1
         AND trim(lower(fi.name)) = trim(lower($2::text))
         AND trim(lower(fi.internal_code)) = trim(lower($3::text))
         AND (
           fi.category_id = $4
           OR fi.category_id IN (
             SELECT id FROM fabric_categories WHERE company_id = $1 AND parent_id = $4
           )
         )`,
      [companyId, l1Name, oldCode, before.parent_id, newCode],
    );
    itemsUpdated = res.rowCount ?? 0;
  }

  if (depth === 2) {
    const oldColorName = colorNameFromCategory(before);
    const newColorName = colorNameFromCategory(after);
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
                 AND trim(lower(fi.internal_code)) = trim(lower($5::text))
                 AND (
                   fi.category_id = $2
                   OR fi.category_id IN (
                     SELECT id FROM fabric_categories WHERE company_id = $1 AND parent_id IS NULL
                   )
                 )
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
    const oldColorCode = colorCodeFromCategoryOnly(before);
    const newColorCode = colorCodeFromCategoryOnly(after);
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
               AND trim(lower(fi.internal_code)) = trim(lower($6::text))
           )`,
        [
          companyId,
          materialName.id,
          oldColorCode,
          newColorCode,
          colorNameFromCategory(colorName),
          materialCodeFromCategory(materialCode),
        ],
      );
      colorsUpdated = res.rowCount ?? 0;

      const cartelaRows = await client.query<{ id: string; cartela_label_id: string; serial_no: string }>(
        `SELECT c.id, c.cartela_label_id, cl.serial_no
         FROM cartela_label_colors c
         JOIN cartela_labels cl ON cl.id = c.cartela_label_id AND cl.company_id = c.company_id
         WHERE c.company_id = $1
           AND trim(lower(c.color_code)) = trim(lower($2::text))`,
        [companyId, oldColorCode],
      );
      for (const row of cartelaRows.rows) {
        const serial = row.serial_no?.trim();
        if (!serial) continue;
        const nextCode = normalizeColorCode(newColorCode);
        const barcodeCode = buildColorBarcodeCode(serial, nextCode);
        await client.query(
          `UPDATE cartela_label_colors
           SET color_code = $3, barcode_code = $4, updated_at = now()
           WHERE id = $1 AND company_id = $2`,
          [row.id, companyId, nextCode, barcodeCode],
        );
        cartelaColorsUpdated += 1;
      }
    }
    }
  }

  return { itemsUpdated, colorsUpdated, cartelaColorsUpdated };
}

export type { CatSnapshot };
