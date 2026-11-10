import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';
import { ensureCompanyOpeningBalanceGlAccount, getGlAccountIdByKey, GL_KEYS } from './glCoaService.js';

type ServiceErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'DUPLICATE';

function fail(message: string, code: ServiceErrorCode): never {
  throw Object.assign(new Error(message), { code });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function stableUuid(seed: string): string {
  const hex = createHash('sha1').update(seed).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export type OpeningBalanceDirection = 'DEBIT' | 'CREDIT';

export type PostCustomerOpeningBalanceInput = {
  companyId: string;
  userId: string | null;
  customerId: string;
  amount: number;
  direction: OpeningBalanceDirection;
  asOfDate: string;
  description?: string | null;
};

export type PostCustomerOpeningBalanceResult = {
  journalEntryId: string;
  entryNo: string;
};

/** يُرحِّل قيداً محاسبياً حقيقياً واحداً لضبط رصيد بداية عميل (مدين أو دائن) —
 * بديل آمن عن إعادة إنشاء فواتير/سندات تاريخية مزيَّفة. يُقرأ فوراً ضمن
 * partyStatementService (journal_lines بـ source_type='OPENING'). */
export async function postCustomerOpeningBalance(
  client: PoolClient,
  input: PostCustomerOpeningBalanceInput,
): Promise<PostCustomerOpeningBalanceResult> {
  const amount = round2(input.amount);
  if (!(amount > 0)) fail('المبلغ يجب أن يكون أكبر من صفر', 'VALIDATION');
  if (input.direction !== 'DEBIT' && input.direction !== 'CREDIT') fail('اتجاه غير صالح', 'VALIDATION');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate)) fail('تاريخ غير صالح', 'VALIDATION');

  const customerRow = await client.query(`SELECT id, name FROM customers WHERE id = $1 AND company_id = $2`, [
    input.customerId,
    input.companyId,
  ]);
  if (!customerRow.rows.length) fail('العميل غير موجود', 'NOT_FOUND');
  const customerName: string = customerRow.rows[0].name;

  const sourceSeed = `${input.customerId}:OPENING_BALANCE_MANUAL:${input.asOfDate}:${amount}:${input.direction}`;
  const sourceId = stableUuid(sourceSeed);

  const exists = await client.query(
    `SELECT id FROM journal_entries WHERE company_id=$1 AND source_type='OPENING' AND source_id=$2::uuid LIMIT 1`,
    [input.companyId, sourceId],
  );
  if (exists.rows.length) fail('تم ترحيل هذا الرصيد الافتتاحي مسبقاً بنفس القيم', 'DUPLICATE');

  await ensureCompanyOpeningBalanceGlAccount(client, input.companyId);
  const arId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.AR);
  const equityId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.OPENING_BALANCE_EQUITY);
  const entryNo = await generateSequentialDocumentNo(client, input.companyId, 'ACCOUNT_STATEMENT');

  const description = input.description?.trim() || `رصيد افتتاحي للعميل ${customerName}`;
  const arDebit = input.direction === 'DEBIT' ? amount : 0;
  const arCredit = input.direction === 'CREDIT' ? amount : 0;
  const equityDebit = input.direction === 'CREDIT' ? amount : 0;
  const equityCredit = input.direction === 'DEBIT' ? amount : 0;

  const ins = await client.query(
    `INSERT INTO journal_entries (company_id, entry_no, entry_date, description, source_type, source_id, status, created_by_user_id)
     VALUES ($1,$2,$3::date,$4,'OPENING',$5::uuid,'POSTED',$6)
     RETURNING id`,
    [input.companyId, entryNo, input.asOfDate, description, sourceId, input.userId],
  );
  const entryId = ins.rows[0].id;

  await client.query(
    `INSERT INTO journal_lines (company_id, entry_id, line_no, gl_account_id, party_type, party_id, description, debit, credit, currency_code)
     VALUES ($1,$2,1,$3,'CUSTOMER',$4,$5,$6,$7,'USD')`,
    [input.companyId, entryId, arId, input.customerId, description, arDebit, arCredit],
  );
  await client.query(
    `INSERT INTO journal_lines (company_id, entry_id, line_no, gl_account_id, description, debit, credit, currency_code)
     VALUES ($1,$2,2,$3,$4,$5,$6,'USD')`,
    [input.companyId, entryId, equityId, description, equityDebit, equityCredit],
  );

  return { journalEntryId: entryId, entryNo };
}
