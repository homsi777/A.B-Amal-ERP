-- إضافية بحتة — المرحلة 2 من نظام HR: سجل حضور يومي واحد لكل (موظف، تاريخ) بدل
-- ورقة Excel منفصلة لكل يوم. لا تعديل على أي جدول موجود.
CREATE TABLE attendance_daily_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  check_in_time time,
  check_out_time time,
  late_minutes numeric(6,2) NOT NULL DEFAULT 0,
  permission_minutes numeric(6,2) NOT NULL DEFAULT 0,
  total_hours numeric(6,2) NOT NULL DEFAULT 0,
  day_type text NOT NULL DEFAULT 'WORK' CHECK (day_type IN ('WORK', 'REST', 'HOLIDAY')),
  -- IMPORTED: من ملف بصمة مستورد | MANUAL: أُدخل/عُدِّل يدوياً — يحمي من استبدال
  -- صامت عند إعادة استيراد الملف نفسه.
  source text NOT NULL DEFAULT 'IMPORTED' CHECK (source IN ('IMPORTED', 'MANUAL')),
  source_file text,
  edited_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  edited_at timestamptz,
  edit_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_daily_records_company_employee_date UNIQUE (company_id, employee_id, attendance_date)
);

CREATE INDEX idx_attendance_daily_records_company_date ON attendance_daily_records(company_id, attendance_date);
CREATE INDEX idx_attendance_daily_records_employee ON attendance_daily_records(company_id, employee_id, attendance_date);
