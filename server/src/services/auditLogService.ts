import type { Pool, PoolClient } from 'pg';

export async function insertAuditLog(
  client: Pool | PoolClient,
  input: {
    companyId: string;
    userId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [input.companyId, input.userId, input.action, input.entityType, input.entityId, JSON.stringify(input.details ?? {})],
  );
}
