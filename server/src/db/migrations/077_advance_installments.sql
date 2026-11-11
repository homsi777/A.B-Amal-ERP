-- إضافية بحتة — المرحلة 5 من نظام HR: سلف مقسّطة. السلفة الفورية الموجودة
-- (payroll_employee_advances) لا تتأثر — القسط اختياري فقط عند الإنشاء.
ALTER TABLE payroll_employee_advances
  ADD COLUMN IF NOT EXISTS installment_count integer;

CREATE TABLE advance_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  advance_id uuid NOT NULL REFERENCES payroll_employee_advances(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  installment_no integer NOT NULL,
  due_month integer NOT NULL CHECK (due_month BETWEEN 1 AND 12),
  due_year integer NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID')),
  paid_at timestamptz,
  paid_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT advance_installments_advance_no UNIQUE (advance_id, installment_no)
);

CREATE INDEX idx_advance_installments_employee_due
  ON advance_installments(company_id, employee_id, due_year, due_month);
CREATE INDEX idx_advance_installments_advance
  ON advance_installments(advance_id);
