import type { PoolClient } from 'pg';

/** عدد خانات باركود الكارتيلa التلقائي */
export const CARTELA_SERIAL_DIGITS = 4;

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
  return String(next).padStart(CARTELA_SERIAL_DIGITS, '0');
}

export function resolveCartelaSerialNo(manual: string, auto: string): string {
  const trimmed = manual.trim();
  return trimmed || auto;
}
