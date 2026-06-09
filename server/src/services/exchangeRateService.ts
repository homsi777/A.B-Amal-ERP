import { getPool } from '../db/pool.js';
import type { PoolClient } from 'pg';

export type SupportedCurrencyCode = 'USD' | 'SYP' | 'TRY' | 'EGP';

export type ExchangeRateRow = {
  id: string;
  company_id: string;
  currency_code: string;
  currency_name_ar: string;
  currency_name_en: string | null;
  currency_symbol: string | null;
  exchange_rate_to_usd: string;
  is_base: boolean;
  is_active: boolean;
  effective_from: string;
  created_at: string;
  updated_at: string;
};

const DEFAULT_RATES: Record<SupportedCurrencyCode, { nameAr: string; nameEn: string; symbol: string; rate: number; isBase: boolean }> = {
  USD: { nameAr: 'دولار أمريكي', nameEn: 'United States Dollar', symbol: '$', rate: 1, isBase: true },
  SYP: { nameAr: 'الليرة السورية', nameEn: 'Syrian Pound', symbol: 'ل.س', rate: 15000, isBase: false },
  TRY: { nameAr: 'الليرة التركية', nameEn: 'Turkish Lira', symbol: '₺', rate: 32, isBase: false },
  EGP: { nameAr: 'الجنيه المصري', nameEn: 'Egyptian Pound', symbol: 'ج.م', rate: 50, isBase: false },
};

export function isSupportedCurrency(code: string): code is SupportedCurrencyCode {
  return code === 'USD' || code === 'SYP' || code === 'TRY' || code === 'EGP';
}

export async function ensureDefaultExchangeRates(companyId: string): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureDefaultExchangeRatesTx(client, companyId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureDefaultExchangeRatesTx(client: Pick<PoolClient, 'query'>, companyId: string): Promise<void> {
  for (const [code, def] of Object.entries(DEFAULT_RATES) as [SupportedCurrencyCode, (typeof DEFAULT_RATES)[SupportedCurrencyCode]][]) {
    await client.query(
      `INSERT INTO exchange_rates
         (company_id, currency_code, currency_name_ar, currency_name_en, currency_symbol, exchange_rate_to_usd, is_base, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true)
       ON CONFLICT (company_id, currency_code)
       DO NOTHING`,
      [companyId, code, def.nameAr, def.nameEn, def.symbol, def.rate, def.isBase],
    );
  }
}

export async function getExchangeRateToUsdTx(
  client: Pick<PoolClient, 'query'>,
  companyId: string,
  currencyCode: string,
): Promise<number | null> {
  const code = String(currencyCode || '').trim().toUpperCase();
  if (!isSupportedCurrency(code)) return null;
  await ensureDefaultExchangeRatesTx(client, companyId);
  const r = await client.query<{ exchange_rate_to_usd: string }>(
    `SELECT exchange_rate_to_usd
     FROM exchange_rates
     WHERE company_id=$1 AND currency_code=$2
     LIMIT 1`,
    [companyId, code],
  );
  const v = r.rows[0]?.exchange_rate_to_usd;
  const rate = Number(v);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return rate;
}

export async function listExchangeRates(companyId: string): Promise<ExchangeRateRow[]> {
  await ensureDefaultExchangeRates(companyId);
  const r = await getPool().query<ExchangeRateRow>(
    `SELECT *
     FROM exchange_rates
     WHERE company_id=$1
     ORDER BY CASE WHEN currency_code='USD' THEN 0 ELSE 1 END, currency_code ASC`,
    [companyId],
  );
  return r.rows;
}

export async function getExchangeRate(companyId: string, currencyCode: string): Promise<ExchangeRateRow | null> {
  if (!isSupportedCurrency(currencyCode)) return null;
  await ensureDefaultExchangeRates(companyId);
  const r = await getPool().query<ExchangeRateRow>(
    `SELECT *
     FROM exchange_rates
     WHERE company_id=$1 AND currency_code=$2
     LIMIT 1`,
    [companyId, currencyCode],
  );
  return r.rows[0] ?? null;
}

export async function updateExchangeRate(input: {
  companyId: string;
  userId: string;
  currencyCode: string;
  exchangeRateToUsd: number;
  isActive?: boolean;
}): Promise<ExchangeRateRow> {
  const code = String(input.currencyCode || '').trim().toUpperCase();
  if (!isSupportedCurrency(code)) {
    throw Object.assign(new Error('العملة غير مدعومة حالياً'), { code: 'VALIDATION' });
  }
  const rate = Number(input.exchangeRateToUsd);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw Object.assign(new Error('يرجى إدخال سعر صرف صحيح'), { code: 'VALIDATION' });
  }
  if (code === 'USD' && Math.abs(rate - 1) > 1e-9) {
    throw Object.assign(new Error('سعر صرف الدولار يجب أن يكون 1'), { code: 'VALIDATION' });
  }

  await ensureDefaultExchangeRates(input.companyId);
  const isActive = code === 'USD' ? true : input.isActive ?? true;

  const r = await getPool().query<ExchangeRateRow>(
    `UPDATE exchange_rates
        SET exchange_rate_to_usd=$3,
            is_active=$4,
            updated_by_user_id=$5,
            updated_at=now()
      WHERE company_id=$1 AND currency_code=$2
      RETURNING *`,
    [input.companyId, code, rate, isActive, input.userId],
  );
  if (!r.rows.length) {
    throw Object.assign(new Error('تعذر تحديث سعر الصرف'), { code: 'NOT_FOUND' });
  }
  return r.rows[0];
}
