import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';
import { ensureCompanyOperatingExpenseCoa } from './glCoaService.js';
import { postOperatingExpenseToGl, reverseOperatingExpenseGl } from './glPostingService.js';
import {
  applyOperatingExpenseCashOut,
  reverseOperatingExpenseCashOut,
} from './operatingExpenseCashboxService.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeUsd(amountOriginal: number, exchangeRateToUsd: number): number {
  if (!Number.isFinite(amountOriginal) || !Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) return 0;
  return round2(amountOriginal / exchangeRateToUsd);
}

const createBody = z.object({
  expenseDate: z.string().min(1, 'التاريخ مطلوب'),
  categoryId: z.string().uuid('تصنيف المصروف غير صالح'),
  cashboxId: z.string().uuid('الصندوق غير صالح'),
  beneficiaryName: z.string().optional().nullable(),
  amount: z.coerce.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  currencyCode: z.string().min(1).default('USD'),
  exchangeRateToUsd: z.coerce.number().positive().default(1),
  description: z.string().min(1, 'البيان مطلوب'),
  notes: z.string().optional().nullable(),
});

const cancelBody = z.object({
  reason: z.string().min(1, 'سبب الإلغاء مطلوب'),
});

export type ExpenseCategoryRow = {
  id: string;
  code: string;
  name: string;
  gl_account_id: string;
  is_active: boolean;
  sort_order: number;
};

export type OperatingExpenseRow = {
  id: string;
  expense_no: string;
  expense_date: string;
  category_id: string;
  cashbox_id: string;
  beneficiary_name: string | null;
  amount: string;
  currency_code: string;
  exchange_rate_to_usd: string;
  amount_usd: string;
  description: string;
  notes: string | null;
  status: string;
  journal_entry_id: string | null;
  cashbox_movement_id: string | null;
  created_at: string;
  category_name?: string;
  category_code?: string;
  cashbox_name?: string;
  cashbox_code?: string;
};

async function loadCategory(
  client: PoolClient,
  companyId: string,
  categoryId: string,
): Promise<{ id: string; name: string; gl_account_id: string }> {
  const row = await client.query<{ id: string; name: string; gl_account_id: string }>(
    `SELECT id, name, gl_account_id FROM expense_categories
     WHERE id=$1 AND company_id=$2 AND is_active=true`,
    [categoryId, companyId],
  );
  if (!row.rows.length) {
    throw Object.assign(new Error('تصنيف المصروف غير موجود'), { code: 'NOT_FOUND' });
  }
  return row.rows[0];
}

async function loadCashbox(client: PoolClient, companyId: string, cashboxId: string) {
  const row = await client.query<{ id: string; name: string; currency_code: string }>(
    `SELECT id, name, currency_code FROM cashboxes
     WHERE id=$1 AND company_id=$2 AND is_active=true`,
    [cashboxId, companyId],
  );
  if (!row.rows.length) {
    throw Object.assign(new Error('الصندوق غير موجود أو غير نشط'), { code: 'NOT_FOUND' });
  }
  return row.rows[0];
}

export async function listExpenseCategories(companyId: string): Promise<ExpenseCategoryRow[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureCompanyOperatingExpenseCoa(client, companyId);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const rows = await pool.query<ExpenseCategoryRow>(
    `SELECT id, code, name, gl_account_id, is_active, sort_order
     FROM expense_categories
     WHERE company_id=$1 AND is_active=true
     ORDER BY sort_order ASC, name ASC`,
    [companyId],
  );
  return rows.rows;
}

export async function listOperatingExpenses(
  companyId: string,
  filters: {
    search?: string;
    cashboxId?: string;
    categoryId?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<{ data: OperatingExpenseRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 30));
  const offset = (page - 1) * pageSize;

  const conds = ['oe.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;

  if (filters.search?.trim()) {
    conds.push(`(
      oe.expense_no ILIKE $${p}
      OR oe.description ILIKE $${p}
      OR COALESCE(oe.beneficiary_name, '') ILIKE $${p}
      OR ec.name ILIKE $${p}
    )`);
    params.push(`%${filters.search.trim()}%`);
    p++;
  }
  if (filters.cashboxId) {
    conds.push(`oe.cashbox_id = $${p}`);
    params.push(filters.cashboxId);
    p++;
  }
  if (filters.categoryId) {
    conds.push(`oe.category_id = $${p}`);
    params.push(filters.categoryId);
    p++;
  }
  if (filters.status && ['CONFIRMED', 'CANCELLED'].includes(filters.status)) {
    conds.push(`oe.status = $${p}`);
    params.push(filters.status);
    p++;
  }
  if (filters.dateFrom) {
    conds.push(`oe.expense_date >= $${p}::date`);
    params.push(filters.dateFrom.slice(0, 10));
    p++;
  }
  if (filters.dateTo) {
    conds.push(`oe.expense_date <= $${p}::date`);
    params.push(filters.dateTo.slice(0, 10));
    p++;
  }

  const where = conds.join(' AND ');
  const pool = getPool();

  const [rows, countRow] = await Promise.all([
    pool.query<OperatingExpenseRow>(
      `SELECT oe.id, oe.expense_no, oe.expense_date, oe.category_id, oe.cashbox_id,
              oe.beneficiary_name, oe.amount, oe.currency_code, oe.exchange_rate_to_usd, oe.amount_usd,
              oe.description, oe.notes, oe.status, oe.journal_entry_id, oe.cashbox_movement_id, oe.created_at,
              ec.name AS category_name, ec.code AS category_code,
              cb.name AS cashbox_name, cb.code AS cashbox_code
       FROM operating_expenses oe
       JOIN expense_categories ec ON ec.id = oe.category_id
       JOIN cashboxes cb ON cb.id = oe.cashbox_id
       WHERE ${where}
       ORDER BY oe.expense_date DESC, oe.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, pageSize, offset],
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM operating_expenses oe
       JOIN expense_categories ec ON ec.id = oe.category_id
       WHERE ${where}`,
      params,
    ),
  ]);

  return {
    data: rows.rows,
    total: Number(countRow.rows[0]?.total ?? 0),
    page,
    pageSize,
  };
}

export async function createOperatingExpense(
  companyId: string,
  userId: string | null,
  raw: unknown,
): Promise<OperatingExpenseRow> {
  const parsed = createBody.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error(parsed.error.issues[0]?.message ?? 'بيانات غير صالحة'), { code: 'VALIDATION' });
  }
  const d = parsed.data;
  const currencyCode = String(d.currencyCode || 'USD').trim().toUpperCase();
  const exchangeRateToUsd = currencyCode === 'USD' ? 1 : d.exchangeRateToUsd;
  const amount = round2(d.amount);
  const amountUsd = currencyCode === 'USD' ? amount : computeUsd(amount, exchangeRateToUsd);
  const expenseDate = d.expenseDate.slice(0, 10);
  const description = d.description.trim();
  const beneficiary = d.beneficiaryName?.trim() || null;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureCompanyOperatingExpenseCoa(client, companyId);
    const category = await loadCategory(client, companyId, d.categoryId);
    const cashbox = await loadCashbox(client, companyId, d.cashboxId);

    const boxCurrency = String(cashbox.currency_code || 'USD').trim().toUpperCase();
    if (boxCurrency !== currencyCode) {
      throw Object.assign(new Error('عملة المصروف يجب أن تطابق عملة الصندوق المحدد'), { code: 'VALIDATION' });
    }

    const expenseNo = await generateSequentialDocumentNo(client, companyId, 'OPERATING_EXPENSE');
    const ins = await client.query<OperatingExpenseRow>(
      `INSERT INTO operating_expenses (
         company_id, expense_no, expense_date, category_id, cashbox_id,
         beneficiary_name, amount, currency_code, exchange_rate_to_usd, amount_usd,
         description, notes, status, created_by_user_id
       ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,'CONFIRMED',$13)
       RETURNING id, expense_no, expense_date, category_id, cashbox_id, beneficiary_name,
                 amount, currency_code, exchange_rate_to_usd, amount_usd,
                 description, notes, status, journal_entry_id, cashbox_movement_id, created_at`,
      [
        companyId,
        expenseNo,
        expenseDate,
        category.id,
        cashbox.id,
        beneficiary,
        amount,
        currencyCode,
        exchangeRateToUsd,
        amountUsd,
        description,
        d.notes?.trim() || null,
        userId,
      ],
    );
    const expense = ins.rows[0];

    const movementId = await applyOperatingExpenseCashOut(client, {
      companyId,
      expenseId: expense.id,
      expenseNo,
      amount,
      currencyCode,
      exchangeRateToUsd,
      amountUsd,
      cashboxId: cashbox.id,
      description: `${category.name} — ${description}`,
      userId,
    });

    const journalEntryId = await postOperatingExpenseToGl(client, {
      companyId,
      expenseId: expense.id,
      expenseNo,
      expenseDate,
      expenseGlAccountId: category.gl_account_id,
      amountUsd,
      cashboxId: cashbox.id,
      description: `${category.name} — ${description}`,
      userId,
    });

    await client.query(
      `UPDATE operating_expenses
       SET journal_entry_id=$3, cashbox_movement_id=$4, updated_at=now()
       WHERE id=$1 AND company_id=$2`,
      [expense.id, companyId, journalEntryId, movementId],
    );

    await client.query('COMMIT');

    const full = await pool.query<OperatingExpenseRow>(
      `SELECT oe.id, oe.expense_no, oe.expense_date, oe.category_id, oe.cashbox_id,
              oe.beneficiary_name, oe.amount, oe.currency_code, oe.exchange_rate_to_usd, oe.amount_usd,
              oe.description, oe.notes, oe.status, oe.journal_entry_id, oe.cashbox_movement_id, oe.created_at,
              ec.name AS category_name, ec.code AS category_code,
              cb.name AS cashbox_name, cb.code AS cashbox_code
       FROM operating_expenses oe
       JOIN expense_categories ec ON ec.id = oe.category_id
       JOIN cashboxes cb ON cb.id = oe.cashbox_id
       WHERE oe.id=$1 AND oe.company_id=$2`,
      [expense.id, companyId],
    );
    return full.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function cancelOperatingExpense(
  companyId: string,
  expenseId: string,
  userId: string | null,
  raw: unknown,
): Promise<OperatingExpenseRow> {
  const parsed = cancelBody.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error(parsed.error.issues[0]?.message ?? 'بيانات غير صالحة'), { code: 'VALIDATION' });
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await client.query<OperatingExpenseRow>(
      `SELECT oe.id, oe.expense_no, oe.expense_date, oe.category_id, oe.cashbox_id,
              oe.beneficiary_name, oe.amount, oe.currency_code, oe.exchange_rate_to_usd, oe.amount_usd,
              oe.description, oe.notes, oe.status, oe.journal_entry_id, oe.cashbox_movement_id, oe.created_at
       FROM operating_expenses oe
       WHERE oe.id=$1 AND oe.company_id=$2
       FOR UPDATE`,
      [expenseId, companyId],
    );
    if (!row.rows.length) {
      throw Object.assign(new Error('المصروف غير موجود'), { code: 'NOT_FOUND' });
    }
    const expense = row.rows[0];
    if (expense.status === 'CANCELLED') {
      throw Object.assign(new Error('المصروف ملغى مسبقاً'), { code: 'INVALID_STATE' });
    }

    await reverseOperatingExpenseGl(client, {
      companyId,
      expenseId: expense.id,
      expenseNo: expense.expense_no,
      userId,
    });

    await reverseOperatingExpenseCashOut(client, {
      companyId,
      expenseId: expense.id,
      expenseNo: expense.expense_no,
      amount: Number(expense.amount),
      currencyCode: expense.currency_code,
      exchangeRateToUsd: Number(expense.exchange_rate_to_usd ?? 1),
      amountUsd: Number(expense.amount_usd ?? 0),
      cashboxId: expense.cashbox_id,
      userId,
    });

    await client.query(
      `UPDATE operating_expenses
       SET status='CANCELLED', cancelled_at=now(), cancellation_reason=$3, updated_at=now()
       WHERE id=$1 AND company_id=$2`,
      [expense.id, companyId, parsed.data.reason.trim()],
    );

    await client.query('COMMIT');

    const full = await pool.query<OperatingExpenseRow>(
      `SELECT oe.id, oe.expense_no, oe.expense_date, oe.category_id, oe.cashbox_id,
              oe.beneficiary_name, oe.amount, oe.currency_code, oe.exchange_rate_to_usd, oe.amount_usd,
              oe.description, oe.notes, oe.status, oe.journal_entry_id, oe.cashbox_movement_id, oe.created_at,
              ec.name AS category_name, ec.code AS category_code,
              cb.name AS cashbox_name, cb.code AS cashbox_code
       FROM operating_expenses oe
       JOIN expense_categories ec ON ec.id = oe.category_id
       JOIN cashboxes cb ON cb.id = oe.cashbox_id
       WHERE oe.id=$1 AND oe.company_id=$2`,
      [expense.id, companyId],
    );
    return full.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
