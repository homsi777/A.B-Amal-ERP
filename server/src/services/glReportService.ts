/**
 * GL-based financial statements: chart balances from journal_lines, journal from posted entries.
 */
import { getPool } from '../db/pool.js';
import { ensureCompanyGlCoa } from './glCoaService.js';

export type CoaAccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface ChartAccountRow {
  id: string;
  code: string;
  parentId: string | null;
  name: string;
  type: CoaAccountType;
  balance: number;
  currency_code: string | null;
  source_note: string | null;
  isPosting: boolean;
}

export interface JournalLineRow {
  entry_id: string;
  line_no: number;
  voucher_id: string | null;
  date: string;
  reference: string;
  account_id: string;
  account_name: string;
  party_name: string | null;
  description: string | null;
  debit: number;
  credit: number;
  currency_code: string;
  source_type: string | null;
}

function mapType(t: string): CoaAccountType {
  const x = t.toLowerCase();
  if (x === 'asset') return 'asset';
  if (x === 'liability') return 'liability';
  if (x === 'equity') return 'equity';
  if (x === 'revenue') return 'revenue';
  return 'expense';
}

function rollupBalances(rows: ChartAccountRow[]): ChartAccountRow[] {
  const depth = (id: string): number => {
    const row = rows.find((r) => r.id === id);
    if (!row?.parentId) return 0;
    return 1 + depth(row.parentId);
  };

  const sorted = [...rows].sort((a, b) => depth(b.id) - depth(a.id));
  const mutable = new Map(rows.map((r) => [r.id, { ...r }]));

  for (const r of sorted) {
    if (!r.parentId) continue;
    const p = mutable.get(r.parentId);
    const c = mutable.get(r.id);
    if (p && c) {
      p.balance += c.balance;
    }
  }

  return rows.map((r) => mutable.get(r.id)!);
}

export async function getGlChartOfAccounts(companyId: string): Promise<ChartAccountRow[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureCompanyGlCoa(client, companyId);
    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }

  const bal = await pool.query<{ id: string; d: string; c: string }>(
    `SELECT jl.gl_account_id AS id,
            COALESCE(SUM(jl.debit),0)::text AS d,
            COALESCE(SUM(jl.credit),0)::text AS c
     FROM journal_lines jl
     WHERE jl.company_id = $1
     GROUP BY jl.gl_account_id`,
    [companyId],
  );
  const balMap = new Map(bal.rows.map((r) => [r.id, Number(r.d) - Number(r.c)]));

  const acc = await pool.query<{
    id: string;
    code: string;
    name: string;
    parent_id: string | null;
    account_type: string;
    is_posting: boolean;
  }>(
    `SELECT id, code, name, parent_id, account_type, is_posting
     FROM gl_accounts WHERE company_id = $1 ORDER BY sort_order, code`,
    [companyId],
  );

  const rows: ChartAccountRow[] = acc.rows.map((r) => ({
    id: r.id,
    code: r.code,
    parentId: r.parent_id,
    name: r.name,
    type: mapType(r.account_type),
    balance: balMap.get(r.id) ?? 0,
    currency_code: null,
    source_note: !r.is_posting ? 'حساب تجميعي' : null,
    isPosting: r.is_posting,
  }));

  return rollupBalances(rows);
}

export async function getGlJournalLines(
  companyId: string,
  q: { dateFrom?: string; dateTo?: string; search?: string; limit?: number },
): Promise<JournalLineRow[]> {
  const pool = getPool();
  const limit = Math.min(2000, Math.max(50, q.limit ?? 800));

  const params: unknown[] = [companyId];
  let p = 2;
  let filt = '';
  if (q.dateFrom) {
    filt += ` AND je.entry_date >= $${p}::date`;
    params.push(q.dateFrom);
    p++;
  }
  if (q.dateTo) {
    filt += ` AND je.entry_date <= $${p}::date`;
    params.push(q.dateTo);
    p++;
  }
  if (q.search?.trim()) {
    filt += ` AND (je.entry_no ILIKE $${p} OR je.description ILIKE $${p} OR jl.description ILIKE $${p} OR ga.code ILIKE $${p} OR ga.name ILIKE $${p})`;
    params.push(`%${q.search.trim()}%`);
    p++;
  }

  const data = await pool.query(
    `SELECT je.entry_no,
            je.entry_date::text AS jd,
            je.source_type,
            je.source_id,
            jl.line_no,
            ga.code AS account_code,
            ga.name AS account_name,
            jl.description AS line_desc,
            jl.debit::text AS debit,
            jl.credit::text AS credit,
            jl.currency_code,
            jl.party_type,
            jl.party_id,
            COALESCE(
              CASE WHEN jl.party_type = 'CUSTOMER' THEN (
                SELECT c.name FROM customers c WHERE c.id = jl.party_id AND c.company_id = jl.company_id LIMIT 1
              ) END,
              CASE WHEN jl.party_type = 'SUPPLIER' THEN (
                SELECT s.name FROM suppliers s WHERE s.id = jl.party_id AND s.company_id = jl.company_id LIMIT 1
              ) END
            ) AS party_name
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
     JOIN gl_accounts ga ON ga.id = jl.gl_account_id
     WHERE jl.company_id = $1 AND je.status = 'POSTED' ${filt}
     ORDER BY je.entry_date DESC, je.entry_no DESC, jl.line_no ASC
     LIMIT ${limit}`,
    params,
  );

  return data.rows.map((r) => ({
    entry_id: String(r.entry_no),
    line_no: Number(r.line_no),
    voucher_id: r.source_type === 'VOUCHER' && r.source_id ? String(r.source_id) : null,
    date: String(r.jd).slice(0, 10),
    reference: String(r.entry_no),
    account_id: String(r.account_code),
    account_name: String(r.account_name),
    party_name: r.party_name ? String(r.party_name) : null,
    description: r.line_desc ? String(r.line_desc) : null,
    debit: Number(r.debit),
    credit: Number(r.credit),
    currency_code: String(r.currency_code || 'USD'),
    source_type: r.source_type ? String(r.source_type) : null,
  }));
}
