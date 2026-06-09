-- Financial foundation: return invoices, party activity, cashboxes, vouchers, payroll
-- No business seed data — only schema.

-- A. return_invoices
CREATE TABLE return_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  return_no text NOT NULL,
  return_type text NOT NULL DEFAULT 'SALES_RETURN',
  customer_id uuid REFERENCES customers(id),
  supplier_id uuid REFERENCES suppliers(id),
  original_invoice_no text,
  return_date date NOT NULL DEFAULT (current_date),
  currency_code text NOT NULL DEFAULT 'USD',
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_total numeric(14,2) NOT NULL DEFAULT 0,
  tax_total numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT',
  notes text,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT return_invoices_company_return_no UNIQUE (company_id, return_no),
  CONSTRAINT return_invoices_type_chk CHECK (return_type IN ('SALES_RETURN', 'PURCHASE_RETURN')),
  CONSTRAINT return_invoices_status_chk CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED'))
);

CREATE INDEX idx_return_invoices_company ON return_invoices(company_id);
CREATE INDEX idx_return_invoices_company_status ON return_invoices(company_id, status);
CREATE INDEX idx_return_invoices_company_date ON return_invoices(company_id, return_date);

-- B. return_invoice_lines
CREATE TABLE return_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  return_invoice_id uuid NOT NULL REFERENCES return_invoices(id) ON DELETE CASCADE,
  fabric_roll_id uuid REFERENCES fabric_rolls(id),
  fabric_item_id uuid REFERENCES fabric_items(id),
  description text NOT NULL,
  quantity numeric(14,3) NOT NULL DEFAULT 1,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  line_total numeric(14,2) NOT NULL DEFAULT 0,
  notes text
);

CREATE INDEX idx_return_invoice_lines_company ON return_invoice_lines(company_id);
CREATE INDEX idx_return_invoice_lines_return ON return_invoice_lines(return_invoice_id);

-- C. party_activity_logs
CREATE TABLE party_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  party_type text NOT NULL,
  party_id uuid,
  party_name text NOT NULL,
  activity_type text NOT NULL,
  reference_type text,
  reference_id uuid,
  reference_no text,
  amount numeric(14,2),
  currency_code text,
  description text NOT NULL,
  activity_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_activity_logs_party_type_chk CHECK (party_type IN ('CUSTOMER', 'SUPPLIER'))
);

CREATE INDEX idx_party_logs_company ON party_activity_logs(company_id);
CREATE INDEX idx_party_logs_party ON party_activity_logs(company_id, party_type, party_id);
CREATE INDEX idx_party_logs_activity_at ON party_activity_logs(company_id, activity_at DESC);
CREATE INDEX idx_party_logs_activity_type ON party_activity_logs(company_id, activity_type);

-- D. cashboxes
CREATE TABLE cashboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  current_balance numeric(14,2) NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashboxes_company_code UNIQUE (company_id, code)
);

CREATE INDEX idx_cashboxes_company ON cashboxes(company_id);
CREATE INDEX idx_cashboxes_company_active ON cashboxes(company_id, is_active);

-- E. cashbox_movements
CREATE TABLE cashbox_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cashbox_id uuid NOT NULL REFERENCES cashboxes(id),
  movement_no text NOT NULL,
  movement_type text NOT NULL,
  direction text NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  balance_after numeric(14,2),
  source_type text,
  source_id uuid,
  source_no text,
  description text NOT NULL,
  movement_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashbox_movements_company_movement_no UNIQUE (company_id, movement_no),
  CONSTRAINT cashbox_movements_type_chk CHECK (movement_type IN (
    'OPENING', 'RECEIPT', 'PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT'
  )),
  CONSTRAINT cashbox_movements_direction_chk CHECK (direction IN ('IN', 'OUT'))
);

CREATE INDEX idx_cashbox_movements_company ON cashbox_movements(company_id);
CREATE INDEX idx_cashbox_movements_cashbox_at ON cashbox_movements(cashbox_id, movement_at DESC);
CREATE INDEX idx_cashbox_movements_source ON cashbox_movements(company_id, source_type, source_id);

-- F. vouchers
CREATE TABLE vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  voucher_no text NOT NULL,
  voucher_type text NOT NULL,
  voucher_date date NOT NULL DEFAULT (current_date),
  cashbox_id uuid REFERENCES cashboxes(id),
  party_type text,
  party_id uuid,
  party_name text NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  payment_method text NOT NULL DEFAULT 'CASH',
  status text NOT NULL DEFAULT 'DRAFT',
  description text,
  notes text,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vouchers_company_voucher_no UNIQUE (company_id, voucher_no),
  CONSTRAINT vouchers_type_chk CHECK (voucher_type IN ('RECEIPT', 'PAYMENT')),
  CONSTRAINT vouchers_party_type_chk CHECK (
    party_type IS NULL OR party_type IN ('CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OTHER')
  ),
  CONSTRAINT vouchers_payment_method_chk CHECK (payment_method IN ('CASH', 'BANK', 'TRANSFER', 'OTHER')),
  CONSTRAINT vouchers_status_chk CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED'))
);

CREATE INDEX idx_vouchers_company ON vouchers(company_id);
CREATE INDEX idx_vouchers_company_status_date ON vouchers(company_id, status, voucher_date DESC);
CREATE INDEX idx_vouchers_cashbox ON vouchers(company_id, cashbox_id);

-- G. payroll_employees
CREATE TABLE payroll_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_code text NOT NULL,
  full_name text NOT NULL,
  job_title text,
  department text,
  phone text,
  base_salary numeric(14,2) NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'USD',
  hire_date date,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_employees_company_code UNIQUE (company_id, employee_code)
);

CREATE INDEX idx_payroll_employees_company ON payroll_employees(company_id);
CREATE INDEX idx_payroll_employees_company_active ON payroll_employees(company_id, is_active);

-- H. payroll_runs
CREATE TABLE payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payroll_no text NOT NULL,
  period_month integer NOT NULL,
  period_year integer NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  total_base numeric(14,2) NOT NULL DEFAULT 0,
  total_allowances numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions numeric(14,2) NOT NULL DEFAULT 0,
  total_net numeric(14,2) NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'USD',
  notes text,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_runs_company_payroll_no UNIQUE (company_id, payroll_no),
  CONSTRAINT payroll_runs_status_chk CHECK (status IN ('DRAFT', 'CONFIRMED', 'PAID', 'CANCELLED'))
);

CREATE INDEX idx_payroll_runs_company ON payroll_runs(company_id);
CREATE INDEX idx_payroll_runs_company_period ON payroll_runs(company_id, period_year, period_month);
CREATE INDEX idx_payroll_runs_company_status ON payroll_runs(company_id, status);

-- I. payroll_run_lines
CREATE TABLE payroll_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES payroll_employees(id),
  base_salary numeric(14,2) NOT NULL DEFAULT 0,
  allowances numeric(14,2) NOT NULL DEFAULT 0,
  deductions numeric(14,2) NOT NULL DEFAULT 0,
  net_salary numeric(14,2) NOT NULL DEFAULT 0,
  notes text
);

CREATE INDEX idx_payroll_run_lines_run ON payroll_run_lines(payroll_run_id);
CREATE INDEX idx_payroll_run_lines_company ON payroll_run_lines(company_id);
