import type { PoolClient } from 'pg';

/** باركود كارتيلa تلقائي: 4 أرقام (0001–9999) */
export const CARTELA_SERIAL_AUTO_DIGITS = 4;

export const CARTELA_SERIAL_AUTO_MAX = 9999;

/** باركود كارتيلa يدوي: حتى 10 أرقام */
export const CARTELA_SERIAL_MANUAL_MAX_LEN = 10;

export function formatAutoCartelaSerial(value: number): string {
  return String(value).padStart(CARTELA_SERIAL_AUTO_DIGITS, '0');
}

/** هل الرقم ضمن نطاق التوليد التلقائي (1–4 خانات)؟ */
export function isAutoRangeCartelaSerial(serial: string): boolean {
  return /^\d{1,4}$/.test(serial.trim());
}

/**
 * رقم تسلسلي تلقائي (0001، 0002…).
 * يعتمد فقط على أرقام 1–4 خانات — لا يتأثر بالباركود اليدوي الطويل (مثل 2005234).
 */
export async function allocateCartelaSerialNo(client: PoolClient, companyId: string): Promise<string> {
  const row = await client.query<{ next: string }>(
    `SELECT COALESCE(MAX(
       CASE WHEN serial_no ~ '^\\d{1,4}$' THEN serial_no::bigint END
     ), 0) + 1 AS next
     FROM cartela_labels
     WHERE company_id = $1`,
    [companyId],
  );

  let next = Number(row.rows[0]?.next ?? 1);
  if (!Number.isFinite(next) || next < 1) next = 1;

  for (let attempt = 0; attempt <= CARTELA_SERIAL_AUTO_MAX; attempt += 1) {
    if (next > CARTELA_SERIAL_AUTO_MAX) {
      throw Object.assign(new Error('نفدت أرقام الكارتيلa التلقائية (0001–9999)'), {
        code: 'CARTELA_AUTO_SERIAL_FULL',
      });
    }

    const padded = formatAutoCartelaSerial(next);
    const plain = String(next);
    const taken = await client.query(
      `SELECT 1 FROM cartela_labels
        WHERE company_id = $1
          AND serial_no IN ($2, $3)
        LIMIT 1`,
      [companyId, padded, plain],
    );
    if (!taken.rows.length) return padded;
    next += 1;
  }

  throw Object.assign(new Error('تعذر تخصيص رقم كارتيلa تلقائي'), { code: 'CARTELA_AUTO_SERIAL_FULL' });
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
