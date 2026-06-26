import type { PoolClient } from 'pg';
import { getExchangeRateToUsdTx } from './exchangeRateService.js';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function resolveRate(
  client: Pick<PoolClient, 'query'>,
  companyId: string,
  currencyCode: string,
  override?: number,
): Promise<number> {
  const code = String(currencyCode || 'USD').trim().toUpperCase();
  if (code === 'USD') return 1;
  if (override != null && Number.isFinite(override) && override > 0) return override;
  const rate = await getExchangeRateToUsdTx(client, companyId, code);
  if (!rate || rate <= 0) {
    throw Object.assign(new Error(`لا يوجد سعر صرف صالح لعملة ${code}. حدّث أسعار الصرف من الإعدادات أو الصناديق.`), {
      code: 'VALIDATION',
    });
  }
  return rate;
}

/** يحوّل مبلغاً بعملة الدفع إلى مبلغ الخصم من الصندوق (قد تختلف العملة). */
export async function resolveCashboxOutAmount(
  client: Pick<PoolClient, 'query'>,
  companyId: string,
  input: {
    paymentAmount: number;
    paymentCurrency: string;
    cashboxCurrency: string;
    paymentExchangeRateToUsd?: number;
  },
): Promise<{
  cashboxAmount: number;
  cashboxCurrency: string;
  cashboxExchangeRateToUsd: number;
  amountUsd: number;
  paymentExchangeRateToUsd: number;
}> {
  const payCur = String(input.paymentCurrency || 'USD').trim().toUpperCase();
  const boxCur = String(input.cashboxCurrency || 'USD').trim().toUpperCase();
  const payAmt = round2(input.paymentAmount);
  if (payAmt <= 0) {
    throw Object.assign(new Error('مبلغ الصرف غير صالح'), { code: 'VALIDATION' });
  }

  const payRate = await resolveRate(client, companyId, payCur, input.paymentExchangeRateToUsd);
  const amountUsd = payCur === 'USD' ? payAmt : round2(payAmt / payRate);

  if (payCur === boxCur) {
    return {
      cashboxAmount: payAmt,
      cashboxCurrency: boxCur,
      cashboxExchangeRateToUsd: payRate,
      amountUsd,
      paymentExchangeRateToUsd: payRate,
    };
  }

  const boxRate = await resolveRate(client, companyId, boxCur);
  const cashboxAmount = boxCur === 'USD' ? amountUsd : round2(amountUsd * boxRate);

  return {
    cashboxAmount,
    cashboxCurrency: boxCur,
    cashboxExchangeRateToUsd: boxRate,
    amountUsd,
    paymentExchangeRateToUsd: payRate,
  };
}
