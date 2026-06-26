import type { PoolClient } from 'pg';
import { generateDocumentNo } from '../utils/documentNumbers.js';
import { resolveCashboxOutAmount } from './cashboxCrossCurrencyService.js';

/**
 * Deduct net payroll from a cashbox (operational movement); must run in same transaction as GL payroll payment.
 * يدعم الصرف من صندوق بعملة مختلفة عن عملة المسير عبر سعر الصرف.
 */
export async function applyPayrollCashOut(
  client: PoolClient,
  input: {
    companyId: string;
    payrollRunId: string;
    payrollNo: string;
    amount: number;
    currencyCode: string;
    cashboxId: string;
    userId: string | null;
    exchangeRateToUsd?: number;
  },
): Promise<void> {
  const movementNo = generateDocumentNo('MOV');
  const box = await client.query<{ current_balance: string; currency_code: string }>(
    `SELECT current_balance, currency_code FROM cashboxes WHERE id=$1 AND company_id=$2 AND is_active=true FOR UPDATE`,
    [input.cashboxId, input.companyId],
  );
  if (!box.rows.length) {
    throw Object.assign(new Error('الصندوق غير موجود أو غير نشط'), { code: 'NOT_FOUND' });
  }

  const resolved = await resolveCashboxOutAmount(client, input.companyId, {
    paymentAmount: input.amount,
    paymentCurrency: input.currencyCode,
    cashboxCurrency: box.rows[0].currency_code,
    paymentExchangeRateToUsd: input.exchangeRateToUsd,
  });

  const prev = Number(box.rows[0].current_balance);
  const amt = resolved.cashboxAmount;
  if (amt <= 0) {
    throw Object.assign(new Error('مبلغ الصرف غير صالح'), { code: 'VALIDATION' });
  }
  if (prev + 1e-9 < amt) {
    throw Object.assign(new Error('رصيد الصندوق غير كافٍ لصرف صافي الرواتب'), { code: 'VALIDATION' });
  }
  const next = Math.round((prev - amt) * 100) / 100;

  const crossNote =
    resolved.cashboxCurrency !== String(input.currencyCode || 'USD').trim().toUpperCase()
      ? ` (خصم ${amt} ${resolved.cashboxCurrency} مقابل ${input.amount} ${input.currencyCode})`
      : '';

  await client.query(
    `INSERT INTO cashbox_movements (
       company_id, cashbox_id, movement_no, movement_type, direction, amount,
       currency_code, exchange_rate_to_usd, amount_usd, balance_after, source_type, source_id, source_no, description, created_by_user_id
     ) VALUES ($1,$2,$3,'PAYMENT','OUT',$4,$5,$6,$7,$8,'PAYROLL_RUN',$9,$10,$11,$12)`,
    [
      input.companyId,
      input.cashboxId,
      movementNo,
      amt,
      resolved.cashboxCurrency,
      resolved.cashboxExchangeRateToUsd,
      resolved.amountUsd,
      next,
      input.payrollRunId,
      input.payrollNo,
      `صرف رواتب ${input.payrollNo} — صافي المسير${crossNote}`,
      input.userId,
    ],
  );

  await client.query(
    `UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
    [input.cashboxId, input.companyId, next],
  );
}
