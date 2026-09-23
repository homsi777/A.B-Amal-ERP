import type { Pool, PoolClient } from 'pg';

export type PlatformAuditAction = 'SWITCH_COMPANY' | 'CREATE_COMPANY' | 'CREATE_USER_IN_OTHER_COMPANY';

export type PlatformAuditEntry = {
  actorUserId: string;
  action: PlatformAuditAction;
  fromCompanyId?: string | null;
  toCompanyId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | null;
};

export async function logPlatformAction(db: Pool | PoolClient, entry: PlatformAuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO platform_audit_log
       (actor_user_id, action, from_company_id, to_company_id, ip, user_agent, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.actorUserId,
      entry.action,
      entry.fromCompanyId ?? null,
      entry.toCompanyId ?? null,
      entry.ip ?? null,
      entry.userAgent ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
    ],
  );
}
