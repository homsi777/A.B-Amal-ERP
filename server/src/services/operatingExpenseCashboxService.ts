import type { PoolClient } from 'pg';
import { generateDocumentNo } from '../utils/documentNumbers.js';

const EPS = 1e-4;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function applyOperatingExpenseCashOut(
  client: PoolClient,
  input: {
    companyId: string;
    expenseId: string;
    expenseNo: string;
    amount: number;
    currencyCode: string;
    exchangeRateToUsd: number;
    amountUsd: number;
    cashboxId: string;
    description: string;
    userId: string | null;
  },
): Promise<string> {
  const movementNo = generateDocumentNo('MOV');
  const box = await client.query<{ current_balance: string; currency_code: string }>(
    `SELECT current_balance, currency_code FROM cashboxes
     WHERE id=$1 AND company_id=$2 AND is_active=true FOR UPDATE`,
    [input.cashboxId, input.companyId],
  );
  if (!box.rows.length) {
    throw Object.assign(new Error('الصندوق غير موجود أو غير نشط'), { code: 'NOT_FOUND' });
  }

  const boxCurrency = String(box.rows[0].currency_code || 'USD').trim().toUpperCase();
  const payCurrency = String(input.currencyCode || 'USD').trim().toUpperCase();
  if (boxCurrency !== payCurrency) {
    throw Object.assign(new Error('عملة المصروف يجب أن تطابق عملة الصندوق المحدد'), { code: 'VALIDATION' });
  }

  const prev = Number(box.rows[0].current_balance);
  const amt = round2(input.amount);
  if (amt <= 0) {
    throw Object.assign(new Error('مبلغ المصروف غير صالح'), { code: 'VALIDATION' });
  }
  if (prev + EPS < amt) {
    throw Object.assign(new Error('رصيد الصندوق غير كافٍ لتسجيل المصروف'), { code: 'VALIDATION' });
  }
  const next = round2(prev - amt);

  const ins = await client.query<{ id: string }>(
    `INSERT INTO cashbox_movements (
       company_id, cashbox_id, movement_no, movement_type, direction, amount,
       currency_code, exchange_rate_to_usd, amount_usd, balance_after,
       source_type, source_id, source_no, description, created_by_user_id
     ) VALUES ($1,$2,$3,'PAYMENT','OUT',$4,$5,$6,$7,$8,'OPERATING_EXPENSE',$9,$10,$11,$12)
     RETURNING id`,
    [
      input.companyId,
      input.cashboxId,
      movementNo,
      amt,
      payCurrency,
      input.exchangeRateToUsd,
      round2(input.amountUsd),
      next,
      input.expenseId,
      input.expenseNo,
      input.description,
      input.userId,
    ],
  );

  await client.query(
    `UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
    [input.cashboxId, input.companyId, next],
  );

  return ins.rows[0].id;
}

export async function reverseOperatingExpenseCashOut(
  client: PoolClient,
  input: {
    companyId: string;
    expenseId: string;
    expenseNo: string;
    amount: number;
    currencyCode: string;
    exchangeRateToUsd: number;
    amountUsd: number;
    cashboxId: string;
    userId: string | null;
  },
): Promise<void> {
  const movementNo = generateDocumentNo('MOV');
  const box = await client.query<{ current_balance: string; currency_code: string }>(
    `SELECT current_balance, currency_code FROM cashboxes
     WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [input.cashboxId, input.companyId],
  );
  if (!box.rows.length) {
    throw Object.assign(new Error('الصندوق غير موجود'), { code: 'NOT_FOUND' });
  }

  const boxCurrency = String(box.rows[0].currency_code || 'USD').trim().toUpperCase();
  const payCurrency = String(input.currencyCode || 'USD').trim().toUpperCase();
  if (boxCurrency !== payCurrency) {
    throw Object.assign(new Error('عملة المصروف لا تطابق عملة الصندوق'), { code: 'VALIDATION' });
  }

  const prev = Number(box.rows[0].current_balance);
  const amt = round2(input.amount);
  const next = round2(prev + amt);

  await client.query(
    `INSERT INTO cashbox_movements (
       company_id, cashbox_id, movement_no, movement_type, direction, amount,
       currency_code, exchange_rate_to_usd, amount_usd, balance_after,
       source_type, source_id, source_no, description, created_by_user_id
     ) VALUES ($1,$2,$3,'ADJUSTMENT','IN',$4,$5,$6,$7,$8,'OPERATING_EXPENSE_REVERSAL',$9,$10,$11,$12)`,
    [
      input.companyId,
      input.cashboxId,
      movementNo,
      amt,
      payCurrency,
      input.exchangeRateToUsd,
      round2(input.amountUsd),
      next,
      input.expenseId,
      input.expenseNo,
      `عكس مصروف ${input.expenseNo}`,
      input.userId,
    ],
  );

  await client.query(
    `UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
    [input.cashboxId, input.companyId, next],
  );
}
