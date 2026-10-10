import type { SupportedCurrencyCode } from './api/exchangeRatesApi';
import i18n from '../i18n/config';

export const BASE_CURRENCY: SupportedCurrencyCode = 'USD';

export const SUPPORTED_CURRENCIES: { code: SupportedCurrencyCode; nameAr: string; nameTr: string; symbol: string }[] = [
  { code: 'USD', nameAr: 'الدولار الأمريكي', nameTr: 'Amerikan Doları', symbol: '$' },
  { code: 'SYP', nameAr: 'الليرة السورية', nameTr: 'Suriye Lirası', symbol: 'ل.س' },
  { code: 'TRY', nameAr: 'الليرة التركية', nameTr: 'Türk Lirası', symbol: '₺' },
  { code: 'EGP', nameAr: 'الجنيه المصري', nameTr: 'Mısır Lirası', symbol: 'ج.م' },
];

export function getCurrencyName(code: string): string {
  const found = SUPPORTED_CURRENCIES.find((c) => c.code === code);
  if (!found) return String(code || 'USD');
  return i18n.language === 'ar' ? found.nameAr : found.nameTr;
}

export function getCurrencyLabel(code: string): string {
  const found = SUPPORTED_CURRENCIES.find((c) => c.code === code);
  return found ? `${getCurrencyName(found.code)} (${found.code})` : String(code || 'USD');
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
  const locale = i18n.language === 'ar' ? 'ar' : 'tr';
  return `${Number(amount || 0).toLocaleString(locale, { maximumFractionDigits: 2 })} ${code}`;
}

export function formatUsd(amountUsd: number): string {
  const locale = i18n.language === 'ar' ? 'ar' : 'tr';
  return `${Number(amountUsd || 0).toLocaleString(locale, { maximumFractionDigits: 2 })} USD`;
}

