import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';
import { ensureCompanyInvoiceGlAccounts, getGlAccountIdByKey, GL_KEYS } from './glCoaService.js';
import { postCustomerDiscountToGl, reverseCustomerDiscountGl } from './glPostingService.js';
import { insertPartyActivityLog } from './partyActivityLogService.js';
import { getCustomerStatement } from './partyStatementService.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeUsd(amountOriginal: number, exchangeRateToUsd: number): number {
  if (!Number.isFinite(amountOriginal) || !Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) return 0;
  return round2(amountOriginal / exchangeRateToUsd);
}

const createBody = z.object({
  discountDate: z.string().min(1, 'التاريخ مطلوب'),
  amount: z.coerce.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  currencyCode: z.string().min(1).default('USD'),
  exchangeRateToUsd: z.coerce.number().positive().default(1),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const cancelBody = z.object({
  reason: z.string().min(1, 'سبب الإلغاء مطلوب'),
});

export type CustomerDiscountRow = {
  id: string;
  discount_no: string;
  discount_date: string;
  customer_id: string;
  amount: string;
  currency_code: string;
  exchange_rate_to_usd: string;
  amount_usd: string;
  description: string | null;
  notes: string | null;
  status: string;
  journal_entry_id: string | null;
  created_at: string;
  customer_name?: string;
};

async function loadCustomer(client: PoolClient, companyId: string, customerId: string) {
  const row = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM customers WHERE id=$1 AND company_id=$2 AND is_active=true`,
    [customerId, companyId],
  );
  if (!row.rows.length) {
    throw Object.assign(new Error('العميل غير موجود أو غير نشط'), { code: 'NOT_FOUND' });
  }
  return row.rows[0];
}

export async function createCustomerDiscount(
  companyId: string,
  customerId: string,
  userId: string | null,
  raw: unknown,
): Promise<CustomerDiscountRow> {
  const parsed = createBody.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error(parsed.error.issues[0]?.message ?? 'بيانات غير صالحة'), { code: 'VALIDATION' });
  }
  const d = parsed.data;
  const currencyCode = String(d.currencyCode || 'USD').trim().toUpperCase();
  const exchangeRateToUsd = currencyCode === 'USD' ? 1 : d.exchangeRateToUsd;
  const amount = round2(d.amount);
  const amountUsd = currencyCode === 'USD' ? amount : computeUsd(amount, exchangeRateToUsd);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const customer = await loadCustomer(client, companyId, customerId);

    const statement = await getCustomerStatement(companyId, customerId, {});
    const closingBalance = Number(statement.totals.closingBalance ?? 0);
    if (amountUsd > closingBalance + 1e-4) {
      throw Object.assign(
        new Error(
          `مبلغ الحسم (${amountUsd.toFixed(2)} USD) أكبر من رصيد العميل الحالي (${closingBalance.toFixed(2)} USD).`,
        ),
        { code: 'VALIDATION' },
      );
    }

    const discountNo = await generateSequentialDocumentNo(client, companyId, 'CUSTOMER_DISCOUNT');
    const discountDate = d.discountDate.slice(0, 10);
    const description =
      d.description?.trim() ||
      `حسم منحة للعميل ${customer.name}`;

    const ins = await client.query<CustomerDiscountRow>(
      `INSERT INTO customer_discounts (
         company_id, discount_no, discount_date, customer_id,
         amount, currency_code, exchange_rate_to_usd, amount_usd,
         description, notes, status, created_by_user_id
       ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,'CONFIRMED',$11)
       RETURNING id, discount_no, discount_date, customer_id, amount, currency_code,
                 exchange_rate_to_usd, amount_usd, description, notes, status, journal_entry_id, created_at`,
      [
        companyId,
        discountNo,
        discountDate,
        customerId,
        amount,
        currencyCode,
        exchangeRateToUsd,
        amountUsd,
        description,
        d.notes?.trim() || null,
        userId,
      ],
    );
    const discount = ins.rows[0];

    const journalEntryId = await postCustomerDiscountToGl(client, {
      companyId,
      discountId: discount.id,
      discountNo,
      discountDate,
      customerId,
      customerName: customer.name,
      amountUsd,
      currencyCode,
      description,
      userId,
    });

    await client.query(
      `UPDATE customer_discounts SET journal_entry_id=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
      [discount.id, companyId, journalEntryId],
    );

    await insertPartyActivityLog(client, {
      companyId,
      partyType: 'CUSTOMER',
      partyId: customerId,
      partyName: customer.name,
      activityType: 'CUSTOMER_DISCOUNT',
      description: `حسم عميل ${discountNo} — ${description}`,
      userId,
      referenceType: 'CUSTOMER_DISCOUNT',
      referenceId: discount.id,
      referenceNo: discountNo,
      amount,
      currencyCode,
    });

    await client.query('COMMIT');
    return { ...discount, journal_entry_id: journalEntryId, customer_name: customer.name };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelCustomerDiscount(
  companyId: string,
  discountId: string,
  userId: string | null,
  raw: unknown,
): Promise<CustomerDiscountRow> {
  const parsed = cancelBody.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error(parsed.error.issues[0]?.message ?? 'بيانات غير صالحة'), { code: 'VALIDATION' });
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<CustomerDiscountRow & { customer_name: string }>(
      `SELECT cd.*, c.name AS customer_name
       FROM customer_discounts cd
       JOIN customers c ON c.id = cd.customer_id AND c.company_id = cd.company_id
       WHERE cd.id=$1 AND cd.company_id=$2
       FOR UPDATE OF cd`,
      [discountId, companyId],
    );
    const discount = cur.rows[0];
    if (!discount) {
      throw Object.assign(new Error('سند الحسم غير موجود'), { code: 'NOT_FOUND' });
    }
    if (discount.status === 'CANCELLED') {
      throw Object.assign(new Error('سند الحسم ملغى مسبقاً'), { code: 'INVALID_STATE' });
    }

    await reverseCustomerDiscountGl(client, {
      companyId,
      discountId: discount.id,
      discountNo: discount.discount_no,
      userId,
    });

    await client.query(
      `UPDATE customer_discounts
       SET status='CANCELLED', cancelled_at=now(), cancellation_reason=$3, updated_at=now()
       WHERE id=$1 AND company_id=$2`,
      [discountId, companyId, parsed.data.reason.trim()],
    );

    await insertPartyActivityLog(client, {
      companyId,
      partyType: 'CUSTOMER',
      partyId: discount.customer_id,
      partyName: discount.customer_name,
      activityType: 'CUSTOMER_DISCOUNT_CANCEL',
      description: `إلغاء حسم عميل ${discount.discount_no} — ${parsed.data.reason.trim()}`,
      userId,
      referenceType: 'CUSTOMER_DISCOUNT',
      referenceId: discount.id,
      referenceNo: discount.discount_no,
      amount: Number(discount.amount),
      currencyCode: discount.currency_code,
    });

    await client.query('COMMIT');
    return { ...discount, status: 'CANCELLED' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listCustomerDiscounts(
  companyId: string,
  customerId: string,
  filters: { fromDate?: string; toDate?: string; status?: string } = {},
): Promise<CustomerDiscountRow[]> {
  const conditions = ['cd.company_id=$1', 'cd.customer_id=$2'];
  const params: unknown[] = [companyId, customerId];
  let p = 3;
  if (filters.status) {
    conditions.push(`cd.status=$${p++}`);
    params.push(filters.status);
  }
  if (filters.fromDate) {
    conditions.push(`cd.discount_date >= $${p++}::date`);
    params.push(filters.fromDate);
  }
  if (filters.toDate) {
    conditions.push(`cd.discount_date <= $${p++}::date`);
    params.push(filters.toDate);
  }
  const pool = getPool();
  const rows = await pool.query<CustomerDiscountRow>(
    `SELECT cd.id, cd.discount_no, cd.discount_date, cd.customer_id, cd.amount, cd.currency_code,
            cd.exchange_rate_to_usd, cd.amount_usd, cd.description, cd.notes, cd.status,
            cd.journal_entry_id, cd.created_at, c.name AS customer_name
     FROM customer_discounts cd
     JOIN customers c ON c.id = cd.customer_id AND c.company_id = cd.company_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY cd.discount_date DESC, cd.created_at DESC`,
    params,
  );
  return rows.rows;
}
