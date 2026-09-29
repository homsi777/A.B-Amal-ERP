export const LANGUAGE_STORAGE_KEY = 'fabric-erp-language';

/** يُضبَط عند تبديل يدوي صريح للغة — بعدها لا يُبدَّل تلقائياً حسب لغة الفرع الافتراضية. */
export const LANGUAGE_MANUAL_OVERRIDE_KEY = 'fabric-erp-language-manual-override';

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

export function hasManualLanguageOverride(): boolean {
  try {
    return localStorage.getItem(LANGUAGE_MANUAL_OVERRIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markManualLanguageOverride(): void {
  try {
    localStorage.setItem(LANGUAGE_MANUAL_OVERRIDE_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function applyDocumentLanguage(language: AppLanguage): void {
  const root = document.documentElement;
  root.lang = language;
  root.dir = language === 'ar' ? 'rtl' : 'ltr';
}
