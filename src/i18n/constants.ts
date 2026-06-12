export const LANGUAGE_STORAGE_KEY = 'obada-erp-language';

export type AppLanguage = 'ar' | 'tr';

export const DEFAULT_LANGUAGE: AppLanguage = 'ar';

export function isAppLanguage(value: string | null | undefined): value is AppLanguage {
  return value === 'ar' || value === 'tr';
}

export function readStoredLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isAppLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function applyDocumentLanguage(language: AppLanguage): void {
  const root = document.documentElement;
  root.lang = language;
  root.dir = language === 'ar' ? 'rtl' : 'ltr';
}
