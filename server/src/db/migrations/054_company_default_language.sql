-- لغة الواجهة الافتراضية لكل حساب/فرع (سوريا=ar، تركيا=tr) — تُطبَّق تلقائياً
-- عند تسجيل الدخول أو تبديل الحساب، ما لم يكن المستخدم قد بدّل اللغة يدوياً
-- من قبل (تفضيل يدوي محفوظ بالمتصفح يبقى له الأولوية دائماً).
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS default_language text NOT NULL DEFAULT 'ar';

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_default_language_chk;
ALTER TABLE companies
  ADD CONSTRAINT companies_default_language_chk CHECK (default_language IN ('ar', 'tr'));
