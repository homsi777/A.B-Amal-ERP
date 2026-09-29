import i18n from './config';
import {
  applyDocumentLanguage,
  hasManualLanguageOverride,
  isAppLanguage,
  LANGUAGE_STORAGE_KEY,
  type AppLanguage,
} from './constants';

/**
 * يُطبَّق عند تسجيل الدخول / تحميل الجلسة / تبديل الحساب — يضبط لغة الواجهة
 * تلقائياً حسب لغة الفرع الافتراضية (سوريا=ar، تركيا=tr)، إلا إذا كان
 * المستخدم قد بدّل اللغة يدوياً من قبل عبر LanguageSwitcher (عندها تبقى
 * أولوية اختياره الشخصي دائماً، ولا نُعيد الكتابة فوقه).
 */
export async function applyCompanyDefaultLanguage(language: string | null | undefined): Promise<void> {
  if (!isAppLanguage(language)) return;
  if (hasManualLanguageOverride()) return;
  const target = language as AppLanguage;
  if (i18n.language === target) return;

  await i18n.changeLanguage(target);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, target);
  } catch {
    /* ignore */
  }
  applyDocumentLanguage(target);
}
