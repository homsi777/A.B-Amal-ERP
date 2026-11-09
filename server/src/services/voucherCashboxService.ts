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

/** يقرأ بنود السند المقسَّم (voucher_lines) إن وُجدت — مصفوفة فارغة لسند أحادي
 * الخزينة القديم (لا صفوف له أصلاً)، فيعود applyVoucherConfirmation/Cancellation
 * لسلوكهما الافتراضي بناءً على الحقول القديمة بالضبط. */
export async function loadVoucherConfirmationLines(
  client: PoolClient,
  companyId: string,
  voucherId: string,
): Promise<VoucherConfirmationLine[]> {
  const rows = await client.query<{
    id: string;
    cashbox_id: string;
    amount: string;
    currency_code: string;
    exchange_rate_to_usd: string | null;
    amount_usd: string | null;
    check_id: string | null;
  }>(
    `SELECT id, cashbox_id, amount, currency_code, exchange_rate_to_usd, amount_usd, check_id
     FROM voucher_lines WHERE company_id=$1 AND voucher_id=$2 ORDER BY sort_order ASC, created_at ASC`,
    [companyId, voucherId],
  );
  return rows.rows.map((r) => ({
    lineId: r.id,
    cashboxId: r.cashbox_id,
    amount: Number(r.amount),
    currencyCode: String(r.currency_code || 'USD').trim().toUpperCase(),
    exchangeRateToUsd: Number(r.exchange_rate_to_usd ?? 1) > 0 ? Number(r.exchange_rate_to_usd ?? 1) : 1,
    amountUsd: Number(r.amount_usd ?? 0) || computeUsd(Number(r.amount), Number(r.exchange_rate_to_usd ?? 1) || 1),
    checkId: r.check_id,
  }));
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

export type VoucherConfirmationLine = {
  /** معرّف صف voucher_lines نفسه — فارغ لسند أحادي الخزينة القديم بلا بنود. */
  lineId?: string;
  cashboxId: string;
  amount: number;
  currencyCode: string;
  exchangeRateToUsd: number;
  amountUsd: number;
  /** دفع بشيك مستلَم سابقاً — المستدعي (route) يتولى تحديث حالة الشيك نفسه. */
  checkId?: string | null;
};

/** تُسجِّل حركة خزينة واحدة + تحديث رصيد لحساب خزينة واحد — منطق مشترك بين
 * السند القديم (بند واحد ضمني) والسند المقسَّم على عدة بنود (كل بند يستدعيها). */
async function applyOneCashboxLine(
  client: PoolClient,
  input: {
    companyId: string;
    voucherId: string;
    voucherNo: string;
    voucherType: 'RECEIPT' | 'PAYMENT';
    line: VoucherConfirmationLine;
    description: string | null;
    userId: string | null;
  },
): Promise<void> {
  const movementNo = generateDocumentNo('MOV');
  const isReceipt = input.voucherType === 'RECEIPT';
  const direction = isReceipt ? 'IN' : 'OUT';
  const movementType = isReceipt ? 'RECEIPT' : 'PAYMENT';
  const { cashboxId, amount, currencyCode, exchangeRateToUsd, amountUsd } = input.line;

  const box = await client.query<{ current_balance: string; currency_code: string }>(
    `SELECT current_balance, currency_code FROM cashboxes WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [cashboxId, input.companyId],
  );
  if (!box.rows.length) throw Object.assign(new Error('الصندوق غير موجود'), { code: 'NOT_FOUND' });
  const boxCurrency = String(box.rows[0].currency_code || 'USD').trim().toUpperCase();
  if (boxCurrency !== String(currencyCode || 'USD').trim().toUpperCase()) {
    throw Object.assign(new Error('عملة السند يجب أن تطابق عملة الصندوق المحدد'), { code: 'VALIDATION' });
  }

  const prev = Number(box.rows[0].current_balance);
  const next = isReceipt ? prev + amount : prev - amount;
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
      cashboxId,
      movementNo,
      movementType,
      direction,
      amount,
      currencyCode,
      exchangeRateToUsd,
      amountUsd,
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
    [cashboxId, input.companyId, next],
  );
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
    /** سند مقسَّم على أكثر من حساب/وسيلة — عند تمريرها، تُعتمَد بدل
     * cashboxId/amount أعلاه (يبقيان لتوافق النداءات القديمة فقط). غير
     * مُمرَّرة أو فارغة = بالضبط نفس سلوك السند أحادي الخزينة كما كان دائماً. */
    lines?: VoucherConfirmationLine[];
  },
): Promise<void> {
  const lines: VoucherConfirmationLine[] =
    input.lines && input.lines.length > 0
      ? input.lines
      : [
          {
            cashboxId: input.cashboxId,
            amount: input.amount,
            currencyCode: input.currencyCode,
            exchangeRateToUsd: input.exchangeRateToUsd,
            amountUsd: input.amountUsd,
          },
        ];

  for (const line of lines) {
    await applyOneCashboxLine(client, {
      companyId: input.companyId,
      voucherId: input.voucherId,
      voucherNo: input.voucherNo,
      voucherType: input.voucherType,
      line,
      description: input.description,
      userId: input.userId,
    });
  }

  if (input.partyType === 'CUSTOMER' || input.partyType === 'SUPPLIER') {
    await insertPartyActivityLog(client, {
      companyId: input.companyId,
      partyType: input.partyType,
      partyId: input.partyId,
      partyName: input.partyName,
      activityType: 'PAYMENT',
      description: `${input.voucherType === 'RECEIPT' ? 'سند قبض' : 'سند صرف'} مؤكد ${input.voucherNo}`,
      userId: input.userId,
      referenceType: 'VOUCHER',
      referenceId: input.voucherId,
      referenceNo: input.voucherNo,
      amount: input.amount,
      currencyCode: input.currencyCode,
    });
  }

  await postVoucherToGl(client, {
    companyId: input.companyId,
    voucherId: input.voucherId,
    voucherNo: input.voucherNo,
    voucherDate: input.voucherDate,
    voucherType: input.voucherType,
    currencyCode: input.currencyCode,
    cashboxLines: lines.map((l) => ({ cashboxId: l.cashboxId, amountUsd: l.amountUsd })),
    partyType: input.partyType,
    partyId: input.partyId,
    description: input.description,
    userId: input.userId,
  });
}

async function reverseOneCashboxLine(
  client: PoolClient,
  input: {
    companyId: string;
    voucherId: string;
    voucherNo: string;
    voucherType: 'RECEIPT' | 'PAYMENT';
    line: VoucherConfirmationLine;
    userId: string | null;
  },
): Promise<void> {
  const movementNo = generateDocumentNo('MOV');
  const wasReceipt = input.voucherType === 'RECEIPT';
  const reversalDirection = wasReceipt ? 'OUT' : 'IN';
  const { cashboxId, amount, currencyCode, exchangeRateToUsd, amountUsd } = input.line;

  const box = await client.query<{ current_balance: string; currency_code: string }>(
    `SELECT current_balance, currency_code FROM cashboxes WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [cashboxId, input.companyId],
  );
  if (!box.rows.length) throw Object.assign(new Error('الصندوق غير موجود'), { code: 'NOT_FOUND' });
  const boxCurrency = String(box.rows[0].currency_code || 'USD').trim().toUpperCase();
  if (boxCurrency !== String(currencyCode || 'USD').trim().toUpperCase()) {
    throw Object.assign(new Error('عملة السند يجب أن تطابق عملة الصندوق المحدد'), { code: 'VALIDATION' });
  }

  const prev = Number(box.rows[0].current_balance);
  const next = wasReceipt ? prev - amount : prev + amount;

  await client.query(
    `INSERT INTO cashbox_movements (
       company_id, cashbox_id, movement_no, movement_type, direction, amount,
       currency_code, exchange_rate_to_usd, amount_usd, balance_after,
       source_type, source_id, source_no, description, created_by_user_id
     ) VALUES ($1,$2,$3,'ADJUSTMENT',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      input.companyId,
      cashboxId,
      movementNo,
      reversalDirection,
      amount,
      currencyCode,
      exchangeRateToUsd,
      amountUsd,
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
    [cashboxId, input.companyId, next],
  );
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
    /** نفس بنود التأكيد الأصلية — لعكس حركة كل حساب على حدة. غير مُمرَّرة =
     * سند أحادي الخزينة كالسابق تماماً. */
    lines?: VoucherConfirmationLine[];
  },
): Promise<void> {
  await reverseVoucherGl(client, {
    companyId: input.companyId,
    voucherId: input.voucherId,
    voucherNo: input.voucherNo,
    userId: input.userId,
  });

  const lines: VoucherConfirmationLine[] =
    input.lines && input.lines.length > 0
      ? input.lines
      : [
          {
            cashboxId: input.cashboxId,
            amount: input.amount,
            currencyCode: input.currencyCode,
            exchangeRateToUsd: input.exchangeRateToUsd,
            amountUsd: input.amountUsd,
          },
        ];

  for (const line of lines) {
    await reverseOneCashboxLine(client, {
      companyId: input.companyId,
      voucherId: input.voucherId,
      voucherNo: input.voucherNo,
      voucherType: input.voucherType,
      line,
      userId: input.userId,
    });
  }
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
    const existingLines = await loadVoucherConfirmationLines(client, input.companyId, input.voucherId);
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
      lines: existingLines,
    });
  }

  await client.query(
    `UPDATE vouchers SET status='CANCELLED', cancelled_at=now(), updated_at=now() WHERE id=$1 AND company_id=$2`,
    [input.voucherId, input.companyId],
  );
}
