import type { Pool, PoolClient } from 'pg';

export type PartyType = 'CUSTOMER' | 'SUPPLIER';

type DbConn = Pick<Pool, 'query'> | PoolClient;

export async function insertPartyActivityLog(
  db: DbConn,
  input: {
    companyId: string;
    partyType: PartyType;
    partyId: string | null;
    partyName: string;
    activityType: string;
    description: string;
    userId: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    referenceNo?: string | null;
    amount?: number | null;
    currencyCode?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO party_activity_logs (
       company_id, party_type, party_id, party_name, activity_type,
       reference_type, reference_id, reference_no, amount, currency_code,
       description, created_by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      input.companyId,
      input.partyType,
      input.partyId,
      input.partyName,
      input.activityType,
      input.referenceType ?? null,
      input.referenceId ?? null,
      input.referenceNo ?? null,
      input.amount ?? null,
      input.currencyCode ?? null,
      input.description,
      input.userId,
    ],
  );
}
