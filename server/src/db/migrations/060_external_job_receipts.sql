-- استلام واحد فقط لكل مهمة "مصنعية" — يسجّل رجوع الخامة بالإجمالي (أمتار
-- وأوزان)، بدون استلام دفعات وبدون مطابقة باركودات الأتواب الفردية. موظف
-- المستودع يحدد يدوياً حالة التوب الناتج (متاح/تالف) والمستودع الذي يدخله.
-- job_id UNIQUE يفرض "استلام واحد فقط" على مستوى قاعدة البيانات نفسها.
--
-- منفصل بالكامل عن جدول المطابقة المالية external_job_line_matches (الذي
-- يطابق فواتير الشراء) — هذا الجدول فعلي-مخزوني (ينشئ توباً حقيقياً)، وذاك
-- محاسبي-كمّي بحت. لا تسعير ولا أجرة هنا إطلاقاً.
CREATE TABLE external_job_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL UNIQUE REFERENCES external_jobs(id),
  returned_length_m numeric(14,3) NOT NULL CHECK (returned_length_m >= 0),
  returned_weight_kg numeric(14,3) CHECK (returned_weight_kg IS NULL OR returned_weight_kg >= 0),
  destination_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  roll_status text NOT NULL DEFAULT 'AVAILABLE' CHECK (roll_status IN ('AVAILABLE', 'DAMAGED')),
  result_roll_id uuid REFERENCES fabric_rolls(id),
  notes text,
  received_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  -- الفرق (المرسل - الراجع) المعتمَد كفاقد — تسجيل/تقرير فقط، بلا أي قيد
  -- محاسبي أو حركة مخزون؛ محصور بالمحاسب أو المدير على مستوى المسار.
  shortage_approved_length_m numeric(14,3) NOT NULL DEFAULT 0
    CHECK (shortage_approved_length_m >= 0),
  shortage_notes text,
  shortage_approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  shortage_approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_external_job_receipts_company ON external_job_receipts(company_id);
