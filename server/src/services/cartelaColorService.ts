import type { PoolClient } from 'pg';

const COLOR_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,19}$/;
const BARCODE_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,47}$/;

export function normalizeColorCode(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/_+/g, '-');
}

export function buildColorBarcodeCode(serialNo: string, colorCode: string): string {
  const serial = String(serialNo ?? '').trim();
  const color = normalizeColorCode(colorCode);
  if (!serial) throw Object.assign(new Error('الكارتيلا تحتاج رقم تسلسلي قبل إضافة ألوان'), { code: 'VALIDATION' });
  if (!color || !COLOR_CODE_RE.test(color)) {
    throw Object.assign(new Error('كود اللون غير صالح — استخدم حروفاً وأرقاماً مثل C-01'), { code: 'VALIDATION' });
  }
  const barcode = `${serial}-${color}`;
  if (!BARCODE_CODE_RE.test(barcode)) {
    throw Object.assign(new Error('الباركود الناتج طويل أو غير صالح لـ Code128'), { code: 'VALIDATION' });
  }
  return barcode;
}

export function validateColorCode(raw: string): string | null {
  const normalized = normalizeColorCode(raw);
  if (!normalized) return 'كود اللون مطلوب';
  if (!COLOR_CODE_RE.test(normalized)) return 'كود اللون غير صالح — مثال: C-01';
  return null;
}

export async function allocateNextColorNo(client: PoolClient, cartelaLabelId: string): Promise<number> {
  const row = await client.query<{ next_no: string }>(
    `SELECT COALESCE(MAX(color_no), 0) + 1 AS next_no
       FROM cartela_label_colors
      WHERE cartela_label_id = $1`,
    [cartelaLabelId],
  );
  return Number(row.rows[0]?.next_no ?? 1);
}

export async function syncColorBarcodesForCartela(
  client: PoolClient,
  companyId: string,
  cartelaLabelId: string,
  serialNo: string,
): Promise<void> {
  const colors = await client.query<{ id: string; color_code: string }>(
    `SELECT id, color_code FROM cartela_label_colors
      WHERE cartela_label_id = $1 AND company_id = $2`,
    [cartelaLabelId, companyId],
  );
  for (const color of colors.rows) {
    const barcodeCode = buildColorBarcodeCode(serialNo, color.color_code);
    await client.query(
      `UPDATE cartela_label_colors
          SET barcode_code = $4, updated_at = now()
        WHERE id = $1 AND company_id = $2 AND cartela_label_id = $3`,
      [color.id, companyId, cartelaLabelId, barcodeCode],
    );
  }
}

export function mapCartelaColorRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    cartela_label_id: row.cartela_label_id,
    color_no: row.color_no,
    color_code: row.color_code,
    barcode_code: row.barcode_code,
    name_ar: row.name_ar,
    name_tr: row.name_tr,
    notes: row.notes,
    image_url: row.image_url,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Normalize scanner / manual input for cartela + color barcode lookup. */
export function normalizeCartelaScanInput(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/\s+/g, '');
}

type CartelaColorLookupRow = {
  cartela: Record<string, unknown>;
  color: Record<string, unknown>;
};

export async function lookupCartelaColorByScan(
  db: { query: PoolClient['query'] },
  companyId: string,
  rawScan: string,
): Promise<CartelaColorLookupRow | null> {
  const scan = normalizeCartelaScanInput(rawScan);
  if (!scan) return null;

  const fetchHit = async (sql: string, params: unknown[]) => {
    const res = await db.query<{ cartela: Record<string, unknown>; color: Record<string, unknown> }>(sql, params);
    return res.rows[0] ?? null;
  };

  const baseSql = `SELECT to_jsonb(cl.*) AS cartela, to_jsonb(c.*) AS color
     FROM cartela_label_colors c
     JOIN cartela_labels cl ON cl.id = c.cartela_label_id AND cl.company_id = c.company_id
    WHERE c.company_id = $1`;

  let hit = await fetchHit(`${baseSql} AND upper(c.barcode_code) = $2 LIMIT 1`, [companyId, scan]);
  if (hit) return hit;

  hit = await fetchHit(
    `${baseSql} AND upper(replace(c.barcode_code, ' ', '')) = $2 LIMIT 1`,
    [companyId, scan],
  );
  if (hit) return hit;

  hit = await fetchHit(
    `${baseSql} AND upper(trim(cl.serial_no) || '-' || trim(c.color_code)) = $2 LIMIT 1`,
    [companyId, scan],
  );
  if (hit) {
    const color = hit.color as { id: string; color_code: string };
    const cartela = hit.cartela as { serial_no: string };
    const serial = String(cartela.serial_no ?? '').trim();
    if (serial && color.color_code) {
      try {
        const expected = buildColorBarcodeCode(serial, color.color_code);
        if (expected !== String((hit.color as { barcode_code?: string }).barcode_code ?? '')) {
          await db.query(
            `UPDATE cartela_label_colors SET barcode_code = $3, updated_at = now() WHERE id = $1 AND company_id = $2`,
            [color.id, companyId, expected],
          );
          (hit.color as { barcode_code: string }).barcode_code = expected;
        }
      } catch {
        // keep hit
      }
    }
    return hit;
  }

  const dashIdx = scan.indexOf('-');
  if (dashIdx > 0) {
    const serial = scan.slice(0, dashIdx);
    const colorPart = scan.slice(dashIdx + 1);
    hit = await fetchHit(
      `${baseSql} AND trim(cl.serial_no) = $2 AND upper(trim(c.color_code)) = $3 LIMIT 1`,
      [companyId, serial, colorPart],
    );
    if (hit) return hit;
  }

  const byColorOnly = await db.query<{ cartela: Record<string, unknown>; color: Record<string, unknown> }>(
    `${baseSql} AND upper(trim(c.color_code)) = $2 ORDER BY c.updated_at DESC LIMIT 2`,
    [companyId, scan],
  );
  if (byColorOnly.rows.length === 1) return byColorOnly.rows[0];

  hit = await fetchHit(
    `${baseSql} AND upper(c.barcode_code) LIKE '%' || $2 LIMIT 1`,
    [companyId, `-${scan}`],
  );
  return hit;
}
