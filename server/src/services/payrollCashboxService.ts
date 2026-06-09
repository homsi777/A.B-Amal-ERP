import type { PoolClient } from 'pg';
import { generateDocumentNo } from '../utils/documentNumbers.js';

/**
 * Deduct net payroll from a cashbox (operational movement); must run in same transaction as GL payroll payment.
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
  if (box.rows[0].currency_code !== input.currencyCode) {
    throw Object.assign(new Error('عملة الصندوق لا تطابق عملة المسير — استخدم صندوقاً بنفس العملة'), {
      code: 'VALIDATION',
    });
  }

  const prev = Number(box.rows[0].current_balance);
  const amt = Math.round(input.amount * 100) / 100;
  if (amt <= 0) {
    throw Object.assign(new Error('مبلغ الصرف غير صالح'), { code: 'VALIDATION' });
  }
  if (prev + 1e-9 < amt) {
    throw Object.assign(new Error('رصيد الصندوق غير كافٍ لصرف صافي الرواتب'), { code: 'VALIDATION' });
  }
  const next = Math.round((prev - amt) * 100) / 100;

  await client.query(
    `INSERT INTO cashbox_movements (
       company_id, cashbox_id, movement_no, movement_type, direction, amount,
       currency_code, balance_after, source_type, source_id, source_no, description, created_by_user_id
     ) VALUES ($1,$2,$3,'PAYMENT','OUT',$4,$5,$6,'PAYROLL_RUN',$7,$8,$9,$10)`,
    [
      input.companyId,
      input.cashboxId,
      movementNo,
      amt,
      input.currencyCode,
      next,
      input.payrollRunId,
      input.payrollNo,
      `صرف رواتب ${input.payrollNo} — صافي المسير`,
      input.userId,
    ],
  );

  await client.query(
    `UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
    [input.cashboxId, input.companyId, next],
  );
}
