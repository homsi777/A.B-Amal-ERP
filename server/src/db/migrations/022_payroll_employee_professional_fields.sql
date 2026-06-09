-- Employee profile fields needed by the payroll UI.

ALTER TABLE payroll_employees
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS salary_period text NOT NULL DEFAULT 'monthly';

ALTER TABLE payroll_employees DROP CONSTRAINT IF EXISTS payroll_employees_salary_period_chk;
ALTER TABLE payroll_employees
  ADD CONSTRAINT payroll_employees_salary_period_chk
  CHECK (salary_period IN ('weekly', 'monthly'));

CREATE INDEX IF NOT EXISTS idx_payroll_employees_salary_period
  ON payroll_employees(company_id, salary_period);
