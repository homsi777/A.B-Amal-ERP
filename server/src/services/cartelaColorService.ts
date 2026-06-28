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
