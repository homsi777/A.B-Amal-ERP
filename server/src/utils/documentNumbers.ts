import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';

/** أرقام وثائق فريدة لكل شركة — بدون تسلسل DB معقد (MVP). */
export function generateDocumentNo(prefix: string): string {
  const t = Date.now().toString(36).toUpperCase();
  const s = randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${t}-${s}`;
}

type SequentialDocumentKind =
  | 'SALES_INVOICE'
  | 'PURCHASE_INVOICE'
  | 'CUSTOMER_ORDER'
  | 'RECEIPT_VOUCHER'
  | 'PAYMENT_VOUCHER'
  | 'ACCOUNT_STATEMENT';

const SEQUENTIAL_DOCUMENTS: Record<
  SequentialDocumentKind,
  { prefix: string; width: number; table: string; column: string; lockKey?: string; voucherType?: 'RECEIPT' | 'PAYMENT' }
> = {
  SALES_INVOICE: { prefix: 'FB', width: 7, table: 'sales_invoices', column: 'invoice_no' },
  PURCHASE_INVOICE: { prefix: 'FS', width: 7, table: 'purchase_invoices', column: 'invoice_no' },
  CUSTOMER_ORDER: { prefix: 'CO', width: 7, table: 'customer_orders', column: 'order_no' },
  RECEIPT_VOUCHER: { prefix: 'SQ', width: 6, table: 'vouchers', column: 'voucher_no', voucherType: 'RECEIPT' },
  PAYMENT_VOUCHER: { prefix: 'SD', width: 6, table: 'vouchers', column: 'voucher_no', voucherType: 'PAYMENT' },
  ACCOUNT_STATEMENT: { prefix: '', width: 10, table: 'journal_entries', column: 'entry_no', lockKey: 'ACCOUNT_STATEMENT' },
};

export async function generateSequentialDocumentNo(
  client: PoolClient,
  companyId: string,
  kind: SequentialDocumentKind,
): Promise<string> {
  const cfg = SEQUENTIAL_DOCUMENTS[kind];
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [companyId, cfg.lockKey ?? cfg.prefix]);

  const params: unknown[] = [companyId];
  let typeFilter = '';
  if (cfg.voucherType) {
    params.push(cfg.voucherType);
    typeFilter = ` AND voucher_type = $2`;
  }

  const result = await client.query<{ max_seq: string | null }>(
    `SELECT MAX((substring(${cfg.column} from ${cfg.prefix.length + 1}))::int)::text AS max_seq
     FROM ${cfg.table}
     WHERE company_id = $1
       ${typeFilter}
       AND ${cfg.column} ~ '^${cfg.prefix}[0-9]{${cfg.width}}$'`,
    params,
  );
  const next = Number(result.rows[0]?.max_seq ?? 0) + 1;
  return `${cfg.prefix}${String(next).padStart(cfg.width, '0')}`;
}
