import type { PoolClient } from 'pg';
import { generateDocumentNo } from '../utils/documentNumbers.js';
import { insertPartyActivityLog } from './partyActivityLogService.js';

const EPS = 1e-4;

export const RETURN_CASH_REFUND_SOURCE_TYPE = 'RETURN_INVOICE';
export const RETURN_CASH_REFUND_REVERSAL_SOURCE_TYPE = 'RETURN_INVOICE_REVERSAL';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CashRefundMovementRow = {
  id: string;
  cashbox_id: string;
  movement_type: string;
  direction: string;
  amount: string;
  currency_code: string;
  exchange_rate_to_usd: string | null;
  amount_usd: string | null;
};

/** Locate the original cash refund movement for a confirmed return (not reversal). */
export async function findReturnCashRefundMovement(
  client: PoolClient,
  companyId: string,
  returnInvoiceId: string,
): Promise<CashRefundMovementRow | null> {
  const res = await client.query<CashRefundMovementRow>(
    `SELECT id, cashbox_id, movement_type, direction, amount, currency_code,
            exchange_rate_to_usd, amount_usd
     FROM cashbox_movements
     WHERE company_id=$1
       AND source_type=$2
       AND source_id=$3
       AND movement_type IN ('PAYMENT', 'RECEIPT')
     ORDER BY created_at ASC
     LIMIT 1`,
    [companyId, RETURN_CASH_REFUND_SOURCE_TYPE, returnInvoiceId],
  );
  return res.rows[0] ?? null;
}

/** Locate reversal movement if cancel already posted cashbox reversal. */
export async function findReturnCashRefundReversalMovement(
  client: PoolClient,
  companyId: string,
  returnInvoiceId: string,
): Promise<CashRefundMovementRow | null> {
  const res = await client.query<CashRefundMovementRow>(
    `SELECT id, cashbox_id, movement_type, direction, amount, currency_code,
            exchange_rate_to_usd, amount_usd
     FROM cashbox_movements
     WHERE company_id=$1
       AND source_type=$2
       AND source_id=$3
       AND movement_type = 'ADJUSTMENT'
     ORDER BY created_at ASC
     LIMIT 1`,
    [companyId, RETURN_CASH_REFUND_REVERSAL_SOURCE_TYPE, returnInvoiceId],
  );
  return res.rows[0] ?? null;
}

/** Cashbox movement for CASH_REFUND return settlement — idempotent per return invoice. */
export async function applyReturnCashRefundCashbox(
  client: PoolClient,
  input: {
    companyId: string;
    returnInvoiceId: string;
    returnNo: string;
    returnType: 'SALES_RETURN' | 'PURCHASE_RETURN';
    amount: number;
    currencyCode: string;
    exchangeRateToUsd: number;
    amountUsd: number;
    cashboxId: string;
    partyType: 'CUSTOMER' | 'SUPPLIER';
    partyId: string;
    partyName: string;
    userId: string | null;
  },
): Promise<void> {
  const amt = round2(input.amount);
  if (amt <= EPS) return;

  const existing = await findReturnCashRefundMovement(client, input.companyId, input.returnInvoiceId);
  if (existing) return;

  const isSalesRefund = input.returnType === 'SALES_RETURN';
  const movementType = isSalesRefund ? 'PAYMENT' : 'RECEIPT';
  const direction = isSalesRefund ? 'OUT' : 'IN';

  const box = await client.query<{ current_balance: string; currency_code: string }>(
    `SELECT current_balance, currency_code FROM cashboxes WHERE id=$1 AND company_id=$2 AND is_active=true FOR UPDATE`,
    [input.cashboxId, input.companyId],
  );
  if (!box.rows.length) {
    throw Object.assign(new Error('الصندوق غير موجود أو غير نشط'), { code: 'NOT_FOUND' });
  }
  const boxCurrency = String(box.rows[0].currency_code || 'USD').trim().toUpperCase();
  if (boxCurrency !== String(input.currencyCode || 'USD').trim().toUpperCase()) {
    throw Object.assign(new Error('عملة الصندوق لا تطابق عملة المرتجع'), { code: 'VALIDATION' });
  }

  const prev = Number(box.rows[0].current_balance);
  const next = isSalesRefund ? round2(prev - amt) : round2(prev + amt);
  if (isSalesRefund && next < -EPS) {
    throw Object.assign(new Error('رصيد الصندوق غير كافٍ لرد المبلغ نقداً'), { code: 'VALIDATION' });
  }

  const movementNo = generateDocumentNo('MOV');
  await client.query(
    `INSERT INTO cashbox_movements (
       company_id, cashbox_id, movement_no, movement_type, direction, amount,
       currency_code, exchange_rate_to_usd, amount_usd, balance_after,
       source_type, source_id, source_no, description, created_by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      input.companyId,
      input.cashboxId,
      movementNo,
      movementType,
      direction,
      amt,
      input.currencyCode,
      input.exchangeRateToUsd,
      input.amountUsd,
      next,
      RETURN_CASH_REFUND_SOURCE_TYPE,
      input.returnInvoiceId,
      input.returnNo,
      isSalesRefund ? `رد نقدي — مرتجع ${input.returnNo}` : `استرداد نقدي — مرتجع ${input.returnNo}`,
      input.userId,
    ],
  );

  await client.query(
    `UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
    [input.cashboxId, input.companyId, next],
  );

  await insertPartyActivityLog(client, {
    companyId: input.companyId,
    partyType: input.partyType,
    partyId: input.partyId,
    partyName: input.partyName,
    activityType: 'RETURN',
    description: isSalesRefund ? `رد نقدي — مرتجع ${input.returnNo}` : `استرداد نقدي — مرتجع ${input.returnNo}`,
    userId: input.userId,
    referenceType: 'RETURN_INVOICE',
    referenceId: input.returnInvoiceId,
    referenceNo: input.returnNo,
    amount: amt,
    currencyCode: input.currencyCode,
  });
}

/**
 * Reverse cashbox effect of a confirmed CASH_REFUND return.
 * Original movement is preserved; an ADJUSTMENT reversal is linked via RETURN_INVOICE_REVERSAL.
 */
export async function reverseReturnCashRefundCashbox(
  client: PoolClient,
  input: {
    companyId: string;
    returnInvoiceId: string;
    returnNo: string;
    returnType: 'SALES_RETURN' | 'PURCHASE_RETURN';
    partyType: 'CUSTOMER' | 'SUPPLIER';
    partyId: string | null;
    partyName: string;
    userId: string | null;
  },
): Promise<void> {
  const existingReversal = await findReturnCashRefundReversalMovement(
    client,
    input.companyId,
    input.returnInvoiceId,
  );
  if (existingReversal) return;

  const original = await findReturnCashRefundMovement(client, input.companyId, input.returnInvoiceId);
  if (!original) return;

  const amt = round2(Number(original.amount));
  if (amt <= EPS) return;

  const isSalesRefund = input.returnType === 'SALES_RETURN';
  const reverseDirection = isSalesRefund ? 'IN' : 'OUT';

  const box = await client.query<{ current_balance: string }>(
    `SELECT current_balance FROM cashboxes WHERE id=$1 AND company_id=$2 AND is_active=true FOR UPDATE`,
    [original.cashbox_id, input.companyId],
  );
  if (!box.rows.length) {
    throw Object.assign(new Error('الصندوق الأصلي للرد النقدي غير موجود أو غير نشط'), { code: 'NOT_FOUND' });
  }

  const prev = Number(box.rows[0].current_balance);
  const next = isSalesRefund ? round2(prev + amt) : round2(prev - amt);
  if (!isSalesRefund && next < -EPS) {
    throw Object.assign(new Error('رصيد الصندوق غير كافٍ لعكس استرداد نقدي'), { code: 'VALIDATION' });
  }

  const rate = Number(original.exchange_rate_to_usd) > 0 ? Number(original.exchange_rate_to_usd) : 1;
  const amountUsd =
    original.amount_usd != null && Number(original.amount_usd) > 0
      ? round2(Number(original.amount_usd))
      : round2(amt / rate);

  const movementNo = generateDocumentNo('MOV');
  await client.query(
    `INSERT INTO cashbox_movements (
       company_id, cashbox_id, movement_no, movement_type, direction, amount,
       currency_code, exchange_rate_to_usd, amount_usd, balance_after,
       source_type, source_id, source_no, description, created_by_user_id
     ) VALUES ($1,$2,$3,'ADJUSTMENT',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      input.companyId,
      original.cashbox_id,
      movementNo,
      reverseDirection,
      amt,
      original.currency_code,
      rate,
      amountUsd,
      next,
      RETURN_CASH_REFUND_REVERSAL_SOURCE_TYPE,
      input.returnInvoiceId,
      input.returnNo,
      isSalesRefund
        ? `عكس رد نقدي — إلغاء مرتجع ${input.returnNo}`
        : `عكس استرداد نقدي — إلغاء مرتجع ${input.returnNo}`,
      input.userId,
    ],
  );

  await client.query(
    `UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
    [original.cashbox_id, input.companyId, next],
  );

  if (input.partyId) {
    await insertPartyActivityLog(client, {
      companyId: input.companyId,
      partyType: input.partyType,
      partyId: input.partyId,
      partyName: input.partyName,
      activityType: 'RETURN',
      description: `عكس رد نقدي — إلغاء مرتجع ${input.returnNo}`,
      userId: input.userId,
      referenceType: RETURN_CASH_REFUND_REVERSAL_SOURCE_TYPE,
      referenceId: input.returnInvoiceId,
      referenceNo: input.returnNo,
      amount: amt,
      currencyCode: original.currency_code,
    });
  }
}
