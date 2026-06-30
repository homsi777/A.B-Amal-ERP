import type { Pool, PoolClient } from 'pg';

type DbQuery = Pool | Pick<PoolClient, 'query'>;

/**
 * calculated_weight_kg = length_m * (width_cm / 100) * gsm / 1000
 * e.g. 100m * 1.5m * 150 g/m² / 1000 = 22.5 kg
 */
export function calcWeight(
  lengthM: number | null | undefined,
  widthCm: number | null | undefined,
  gsm: number | null | undefined,
): number | null {
  if (
    lengthM != null && lengthM >= 0 &&
    widthCm != null && widthCm > 0 &&
    gsm != null && gsm > 0
  ) {
    return parseFloat((lengthM * (widthCm / 100) * (gsm / 1000)).toFixed(3));
  }
  return null;
}

/**
 * Generate a unique barcode per company.
 * Format: 7 numeric digits, matching printed sticker and invoice scan policy.
 */
export async function generateBarcode(db: DbQuery, companyId: string): Promise<string> {
  const maxExisting = await db.query<{ max_barcode: string | null }>(
    `SELECT MAX(barcode)::text AS max_barcode
       FROM fabric_rolls
      WHERE company_id=$1
        AND barcode ~ '^[0-9]{7}$'`,
    [companyId],
  );
  const current = Number(maxExisting.rows[0]?.max_barcode ?? 999999);
  for (let offset = 1; offset <= 100; offset++) {
    const next = current + offset;
    if (next > 9999999) break;
    const barcode = String(next).padStart(7, '0');
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM fabric_rolls WHERE company_id=$1 AND barcode=$2',
      [companyId, barcode],
    );
    if (rows.length === 0) return barcode;
  }

  for (let attempt = 0; attempt < 100; attempt++) {
    const barcode = String(Math.floor(1000000 + Math.random() * 9000000));
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM fabric_rolls WHERE company_id=$1 AND barcode=$2',
      [companyId, barcode],
    );
    if (rows.length === 0) return barcode;
  }

  throw new Error('Unable to generate a unique 7-digit barcode');
}

const VOID_BARCODE_MARKER = '~VOID~';

/** True when an existing roll may be replaced/re-imported under the same barcode. */
export function isReusableInactiveRoll(
  status: string,
  lengthM: number | string | null | undefined,
): boolean {
  if (status !== 'INACTIVE') return false;
  const len = typeof lengthM === 'string' ? parseFloat(lengthM) : Number(lengthM ?? 0);
  return !Number.isFinite(len) || len <= 1e-6;
}

/** Archive barcode on voided/inactive roll so the original sticker barcode can be reused. */
export async function archiveFabricRollBarcode(
  db: DbQuery,
  companyId: string,
  rollId: string,
  currentBarcode: string,
): Promise<string> {
  const trimmed = currentBarcode.trim();
  if (!trimmed || trimmed.includes(VOID_BARCODE_MARKER)) return trimmed;

  const suffix = rollId.replace(/-/g, '').slice(0, 8);
  let candidate = `${trimmed}${VOID_BARCODE_MARKER}${suffix}`;
  let n = 0;
  for (;;) {
    const dup = await db.query<{ id: string }>(
      'SELECT id FROM fabric_rolls WHERE company_id=$1 AND barcode=$2 AND id<>$3 LIMIT 1',
      [companyId, candidate, rollId],
    );
    if (!dup.rows.length) break;
    n += 1;
    candidate = `${trimmed}${VOID_BARCODE_MARKER}${suffix}~${n}`;
  }

  await db.query(
    'UPDATE fabric_rolls SET barcode=$3, updated_at=now() WHERE id=$1 AND company_id=$2',
    [rollId, companyId, candidate],
  );
  return candidate;
}

export type RollStatus =
  | 'AVAILABLE'
  | 'RESERVED'
  | 'SOLD'
  | 'DAMAGED'
  | 'TRANSFERRED'
  | 'INACTIVE';

export const VALID_STATUSES: RollStatus[] = [
  'AVAILABLE', 'RESERVED', 'SOLD', 'DAMAGED', 'TRANSFERRED', 'INACTIVE',
];

/** Returns an Arabic error message if the status transition is obviously illegal. */
export function validateStatusTransition(
  from: RollStatus,
  to: RollStatus,
): string | null {
  if (from === 'SOLD' && to === 'AVAILABLE') {
    return 'لا يمكن تحويل ثوب مباع إلى متاح مباشرة. يجب إنشاء إذن إرجاع أولاً.';
  }
  if (from === 'DAMAGED' && to === 'SOLD') {
    return 'لا يمكن بيع ثوب تالف.';
  }
  return null;
}
