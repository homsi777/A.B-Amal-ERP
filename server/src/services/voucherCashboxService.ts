import type { PoolClient } from 'pg';
import { generateDocumentNo, generateSequentialDocumentNo } from '../utils/documentNumbers.js';
import { insertPartyActivityLog } from './partyActivityLogService.js';
import { postVoucherToGl, reverseVoucherGl } from './glPostingService.js';

const EPS = 1e-4;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeUsd(amountOriginal: number, exchangeRateToUsd: number): number {
  if (!Number.isFinite(amountOriginal) || !Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) return 0;
  return round2(amountOriginal / exchangeRateToUsd);
}

export async function insertDraftVoucher(
  client: PoolClient,
  input: {
    companyId: string;
    userId: string | null;
    voucherType: 'RECEIPT' | 'PAYMENT';
    voucherDate: string;
    cashboxId: string;
    partyType: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE' | 'OTHER' | null;
    partyId: string | null;
    partyName: string;
    amount: number;
    currencyCode: string;
    exchangeRateToUsd: number;
    amountUsd: number;
    description: string | null;
    notes: string | null;
    referenceDocumentType?: string | null;
    referenceDocumentNo?: string | null;
  },
): Promise<{ id: string; voucherNo: string }> {
  const voucherNo = await generateSequentialDocumentNo(
    client,
    input.companyId,
    input.voucherType === 'RECEIPT' ? 'RECEIPT_VOUCHER' : 'PAYMENT_VOUCHER',
  );
  const vd = input.voucherDate.slice(0, 10);
  const row = await client.query<{ id: string; voucher_no: string }>(
    `INSERT INTO vouchers (
       company_id, voucher_no, voucher_type, voucher_date, cashbox_id, party_type, party_id, party_name,
       amount, currency_code, exchange_rate_to_usd, amount_usd, payment_method, status, description, notes,
       reference_document_type, reference_document_no, created_by_user_id
     ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,'CASH','DRAFT',$13,$14,$15,$16,$17)
     RETURNING id, voucher_no`,
    [
      input.companyId,
      voucherNo,
      input.voucherType,
      vd,
      input.cashboxId,
      input.partyType,
      input.partyId,
      input.partyName.trim(),
      input.amount,
      input.currencyCode,
      input.exchangeRateToUsd,
      input.amountUsd,
      input.description ?? null,
      input.notes ?? null,
      input.referenceDocumentType?.trim() || null,
      input.referenceDocumentNo?.trim() || null,
      input.userId,
    ],
  );
  return { id: row.rows[0].id, voucherNo: row.rows[0].voucher_no };
}

export async function applyVoucherConfirmation(
  client: PoolClient,
  input: {
    companyId: string;
    voucherId: string;
    voucherNo: string;
    voucherDate: string;
    voucherType: 'RECEIPT' | 'PAYMENT';
    amount: number;
    currencyCode: string;
    exchangeRateToUsd: number;
    amountUsd: number;
    cashboxId: string;
    partyType: string | null;
    partyId: string | null;
    partyName: string;
    description: string | null;
    userId: string | null;
  },
): Promise<void> {
  const movementNo = generateDocumentNo('MOV');
  const isReceipt = input.voucherType === 'RECEIPT';
  const direction = isReceipt ? 'IN' : 'OUT';
  const movementType = isReceipt ? 'RECEIPT' : 'PAYMENT';

  const box = await client.query<{ current_balance: string; currency_code: string }>(
    `SELECT current_balance, currency_code FROM cashboxes WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [input.cashboxId, input.companyId],
  );
  if (!box.rows.length) throw Object.assign(new Error('الصندوق غير موجود'), { code: 'NOT_FOUND' });
  const boxCurrency = String(box.rows[0].currency_code || 'USD').trim().toUpperCase();
  if (boxCurrency !== String(input.currencyCode || 'USD').trim().toUpperCase()) {
    throw Object.assign(new Error('عملة السند يجب أن تطابق عملة الصندوق المحدد'), { code: 'VALIDATION' });
  }

  const prev = Number(box.rows[0].current_balance);
  const amt = input.amount;
  const next = isReceipt ? prev + amt : prev - amt;
  if (!isReceipt && next < -EPS) {
    throw Object.assign(new Error('الرصيد غير كافٍ في الصندوق'), { code: 'VALIDATION' });
  }

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
      'VOUCHER',
      input.voucherId,
      input.voucherNo,
      input.description ?? (isReceipt ? `قبض — ${input.voucherNo}` : `صرف — ${input.voucherNo}`),
      input.userId,
    ],
  );

  await client.query(
    `UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
    [input.cashboxId, input.companyId, next],
  );

  if (input.partyType === 'CUSTOMER' || input.partyType === 'SUPPLIER') {
    await insertPartyActivityLog(client, {
      companyId: input.companyId,
      partyType: input.partyType,
      partyId: input.partyId,
      partyName: input.partyName,
      activityType: 'PAYMENT',
      description: `${isReceipt ? 'سند قبض' : 'سند صرف'} مؤكد ${input.voucherNo}`,
      userId: input.userId,
      referenceType: 'VOUCHER',
      referenceId: input.voucherId,
      referenceNo: input.voucherNo,
      amount: amt,
      currencyCode: input.currencyCode,
    });
  }

  await postVoucherToGl(client, {
    companyId: input.companyId,
    voucherId: input.voucherId,
    voucherNo: input.voucherNo,
    voucherDate: input.voucherDate,
    voucherType: input.voucherType,
    amount: amt,
    amountUsd: input.amountUsd,
    currencyCode: input.currencyCode,
    exchangeRateToUsd: input.exchangeRateToUsd,
    cashboxId: input.cashboxId,
    partyType: input.partyType,
    partyId: input.partyId,
    description: input.description,
    userId: input.userId,
  });
}

export async function applyVoucherCancellation(
  client: PoolClient,
  input: {
    companyId: string;
    voucherId: string;
    voucherNo: string;
    voucherType: 'RECEIPT' | 'PAYMENT';
    amount: number;
    currencyCode: string;
    exchangeRateToUsd: number;
    amountUsd: number;
    cashboxId: string;
    userId: string | null;
  },
): Promise<void> {
  await reverseVoucherGl(client, {
    companyId: input.companyId,
    voucherId: input.voucherId,
    voucherNo: input.voucherNo,
    userId: input.userId,
  });

  const movementNo = generateDocumentNo('MOV');
  const wasReceipt = input.voucherType === 'RECEIPT';
  const reversalDirection = wasReceipt ? 'OUT' : 'IN';

  const box = await client.query<{ current_balance: string; currency_code: string }>(
    `SELECT current_balance, currency_code FROM cashboxes WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [input.cashboxId, input.companyId],
  );
  if (!box.rows.length) throw Object.assign(new Error('الصندوق غير موجود'), { code: 'NOT_FOUND' });
  const boxCurrency = String(box.rows[0].currency_code || 'USD').trim().toUpperCase();
  if (boxCurrency !== String(input.currencyCode || 'USD').trim().toUpperCase()) {
    throw Object.assign(new Error('عملة السند يجب أن تطابق عملة الصندوق المحدد'), { code: 'VALIDATION' });
  }

  const prev = Number(box.rows[0].current_balance);
  const amt = input.amount;
  const next = wasReceipt ? prev - amt : prev + amt;

  await client.query(
    `INSERT INTO cashbox_movements (
       company_id, cashbox_id, movement_no, movement_type, direction, amount,
       currency_code, exchange_rate_to_usd, amount_usd, balance_after,
       source_type, source_id, source_no, description, created_by_user_id
     ) VALUES ($1,$2,$3,'ADJUSTMENT',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      input.companyId,
      input.cashboxId,
      movementNo,
      reversalDirection,
      amt,
      input.currencyCode,
      input.exchangeRateToUsd,
      input.amountUsd,
      next,
      'VOUCHER_CANCEL',
      input.voucherId,
      input.voucherNo,
      `عكس سند ملغى ${input.voucherNo}`,
      input.userId,
    ],
  );

  await client.query(
    `UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
    [input.cashboxId, input.companyId, next],
  );
}

/** Cancel a confirmed voucher (GL + cashbox reversal) and mark it CANCELLED. No-op if already cancelled. */
export async function cancelConfirmedVoucher(
  client: PoolClient,
  input: {
    companyId: string;
    voucherId: string;
    userId: string | null;
  },
): Promise<void> {
  const v = await client.query(
    `SELECT * FROM vouchers WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [input.voucherId, input.companyId],
  );
  if (!v.rows.length) return;
  const row = v.rows[0];
  if (row.status === 'CANCELLED') return;

  if (row.status === 'CONFIRMED' && row.cashbox_id) {
    await applyVoucherCancellation(client, {
      companyId: input.companyId,
      voucherId: input.voucherId,
      voucherNo: row.voucher_no,
      voucherType: row.voucher_type,
      amount: Number(row.amount),
      currencyCode: String(row.currency_code || 'USD').trim().toUpperCase(),
      exchangeRateToUsd: Number(row.exchange_rate_to_usd ?? 1) > 0 ? Number(row.exchange_rate_to_usd ?? 1) : 1,
      amountUsd:
        Number(row.amount_usd ?? 0) ||
        computeUsd(Number(row.amount), Number(row.exchange_rate_to_usd ?? 1) || 1),
      cashboxId: row.cashbox_id,
      userId: input.userId,
    });
  }

  await client.query(
    `UPDATE vouchers SET status='CANCELLED', cancelled_at=now(), updated_at=now() WHERE id=$1 AND company_id=$2`,
    [input.voucherId, input.companyId],
  );
}
