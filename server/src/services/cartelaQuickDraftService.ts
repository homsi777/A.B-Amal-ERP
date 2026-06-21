import type { PoolClient } from 'pg';

type OrderLineCartelaHint = {
  referenceBarcode?: string | null;
  materialName?: string;
  dsamNumber?: string;
  rollNo?: string;
};

/** استخراج رقم تسلسلي الكارتيلا من مسح QR أو باركود */
export function resolveCartelaSerialFromScan(scan: string): string {
  const trimmed = scan.trim();
  if (!trimmed) return '';
  if (/^CLOTEX\|/i.test(trimmed)) {
    const parts = trimmed.split('|').map((p) => p.trim());
    return parts[3] ?? trimmed;
  }
  if (/^\d{4,10}$/.test(trimmed)) return trimmed;
  return trimmed;
}

/**
 * عند حفظ الطلبية: إنشاء مسودة كارتيلا لكل باركود مرجعي غير مسجّل.
 * يعمل داخل نفس معاملة حفظ الطلبية.
 */
export async function ensureCartelaDraftsFromOrderLines(
  client: PoolClient,
  companyId: string,
  userId: string,
  lines: OrderLineCartelaHint[],
): Promise<number> {
  const seen = new Set<string>();
  let created = 0;

  for (const line of lines) {
    const rawScan = (line.referenceBarcode ?? '').trim();
    if (!rawScan) continue;

    const serial = resolveCartelaSerialFromScan(rawScan);
    if (!serial || seen.has(serial)) continue;
    seen.add(serial);

    const existing = await client.query(
      `SELECT id FROM cartela_labels WHERE company_id = $1 AND serial_no = $2 LIMIT 1`,
      [companyId, serial],
    );
    if (existing.rows.length) continue;

    const designNo = (line.rollNo ?? '').trim();
    const artCode = (line.dsamNumber ?? '').trim() || (line.materialName ?? '').trim() || designNo;
    const title = (line.materialName ?? '').trim() || artCode || serial;

    await client.query(
      `INSERT INTO cartela_labels (
         company_id, title, art_code, design_no, colour,
         width_value, width_unit, width_tolerance_enabled, width_tolerance_percent,
         weight_value, weight_unit, weight_tolerance_enabled, weight_tolerance_percent,
         composition, composition_lines, care_symbols, serial_no, show_logo, font_size_pt,
         created_by_user_id, updated_by_user_id
       ) VALUES (
         $1,$2,$3,$4,'',
         '','cm',true,3,
         '','gr/m²',true,5,
         '', '[]'::jsonb, '[]'::jsonb, $5, true, 6.8,
         $6,$6
       )`,
      [companyId, title, artCode || title, designNo, serial, userId],
    );
    created += 1;
  }

  return created;
}
