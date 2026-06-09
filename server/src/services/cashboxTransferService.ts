import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { generateDocumentNo } from '../utils/documentNumbers.js';
import { getExchangeRateToUsdTx } from './exchangeRateService.js';

type ServiceErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'INVALID_STATE' | 'INSUFFICIENT_BALANCE';

type CashboxTransferRow = {
  id: string;
  company_id: string;
  transfer_no: string;
  transfer_date: string;
  from_cashbox_id: string;
  to_cashbox_id: string;
  amount: string;
  currency_code: string;
  exchange_rate_to_usd?: string;
  amount_usd?: string;
  notes: string | null;
  status: 'DRAFT' | 'CONFIRMED' | 'VOID';
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  voided_at: string | null;
  from_cashbox_name: string;
  from_cashbox_code: string;
  to_cashbox_name: string;
  to_cashbox_code: string;
};

type CashboxRow = {
  id: string;
  code: string;
  name: string;
  currency_code: string;
  current_balance: string;
  is_active: boolean;
};

export type CashboxTransferPayload = {
  transferDate?: string;
  fromCashboxId: string;
  toCashboxId: string;
  amount: number;
  currencyCode?: string;
  notes?: string | null;
};

function fail(message: string, code: ServiceErrorCode): never {
  throw Object.assign(new Error(message), { code });
}

const transferSelect = `
  SELECT t.id, t.company_id, t.transfer_no, t.transfer_date, t.from_cashbox_id, t.to_cashbox_id,
         t.amount, t.currency_code, t.exchange_rate_to_usd, t.amount_usd, t.notes, t.status, t.created_at, t.updated_at,
         t.confirmed_at, t.voided_at,
         f.name AS from_cashbox_name, f.code AS from_cashbox_code,
         d.name AS to_cashbox_name, d.code AS to_cashbox_code
  FROM cashbox_transfers t
  JOIN cashboxes f ON f.id = t.from_cashbox_id AND f.company_id = t.company_id
  JOIN cashboxes d ON d.id = t.to_cashbox_id AND d.company_id = t.company_id
`;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeUsd(amountOriginal: number, exchangeRateToUsd: number): number {
  if (!Number.isFinite(amountOriginal) || !Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) return 0;
  return round2(amountOriginal / exchangeRateToUsd);
}

function normalizePayload(payload: CashboxTransferPayload) {
  const amount = Number(payload.amount);
  if (!payload.fromCashboxId || !payload.toCashboxId) fail('يجب اختيار الصندوق المصدر والصندوق الوجهة', 'VALIDATION');
  if (payload.fromCashboxId === payload.toCashboxId) fail('لا يمكن المناقلة إلى نفس الصندوق', 'VALIDATION');
  if (!Number.isFinite(amount) || amount <= 0) fail('قيمة المناقلة يجب أن تكون أكبر من صفر', 'VALIDATION');
  return {
    transferDate: payload.transferDate ? payload.transferDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
    fromCashboxId: payload.fromCashboxId,
    toCashboxId: payload.toCashboxId,
    amount,
    currencyCode: (payload.currencyCode || 'USD').trim() || 'USD',
    notes: payload.notes?.trim() || null,
  };
}

async function fetchTransfer(client: PoolClient, companyId: string, id: string, lock = false) {
  const row = await client.query<CashboxTransferRow>(
    `${transferSelect}
     WHERE t.id=$1 AND t.company_id=$2
     ${lock ? 'FOR UPDATE OF t' : ''}`,
    [id, companyId],
  );
  return row.rows[0] ?? null;
}

async function lockCashboxes(client: PoolClient, companyId: string, fromCashboxId: string, toCashboxId: string) {
  const boxes = await client.query<CashboxRow>(
    `SELECT id, code, name, currency_code, current_balance, is_active
     FROM cashboxes
     WHERE company_id=$1 AND id = ANY($2::uuid[])
     ORDER BY id
     FOR UPDATE`,
    [companyId, [fromCashboxId, toCashboxId]],
  );
  if (boxes.rows.length !== 2) fail('أحد الصناديق غير موجود', 'NOT_FOUND');
  const from = boxes.rows.find((x) => x.id === fromCashboxId);
  const to = boxes.rows.find((x) => x.id === toCashboxId);
  if (!from || !to) fail('أحد الصناديق غير موجود', 'NOT_FOUND');
  return { from, to };
}

async function insertMovement(
  client: PoolClient,
  input: {
    companyId: string;
    cashboxId: string;
    movementType: 'TRANSFER_IN' | 'TRANSFER_OUT' | 'ADJUSTMENT';
    direction: 'IN' | 'OUT';
    amount: number;
    currencyCode: string;
    exchangeRateToUsd: number;
    amountUsd: number;
    balanceAfter: number;
    sourceType: 'CASHBOX_TRANSFER' | 'CASHBOX_TRANSFER_VOID';
    sourceId: string;
    sourceNo: string;
    description: string;
    userId: string | null;
  },
) {
  await client.query(
    `INSERT INTO cashbox_movements (
       company_id, cashbox_id, movement_no, movement_type, direction, amount,
       currency_code, exchange_rate_to_usd, amount_usd, balance_after,
       source_type, source_id, source_no, description, created_by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      input.companyId,
      input.cashboxId,
      generateDocumentNo('MOV'),
      input.movementType,
      input.direction,
      input.amount,
      input.currencyCode,
      input.exchangeRateToUsd,
      input.amountUsd,
      input.balanceAfter,
      input.sourceType,
      input.sourceId,
      input.sourceNo,
      input.description,
      input.userId,
    ],
  );
}

export async function listCashboxTransfers(
  companyId: string,
  filters: { status?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize || 20));
  const offset = (page - 1) * pageSize;
  const conditions = ['t.company_id=$1'];
  const params: unknown[] = [companyId];
  let p = 2;

  if (filters.status && ['DRAFT', 'CONFIRMED', 'VOID'].includes(filters.status)) {
    conditions.push(`t.status=$${p}`);
    params.push(filters.status);
    p++;
  }
  if (filters.fromDate) {
    conditions.push(`t.transfer_date >= $${p}::date`);
    params.push(filters.fromDate);
    p++;
  }
  if (filters.toDate) {
    conditions.push(`t.transfer_date <= $${p}::date`);
    params.push(filters.toDate);
    p++;
  }

  const where = conditions.join(' AND ');
  const pool = getPool();
  const [rows, count] = await Promise.all([
    pool.query<CashboxTransferRow>(
      `${transferSelect}
       WHERE ${where}
       ORDER BY t.transfer_date DESC, t.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, pageSize, offset],
    ),
    pool.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM cashbox_transfers t WHERE ${where}`, params),
  ]);
  return { data: rows.rows, total: count.rows[0].total, page, pageSize };
}

export async function getCashboxTransferById(companyId: string, id: string) {
  const client = await getPool().connect();
  try {
    const row = await fetchTransfer(client, companyId, id);
    if (!row) fail('المناقلة غير موجودة', 'NOT_FOUND');
    return row;
  } finally {
    client.release();
  }
}

export async function createCashboxTransfer(companyId: string, userId: string | null, payload: CashboxTransferPayload) {
  const d = normalizePayload(payload);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { from, to } = await lockCashboxes(client, companyId, d.fromCashboxId, d.toCashboxId);
    if (!from.is_active || !to.is_active) fail('لا يمكن المناقلة بين صناديق غير نشطة', 'VALIDATION');
    if (from.currency_code !== to.currency_code) fail('يجب أن تكون عملة الصندوقين متطابقة', 'VALIDATION');
    if (d.currencyCode !== from.currency_code) fail('عملة المناقلة لا تطابق عملة الصناديق', 'VALIDATION');

    let exchangeRateToUsd = d.currencyCode.trim().toUpperCase() === 'USD' ? 1 : NaN;
    if (exchangeRateToUsd !== 1) {
      const fromDb = await getExchangeRateToUsdTx(client, companyId, d.currencyCode.trim().toUpperCase());
      exchangeRateToUsd = fromDb ?? NaN;
    }
    if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
      fail('لا يمكن تنفيذ العملية بدون سعر صرف', 'VALIDATION');
    }
    const amountUsd = computeUsd(d.amount, exchangeRateToUsd);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO cashbox_transfers (
         company_id, transfer_no, transfer_date, from_cashbox_id, to_cashbox_id,
         amount, currency_code, exchange_rate_to_usd, amount_usd, notes, status, created_by_user_id
       ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,'DRAFT',$11)
       RETURNING id`,
      [
        companyId,
        generateDocumentNo('TRF'),
        d.transferDate,
        d.fromCashboxId,
        d.toCashboxId,
        d.amount,
        d.currencyCode,
        exchangeRateToUsd,
        amountUsd,
        d.notes,
        userId,
      ],
    );
    const row = await fetchTransfer(client, companyId, inserted.rows[0].id);
    await client.query('COMMIT');
    return row!;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function confirmCashboxTransfer(companyId: string, userId: string | null, id: string) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const transfer = await fetchTransfer(client, companyId, id, true);
    if (!transfer) fail('المناقلة غير موجودة', 'NOT_FOUND');
    if (transfer.status !== 'DRAFT') fail('لا يمكن تأكيد المناقلة في هذه الحالة', 'INVALID_STATE');

    const { from, to } = await lockCashboxes(client, companyId, transfer.from_cashbox_id, transfer.to_cashbox_id);
    const amount = Number(transfer.amount);
    const currencyCode = String(transfer.currency_code || 'USD').trim().toUpperCase();
    let exchangeRateToUsd = Number(transfer.exchange_rate_to_usd ?? 0);
    if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
      exchangeRateToUsd = currencyCode === 'USD' ? 1 : (await getExchangeRateToUsdTx(client, companyId, currencyCode)) ?? NaN;
    }
    if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) fail('لا يمكن تنفيذ العملية بدون سعر صرف', 'VALIDATION');
    const amountUsd = Number(transfer.amount_usd ?? 0) || computeUsd(amount, exchangeRateToUsd);
    const fromBalance = Number(from.current_balance);
    const toBalance = Number(to.current_balance);
    if (!from.is_active || !to.is_active) fail('لا يمكن تأكيد مناقلة بين صناديق غير نشطة', 'VALIDATION');
    if (from.currency_code !== to.currency_code || from.currency_code !== transfer.currency_code) {
      fail('عملة المناقلة لا تطابق عملة الصناديق', 'VALIDATION');
    }
    if (fromBalance < amount) fail('الرصيد غير كافٍ في الصندوق المصدر', 'INSUFFICIENT_BALANCE');

    const sourceAfter = fromBalance - amount;
    const destinationAfter = toBalance + amount;
    await client.query(`UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`, [
      from.id,
      companyId,
      sourceAfter,
    ]);
    await client.query(`UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`, [
      to.id,
      companyId,
      destinationAfter,
    ]);
    await insertMovement(client, {
      companyId,
      cashboxId: from.id,
      movementType: 'TRANSFER_OUT',
      direction: 'OUT',
      amount,
      currencyCode,
      exchangeRateToUsd,
      amountUsd,
      balanceAfter: sourceAfter,
      sourceType: 'CASHBOX_TRANSFER',
      sourceId: transfer.id,
      sourceNo: transfer.transfer_no,
      description: `مناقلة صادرة إلى ${to.name} - ${transfer.transfer_no}`,
      userId,
    });
    await insertMovement(client, {
      companyId,
      cashboxId: to.id,
      movementType: 'TRANSFER_IN',
      direction: 'IN',
      amount,
      currencyCode,
      exchangeRateToUsd,
      amountUsd,
      balanceAfter: destinationAfter,
      sourceType: 'CASHBOX_TRANSFER',
      sourceId: transfer.id,
      sourceNo: transfer.transfer_no,
      description: `مناقلة واردة من ${from.name} - ${transfer.transfer_no}`,
      userId,
    });
    await client.query(
      `UPDATE cashbox_transfers
       SET status='CONFIRMED', confirmed_at=now(), confirmed_by_user_id=$3, updated_at=now()
       WHERE id=$1 AND company_id=$2`,
      [id, companyId, userId],
    );
    const row = await fetchTransfer(client, companyId, id);
    await client.query('COMMIT');
    return row!;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function voidCashboxTransfer(companyId: string, userId: string | null, id: string) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const transfer = await fetchTransfer(client, companyId, id, true);
    if (!transfer) fail('المناقلة غير موجودة', 'NOT_FOUND');
    if (transfer.status === 'VOID') fail('المناقلة ملغاة مسبقاً', 'INVALID_STATE');
    if (transfer.status !== 'CONFIRMED') fail('لا يمكن إلغاء مناقلة غير مؤكدة', 'INVALID_STATE');

    const { from, to } = await lockCashboxes(client, companyId, transfer.from_cashbox_id, transfer.to_cashbox_id);
    const amount = Number(transfer.amount);
    const currencyCode = String(transfer.currency_code || 'USD').trim().toUpperCase();
    let exchangeRateToUsd = Number(transfer.exchange_rate_to_usd ?? 0);
    if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
      exchangeRateToUsd = currencyCode === 'USD' ? 1 : (await getExchangeRateToUsdTx(client, companyId, currencyCode)) ?? NaN;
    }
    if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) fail('لا يمكن تنفيذ العملية بدون سعر صرف', 'VALIDATION');
    const amountUsd = Number(transfer.amount_usd ?? 0) || computeUsd(amount, exchangeRateToUsd);
    const fromBalance = Number(from.current_balance);
    const toBalance = Number(to.current_balance);
    if (toBalance < amount) fail('لا يمكن عكس المناقلة لأن رصيد الصندوق الوجهة غير كافٍ', 'INSUFFICIENT_BALANCE');

    const sourceAfter = fromBalance + amount;
    const destinationAfter = toBalance - amount;
    await client.query(`UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`, [
      from.id,
      companyId,
      sourceAfter,
    ]);
    await client.query(`UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`, [
      to.id,
      companyId,
      destinationAfter,
    ]);
    await insertMovement(client, {
      companyId,
      cashboxId: from.id,
      movementType: 'ADJUSTMENT',
      direction: 'IN',
      amount,
      currencyCode,
      exchangeRateToUsd,
      amountUsd,
      balanceAfter: sourceAfter,
      sourceType: 'CASHBOX_TRANSFER_VOID',
      sourceId: transfer.id,
      sourceNo: transfer.transfer_no,
      description: `عكس مناقلة واردة إلى ${from.name} - ${transfer.transfer_no}`,
      userId,
    });
    await insertMovement(client, {
      companyId,
      cashboxId: to.id,
      movementType: 'ADJUSTMENT',
      direction: 'OUT',
      amount,
      currencyCode,
      exchangeRateToUsd,
      amountUsd,
      balanceAfter: destinationAfter,
      sourceType: 'CASHBOX_TRANSFER_VOID',
      sourceId: transfer.id,
      sourceNo: transfer.transfer_no,
      description: `عكس مناقلة صادرة من ${to.name} - ${transfer.transfer_no}`,
      userId,
    });
    await client.query(
      `UPDATE cashbox_transfers
       SET status='VOID', voided_at=now(), voided_by_user_id=$3, updated_at=now()
       WHERE id=$1 AND company_id=$2`,
      [id, companyId, userId],
    );
    const row = await fetchTransfer(client, companyId, id);
    await client.query('COMMIT');
    return row!;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
