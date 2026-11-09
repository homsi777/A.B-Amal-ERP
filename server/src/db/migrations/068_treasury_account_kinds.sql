-- إضافية بحتة (لا حذف ولا تعديل بيانات) — تضيف نوع الحساب (صندوق نقدي/بنك/محفظة
-- فودافون كاش/خزينة شيكات) وربطاً اختيارياً بحساب رئيسي للتجميع بالعرض فقط، فوق
-- جدول cashboxes الموجود. كل الصناديق الحالية تبقى 'CASH' تلقائياً — سلوكها
-- المحاسبي الحالي (الترحيل لحساب GL_CASH الموحّد) لا يتغيّر إطلاقاً لأي صندوق قائم.
ALTER TABLE cashboxes
  ADD COLUMN account_kind text NOT NULL DEFAULT 'CASH'
    CHECK (account_kind IN ('CASH', 'BANK', 'WALLET', 'CHECKS'));

ALTER TABLE cashboxes
  ADD COLUMN parent_cashbox_id uuid REFERENCES cashboxes(id);

CREATE INDEX IF NOT EXISTS idx_cashboxes_parent ON cashboxes(parent_cashbox_id) WHERE parent_cashbox_id IS NOT NULL;
