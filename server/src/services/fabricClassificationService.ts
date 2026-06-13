/**
 * Maps the 4-level fabric_categories tree (material name → material code → colour name → colour code)
 * into fabric_items + fabric_colors (+ optional fabric_item_variants) for roll creation.
 */

import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';

export type ResolveClassificationInput = {
  companyId: string;
  level1CategoryId: string;
  level2CategoryId: string;
  level3CategoryId: string;
  level4CategoryId: string;
  widthCm?: number | null;
  gsm?: number | null;
};

export type ResolveClassificationResult = {
  itemId: string;
  colorId: string;
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

async function loadCategoryQuadruplet(
  client: PoolClient,
  companyId: string,
  l1: string,
  l2: string,
  l3: string,
  l4: string,
): Promise<{ c1: CatRow; c2: CatRow; c3: CatRow; c4: CatRow }> {
  const r = await client.query<CatRow>(
    `SELECT id, parent_id, code, name FROM fabric_categories
     WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, [l1, l2, l3, l4]],
  );
  if (r.rows.length !== 4) {
    throw Object.assign(new Error('أحد تصنيفات الأقمشة غير موجود أو لا يتبع شركتك'), { statusCode: 404 });
  }
  const map = new Map(r.rows.map((x) => [x.id, x]));
  const c1 = map.get(l1)!;
  const c2 = map.get(l2)!;
  const c3 = map.get(l3)!;
  const c4 = map.get(l4)!;
  if (c1.parent_id !== null) {
    throw Object.assign(new Error('اسم الخامة يجب أن يكون المستوى الجذري للشجرة'), { statusCode: 400 });
  }
  if (c2.parent_id !== c1.id) {
    throw Object.assign(new Error('كود الخامة المختار لا يتبع اسم الخامة المحدد'), { statusCode: 400 });
  }
  if (c3.parent_id !== c2.id) {
    throw Object.assign(new Error('لون الخامة المختار لا يتبع كود الخامة المحدد'), { statusCode: 400 });
  }
  if (c4.parent_id !== c3.id) {
    throw Object.assign(new Error('كود اللون المختار لا يتبع لون الخامة المحدد'), { statusCode: 400 });
  }
  return { c1, c2, c3, c4 };
}

function buildVariantCode(internalCode: string, colorCode: string, widthCm: number, gsm: number): string {
  const raw = `${internalCode}-${colorCode}-${widthCm}-${gsm}`.replace(/\s+/g, '_');
  return raw.length > 120 ? raw.slice(0, 120) : raw;
}

export async function resolveFabricClassification(
  input: ResolveClassificationInput,
): Promise<ResolveClassificationResult> {
  const { companyId, level1CategoryId, level2CategoryId, level3CategoryId, level4CategoryId, widthCm, gsm } = input;
  const pool = getPool();
  const client = await pool.connect();
  let createdItem = false;
  let createdColor = false;
  let createdVariant = false;

  try {
    await client.query('BEGIN');

    const { c1, c2, c3, c4 } = await loadCategoryQuadruplet(
      client,
      companyId,
      level1CategoryId,
      level2CategoryId,
      level3CategoryId,
      level4CategoryId,
    );

    const materialCode = c2.code.trim() || c2.name.trim();
    const colorCodeVal = c4.code.trim() || c4.name.trim();

    // ── fabric_item linked to level-1 material-name category ───────────────
    let itemRow = await client.query<{ id: string; internal_code: string }>(
      `SELECT id, internal_code FROM fabric_items
       WHERE company_id = $1
         AND trim(lower(internal_code)) = trim(lower($2::text))
       ORDER BY created_at ASC LIMIT 1`,
      [companyId, materialCode],
    );

    let itemId: string;
    let designNr: string | null;

    if (!itemRow.rows.length) {
      const ins = await client.query<{ id: string; internal_code: string }>(
        `INSERT INTO fabric_items
           (company_id, category_id, internal_code, supplier_code, name, fabric_type, unit, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (company_id, internal_code) DO UPDATE
           SET category_id = COALESCE(fabric_items.category_id, EXCLUDED.category_id),
               name = COALESCE(NULLIF(fabric_items.name, ''), EXCLUDED.name),
               updated_at = now()
         RETURNING id, internal_code`,
        [
          companyId,
          c1.id,
          materialCode,
          '',
          c1.name.trim(),
          '',
          'meter',
          'أُنشئ تلقائياً من تصنيف الأقمشة عند إنشاء ثوب يدوي',
        ],
      );
      itemId = ins.rows[0].id;
      designNr = ins.rows[0].internal_code;
      createdItem = true;
    } else {
      itemId = itemRow.rows[0].id;
      designNr = itemRow.rows[0].internal_code;
    }

    const colorNameAr = c3.name.trim();

    // ── fabric_color (company-scoped) ─────────────────────────────────────
    let colorRes = await client.query<{ id: string }>(
      `SELECT id FROM fabric_colors
       WHERE company_id = $1
         AND trim(lower(color_code)) = trim(lower($2::text))
         AND trim(lower(coalesce(name_ar, ''))) = trim(lower($3::text))
       LIMIT 1`,
      [companyId, colorCodeVal, colorNameAr],
    );

    let colorId: string;

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
      colorId = colorRes.rows[0].id;
    }

    // ── optional variant (width + GSM) ─────────────────────────────────────
    let variantId: string | null = null;
    const w = widthCm != null && widthCm > 0 ? widthCm : null;
    const g = gsm != null && gsm > 0 ? gsm : null;

    if (w != null && g != null) {
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
        const ic = designNr ?? c2.code.trim();
        let vcode = buildVariantCode(ic, colorCodeVal, w, g);
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

    await client.query('COMMIT');

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
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
