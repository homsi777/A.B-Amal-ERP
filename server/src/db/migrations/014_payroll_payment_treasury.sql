-- Link payroll settlement to treasury (cashbox) for audit and reports

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS paid_cashbox_id uuid REFERENCES cashboxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_at date;

CREATE INDEX IF NOT EXISTS idx_payroll_runs_paid_cashbox
  ON payroll_runs(company_id, paid_cashbox_id)
  WHERE paid_cashbox_id IS NOT NULL;
