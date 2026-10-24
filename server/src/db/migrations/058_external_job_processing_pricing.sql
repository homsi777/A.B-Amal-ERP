-- تسعير مهمة "مصنعية" حسب الكيلو أو المتر — إضافي بالكامل، لا يلمس مهام
-- "عامة" (GENERAL) ولا تدفّق ترحيل الأجرة الموجود أصلاً (postExternalJobFee /
-- GL)، الذي يبقى يقرأ fee_amount و fee_currency_code كما هو تماماً.
--
-- approved_quantity هي "الكمية المعتمدة للحساب" — مستقلة تماماً عن الكمية
-- المرسلة فعلياً (external_job_lines.sent_length_m لا تتغيّر أبداً)، قابلة
-- للتعديل اليدوي دائماً، وهي ما يُحتسَب عليه fee_amount = approved_quantity
-- × unit_price، لا كمية الأتواب المرسلة.
ALTER TABLE external_jobs
  ADD COLUMN pricing_method text CHECK (pricing_method IS NULL OR pricing_method IN ('BY_KG', 'BY_METER')),
  ADD COLUMN approved_quantity numeric(14,3) CHECK (approved_quantity IS NULL OR approved_quantity >= 0),
  ADD COLUMN unit_price numeric(14,4) CHECK (unit_price IS NULL OR unit_price >= 0);
