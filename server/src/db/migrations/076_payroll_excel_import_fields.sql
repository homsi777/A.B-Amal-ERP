-- إضافية بحتة — المرحلة 4أ من نظام HR: استيراد شيت "الاجر" المحسوب فعلاً من
-- Excel كسجلات رواتب حقيقية، مع تصحيح ثغرة عملة كانت موجودة مسبقاً.
ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS exchange_rate_to_usd numeric(14,6) NOT NULL DEFAULT 1;

-- excel_detail: نسخة كاملة من كل حقول شيت "الاجر" لهذا الموظف بهذا الشهر (مفاتيح
-- عربية = عناوين الأعمدة الفعلية بالملف) — للطباعة/التحقق، بلا إعادة حساب.
ALTER TABLE payroll_run_lines
  ADD COLUMN IF NOT EXISTS excel_detail jsonb,
  ADD COLUMN IF NOT EXISTS source_file text,
  ADD COLUMN IF NOT EXISTS employee_fingerprint_code text;
