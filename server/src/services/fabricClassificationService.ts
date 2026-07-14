/**
 * Maps the 4-level fabric_categories tree (material name → material code → colour name → colour code)
 * into fabric_items + fabric_colors (+ optional fabric_item_variants) for roll creation.
 *
 * Existing master rows are never mutated — find / create / relink only.
 */

import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import {
  colorCodeFromCategories,
  colorNameFromCategory,
  materialCodeFromCategory,
  materialNameFromCategory,
} from '../utils/categoryBusinessValues.js';
import {
  findFabricItemByNameAndCode,
  resolveFabricItemInternalCode,
} from '../utils/fabricItemIdentity.js';

export type ResolveClassificationInput = {
  companyId: string;
  level1CategoryId: string;
  level2CategoryId: string;
  level3CategoryId?: string | null;
  level4CategoryId?: string | null;
  widthCm?: number | null;
  gsm?: number | null;
};

export type ResolveClassificationResult = {
  itemId: string;
  colorId: string | null;
  variantId: string | null;
  /** Display: level-2 material code */
  articleCode: string;
  /** Display: level-3 colour name */
  fabricColorName: string;
  /** Display: level-4 colour code */
  colorCode: string;
  /** Design nr — internal_code of linked fabric_item */
  designNr: string | null;
  created: { item: boolean; color: boolean; variant: boolean };
};

type CatRow = {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
};

async function loadCategoryRows(
  client: PoolClient,
  companyId: string,
  ids: string[],
): Promise<Map<string, CatRow>> {
  const r = await client.query<CatRow>(
    `SELECT id, parent_id, code, name FROM fabric_categories
     WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, ids],
  );
  return new Map(r.rows.map((x) => [x.id, x]));
}

async function loadMaterialPair(
  client: PoolClient,
  companyId: string,
  l1: string,
  l2: string,
): Promise<{ c1: CatRow; c2: CatRow }> {
  const map = await loadCategoryRows(client, companyId, [l1, l2]);
  const c1 = map.get(l1);
  const c2 = map.get(l2);
  if (!c1 || !c2) {
    throw Object.assign(new Error('أحد تصنيفات الأقمشة غير موجود أو لا يتبع شركتك'), { statusCode: 404 });
  }
  if (c1.parent_id !== null) {
    throw Object.assign(new Error('اسم الخامة يجب أن يكون المستوى الجذري للشجرة'), { statusCode: 400 });
  }
  if (c2.parent_id !== c1.id) {
    throw Object.assign(new Error('كود الخامة المختار لا يتبع اسم الخامة المحدد'), { statusCode: 400 });
  }
  return { c1, c2 };
}

async function loadColorPair(
  client: PoolClient,
  companyId: string,
  c2: CatRow,
  l3: string,
  l4: string,
): Promise<{ c3: CatRow; c4: CatRow }> {
  const map = await loadCategoryRows(client, companyId, [l3, l4]);
  const c3 = map.get(l3);
  const c4 = map.get(l4);
  if (!c3 || !c4) {
    throw Object.assign(new Error('تصنيف اللون غير موجود'), { statusCode: 404 });
  }
  if (c3.parent_id !== c2.id) {
    throw Object.assign(new Error('لون الخامة المختار لا يتبع كود الخامة المحدد'), { statusCode: 400 });
  }
  if (l3 !== l4 && c4.parent_id !== c3.id) {
    throw Object.assign(new Error('كود اللون المختار لا يتبع لون الخامة المحدد'), { statusCode: 400 });
  }
  return { c3, c4 };
}

function buildVariantCode(internalCode: string, colorCode: string, widthCm: number, gsm: number): string {
  const raw = `${internalCode}-${colorCode}-${widthCm}-${gsm}`.replace(/\s+/g, '_');
  return raw.length > 120 ? raw.slice(0, 120) : raw;
}

/**
 * Core resolve logic injectable with any PoolClient (used by API + unit tests).
 * Never UPDATEs existing fabric_items / fabric_colors.
 */
export async function resolveFabricClassificationWithClient(
  client: PoolClient,
  input: ResolveClassificationInput,
): Promise<ResolveClassificationResult> {
  const {
    companyId,
    level1CategoryId,
    level2CategoryId,
    level3CategoryId,
    level4CategoryId,
    widthCm,
    gsm,
  } = input;

  let createdItem = false;
  let createdColor = false;
  let createdVariant = false;

  const { c1, c2 } = await loadMaterialPair(client, companyId, level1CategoryId, level2CategoryId);
  const materialCode = materialCodeFromCategory(c2);
  const materialName = materialNameFromCategory(c1);

  const existingItem = await findFabricItemByNameAndCode(client, companyId, materialName, materialCode);

  let itemId: string;
  let designNr: string | null;

  if (!existingItem) {
    const internalCode = await resolveFabricItemInternalCode(client, companyId, materialName, materialCode);
    const ins = await client.query<{ id: string; internal_code: string }>(
      `INSERT INTO fabric_items
         (company_id, category_id, internal_code, supplier_code, name, fabric_type, unit, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, internal_code`,
      [
        companyId,
        c1.id,
        internalCode,
        materialCode,
        materialName,
        '',
        'meter',
        'أُنشئ تلقائياً من تصنيف الأقمشة عند إنشاء ثوب يدوي',
      ],
    );
    itemId = ins.rows[0].id;
    designNr = ins.rows[0].internal_code;
    createdItem = true;
  } else {
    // Relink only — never mutate a shared fabric_item that other rolls use.
    itemId = existingItem.id;
    designNr = existingItem.internal_code;
  }

  const hasColor = Boolean(level3CategoryId?.trim());
  let colorId: string | null = null;
  let colorNameAr = '';
  let colorCodeVal = '';

  if (hasColor) {
    const l3 = level3CategoryId!.trim();
    const l4 = level4CategoryId?.trim() || l3;
    const { c3, c4 } = await loadColorPair(client, companyId, c2, l3, l4);
    colorNameAr = colorNameFromCategory(c3);
    colorCodeVal = colorCodeFromCategories(c3, c4);

    const colorRes = colorCodeVal
      ? await client.query<{ id: string }>(
          `SELECT id FROM fabric_colors
           WHERE company_id = $1
             AND trim(lower(coalesce(name_ar, ''))) = trim(lower($2::text))
             AND (
               trim(lower(coalesce(color_code, ''))) = trim(lower($3::text))
               OR trim(lower(coalesce(color_code, ''))) = trim(lower($4::text))
             )
           LIMIT 1`,
          [companyId, colorNameAr, colorCodeVal, c4.code.trim()],
        )
      : await client.query<{ id: string }>(
          `SELECT id FROM fabric_colors
           WHERE company_id = $1
             AND trim(lower(coalesce(name_ar, ''))) = trim(lower($2::text))
             AND coalesce(nullif(trim(color_code), ''), '0') IN ('', '0')
           LIMIT 1`,
          [companyId, colorNameAr],
        );

    if (!colorRes.rows.length) {
      const insC = await client.query<{ id: string }>(
        `INSERT INTO fabric_colors (company_id, name_ar, name_tr, color_code, supplier_color_code, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          companyId,
          colorNameAr,
          '',
          colorCodeVal,
          '',
          'أُنشئ تلقائياً من تصنيف الأقمشة (اسم خامة → كود خامة → لون → كود لون)',
        ],
      );
      colorId = insC.rows[0].id;
      createdColor = true;
    } else {
      // Relink only — never mutate a shared fabric_color that other rolls use.
      colorId = colorRes.rows[0].id;
    }
  }

  let variantId: string | null = null;
  const w = widthCm != null && widthCm > 0 ? widthCm : null;
  const g = gsm != null && gsm > 0 ? gsm : null;

  if (colorId && w != null && g != null) {
    const vFind = await client.query<{ id: string }>(
      `SELECT id FROM fabric_item_variants
       WHERE company_id = $1 AND item_id = $2 AND color_id = $3
         AND width_cm IS NOT DISTINCT FROM $4::numeric
         AND gsm IS NOT DISTINCT FROM $5::numeric
       LIMIT 1`,
      [companyId, itemId, colorId, w, g],
    );

    if (vFind.rows.length) {
      variantId = vFind.rows[0].id;
    } else {
      const ic = designNr ?? materialCode;
      let vcode = buildVariantCode(ic, colorCodeVal || 'NA', w, g);
      const tryInsert = async (code: string) => {
        return client.query<{ id: string }>(
          `INSERT INTO fabric_item_variants (company_id, item_id, color_id, width_cm, gsm, variant_code)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [companyId, itemId, colorId, w, g, code],
        );
      };
      try {
        const insV = await tryInsert(vcode);
        variantId = insV.rows[0].id;
        createdVariant = true;
      } catch (e: unknown) {
        if ((e as { code?: string }).code === '23505') {
          vcode = `${vcode}-${itemId.slice(0, 8)}`;
          const insV2 = await tryInsert(vcode.slice(0, 120));
          variantId = insV2.rows[0].id;
          createdVariant = true;
        } else {
          throw e;
        }
      }
    }
  }

  return {
    itemId,
    colorId,
    variantId,
    articleCode: materialCode,
    fabricColorName: colorNameAr,
    colorCode: colorCodeVal,
    designNr,
    created: { item: createdItem, color: createdColor, variant: createdVariant },
  };
}

export async function resolveFabricClassification(
  input: ResolveClassificationInput,
): Promise<ResolveClassificationResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await resolveFabricClassificationWithClient(client, input);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
