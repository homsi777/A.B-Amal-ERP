import type { SupportedCurrencyCode } from './api/exchangeRatesApi';

export const BASE_CURRENCY: SupportedCurrencyCode = 'USD';

export const SUPPORTED_CURRENCIES: { code: SupportedCurrencyCode; nameAr: string; symbol: string }[] = [
  { code: 'USD', nameAr: 'الدولار الأمريكي', symbol: '$' },
  { code: 'SYP', nameAr: 'الليرة السورية', symbol: 'ل.س' },
  { code: 'TRY', nameAr: 'الليرة التركية', symbol: '₺' },
  { code: 'EGP', nameAr: 'الجنيه المصري', symbol: 'ج.م' },
];

export function getCurrencyLabel(code: string): string {
  const found = SUPPORTED_CURRENCIES.find((c) => c.code === code);
  return found ? `${found.nameAr} (${found.code})` : String(code || 'USD');
}

export function getCurrencySymbol(code: string): string {
  const found = SUPPORTED_CURRENCIES.find((c) => c.code === code);
  return found?.symbol || '$';
}

export function normalizeExchangeRate(value: unknown): number {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

export function convertToUsd(amountOriginal: number, exchangeRateToUsd: number): number {
  const amt = Number(amountOriginal);
  const rate = Number(exchangeRateToUsd);
  if (!Number.isFinite(amt) || !Number.isFinite(rate) || rate <= 0) return 0;
  return amt / rate;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatCurrency(amount: number, currencyCode: string): string {
  const code = String(currencyCode || 'USD');
  return `${Number(amount || 0).toLocaleString('ar', { maximumFractionDigits: 2 })} ${code}`;
}

export function formatUsd(amountUsd: number): string {
  return `${Number(amountUsd || 0).toLocaleString('ar', { maximumFractionDigits: 2 })} USD`;
}

