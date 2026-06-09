import { apiFetch } from './client';

export type SupportedCurrencyCode = 'USD' | 'SYP' | 'TRY' | 'EGP';

export type ExchangeRateDto = {
  id: string;
  currency_code: SupportedCurrencyCode;
  currency_name_ar: string;
  currency_name_en: string | null;
  currency_symbol: string | null;
  exchange_rate_to_usd: string;
  is_base: boolean;
  is_active: boolean;
  effective_from: string;
  updated_at: string;
};

export async function listExchangeRates() {
  return apiFetch<{ ok: boolean; data: ExchangeRateDto[] }>('/api/exchange-rates');
}

export async function getExchangeRate(currencyCode: SupportedCurrencyCode) {
  return apiFetch<{ ok: boolean; data: ExchangeRateDto }>(`/api/exchange-rates/${currencyCode}`);
}

export async function updateExchangeRate(currencyCode: SupportedCurrencyCode, payload: { exchangeRateToUsd: number; isActive?: boolean }) {
  return apiFetch<{ ok: boolean; data: ExchangeRateDto }>(`/api/exchange-rates/${currencyCode}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

