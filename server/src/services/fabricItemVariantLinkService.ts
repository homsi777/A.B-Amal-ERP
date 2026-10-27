import type { PoolClient } from 'pg';

/**
 * يضمن وجود فاريانت حقيقي لربط (خامة + لون) — بدون أي تأثير على أتواب
 * المخزون غير ربط عمود variant_id. يُستخدَم عند إنشاء/ربط كارتيله بلون
 * موجود فعلياً على أتواب المستودع لكن بلا سجل بـfabric_item_variants.
 *
 * - إن وُجد فاريانت لنفس (item_id, color_id) مسبقاً، يُعاد كما هو.
 * - وإلا يُنشأ فاريانت جديد (width_cm/gsm مجهولان — NULL) بكود مُولَّد من
 *   كود الخامة + كود اللون، ثم تُربط به كل أتواب هذا اللون لهذه الخامة التي
 *   لم تكن مرتبطة بأي فاريانت (variant_id IS NULL) فقط — لا تُنشأ ولا تُحذف
 *   ولا تتغيّر كمية أي توب، فقط عمود الربط.
 */
export async function ensureFabricVariantForColor(
  client: PoolClient,
  companyId: string,
  itemId: string,
  colorId: string,
): Promise<{ id: string; variant_code: string }> {
  const existing = await client.query<{ id: string; variant_code: string }>(
    `SELECT id, variant_code FROM fabric_item_variants
      WHERE company_id = $1 AND item_id = $2 AND color_id = $3
      ORDER BY created_at ASC LIMIT 1`,
    [companyId, itemId, colorId],
  );
  if (existing.rows.length) return existing.rows[0];

  const info = await client.query<{ internal_code: string; color_code: string | null }>(
    `SELECT fi.internal_code, fc.color_code
       FROM fabric_items fi, fabric_colors fc
      WHERE fi.id = $1 AND fi.company_id = $2 AND fc.id = $3`,
    [itemId, companyId, colorId],
  );
  if (!info.rows.length) {
    throw Object.assign(new Error('الخامة أو اللون غير موجود'), { code: 'NOT_FOUND' });
  }
  const { internal_code: internalCode, color_code: colorCode } = info.rows[0];
  const base = `${internalCode}-${(colorCode || colorId.slice(0, 6)).toUpperCase()}`.trim();

  let variantCode = base;
  let variant: { id: string; variant_code: string } | null = null;
  for (let attempt = 0; attempt < 20 && !variant; attempt += 1) {
    if (attempt > 0) variantCode = `${base}-${attempt + 1}`;
    try {
      const inserted = await client.query<{ id: string; variant_code: string }>(
        `INSERT INTO fabric_item_variants (company_id, item_id, color_id, variant_code, width_cm, gsm)
         VALUES ($1,$2,$3,$4,NULL,NULL)
         RETURNING id, variant_code`,
        [companyId, itemId, colorId, variantCode],
      );
      variant = inserted.rows[0];
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err;
      // كود الفاريانت مستخدم مسبقاً — جرّب كوداً آخر
    }
  }
  if (!variant) {
    throw Object.assign(new Error('تعذّر توليد كود فاريانت فريد لهذا اللون'), { code: 'VALIDATION' });
  }

  await client.query(
    `UPDATE fabric_rolls
        SET variant_id = $1
      WHERE company_id = $2 AND item_id = $3 AND color_id = $4 AND variant_id IS NULL`,
    [variant.id, companyId, itemId, colorId],
  );

  return variant;
}
