-- إضافية بحتة — المرحلة 1 من نظام HR: حقول ملف الموظف الإضافية + تاريخ تغييرات
-- قاعدة الأجر. لا حذف ولا تغيير لأي عمود/جدول موجود — payroll_employees يبقى
-- يعمل بالضبط كما كان لأي كود حالي (Salaries.tsx، payrollRoutes.ts القديم).
ALTER TABLE payroll_employees
  ADD COLUMN IF NOT EXISTS fingerprint_code text,
  ADD COLUMN IF NOT EXISTS factory text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS termination_date date,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE payroll_employees DROP CONSTRAINT IF EXISTS payroll_employees_status_chk;
ALTER TABLE payroll_employees
  ADD CONSTRAINT payroll_employees_status_chk
  CHECK (status IN ('ACTIVE', 'TERMINATED', 'SUSPENDED'));

-- رقم البصمة هو أساس ربط الحضور بالموظف (لا الاسم) — فريد لكل شركة عند وجوده.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_employees_company_fingerprint
  ON payroll_employees(company_id, fingerprint_code)
  WHERE fingerprint_code IS NOT NULL;

-- يحفظ كل تغيير بقاعدة أجر الموظف بتاريخه — لا يُفقَد تاريخ التغييرات، ولا يُعاد
-- حساب رواتب شهر سابق مُعتمَد عند تعديل أجر الموظف لاحقاً (القيم تُنسَخ حرفياً
-- بسطر الراتب وقت الاعتماد، لا تُقرَأ من هنا حيّة في كل مرة).
CREATE TABLE employee_wage_rule_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  base_salary numeric(14,2) NOT NULL,
  allowances jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_employee_wage_rule_history_employee
  ON employee_wage_rule_history(company_id, employee_id, effective_from DESC);
