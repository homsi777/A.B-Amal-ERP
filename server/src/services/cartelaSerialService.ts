import type { PoolClient } from 'pg';

/** باركود كارتيلa تلقائي: 4 أرقام */
export const CARTELA_SERIAL_AUTO_DIGITS = 4;

/** باركود كارتيلa يدوي: حتى 10 أرقام */
export const CARTELA_SERIAL_MANUAL_MAX_LEN = 10;

/** رقم تسلسلي رقمي تلقائي (4 خانات: 0001، 0002…) — مستقل عن المخزون. */
export async function allocateCartelaSerialNo(client: PoolClient, companyId: string): Promise<string> {
  const row = await client.query<{ next: string }>(
    `SELECT COALESCE(MAX(
       CASE WHEN serial_no ~ '^[0-9]+$' THEN serial_no::bigint END
     ), 0) + 1 AS next
     FROM cartela_labels
     WHERE company_id = $1`,
    [companyId],
  );
  const next = Number(row.rows[0]?.next ?? 1);
  return String(next).padStart(CARTELA_SERIAL_AUTO_DIGITS, '0');
}

export function resolveCartelaSerialNo(manual: string, auto: string): string {
  const trimmed = manual.trim();
  return trimmed || auto;
}

/** التحقق من باركود يدوي — فارغ = توليد تلقائي لاحقاً */
export function validateManualCartelaSerialNo(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) {
    return 'باركود الكارتيلa يجب أن يكون أرقاماً فقط';
  }
  if (trimmed.length > CARTELA_SERIAL_MANUAL_MAX_LEN) {
    return `الباركود اليدوي بحد أقصى ${CARTELA_SERIAL_MANUAL_MAX_LEN} أرقام — التلقائي ${CARTELA_SERIAL_AUTO_DIGITS} أرقام`;
  }
  return null;
}
