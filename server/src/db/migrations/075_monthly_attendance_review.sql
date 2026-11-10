-- إضافية بحتة — المرحلة 3 من نظام HR: أنواع الشفتات (لحساب التأخير/الإذن مقابل
-- دوام مطلوب)، وكشف الانتظام الشهري (تجميع + اعتماد/تجميد قبل حساب الراتب).
CREATE TABLE attendance_shift_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  crosses_midnight boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_shift_types_company_code UNIQUE (company_id, code)
);

-- الدوام المطلوب الافتراضي لكل موظف — لا سجل تاريخي لتغييرات الشفت (نادر
-- التغيير عملياً)، بعكس تاريخ تغييرات الأجر الذي يُحفَظ دوماً.
ALTER TABLE payroll_employees
  ADD COLUMN IF NOT EXISTS shift_type_id uuid REFERENCES attendance_shift_types(id);

CREATE TABLE monthly_attendance_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year integer NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED')),
  days_present integer NOT NULL DEFAULT 0,
  total_hours numeric(8,2) NOT NULL DEFAULT 0,
  total_late_minutes numeric(8,2) NOT NULL DEFAULT 0,
  total_permission_minutes numeric(8,2) NOT NULL DEFAULT 0,
  notes text,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monthly_attendance_reviews_company_employee_period
    UNIQUE (company_id, employee_id, period_month, period_year)
);

CREATE INDEX idx_monthly_attendance_reviews_period
  ON monthly_attendance_reviews(company_id, period_year, period_month);
