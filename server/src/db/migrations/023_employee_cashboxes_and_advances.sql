-- Dedicated employee funds and employee advances.
-- Cashboxes are currency-specific to avoid mixing SYP/TRY/USD balances.

INSERT INTO cashboxes (company_id, code, name, currency_code, opening_balance, current_balance, is_default, is_active, notes)
SELECT c.id, v.code, v.name, v.currency_code, 0, 0, false, true, 'صندوق افتراضي مخصص لتسليم رواتب وسلف الموظفين'
FROM companies c
CROSS JOIN (
  VALUES
    ('EMP-SYP', 'صندوق الموظفين - ليرة سورية', 'SYP'),
    ('EMP-TRY', 'صندوق الموظفين - ليرة تركية', 'TRY'),
    ('EMP-USD', 'صندوق الموظفين - دولار', 'USD')
) AS v(code, name, currency_code)
ON CONFLICT (company_id, code) DO NOTHING;

CREATE TABLE payroll_employee_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES payroll_employees(id),
  voucher_id uuid REFERENCES vouchers(id) ON DELETE SET NULL,
  cashbox_id uuid NOT NULL REFERENCES cashboxes(id),
  advance_no text NOT NULL,
  advance_date date NOT NULL DEFAULT (current_date),
  amount numeric(14,2) NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  notes text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_employee_advances_company_no UNIQUE (company_id, advance_no),
  CONSTRAINT payroll_employee_advances_amount_chk CHECK (amount > 0)
);

CREATE INDEX idx_payroll_employee_advances_company ON payroll_employee_advances(company_id, advance_date DESC);
CREATE INDEX idx_payroll_employee_advances_employee ON payroll_employee_advances(company_id, employee_id);
CREATE INDEX idx_payroll_employee_advances_cashbox ON payroll_employee_advances(company_id, cashbox_id);
